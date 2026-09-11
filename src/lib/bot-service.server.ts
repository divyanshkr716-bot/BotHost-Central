/**
 * All bot business logic. Server-only (never reaches the browser bundle).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { encryptSecret, decryptSecret, generateWebhookSecret, redact } from "./crypto.server";
import {
  getMe,
  getChat,
  getChatMember,
  setWebhook,
  deleteWebhook,
  getWebhookInfo,
  sendMessage,
  sendDocumentBytes,
} from "./telegram.server";
import { verifyStorageChannel } from "./storage-media.server";
import { safeExtract, analyzeProject, buildAdapterPlan, sha256Hex, ZipError } from "./analyze.server";
import { webhookUrlFor } from "./public-url";
import { loadEnv } from "./flix/config.server";


export class AppError extends Error {}

// ---------- rate limiting (persistent, works across instances) ----------
export async function rateLimit(subject: string, action: string, max: number, windowSec: number) {
  const since = new Date(Date.now() - windowSec * 1000).toISOString();
  const { count } = await supabaseAdmin
    .from("rate_limits")
    .select("id", { count: "exact", head: true })
    .eq("subject", subject)
    .eq("action", action)
    .gte("created_at", since);
  if ((count ?? 0) >= max)
    throw new AppError(`Rate limit reached for "${action}". Try again in ${windowSec} seconds.`);
  await supabaseAdmin.from("rate_limits").insert({ subject, action });
}

export async function audit(
  userId: string | null,
  botId: string | null,
  action: string,
  detail?: string,
) {
  await supabaseAdmin.from("audit_logs").insert({
    user_id: userId,
    bot_id: botId,
    action,
    detail: detail ? redact(detail) : null,
  });
}

async function log(
  botId: string | null,
  level: string,
  event: string,
  status: string,
  message: string,
) {
  await supabaseAdmin.from("runtime_logs").insert({
    bot_id: botId,
    level,
    event,
    status,
    message: redact(message),
  });
}

// ---------- ownership ----------
export async function assertOwner(db: SupabaseClient, botId: string) {
  const { data, error } = await db.from("bots").select("*").eq("id", botId).maybeSingle();
  if (error) throw new AppError(error.message);
  if (!data) throw new AppError("Bot not found or you do not have access to it.");
  return data;
}

async function tokenFor(botId: string): Promise<string> {
  const { data } = await supabaseAdmin
    .from("bot_credentials")
    .select("token_ciphertext, token_iv")
    .eq("bot_id", botId)
    .maybeSingle();
  if (!data) throw new AppError("No Telegram token stored for this bot.");
  return decryptSecret(data.token_ciphertext, data.token_iv);
}

// ---------- profile ----------
export async function ensureProfile(db: SupabaseClient, userId: string, email: string | null) {
  await db.from("profiles").upsert({ id: userId, email }, { onConflict: "id" });
}

// ---------- token validation ----------
export async function validateToken(userId: string, token: string) {
  await rateLimit(userId, "validate_token", 20, 60);
  const res = await getMe(token.trim());
  if (!res.ok) return { valid: false as const, error: res.error };
  return {
    valid: true as const,
    bot: {
      id: res.result.id,
      username: res.result.username ?? null,
      first_name: res.result.first_name,
    },
  };
}

// ---------- create bot ----------
export async function createBot(
  db: SupabaseClient,
  userId: string,
  input: {
    name: string;
    token: string;
    ownerTelegramId?: number | null | undefined;
    storageChannelId?: number | null | undefined;
    env?: { key: string; value: string }[] | undefined;
  },
) {
  await rateLimit(userId, "create_bot", 10, 300);
  const me = await getMe(input.token.trim());
  if (!me.ok) throw new AppError(`Telegram rejected this token: ${me.error}`);

  const { data: bot, error } = await db
    .from("bots")
    .insert({
      user_id: userId,
      name: input.name,
      telegram_bot_id: me.result.id,
      telegram_username: me.result.username ?? null,
      telegram_first_name: me.result.first_name,
      owner_telegram_id: input.ownerTelegramId ?? null,
      status: "NOT_DEPLOYED",
    })
    .select()
    .single();
  if (error) throw new AppError(error.message);

  const enc = await encryptSecret(input.token.trim());
  const secret = generateWebhookSecret();
  const encSecret = await encryptSecret(secret);
  await supabaseAdmin.from("bot_credentials").insert({
    bot_id: bot.id,
    token_ciphertext: enc.ciphertext,
    token_iv: enc.iv,
    webhook_secret_ciphertext: encSecret.ciphertext,
    webhook_secret_iv: encSecret.iv,
  });
  await db.from("bot_settings").insert({ bot_id: bot.id });
  await db.from("bot_projects").insert({ bot_id: bot.id, name: input.name });

  const envRows = [
    { key: "BOT_TOKEN", value: input.token.trim() },
    ...(input.ownerTelegramId ? [{ key: "OWNER_ID", value: String(input.ownerTelegramId) }] : []),
    ...(input.storageChannelId
      ? [{ key: "STORAGE_CHANNEL_ID", value: String(input.storageChannelId) }]
      : []),
    ...(input.env ?? []),
  ];
  for (const row of envRows) await setEnvVar(bot.id, row.key, row.value);

  let storage: Awaited<ReturnType<typeof verifyStorageChannel>> | null = null;
  if (input.storageChannelId) {
    storage = await verifyStorage(db, bot.id, input.storageChannelId);
  }

  await audit(userId, bot.id, "BOT_CREATED", `Bot "${input.name}" created`);
  await log(bot.id, "INFO", "TELEGRAM", "verified", `Token verified via getMe as @${me.result.username}`);
  return { bot, telegram: me.result, storage };
}

export async function setEnvVar(botId: string, key: string, value: string) {
  const enc = await encryptSecret(value);
  await supabaseAdmin.from("bot_environment_variables").upsert(
    {
      bot_id: botId,
      key,
      value_ciphertext: enc.ciphertext,
      value_iv: enc.iv,
      is_secret: /TOKEN|SECRET|KEY|PASSWORD|DATABASE_URL/i.test(key),
    },
    { onConflict: "bot_id,key" },
  );
}

export async function listEnvKeys(botId: string) {
  const { data } = await supabaseAdmin
    .from("bot_environment_variables")
    .select("id, key, is_secret, created_at")
    .eq("bot_id", botId)
    .order("key");
  return data ?? [];
}

// ---------- storage channel ----------
export async function verifyStorage(db: SupabaseClient, botId: string, chatId: number) {
  const bot = await assertOwner(db, botId);
  const token = await tokenFor(botId);
  const result = await verifyStorageChannel(token, chatId, Number(bot.telegram_bot_id));
  await db.from("storage_channels").upsert(
    {
      bot_id: botId,
      chat_id: chatId,
      title: result.title ?? null,
      type: result.type ?? null,
      bot_is_admin: result.botIsAdmin,
      can_post_messages: result.canPostMessages,
      verified_at: result.ok ? new Date().toISOString() : null,
      last_error: result.error ?? null,
    },
    { onConflict: "bot_id,chat_id" },
  );
  await log(
    botId,
    result.ok ? "INFO" : "ERROR",
    "STORAGE",
    result.ok ? "verified" : "failed",
    result.ok ? `Storage channel ${chatId} verified` : `Storage verification failed: ${result.error}`,
  );
  return result;
}

// ---------- project upload + analysis ----------
export async function uploadProject(
  db: SupabaseClient,
  userId: string,
  botId: string,
  zipBase64: string,
  fileName: string,
) {
  await assertOwner(db, botId);
  await rateLimit(userId, "upload_project", 20, 300);
  await db.from("bots").update({ status: "ANALYZING" }).eq("id", botId);

  const bin = Uint8Array.from(atob(zipBase64), (c) => c.charCodeAt(0));
  let analysis, plan, hash: string;
  try {
    const files = safeExtract(bin);
    analysis = analyzeProject(files);
    plan = buildAdapterPlan(analysis);
    hash = await sha256Hex(bin);
  } catch (e) {
    const message = e instanceof ZipError ? e.message : `Analysis failed: ${(e as Error).message}`;
    await db.from("bots").update({ status: "ERROR", last_error: message }).eq("id", botId);
    await log(botId, "ERROR", "DEPLOYMENT", "failed", message);
    throw new AppError(message);
  }

  const { data: project } = await db
    .from("bot_projects")
    .select("id")
    .eq("bot_id", botId)
    .maybeSingle();
  if (!project) throw new AppError("Project record missing for this bot.");

  const { data: last } = await db
    .from("bot_project_versions")
    .select("version")
    .eq("project_id", project.id)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const version = (last?.version ?? 0) + 1;

  const storagePath = `${userId}/${botId}/v${version}-${Date.now()}.zip`;

  // Hybrid archive storage: Supabase remains the primary store when available,
  // while every successful archive upload is mirrored to the bot's verified
  // Telegram storage channel. If Supabase Storage is full/unavailable, the
  // Telegram copy becomes the primary reference for this version.
  let supabaseStored = false;
  let telegramStored = false;
  let telegramStorageChatId: number | null = null;
  let telegramStorageMessageId: number | null = null;
  let telegramStorageFileId: string | null = null;
  let storageProvider = "supabase";
  let backupStatus = "pending";

  const upload = await supabaseAdmin.storage
    .from("bot-projects")
    .upload(storagePath, bin, { contentType: "application/zip", upsert: false });
  if (!upload.error) {
    supabaseStored = true;
  } else {
    backupStatus = `supabase_failed:${upload.error.message}`;
  }

  const { data: storageChannel } = await db
    .from("storage_channels")
    .select("chat_id, verified_at")
    .eq("bot_id", botId)
    .not("verified_at", "is", null)
    .maybeSingle();

  if (storageChannel?.chat_id) {
    telegramStorageChatId = Number(storageChannel.chat_id);
    // Telegram Bot API currently accepts multipart document uploads up to 50 MB.
    // Larger archives cannot be mirrored through the hosted Bot API.
    if (bin.byteLength <= 50 * 1024 * 1024) {
      const tg = await sendDocumentBytes(
        input.token.trim(),
        telegramStorageChatId,
        bin,
        fileName || `bot-project-v${version}.zip`,
        `BotHost backup: ${botId} / version ${version}`,
      );
      if (tg.ok) {
        telegramStored = true;
        telegramStorageMessageId = tg.result.message_id;
        telegramStorageFileId = tg.result.document?.file_id ?? null;
        backupStatus = supabaseStored ? "backed_up" : "telegram_primary";
      } else {
        backupStatus = `telegram_backup_failed:${tg.error}`;
      }
    } else {
      backupStatus = "telegram_backup_skipped_over_50mb";
    }
  } else {
    backupStatus = "telegram_backup_unavailable_no_verified_storage_channel";
  }

  if (!supabaseStored && !telegramStored) {
    throw new AppError(
      `Could not store the project archive. Supabase Storage failed and Telegram backup was unavailable: ${backupStatus}`,
    );
  }

  if (!supabaseStored && telegramStored) {
    storageProvider = "telegram";
  }
  const effectiveStoragePath = supabaseStored
    ? storagePath
    : `telegram://${telegramStorageChatId}/${telegramStorageMessageId}`;

  const { data: versionRow, error } = await db
    .from("bot_project_versions")
    .insert({
      project_id: project.id,
      bot_id: botId,
      version,
      storage_path: effectiveStoragePath,
      storage_provider: storageProvider,
      telegram_storage_chat_id: telegramStorageChatId,
      telegram_storage_message_id: telegramStorageMessageId,
      telegram_storage_file_id: telegramStorageFileId,
      backup_status: backupStatus,
      project_hash: hash,
      file_count: analysis.fileCount,
      total_bytes: analysis.totalBytes,
      compatibility: analysis.compatibility,
      analysis: analysis as unknown as Record<string, unknown>,
      adapter_plan: plan as unknown as Record<string, unknown>,
    })
    .select()
    .single();
  if (error) throw new AppError(error.message);

  await db.from("bots").update({
    status: analysis.compatibility === "READY" ? "NOT_DEPLOYED" : "NEEDS_ADAPTATION",
    last_error: null,
  }).eq("id", botId);
  await audit(userId, botId, "PROJECT_UPLOADED", `${fileName} → version ${version} (${analysis.compatibility})`);
  await log(botId, "INFO", "DEPLOYMENT", "analyzed", `Version ${version} analyzed: ${analysis.compatibility}`);

  return { version: versionRow, analysis, plan };
}

// ---------- deployment ----------
type Step = { name: string; status: "ok" | "failed" | "skipped"; detail?: string };

export async function deployBot(
  db: SupabaseClient,
  userId: string,
  botId: string,
  requestUrl: string,
  versionId?: string,
) {
  await assertOwner(db, botId);
  await rateLimit(userId, "deploy", 10, 300);
  const started = Date.now();
  const steps: Step[] = [];

  const { data: deployment } = await supabaseAdmin
    .from("bot_deployments")
    .insert({ bot_id: botId, status: "DEPLOYING", steps: [] })
    .select()
    .single();
  const deploymentId = deployment!.id;

  const push = async (name: string, status: Step["status"], detail?: string) => {
    steps.push({ name, status, ...(detail ? { detail: redact(detail) } : {}) });
    await supabaseAdmin.from("deployment_logs").insert({
      deployment_id: deploymentId,
      bot_id: botId,
      step: name,
      status,
      message: detail ? redact(detail) : null,
    });
  };

  const fail = async (message: string) => {
    await supabaseAdmin
      .from("bot_deployments")
      .update({
        status: "FAILED",
        steps: steps as unknown as never,
        error: redact(message),
        duration_ms: Date.now() - started,
      })
      .eq("id", deploymentId);
    await db.from("bots").update({ status: "ERROR", last_error: redact(message) }).eq("id", botId);
    await log(botId, "ERROR", "DEPLOYMENT", "failed", message);
    throw new AppError(message);
  };

  await db.from("bots").update({ status: "DEPLOYING", last_error: null }).eq("id", botId);

  // 1. token
  let token: string;
  try {
    token = await tokenFor(botId);
  } catch (e) {
    return fail((e as Error).message);
  }
  const me = await getMe(token);
  if (!me.ok) return fail(`Telegram token validation failed: ${me.error}`);
  await push("Validate Telegram token", "ok", `@${me.result.username}`);

  // 2. runtime / adapter
  const { data: project } = await db
    .from("bot_projects")
    .select("id, active_version_id")
    .eq("bot_id", botId)
    .maybeSingle();
  const { data: version } = versionId
    ? await db.from("bot_project_versions").select("*").eq("id", versionId).maybeSingle()
    : await db
        .from("bot_project_versions")
        .select("*")
        .eq("bot_id", botId)
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();

  if (!version) return fail("No uploaded project version found. Upload a project ZIP first.");
  if (version.compatibility === "INCOMPATIBLE")
    return fail(
      "This version is INCOMPATIBLE with the serverless webhook runtime and cannot be deployed. Review the compatibility report and adapt the project manually.",
    );
  const plan = version.adapter_plan as { handlers?: unknown[]; unsupported?: unknown[]; mediaCapture?: boolean };
  const adapted = plan?.handlers?.length ?? 0;
  // The built-in My Flix runtime serves commands, callbacks, search and storage
  // indexing even when the static analyzer derived no adapted handlers, so an
  // empty adapter plan is not by itself a deployment blocker.
  await push(
    "Prepare webhook runtime",
    "ok",
    adapted
      ? `${adapted} adapted handler(s), ${plan.unsupported?.length ?? 0} unsupported, plus the built-in runtime`
      : "No adapted handlers derived from this version; the built-in runtime (commands, search, media, storage indexing) will serve updates",
  );


  // 3. storage (optional but reported honestly)
  const { data: channel } = await db
    .from("storage_channels")
    .select("*")
    .eq("bot_id", botId)
    .maybeSingle();
  if (!channel) await push("Storage channel", "skipped", "No storage channel configured");
  else if (!channel.verified_at)
    await push("Storage channel", "failed", channel.last_error ?? "Channel not verified");
  else await push("Storage channel", "ok", `Verified channel ${channel.chat_id}`);

  // 4. register webhook
  const url = webhookUrlFor(requestUrl, botId);
  const { data: cred } = await supabaseAdmin
    .from("bot_credentials")
    .select("webhook_secret_ciphertext, webhook_secret_iv")
    .eq("bot_id", botId)
    .maybeSingle();
  let secret: string;
  if (cred?.webhook_secret_ciphertext) {
    secret = await decryptSecret(cred.webhook_secret_ciphertext, cred.webhook_secret_iv!);
  } else {
    secret = generateWebhookSecret();
    const e = await encryptSecret(secret);
    await supabaseAdmin
      .from("bot_credentials")
      .update({ webhook_secret_ciphertext: e.ciphertext, webhook_secret_iv: e.iv })
      .eq("bot_id", botId);
  }
  const registered = await setWebhook(token, url, secret);
  if (!registered.ok) return fail(`setWebhook failed: ${registered.error}`);
  await push("Register webhook", "ok", url);

  // 5. verify with Telegram
  const info = await getWebhookInfo(token);
  if (!info.ok) return fail(`getWebhookInfo failed: ${info.error}`);
  if (info.result.url !== url)
    return fail(`Telegram reports a different webhook URL than the one registered: "${info.result.url}"`);
  await push("Verify webhook (getWebhookInfo)", "ok", `pending updates: ${info.result.pending_update_count}`);

  await supabaseAdmin.from("bot_webhooks").upsert(
    {
      bot_id: botId,
      url,
      is_registered: true,
      pending_update_count: info.result.pending_update_count,
      last_error_message: info.result.last_error_message ?? null,
      last_error_date: info.result.last_error_date
        ? new Date(info.result.last_error_date * 1000).toISOString()
        : null,
      last_verified_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "bot_id" },
  );

  // 6. health check
  const health = await healthCheck(db, botId, requestUrl);
  await push(
    "Health check",
    health.overall === "healthy" ? "ok" : "failed",
    Object.entries(health.checks)
      .map(([k, v]) => `${k}: ${v.status}`)
      .join(", "),
  );
  if (health.overall !== "healthy") return fail("Health check failed after webhook registration.");

  await db.from("bot_projects").update({ active_version_id: version.id }).eq("id", project!.id);
  await db
    .from("bots")
    .update({ status: "RUNNING", last_error: null, last_deployed_at: new Date().toISOString() })
    .eq("id", botId);

  await supabaseAdmin
    .from("bot_deployments")
    .update({
      status: "SUCCESS",
      webhook_status: "REGISTERED",
      compatibility: version.compatibility,
      version_id: version.id,
      steps: steps as unknown as never,
      duration_ms: Date.now() - started,
    })
    .eq("id", deploymentId);
  await audit(userId, botId, "DEPLOYMENT", `Deployed version ${version.version}`);
  await log(botId, "INFO", "DEPLOYMENT", "success", `Version ${version.version} deployed and webhook verified`);

  return { ok: true, steps, url, deploymentId };
}

export async function stopWebhookForBot(db: SupabaseClient, userId: string, botId: string) {
  await assertOwner(db, botId);
  await rateLimit(userId, "webhook_op", 30, 300);
  const token = await tokenFor(botId);
  const removed = await deleteWebhook(token);
  if (!removed.ok) throw new AppError(`deleteWebhook failed: ${removed.error}`);
  const info = await getWebhookInfo(token);
  if (!info.ok) throw new AppError(`getWebhookInfo failed: ${info.error}`);
  if (info.result.url) throw new AppError(`Telegram still reports a webhook URL: ${info.result.url}`);
  await supabaseAdmin
    .from("bot_webhooks")
    .upsert({ bot_id: botId, url: null, is_registered: false, last_verified_at: new Date().toISOString(), updated_at: new Date().toISOString() }, { onConflict: "bot_id" });
  await db.from("bots").update({ status: "STOPPED" }).eq("id", botId);
  await audit(userId, botId, "WEBHOOK_DISABLED", "Webhook deleted and verified removed");
  await log(botId, "INFO", "WEBHOOK", "stopped", "Webhook deleted and confirmed removed by Telegram");
  return { ok: true };
}

/**
 * Re-register the webhook for a bot that was stopped, without re-running the
 * full deployment pipeline. Status only becomes RUNNING once Telegram confirms.
 */
export async function startBot(db: SupabaseClient, userId: string, botId: string, requestUrl: string) {
  await assertOwner(db, botId);
  await rateLimit(userId, "webhook_op", 30, 300);
  await db.from("bots").update({ status: "STARTING", last_error: null }).eq("id", botId);

  const token = await tokenFor(botId);
  const url = webhookUrlFor(requestUrl, botId);
  const { data: cred } = await supabaseAdmin
    .from("bot_credentials")
    .select("webhook_secret_ciphertext, webhook_secret_iv")
    .eq("bot_id", botId)
    .maybeSingle();
  if (!cred?.webhook_secret_ciphertext) {
    await db.from("bots").update({ status: "ERROR", last_error: "No webhook secret stored" }).eq("id", botId);
    throw new AppError("No webhook secret stored for this bot. Run a full deployment first.");
  }
  const secret = await decryptSecret(cred.webhook_secret_ciphertext, cred.webhook_secret_iv!);

  const registered = await setWebhook(token, url, secret);
  if (!registered.ok) {
    await db.from("bots").update({ status: "WEBHOOK_ERROR", last_error: redact(registered.error) }).eq("id", botId);
    await log(botId, "ERROR", "WEBHOOK", "failed", `setWebhook failed: ${registered.error}`);
    throw new AppError(`setWebhook failed: ${registered.error}`);
  }
  const info = await getWebhookInfo(token);
  if (!info.ok || info.result.url !== url) {
    const detail = info.ok
      ? `Telegram reports "${info.result.url || "no webhook"}" instead of the expected URL`
      : info.error;
    await db.from("bots").update({ status: "WEBHOOK_ERROR", last_error: redact(detail) }).eq("id", botId);
    throw new AppError(detail);
  }

  await supabaseAdmin.from("bot_webhooks").upsert(
    {
      bot_id: botId,
      url,
      is_registered: true,
      pending_update_count: info.result.pending_update_count,
      last_error_message: info.result.last_error_message ?? null,
      last_verified_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "bot_id" },
  );
  await db.from("bots").update({ status: "RUNNING", last_error: null }).eq("id", botId);
  await audit(userId, botId, "BOT_STARTED", "Webhook re-registered and confirmed by Telegram");
  await log(botId, "INFO", "WEBHOOK", "started", `Webhook active at ${url}`);
  return { ok: true, url, pending: info.result.pending_update_count };
}

/** Stop then start again, verifying both transitions against Telegram. */
export async function restartBot(db: SupabaseClient, userId: string, botId: string, requestUrl: string) {
  const bot = await assertOwner(db, botId);
  await rateLimit(userId, "webhook_op", 30, 300);
  await db.from("bots").update({ status: "RESTARTING", last_error: null }).eq("id", botId);

  const token = await tokenFor(botId);
  const removed = await deleteWebhook(token);
  if (!removed.ok) {
    await db.from("bots").update({ status: "WEBHOOK_ERROR", last_error: redact(removed.error) }).eq("id", botId);
    throw new AppError(`deleteWebhook failed: ${removed.error}`);
  }
  const result = await startBot(db, userId, botId, requestUrl);
  await db
    .from("bots")
    .update({ restart_count: ((bot as { restart_count?: number }).restart_count ?? 0) + 1 })
    .eq("id", botId);
  await audit(userId, botId, "BOT_RESTARTED", "Webhook deleted and re-registered");
  return result;
}

export async function refreshWebhookInfo(db: SupabaseClient, botId: string) {

  await assertOwner(db, botId);
  const token = await tokenFor(botId);
  const info = await getWebhookInfo(token);
  if (!info.ok) return { ok: false as const, error: info.error };
  await supabaseAdmin.from("bot_webhooks").upsert(
    {
      bot_id: botId,
      url: info.result.url || null,
      is_registered: !!info.result.url,
      pending_update_count: info.result.pending_update_count,
      last_error_message: info.result.last_error_message ?? null,
      last_error_date: info.result.last_error_date
        ? new Date(info.result.last_error_date * 1000).toISOString()
        : null,
      last_verified_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "bot_id" },
  );
  return { ok: true as const, info: info.result };
}

// ---------- health & test ----------
export type Check = { status: "healthy" | "unhealthy" | "not_available"; detail: string };

export async function healthCheck(db: SupabaseClient, botId: string, requestUrl: string) {
  const checks: Record<string, Check> = {};

  const { error: dbError } = await db.from("bots").select("id").eq("id", botId).maybeSingle();
  checks["database"] = dbError
    ? { status: "unhealthy", detail: dbError.message }
    : { status: "healthy", detail: "Query succeeded" };

  let token: string | null = null;
  try {
    token = await tokenFor(botId);
  } catch {
    checks["telegram_api"] = { status: "unhealthy", detail: "No stored token" };
  }
  if (token) {
    const me = await getMe(token);
    checks["telegram_api"] = me.ok
      ? { status: "healthy", detail: `getMe ok (@${me.result.username})` }
      : { status: "unhealthy", detail: me.error };

    const info = await getWebhookInfo(token);
    const expected = webhookUrlFor(requestUrl, botId);
    checks["webhook"] = !info.ok
      ? { status: "unhealthy", detail: info.error }
      : info.result.url === expected
        ? {
            status: "healthy",
            detail: `Registered${info.result.last_error_message ? `, last Telegram error: ${info.result.last_error_message}` : ""}`,
          }
        : { status: "unhealthy", detail: info.result.url ? `Different URL registered: ${info.result.url}` : "No webhook registered" };
  }

  const { data: channel } = await db
    .from("storage_channels")
    .select("verified_at, last_error")
    .eq("bot_id", botId)
    .maybeSingle();
  checks["storage"] = !channel
    ? { status: "not_available", detail: "No storage channel configured" }
    : channel.verified_at
      ? { status: "healthy", detail: "Channel verified" }
      : { status: "unhealthy", detail: channel.last_error ?? "Not verified" };

  const { data: project } = await db
    .from("bot_projects")
    .select("active_version_id")
    .eq("bot_id", botId)
    .maybeSingle();
  if (!project?.active_version_id) {
    checks["bot_runtime"] = { status: "not_available", detail: "No active deployed version" };
  } else {
    const { data: version } = await db
      .from("bot_project_versions")
      .select("adapter_plan, version")
      .eq("id", project.active_version_id)
      .maybeSingle();
    const handlers = (version?.adapter_plan as { handlers?: unknown[] })?.handlers ?? [];
    checks["bot_runtime"] = {
      status: "healthy",
      detail: `v${version?.version}: ${handlers.length} adapted handler(s) + built-in runtime`,
    };
  }

  // Log channel: only reported healthy when Telegram itself confirms access.
  const env = await loadEnv(supabaseAdmin, botId);
  const logChannelId = Number(env["LOG_CHANNEL_ID"] ?? "");
  if (!Number.isFinite(logChannelId) || logChannelId === 0) {
    checks["log_channel"] = { status: "not_available", detail: "LOG_CHANNEL_ID not configured" };
  } else if (!token) {
    checks["log_channel"] = { status: "unhealthy", detail: "No stored token to verify the log channel" };
  } else {
    const chat = await getChat(token, logChannelId);
    if (!chat.ok) {
      checks["log_channel"] = { status: "unhealthy", detail: `Cannot access log channel: ${chat.error}` };
    } else {
      const bot = await db.from("bots").select("telegram_bot_id").eq("id", botId).maybeSingle();
      const member = bot.data?.telegram_bot_id
        ? await getChatMember(token, logChannelId, Number(bot.data.telegram_bot_id))
        : null;
      const canPost =
        member?.ok && (member.result.status === "administrator" || member.result.status === "creator");
      checks["log_channel"] = canPost
        ? { status: "healthy", detail: `Connected to "${chat.result.title ?? logChannelId}"` }
        : {
            status: "unhealthy",
            detail: `Bot is not an administrator in "${chat.result.title ?? logChannelId}"`,
          };
    }
  }

  // Environment completeness (never exposes values).
  const missing = ["BOT_TOKEN"].filter((k) => !env[k]);
  checks["environment"] = missing.length
    ? { status: "unhealthy", detail: `Missing variables: ${missing.join(", ")}` }
    : { status: "healthy", detail: `${Object.keys(env).length} variable(s) stored, values encrypted` };

  // Honest resource reporting: the serverless runtime exposes no process metrics.
  checks["resources"] = {
    status: "not_available",
    detail: "CPU, memory and uptime are not available on this serverless runtime",
  };

  const required = ["database", "telegram_api", "webhook"];
  const overall = required.every((k) => checks[k]?.status === "healthy") ? "healthy" : "unhealthy";
  return { overall, checks };

}

export async function testBot(db: SupabaseClient, userId: string, botId: string, requestUrl: string) {
  await assertOwner(db, botId);
  await rateLimit(userId, "test", 20, 300);
  const health = await healthCheck(db, botId, requestUrl);
  await log(botId, "INFO", "INFO", health.overall, `Test run: ${health.overall}`);
  await audit(userId, botId, "BOT_TESTED", `Result: ${health.overall}`);
  return health;
}

export async function sendTestMessage(db: SupabaseClient, userId: string, botId: string, chatId: number, text: string) {
  const bot = await assertOwner(db, botId);
  await rateLimit(userId, "test", 20, 300);
  const token = await tokenFor(botId);
  const res = await sendMessage(token, chatId, text || `Test message from ${bot.name}`);
  await log(botId, res.ok ? "INFO" : "ERROR", "TELEGRAM", res.ok ? "sent" : "failed", res.ok ? `Test message sent to ${chatId}` : res.error);
  if (!res.ok) throw new AppError(res.error);
  return { ok: true, messageId: res.result.message_id };
}

export async function deleteBot(db: SupabaseClient, userId: string, botId: string) {
  await assertOwner(db, botId);
  try {
    const token = await tokenFor(botId);
    await deleteWebhook(token);
  } catch {
    /* credentials may already be gone; deletion continues */
  }
  const { error } = await db.from("bots").delete().eq("id", botId);
  if (error) throw new AppError(error.message);
  await audit(userId, null, "BOT_DELETED", `Bot ${botId} deleted`);
  return { ok: true };
}

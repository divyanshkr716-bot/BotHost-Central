/**
 * My Flix real bot runtime.
 *
 * Executes actual handlers against the database and the Telegram Bot API:
 * commands, callback queries, inline keyboards, search, requests, favorites,
 * bookmarks, history, the admin /addmovie wizard and storage-channel indexing.
 *
 * Everything is stateless: conversation state lives in bot_chat_state.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  sendMessage,
  editMessageText,
  answerCallbackQuery,
  sendVideo,
  sendDocument,
  sendAudio,
  sendPhoto,
  copyMessage,
  answerInlineQuery,
  getWebhookInfo,
  getChat,
  getMe,
  deleteMessage,

} from "../telegram.server";
import { redact } from "../crypto.server";
import { acquireLock, releaseLock, purgeExpiredLocks } from "./locks.server";
import { loadConfig, type FlixConfig } from "./config.server";
import { saveSupportContact } from "./config.server";
import { resolveAccess, type Access } from "./access.server";

import {
  mainMenuKeyboard,
  mediaKeyboard,
  requestModerationKeyboard,
  resultListKeyboard,
  backToMenu,
} from "./keyboards";
import { logToChannel, activityLog, displayName, stamp, type LogUser } from "./log-channel.server";
import { searchLibrary, normalize, extractQuery, humanSize, type LibraryRow } from "./search.server";
import { autoDeleteSeconds, autoDeleteNotice, recordDelivery } from "./ephemeral.server";

type Msg = {
  message_id: number;
  chat: { id: number; type: string };
  from?: { id: number; first_name?: string | undefined; last_name?: string | undefined; username?: string | undefined };
  text?: string;
  caption?: string;
  forward_origin?: unknown;
  forward_from_chat?: { id: number };
  photo?: { file_id: string; file_unique_id: string; file_size?: number }[];
  video?: { file_id: string; file_unique_id: string; file_size?: number; file_name?: string };
  document?: { file_id: string; file_unique_id: string; file_size?: number; file_name?: string };
  audio?: { file_id: string; file_unique_id: string; file_size?: number; file_name?: string };
};

export type FlixUpdate = {
  update_id: number;
  message?: Msg;
  edited_message?: Msg;
  channel_post?: Msg;
  callback_query?: { id: string; data?: string; from: LogUser; message?: Msg };
  inline_query?: { id: string; query: string; from: LogUser };
};

export type FlixContext = {
  botId: string;
  token: string;
  db: SupabaseClient;
  update: FlixUpdate;
};

export type FlixResult = { handled: boolean; handler: string; detail?: string };

const COMMANDS = new Set([
  "/start","/help","/menu","/profile","/id","/search","/request","/latest","/trending",
  "/categories","/languages","/favorites","/bookmarks","/history","/support","/cancel","/delete","/deletemsg",
  "/addmovie","/health","/ping","/webhookinfo","/stats","/requests","/panel",
  // admin actions with real arguments
  "/whoami","/setsupport","/user","/reply","/logtest","/users","/ban","/unban","/broadcast","/resolve","/reject",
]);


// ---------------------------------------------------------------- helpers

function mediaOf(msg: Msg) {
  if (msg.video) return { media_type: "video", ...msg.video };
  if (msg.document) return { media_type: "document", ...msg.document };
  if (msg.audio) return { media_type: "audio", ...msg.audio };
  if (msg.photo?.length) {
    const p = msg.photo[msg.photo.length - 1]!;
    return { media_type: "photo", ...p, file_name: undefined };
  }
  return null;
}

async function upsertUser(db: SupabaseClient, botId: string, from: LogUser) {
  const now = new Date().toISOString();
  const { data: existing } = await db
    .from("bot_users")
    .select("id")
    .eq("bot_id", botId)
    .eq("telegram_id", from.id)
    .maybeSingle();
  if (existing) {
    await db
      .from("bot_users")
      .update({
        first_name: from.first_name ?? null,
        last_name: from.last_name ?? null,
        username: from.username ?? null,
        last_seen_at: now,
      })
      .eq("id", existing.id);
    return existing.id as string;
  }
  const { data } = await db
    .from("bot_users")
    .insert({
      bot_id: botId,
      telegram_id: from.id,
      first_name: from.first_name ?? null,
      last_name: from.last_name ?? null,
      username: from.username ?? null,
      joined_at: now,
      last_seen_at: now,
    })
    .select("id")
    .single();
  return (data?.id as string) ?? null;
}

async function bump(db: SupabaseClient, botId: string, telegramId: number, column: "search_count" | "request_count") {
  const { data } = await db
    .from("bot_users")
    .select(`id, ${column}`)
    .eq("bot_id", botId)
    .eq("telegram_id", telegramId)
    .maybeSingle();
  if (!data) return;
  const current = (data as Record<string, unknown>)[column] as number | null;
  await db.from("bot_users").update({ [column]: (current ?? 0) + 1 }).eq("id", (data as { id: string }).id);
}

async function getState(db: SupabaseClient, botId: string, telegramId: number) {
  const { data } = await db
    .from("bot_chat_state")
    .select("*")
    .eq("bot_id", botId)
    .eq("telegram_id", telegramId)
    .maybeSingle();
  if (!data) return null;
  if (new Date(data.expires_at as string).getTime() < Date.now()) {
    await clearState(db, botId, telegramId);
    return null;
  }
  return data as { flow: string; step: string; data: Record<string, unknown> };
}

async function setState(
  db: SupabaseClient,
  botId: string,
  telegramId: number,
  flow: string,
  step: string,
  payload: Record<string, unknown>,
) {
  await db.from("bot_chat_state").upsert(
    {
      bot_id: botId,
      telegram_id: telegramId,
      flow,
      step,
      data: payload,
      expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "bot_id,telegram_id" },
  );
}

async function clearState(db: SupabaseClient, botId: string, telegramId: number) {
  await db.from("bot_chat_state").delete().eq("bot_id", botId).eq("telegram_id", telegramId);
}

const html = { parse_mode: "HTML", disable_web_page_preview: true } as const;

/**
 * Per-invocation runtime context, so every outgoing message can record the real
 * Telegram outcome without threading the context through every helper.
 */
const runtimeStore = new AsyncLocalStorage<FlixContext>();

/**
 * Send a message and record the ACTUAL Telegram result. A failed send is logged
 * with the exact Telegram error instead of being silently treated as success.
 */
async function say(token: string, chatId: number, text: string, keyboard?: unknown) {
  const res = await sendMessage(token, chatId, text, {
    ...html,
    ...(keyboard ? { reply_markup: keyboard } : {}),
  });
  if (!res.ok) {
    const ctx = runtimeStore.getStore();
    if (ctx) {
      await ctx.db
        .from("runtime_logs")
        .insert({
          bot_id: ctx.botId,
          level: "ERROR",
          event: "SEND_FAILED",
          status: "error",
          message: `sendMessage failed for chat ${chatId}: ${res.error}`,
          update_id: ctx.update.update_id,
        })
        .then(() => undefined, () => undefined);
    }
  }
  return res;
}


function userLabel(u: LogUser) {
  const name = displayName(u);
  return u.username ? `${name} (@${u.username})` : name;
}

// ---------------------------------------------------------------- messages

function welcomeText(config: FlixConfig, u: LogUser): string {
  const name = [u.first_name, u.last_name].filter(Boolean).join(" ") || "there";
  const handle = u.username ? `\n🔗 @${u.username}` : "";
  return [
    "👋 <b>Welcome to My Flix!</b> ❤️",
    "",
    `😊 Hello, <b>${name}</b>!${handle}`,
    "",
    "🎬 Welcome to your personal media library.",
    "🔎 Search for any movie, series or video by simply typing its name.",
    "📥 If you cannot find something, you can send a request and the admin will be notified.",
    "",
    "👇 Choose an option below to get started.",
  ].join("\n");
}

function helpText(config: FlixConfig): string {
  return [
    "🆘 <b>My Flix Help</b>",
    "",
    "Just type the name of a movie, series or video and I will search the library.",
    "",
    "<b>Commands</b>",
    "/start – open the main menu",
    "/menu – navigation menu",
    "/search – search the library",
    "/request – request media the library doesn't have",
    "/latest – newest indexed media",
    "/trending – most watched right now",
    "/categories – available genres",
    "/languages – available languages",
    "/favorites – your favourites",
    "/bookmarks – your bookmarks",
    "/history – your recent activity",
    "/profile – your profile",
    "/id – your Telegram ID",
    "/whoami – your verified ID and role",
    ...(config.supportUrl
      ? ["", `💬 Support: ${config.supportUsername ? `@${config.supportUsername}` : config.supportUrl}`]
      : []),

  ].join("\n");
}

// ---------------------------------------------------------------- library views

async function listMedia(db: SupabaseClient, botId: string, order: "latest" | "trending", limit = 10) {
  const q = db.from("media_library").select("*").eq("bot_id", botId).limit(limit);
  const { data } =
    order === "latest"
      ? await q.order("created_at", { ascending: false })
      : await q.order("views", { ascending: false }).order("created_at", { ascending: false });
  return (data ?? []) as LibraryRow[];
}

async function sendResultList(token: string, chatId: number, title: string, rows: LibraryRow[], empty: string) {
  if (!rows.length) return say(token, chatId, empty, backToMenu);
  const text = [title, "", "👇 Tap the exact file you want."].join("\n");
  return say(
    token,
    chatId,
    text,
    resultListKeyboard(
      rows.map((r) => ({
        id: r.id,
        title: r.title,
        quality: r.quality,
        language: r.language,
        year: r.year,
        file_size: r.file_size,
        media_type: r.media_type,
      })),
    ),
  );
}

/**
 * Bot 200 delivery flow: warning message -> the ACTUAL media message with the
 * Watch/Download · Favorite/Bookmark · Menu keyboard attached directly to it.
 * No intermediate type/language/details page.
 * Warning + media message IDs are recorded in the durable auto-delete queue.
 */
async function deliverMedia(
  ctx: FlixContext,
  config: FlixConfig,
  chatId: number,
  m: LibraryRow,
  user: LogUser,
  kind: "select" | "watch" | "download",
) {
  const seconds = autoDeleteSeconds(config.autoDeleteSeconds);

  const warning = await say(ctx.token, chatId, autoDeleteNotice(seconds));
  const warningMessageId = warning.ok ? warning.result.message_id : null;

  const keyboard = mediaKeyboard(m.id, { watchUrl: m.watch_url, downloadUrl: m.download_url });
  const size = humanSize(m.file_size);
  const caption = [
    `🎬 <b>${m.title}</b>`,
    [m.quality, m.language, m.year ? String(m.year) : null, size].filter(Boolean).join(" · "),
  ]
    .filter(Boolean)
    .join("\n");
  const extra = { caption, ...html, reply_markup: keyboard };

  let fileMessageId: number | null = null;
  let error: string | undefined;

  if (m.file_id) {
    const res =
      m.media_type === "video"
        ? await sendVideo(ctx.token, chatId, m.file_id, extra)
        : m.media_type === "audio"
          ? await sendAudio(ctx.token, chatId, m.file_id, extra)
          : m.media_type === "photo"
            ? await sendPhoto(ctx.token, chatId, m.file_id, extra)
            : await sendDocument(ctx.token, chatId, m.file_id, extra);
    if (res.ok) fileMessageId = res.result.message_id;
    else error = res.error;
  }
  if (!fileMessageId && m.storage_channel_id && m.message_id) {
    const res = await copyMessage(ctx.token, chatId, m.storage_channel_id, m.message_id, {
      reply_markup: keyboard,
    });
    if (res.ok) fileMessageId = res.result.message_id;
    else error = res.error;
  }

  if (!fileMessageId) {
    await say(
      ctx.token,
      chatId,
      `⚠️ I could not deliver <b>${m.title}</b> right now. The admin has been notified.`,
      backToMenu,
    );
    await logToChannel(
      ctx.db,
      config,
      ctx.token,
      activityLog("⚠️ <b>DELIVERY FAILED</b>", user, { Title: m.title, Reason: error ?? "unknown" }),
    );
    return false;
  }

  // Durable auto-delete: real Telegram message IDs only, swept by the cron job.
  const scheduled = await recordDelivery(
    ctx.db,
    ctx.botId,
    chatId,
    { fileMessageId, warningMessageId },
    seconds,
  );
  await ctx.db.from("runtime_logs").insert({
    bot_id: ctx.botId,
    level: scheduled ? "INFO" : "ERROR",
    event: scheduled ? "AUTO_DELETE_SCHEDULED" : "AUTO_DELETE_FAILED",
    status: scheduled ? "scheduled" : "error",
    message: scheduled
      ? `Auto-delete scheduled in ${seconds}s for chat ${chatId} (media msg ${fileMessageId}, warning msg ${warningMessageId ?? "none"})`
      : `Could not persist auto-delete job for chat ${chatId} media msg ${fileMessageId}`,
  });


  await ctx.db.from("media_library").update({ views: (m.views ?? 0) + 1 }).eq("id", m.id);
  await ctx.db.from("user_history").insert({
    bot_id: ctx.botId,
    telegram_id: user.id,
    kind: kind === "download" ? "download" : "watch",
    media_id: m.id,
    query: m.title,
  });

  const log = await logToChannel(
    ctx.db,
    config,
    ctx.token,
    activityLog("📤 <b>MEDIA DELIVERED</b>", user, {
      "User ID": user.id,
      "Chat ID": chatId,
      Title: m.title,
      Quality: m.quality ?? "—",
      "File size": size ?? "—",
      "Warning Message ID": warningMessageId ?? "—",
      "Media Message ID": fileMessageId,
      "Auto delete": `${seconds}s`,
      Mode: kind,
    }),
  );
  if (log.messageId) {
    await ctx.db.from("runtime_logs").insert({
      bot_id: ctx.botId,
      level: "INFO",
      event: "DELIVERY",
      status: "delivered",
      message: `Delivered "${m.title}" (media msg ${fileMessageId}, warning msg ${warningMessageId ?? "none"}, log msg ${log.messageId})`,
    });
  }
  return true;
}

// ---------------------------------------------------------------- search flow

async function runSearch(ctx: FlixContext, config: FlixConfig, chatId: number, user: LogUser, raw: string) {
  const query = extractQuery(raw);
  if (!query) {
    await say(ctx.token, chatId, "🔎 Please tell me what you are looking for.", backToMenu);
    return;
  }
  await say(ctx.token, chatId, `🔎 <b>Searching for:</b> ${query}`);
  const rows = await searchLibrary(ctx.db, ctx.botId, raw);

  await bump(ctx.db, ctx.botId, user.id, "search_count");
  await ctx.db.from("user_history").insert({
    bot_id: ctx.botId,
    telegram_id: user.id,
    kind: "search",
    query,
    result_count: rows.length,
  });
  await logToChannel(
    ctx.db,
    config,
    ctx.token,
    activityLog("🔎 <b>SEARCH</b>", user, { Query: query, "Result count": rows.length }),
  );

  if (!rows.length) {
    await say(
      ctx.token,
      chatId,
      `😔 No results for <b>${query}</b>.\n\n📥 Tap below to request it and the admin will be notified.`,
      { inline_keyboard: [[{ text: "📥 Request this", callback_data: `rq:${query.slice(0, 55)}` }], [{ text: "🏠 Menu", callback_data: "menu" }]] },
    );
    return;
  }
  // Always an inline result list — even for a single match.
  await sendResultList(
    ctx.token,
    chatId,
    `🔎 <b>${rows.length} result${rows.length === 1 ? "" : "s"} for</b> ${query}`,
    rows,
    "No results.",
  );
}

// ---------------------------------------------------------------- requests

async function createRequest(ctx: FlixContext, config: FlixConfig, chatId: number, user: LogUser, title: string) {
  const clean = title.trim().slice(0, 120);
  if (!clean) {
    await say(ctx.token, chatId, "📥 Please send the name of the media you want.");
    return;
  }
  const { data } = await ctx.db
    .from("media_requests")
    .insert({
      bot_id: ctx.botId,
      telegram_id: user.id,
      username: user.username ?? null,
      display_name: displayName(user),
      title: clean,
      status: "pending",
    })
    .select("id")
    .single();
  await bump(ctx.db, ctx.botId, user.id, "request_count");
  await clearState(ctx.db, ctx.botId, user.id);

  const body = [
    "📥 <b>NEW MEDIA REQUEST</b>",
    "",
    `👤 User: ${displayName(user)}`,
    `🔗 Username: ${user.username ? `@${user.username}` : "—"}`,
    `🆔 ID: ${user.id}`,
    "",
    `🎬 Requested: <b>${clean}</b>`,
    "",
    `🕐 Time: ${stamp()}`,
    "Status: pending",
  ].join("\n");
  const keyboard = data?.id ? requestModerationKeyboard(data.id as string) : undefined;

  await logToChannel(ctx.db, config, ctx.token, body);
  for (const admin of config.adminIds) {
    await sendMessage(ctx.token, admin, body, { ...html, ...(keyboard ? { reply_markup: keyboard } : {}) });
  }
  await say(ctx.token, chatId, `✅ Request saved: <b>${clean}</b>\n\nThe admin has been notified.`, backToMenu);
}

// ---------------------------------------------------------------- storage indexing

async function indexFromMessage(
  ctx: FlixContext,
  config: FlixConfig,
  msg: Msg,
  meta: {
    title: string;
    added_by?: number;
    description?: string | null;
    language?: string | null;
    genre?: string | null;
    watch_url?: string | null;
    download_url?: string | null;
    poster_file_id?: string | null;
  },
) {
  const media = mediaOf(msg);
  const title = meta.title.trim();
  const { data, error } = await ctx.db
    .from("media_library")
    .insert({
      bot_id: ctx.botId,
      title,
      normalized_title: normalize(title),
      media_type: media?.media_type ?? "video",
      file_id: media?.file_id ?? null,
      file_unique_id: media?.file_unique_id ?? null,
      message_id: msg.message_id,
      storage_channel_id: msg.chat.id,
      caption: msg.caption ?? null,
      description: meta.description ?? null,
      language: meta.language ?? null,
      genre: meta.genre ?? null,
      watch_url: meta.watch_url ?? null,
      download_url: meta.download_url ?? null,
      poster_file_id: meta.poster_file_id ?? null,
      file_size: media?.file_size ?? null,
      added_by: meta.added_by ?? null,
    })
    .select("id")
    .single();
  if (error) return { ok: false as const, error: error.message };
  return { ok: true as const, id: data!.id as string };
}

/** New media posted into the private storage channel gets indexed automatically. */
async function handleStorageChannelPost(ctx: FlixContext, config: FlixConfig, msg: Msg): Promise<FlixResult | null> {
  if (!config.storageChannelId || msg.chat.id !== config.storageChannelId) return null;
  const media = mediaOf(msg);
  if (!media) return null;

  const title =
    (msg.caption?.split("\n")[0] ?? "").trim() ||
    (media as { file_name?: string }).file_name?.replace(/\.[a-z0-9]+$/i, "") ||
    `Untitled ${msg.message_id}`;

  const res = await indexFromMessage(ctx, config, msg, { title });
  if (!res.ok) return { handled: false, handler: "storage:index", detail: res.error };

  await logToChannel(
    ctx.db,
    config,
    ctx.token,
    ["🗄 <b>STORAGE INDEXED</b>", "", `🎬 Title: <b>${title}</b>`, `📁 Type: ${media.media_type}`, `🆔 Media ID: ${res.id}`, `🕐 ${stamp()}`].join("\n"),
  );
  return { handled: true, handler: "storage:index", detail: `Indexed "${title}"` };
}

// ---------------------------------------------------------------- /addmovie wizard

const WIZARD_ORDER = ["title", "media", "poster", "language", "genre", "description", "watch", "download", "preview"] as const;

const WIZARD_PROMPT: Record<string, string> = {
  title: "🎬 Send the <b>title</b>.",
  media: "📼 Now send or forward the <b>media file</b> (video, document, audio or photo).",
  poster: "🖼 Send a <b>poster</b> image, or /skip.",
  language: "🌐 Send the <b>language</b>, or /skip.",
  genre: "🏷 Send the <b>genre</b>, or /skip.",
  description: "📝 Send a <b>description</b>, or /skip.",
  watch: "▶️ Send a <b>watch link</b>, or /skip.",
  download: "📥 Send a <b>download link</b>, or /skip.",
};

async function wizardStep(ctx: FlixContext, config: FlixConfig, chatId: number, user: LogUser, step: string, payload: Record<string, unknown>) {
  if (step === "preview") {
    const text = [
      "👀 <b>Preview</b>",
      "",
      `🎬 Title: <b>${payload["title"]}</b>`,
      `📁 Type: ${payload["media_type"] ?? "video"}`,
      `🌐 Language: ${payload["language"] ?? "—"}`,
      `🏷 Genre: ${payload["genre"] ?? "—"}`,
      `📝 ${payload["description"] ?? "—"}`,
      `▶️ Watch: ${payload["watch_url"] ?? "—"}`,
      `📥 Download: ${payload["download_url"] ?? "—"}`,
    ].join("\n");
    await setState(ctx.db, ctx.botId, user.id, "addmovie", "preview", payload);
    await say(ctx.token, chatId, text, {
      inline_keyboard: [[{ text: "✅ Publish", callback_data: "pub:ok" }, { text: "❌ Cancel", callback_data: "pub:no" }]],
    });
    return;
  }
  await setState(ctx.db, ctx.botId, user.id, "addmovie", step, payload);
  await say(ctx.token, chatId, WIZARD_PROMPT[step] ?? "Continue.");
}

function nextStep(step: string): string {
  const i = WIZARD_ORDER.indexOf(step as (typeof WIZARD_ORDER)[number]);
  return WIZARD_ORDER[Math.min(i + 1, WIZARD_ORDER.length - 1)]!;
}

async function publishWizard(ctx: FlixContext, config: FlixConfig, chatId: number, user: LogUser, payload: Record<string, unknown>) {
  let storageChatId = config.storageChannelId;
  let storageMessageId = payload["source_message_id"] as number | undefined;

  // Copy the admin's media into the private storage channel so it is durable.
  if (config.storageChannelId && payload["source_chat_id"] && payload["source_message_id"]) {
    const copied = await copyMessage(
      ctx.token,
      config.storageChannelId,
      payload["source_chat_id"] as number,
      payload["source_message_id"] as number,
    );
    if (copied.ok) storageMessageId = copied.result.message_id;
    else storageChatId = payload["source_chat_id"] as number;
  } else {
    storageChatId = (payload["source_chat_id"] as number) ?? null;
  }

  const title = String(payload["title"] ?? "").trim();
  const { data, error } = await ctx.db
    .from("media_library")
    .insert({
      bot_id: ctx.botId,
      title,
      normalized_title: normalize(title),
      media_type: (payload["media_type"] as string) ?? "video",
      file_id: (payload["file_id"] as string) ?? null,
      file_unique_id: (payload["file_unique_id"] as string) ?? null,
      message_id: storageMessageId ?? null,
      storage_channel_id: storageChatId,
      poster_file_id: (payload["poster_file_id"] as string) ?? null,
      description: (payload["description"] as string) ?? null,
      language: (payload["language"] as string) ?? null,
      genre: (payload["genre"] as string) ?? null,
      watch_url: (payload["watch_url"] as string) ?? null,
      download_url: (payload["download_url"] as string) ?? null,
      added_by: user.id,
    })
    .select("id")
    .single();

  await clearState(ctx.db, ctx.botId, user.id);
  if (error) {
    await say(ctx.token, chatId, `❌ Could not save: ${error.message}`);
    return;
  }
  await say(
    ctx.token,
    chatId,
    ["✅ <b>Media added successfully.</b>", "", `🎬 Title: ${title}`, "📚 Library: Indexed", `🗄 Storage: ${storageChatId ? "Saved" : "Local reference only"}`].join("\n"),
    backToMenu,
  );
  await logToChannel(
    ctx.db,
    config,
    ctx.token,
    activityLog("👑 <b>ADMIN ACTION</b>", user, { Action: "/addmovie publish", Target: title, "Media ID": data!.id }),
  );
}

// ---------------------------------------------------------------- commands

async function handleCommand(ctx: FlixContext, config: FlixConfig, msg: Msg, command: string, args: string, access: Access): Promise<FlixResult> {
  const user = msg.from as LogUser;
  const chatId = msg.chat.id;
  const admin = access.isAdmin;

  const logCommand = async (extra: Record<string, unknown> = {}) =>
    logToChannel(ctx.db, config, ctx.token, activityLog(`⚙️ <b>COMMAND ${command}</b>`, user, extra));

  switch (command) {
    case "/start":
    case "/menu": {
      await clearState(ctx.db, ctx.botId, user.id);
      await say(ctx.token, chatId, command === "/start" ? welcomeText(config, user) : "🏠 <b>My Flix menu</b>", mainMenuKeyboard(config));
      await logCommand();
      return { handled: true, handler: command };
    }
    case "/help": {
      await say(ctx.token, chatId, helpText(config), mainMenuKeyboard(config));
      await logCommand();
      return { handled: true, handler: command };
    }
    case "/id": {
      await say(ctx.token, chatId, `🆔 Your Telegram ID: <code>${user.id}</code>\n💬 Chat ID: <code>${chatId}</code>`, backToMenu);
      await logCommand();
      return { handled: true, handler: command };
    }
    case "/profile": {
      await sendProfile(ctx, config, chatId, user);
      await logCommand();
      return { handled: true, handler: command };
    }
    case "/search": {
      if (args) {
        await runSearch(ctx, config, chatId, user, args);
      } else {
        await setState(ctx.db, ctx.botId, user.id, "search", "await_query", {});
        await say(ctx.token, chatId, "🔎 Send the name of the media you are looking for.");
      }
      return { handled: true, handler: command };
    }
    case "/request": {
      if (args) {
        await createRequest(ctx, config, chatId, user, args);
      } else {
        await setState(ctx.db, ctx.botId, user.id, "request", "await_title", {});
        await say(ctx.token, chatId, "📥 Please send the name of the media you want.");
      }
      await logCommand();
      return { handled: true, handler: command };
    }
    case "/latest":
    case "/trending": {
      const rows = await listMedia(ctx.db, ctx.botId, command === "/latest" ? "latest" : "trending");
      await sendResultList(
        ctx.token,
        chatId,
        command === "/latest" ? "🆕 <b>Latest additions</b>" : "🔥 <b>Trending now</b>",
        rows,
        "📭 The library is empty right now.",
      );
      await logCommand({ Items: rows.length });
      return { handled: true, handler: command };
    }
    case "/categories":
    case "/languages": {
      const column = command === "/categories" ? "genre" : "language";
      const { data } = await ctx.db.from("media_library").select(column).eq("bot_id", ctx.botId).not(column, "is", null);
      const values = [...new Set((data ?? []).map((r) => String((r as Record<string, unknown>)[column]).trim()).filter(Boolean))].sort();
      await say(
        ctx.token,
        chatId,
        values.length
          ? `${command === "/categories" ? "🏷 <b>Categories</b>" : "🌐 <b>Languages</b>"}\n\n${values.map((v) => `• ${v}`).join("\n")}`
          : "📭 Nothing tagged yet.",
        backToMenu,
      );
      await logCommand({ Values: values.length });
      return { handled: true, handler: command };
    }
    case "/favorites":
    case "/bookmarks": {
      const kind = command === "/favorites" ? "favorite" : "bookmark";
      const { data } = await ctx.db
        .from("user_media_marks")
        .select("media_id, media_library(*)")
        .eq("bot_id", ctx.botId)
        .eq("telegram_id", user.id)
        .eq("kind", kind)
        .order("created_at", { ascending: false })
        .limit(15);
      const rows = (data ?? []).map((r) => (r as unknown as { media_library: LibraryRow }).media_library).filter(Boolean);
      await sendResultList(
        ctx.token,
        chatId,
        kind === "favorite" ? "❤️ <b>Your favourites</b>" : "🔖 <b>Your bookmarks</b>",
        rows,
        kind === "favorite" ? "❤️ You have no favourites yet." : "🔖 You have no bookmarks yet.",
      );
      await logCommand({ Items: rows.length });
      return { handled: true, handler: command };
    }
    case "/history": {
      const { data } = await ctx.db
        .from("user_history")
        .select("kind, query, created_at")
        .eq("bot_id", ctx.botId)
        .eq("telegram_id", user.id)
        .order("created_at", { ascending: false })
        .limit(15);
      const rows = data ?? [];
      await say(
        ctx.token,
        chatId,
        rows.length
          ? "🕘 <b>Your recent activity</b>\n\n" +
              rows
                .map((r) => {
                  const rec = r as { kind: string; query: string | null; created_at: string };
                  const icon = rec.kind === "search" ? "🔎" : rec.kind === "watch" ? "▶️" : "📥";
                  return `${icon} ${rec.query ?? "—"} · ${new Date(rec.created_at).toISOString().slice(0, 16).replace("T", " ")}`;
                })
                .join("\n")
          : "🕘 No activity yet.",
        backToMenu,
      );
      await logCommand({ Items: rows.length });
      return { handled: true, handler: command };
    }
    case "/support": {
      // Support target is whatever is really configured (DB /setsupport first, then env).
      const target = config.supportUrl;
      const sent = await say(
        ctx.token,
        chatId,
        target
          ? `💬 Support: ${config.supportUsername ? `@${config.supportUsername}` : target}`
          : "💬 No support contact is configured for this bot yet. An administrator can set one with <code>/setsupport &lt;@username or link&gt;</code>.",
        target ? { inline_keyboard: [[{ text: "💬 Open support chat", url: target }]] } : backToMenu,
      );
      await logCommand({ Configured: Boolean(target), Delivered: sent.ok });
      return sent.ok
        ? { handled: true, handler: command }
        : { handled: false, handler: command, detail: sent.error };
    }

    case "/delete":
    case "/deletemsg": {
      // /delete <message_id>  or  /delete <chat_id> <message_id>
      const parts = args.trim().split(/\s+/).filter(Boolean);
      let targetChat = chatId;
      let targetMessage: number | null = null;
      if (parts.length === 1) {
        targetMessage = Number(parts[0]);
      } else if (parts.length >= 2) {
        targetChat = Number(parts[0]);
        targetMessage = Number(parts[1]);
      }
      if (!targetMessage || !Number.isFinite(targetMessage) || !Number.isFinite(targetChat)) {
        await say(
          ctx.token,
          chatId,
          [
            "🗑 <b>Delete a message</b>",
            "",
            "Usage:",
            "<code>/delete &lt;message_id&gt;</code>",
            "<code>/delete &lt;chat_id&gt; &lt;message_id&gt;</code>",
          ].join("\n"),
          backToMenu,
        );
        return { handled: true, handler: command };
      }
      const res = await deleteMessage(ctx.token, targetChat, targetMessage);
      if (res.ok) {
        await say(ctx.token, chatId, "✅ Message deleted successfully", backToMenu);
        await ctx.db.from("runtime_logs").insert({
          bot_id: ctx.botId,
          level: "INFO",
          event: "MANUAL_DELETE_SUCCESS",
          status: "deleted",
          message: `Telegram confirmed deletion of message ${targetMessage} in chat ${targetChat} (requested by ${user.id})`,
        });
        await ctx.db
          .from("scheduled_deletions")
          .update({ status: "deleted", deleted_at: new Date().toISOString() })
          .eq("bot_id", ctx.botId)
          .eq("chat_id", targetChat)
          .eq("message_id", targetMessage);
        await logCommand({ "Chat ID": targetChat, "Message ID": targetMessage, Result: "deleted" });
      } else {
        await say(
          ctx.token,
          chatId,
          `❌ Telegram could not delete message <code>${targetMessage}</code> in chat <code>${targetChat}</code>.\n\n<b>Telegram error:</b> ${res.error}`,
          backToMenu,
        );
        await ctx.db.from("runtime_logs").insert({
          bot_id: ctx.botId,
          level: "ERROR",
          event: "MANUAL_DELETE_FAILED",
          status: "error",
          message: `deleteMessage failed for chat ${targetChat} message ${targetMessage}: ${res.error}`,
        });
        await logCommand({ "Chat ID": targetChat, "Message ID": targetMessage, Error: res.error });
      }
      return { handled: true, handler: command };
    }
    case "/panel": {
      if (!admin) return denyAdmin(ctx, chatId, command, access);
      // Every number below is read live from the database at call time.
      const [users, media, pendingReq, pendingDel, failedDel, lastRun] = await Promise.all([
        ctx.db.from("bot_users").select("id", { count: "exact", head: true }).eq("bot_id", ctx.botId),
        ctx.db.from("media_library").select("id", { count: "exact", head: true }).eq("bot_id", ctx.botId),
        ctx.db.from("media_requests").select("id", { count: "exact", head: true }).eq("bot_id", ctx.botId).eq("status", "pending"),
        ctx.db.from("scheduled_deletions").select("id", { count: "exact", head: true }).eq("bot_id", ctx.botId).eq("status", "pending"),
        ctx.db.from("scheduled_deletions").select("id", { count: "exact", head: true }).eq("bot_id", ctx.botId).eq("status", "failed"),
        ctx.db.from("cleanup_runs").select("finished_at, found, deleted, failed, ok, error").order("started_at", { ascending: false }).limit(1).maybeSingle(),
      ]);
      const run = lastRun.data as
        | { finished_at?: string | null; found?: number; deleted?: number; failed?: number; ok?: boolean; error?: string | null }
        | null;
      const sent = await say(
        ctx.token,
        chatId,
        [
          "🛠 <b>Admin panel</b> (live)",
          "",
          `👥 Users: <b>${users.count ?? 0}</b>`,
          `🎬 Media items: <b>${media.count ?? 0}</b>`,
          `📥 Pending requests: <b>${pendingReq.count ?? 0}</b>`,
          `⏳ Auto-delete pending: <b>${pendingDel.count ?? 0}</b>`,
          `❌ Auto-delete failed: <b>${failedDel.count ?? 0}</b>`,
          run
            ? `🧹 Last cleanup run: ${run.finished_at ?? "running"} — found ${run.found ?? 0}, deleted ${run.deleted ?? 0}, failed ${run.failed ?? 0}${run.error ? ` (${run.error})` : ""}`
            : "🧹 Last cleanup run: none recorded yet",
          "",
          "Commands: /stats /users /requests /addmovie /health /webhookinfo /setsupport /delete /deletemsg /whoami",
        ].join("\n"),
        backToMenu,
      );
      await logCommand({ Users: users.count ?? 0, Media: media.count ?? 0, Delivered: sent.ok });
      return sent.ok
        ? { handled: true, handler: command }
        : { handled: false, handler: command, detail: sent.error };
    }
    case "/cancel": {
      // Reports what was really cancelled, based on the stored conversation state.
      const state = await getState(ctx.db, ctx.botId, user.id);
      if (!state) {
        const idle = await say(ctx.token, chatId, "ℹ️ There is nothing in progress to cancel.", mainMenuKeyboard(config));
        return idle.ok
          ? { handled: true, handler: `${command}:idle` }
          : { handled: false, handler: command, detail: idle.error };
      }
      await clearState(ctx.db, ctx.botId, user.id);
      const sent = await say(ctx.token, chatId, `✅ Cancelled your <b>${state.flow}</b> flow (step: ${state.step}).`, mainMenuKeyboard(config));
      await logCommand({ Flow: state.flow, Step: state.step, Delivered: sent.ok });
      return sent.ok
        ? { handled: true, handler: command }
        : { handled: false, handler: command, detail: sent.error };
    }
    case "/whoami": {
      // Verified identity + role, resolved live for this sender.
      const sent = await say(
        ctx.token,
        chatId,
        [
          "🪪 <b>Verified identity</b>",
          "",
          `Name: ${userLabel(user)}`,
          `Telegram ID: <code>${access.userId}</code>`,
          `Chat ID: <code>${chatId}</code>`,
          `Role: <b>${access.role}</b>`,
          `Verified via: ${access.source}`,
          `Registered in this bot: ${access.registered ? "yes" : "no"}`,
        ].join("\n"),
        backToMenu,
      );
      await logCommand({ Role: access.role, Source: access.source });
      return sent.ok
        ? { handled: true, handler: command }
        : { handled: false, handler: command, detail: sent.error };
    }

    // ------------- admin only -------------
    case "/setsupport": {
      if (!admin) return denyAdmin(ctx, chatId, command, access);
      if (!args.trim()) {
        await say(ctx.token, chatId, "ℹ️ Usage: <code>/setsupport &lt;@username | t.me link | https link&gt;</code>");
        return { handled: true, handler: `${command}:usage` };
      }
      const saved = await saveSupportContact(ctx.db, ctx.botId, args.trim());
      if (!saved.ok) {
        await say(
          ctx.token,
          chatId,
          saved.error === "invalid"
            ? "❌ That is not a usable support contact. Send an @username, a t.me link or an https link."
            : `❌ Could not save the support contact: ${saved.error}`,
        );
        return { handled: true, handler: `${command}:failed`, detail: saved.error };
      }
      const sent = await say(
        ctx.token,
        chatId,
        `✅ Support contact saved and live now: ${saved.username ? `@${saved.username}` : saved.url}`,
        { inline_keyboard: [[{ text: "💬 Open support chat", url: saved.url }]] },
      );
      await logCommand({ Support: saved.username ?? saved.url, Delivered: sent.ok });
      return { handled: true, handler: command };
    }
    case "/addmovie": {
      if (!admin) return denyAdmin(ctx, chatId, command, access);
      await setState(ctx.db, ctx.botId, user.id, "addmovie", "title", {});
      const sent = await say(ctx.token, chatId, "🎬 <b>Add media</b>\n\nSend the <b>title</b>. Use /cancel at any time.");
      return sent.ok
        ? { handled: true, handler: command }
        : { handled: false, handler: command, detail: sent.error };
    }

    case "/requests": {
      if (!admin) return denyAdmin(ctx, chatId, command, access);
      const { data } = await ctx.db
        .from("media_requests")
        .select("id, title, display_name, username, status, created_at")
        .eq("bot_id", ctx.botId)
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(10);
      const rows = data ?? [];
      await say(
        ctx.token,
        chatId,
        rows.length
          ? "📥 <b>Pending requests</b>\n\n" +
              rows.map((r) => {
                const rec = r as { title: string; display_name: string | null; username: string | null };
                return `• <b>${rec.title}</b> — ${rec.display_name ?? "user"}${rec.username ? ` (@${rec.username})` : ""}`;
              }).join("\n")
          : "📭 No pending requests.",
        backToMenu,
      );
      return { handled: true, handler: command };
    }
    case "/stats": {
      if (!admin) return denyAdmin(ctx, chatId, command, access);
      const [users, media, requests] = await Promise.all([
        ctx.db.from("bot_users").select("id", { count: "exact", head: true }).eq("bot_id", ctx.botId),
        ctx.db.from("media_library").select("id", { count: "exact", head: true }).eq("bot_id", ctx.botId),
        ctx.db.from("media_requests").select("id", { count: "exact", head: true }).eq("bot_id", ctx.botId).eq("status", "pending"),
      ]);
      await say(
        ctx.token,
        chatId,
        ["📊 <b>Stats</b>", "", `👥 Users: ${users.count ?? 0}`, `🎬 Library: ${media.count ?? 0}`, `📥 Pending requests: ${requests.count ?? 0}`].join("\n"),
        backToMenu,
      );
      return { handled: true, handler: command };
    }
    case "/ping": {
      if (!admin) return denyAdmin(ctx, chatId, command, access);
      // Real round trips: Telegram getMe and a database read, both measured.
      const tApi = Date.now();
      const me = await getMe(ctx.token);
      const apiMs = Date.now() - tApi;
      const tDb = Date.now();
      const { error: dbError } = await ctx.db.from("bots").select("id").eq("id", ctx.botId).maybeSingle();
      const dbMs = Date.now() - tDb;
      const res = await say(
        ctx.token,
        chatId,
        [
          "🏓 <b>Pong</b>",
          "",
          me.ok ? `Telegram API: ✅ @${me.result.username ?? "unknown"} — ${apiMs}ms` : `Telegram API: ❌ ${me.error}`,
          dbError ? `Database: ❌ ${dbError.message}` : `Database: ✅ ok — ${dbMs}ms`,
        ].join("\n"),
        backToMenu,
      );
      return {
        handled: res.ok,
        handler: command,
        detail: res.ok ? `api ${apiMs}ms db ${dbMs}ms` : (res.error ?? "send failed"),
      };
    }

    case "/health": {
      if (!admin) return denyAdmin(ctx, chatId, command, access);
      await say(ctx.token, chatId, await healthReport(ctx, config), backToMenu);
      return { handled: true, handler: command };
    }
    case "/webhookinfo": {
      if (!admin) return denyAdmin(ctx, chatId, command, access);
      const info = await getWebhookInfo(ctx.token);
      await say(
        ctx.token,
        chatId,
        info.ok
          ? ["🔗 <b>Webhook</b>", `URL set: ${info.result.url ? "yes" : "no"}`, `Pending updates: ${info.result.pending_update_count}`, `Last error: ${info.result.last_error_message ?? "none"}`].join("\n")
          : `❌ getWebhookInfo failed: ${info.error}`,
        backToMenu,
      );
      return { handled: true, handler: command };
    }

    // ---- real argument-driven admin actions ----
    case "/user": {
      if (!admin) return denyAdmin(ctx, chatId, command, access);
      const targetId = Number((args.split(/\s+/)[0] ?? "").replace(/[^\d-]/g, ""));
      if (!Number.isFinite(targetId) || targetId === 0) {
        await say(ctx.token, chatId, "ℹ️ Usage: <code>/user &lt;telegram_id&gt;</code>");
        return { handled: true, handler: `${command}:usage` };
      }
      const { data: row } = await ctx.db
        .from("bot_users")
        .select("telegram_id, first_name, last_name, username, is_blocked, search_count, request_count, joined_at, last_seen_at")
        .eq("bot_id", ctx.botId)
        .eq("telegram_id", targetId)
        .maybeSingle();
      if (!row) {
        await say(ctx.token, chatId, `🚫 <code>${targetId}</code> is not registered with this bot yet.`);
        await logCommand({ Target: targetId, Result: "not registered" });
        return { handled: true, handler: `${command}:missing` };
      }
      const r = row as Record<string, unknown>;
      await say(
        ctx.token,
        chatId,
        [
          "👤 <b>User details</b>",
          "",
          `Name: ${[r["first_name"], r["last_name"]].filter(Boolean).join(" ") || "—"}`,
          `Username: ${r["username"] ? `@${r["username"]}` : "—"}`,
          `Telegram ID: <code>${r["telegram_id"]}</code>`,
          `Blocked: ${r["is_blocked"] ? "yes" : "no"}`,
          `Searches: ${r["search_count"] ?? 0}`,
          `Requests: ${r["request_count"] ?? 0}`,
          `Joined: ${String(r["joined_at"] ?? "").slice(0, 19).replace("T", " ")}`,
          `Last seen: ${String(r["last_seen_at"] ?? "").slice(0, 19).replace("T", " ")}`,
        ].join("\n"),
        backToMenu,
      );
      await logCommand({ Target: targetId, Result: "found" });
      return { handled: true, handler: command };
    }
    case "/reply": {
      if (!admin) return denyAdmin(ctx, chatId, command, access);
      const first = args.split(/\s+/)[0] ?? "";
      const targetId = Number(first.replace(/[^\d-]/g, ""));
      const body = args.slice(first.length).trim();
      if (!Number.isFinite(targetId) || targetId === 0 || !body) {
        await say(ctx.token, chatId, "ℹ️ Usage: <code>/reply &lt;telegram_id&gt; &lt;message&gt;</code>");
        return { handled: true, handler: `${command}:usage` };
      }
      const sent = await sendMessage(ctx.token, targetId, body);
      await say(
        ctx.token,
        chatId,
        sent.ok
          ? `✅ Message delivered to <code>${targetId}</code>.`
          : `❌ Telegram refused delivery to <code>${targetId}</code>: ${sent.error}`,
      );
      await ctx.db.from("audit_logs").insert({
        bot_id: ctx.botId,
        action: "admin.reply",
        detail: sent.ok ? `Sent direct reply to ${targetId}` : `Failed reply to ${targetId}: ${sent.error}`,
        meta: { admin_telegram_id: user.id, target_telegram_id: targetId, ok: sent.ok },
      });
      await logToChannel(
        ctx.db,
        config,
        ctx.token,
        activityLog("👑 <b>ADMIN REPLY</b>", user, { Target: targetId, Status: sent.ok ? "delivered" : `failed: ${sent.error}` }),
      );
      return { handled: true, handler: command, detail: sent.ok ? "delivered" : (sent.error ?? "failed") };
    }
    case "/logtest": {
      if (!admin) return denyAdmin(ctx, chatId, command, access);
      if (!config.logChannelId) {
        await say(ctx.token, chatId, "⚠️ LOG_CHANNEL_ID (or TELEGRAM_LOG_CHANNEL_ID) is not set in this bot's environment variables.");
        return { handled: true, handler: `${command}:unconfigured` };
      }
      const chat = await getChat(ctx.token, config.logChannelId);
      const probe = await logToChannel(
        ctx.db,
        config,
        ctx.token,
        [
          "🧪 <b>My Flix log test</b>",
          "",
          `Bot: @${config.botUsername ?? "unknown"}`,
          `Time: ${stamp()}`,
          "Status: Telegram log channel working ✅",
        ].join("\n"),
      );
      await say(
        ctx.token,
        chatId,
        probe.ok
          ? `✅ Test message delivered.\nChannel: ${chat.ok ? (chat.result.title ?? "—") : "unknown title"}\nID: <code>${config.logChannelId}</code>`
          : `❌ Telegram rejected the log message: ${probe.error}`,
      );
      return { handled: true, handler: command, detail: probe.ok ? "delivered" : (probe.error ?? "failed") };
    }
    case "/users": {
      if (!admin) return denyAdmin(ctx, chatId, command, access);
      const { data, count } = await ctx.db
        .from("bot_users")
        .select("telegram_id, first_name, username, last_seen_at", { count: "exact" })
        .eq("bot_id", ctx.botId)
        .order("last_seen_at", { ascending: false })
        .limit(15);
      const rows = (data ?? []) as Record<string, unknown>[];
      await say(
        ctx.token,
        chatId,
        [
          `👥 <b>Users</b> — total ${count ?? rows.length}`,
          "",
          ...(rows.length
            ? rows.map((r) => `• ${r["first_name"] ?? "user"}${r["username"] ? ` (@${r["username"]})` : ""} — <code>${r["telegram_id"]}</code>`)
            : ["No users yet."]),
        ].join("\n"),
        backToMenu,
      );
      return { handled: true, handler: command };
    }
    case "/ban":
    case "/unban": {
      if (!admin) return denyAdmin(ctx, chatId, command, access);
      const targetId = Number((args.split(/\s+/)[0] ?? "").replace(/[^\d-]/g, ""));
      if (!Number.isFinite(targetId) || targetId === 0) {
        await say(ctx.token, chatId, `ℹ️ Usage: <code>${command} &lt;telegram_id&gt;</code>`);
        return { handled: true, handler: `${command}:usage` };
      }
      const blocked = command === "/ban";
      const { data: updated } = await ctx.db
        .from("bot_users")
        .update({ is_blocked: blocked })
        .eq("bot_id", ctx.botId)
        .eq("telegram_id", targetId)
        .select("telegram_id")
        .maybeSingle();
      await say(
        ctx.token,
        chatId,
        updated
          ? `${blocked ? "🚫 Banned" : "✅ Unbanned"} <code>${targetId}</code>.`
          : `🚫 <code>${targetId}</code> is not registered with this bot.`,
      );
      if (updated) {
        await ctx.db.from("audit_logs").insert({
          bot_id: ctx.botId,
          action: blocked ? "admin.ban" : "admin.unban",
          detail: `${blocked ? "Banned" : "Unbanned"} ${targetId}`,
          meta: { admin_telegram_id: user.id, target_telegram_id: targetId },
        });
        await logToChannel(ctx.db, config, ctx.token, activityLog("👑 <b>ADMIN ACTION</b>", user, { Action: command, Target: targetId }));
      }
      return { handled: true, handler: command };
    }
    case "/broadcast": {
      if (!admin) return denyAdmin(ctx, chatId, command, access);
      if (!args) {
        await say(ctx.token, chatId, "ℹ️ Usage: <code>/broadcast &lt;message&gt;</code>");
        return { handled: true, handler: `${command}:usage` };
      }
      const { data } = await ctx.db
        .from("bot_users")
        .select("telegram_id")
        .eq("bot_id", ctx.botId)
        .eq("is_blocked", false)
        .limit(200);
      let ok = 0;
      let failed = 0;
      for (const row of (data ?? []) as { telegram_id: number }[]) {
        const res = await sendMessage(ctx.token, row.telegram_id, args);
        res.ok ? ok++ : failed++;
      }
      await say(ctx.token, chatId, `📣 Broadcast finished.\nDelivered: ${ok}\nFailed: ${failed}`);
      await ctx.db.from("audit_logs").insert({
        bot_id: ctx.botId,
        action: "admin.broadcast",
        detail: `Broadcast delivered=${ok} failed=${failed}`,
        meta: { admin_telegram_id: user.id, delivered: ok, failed },
      });
      return { handled: true, handler: command, detail: `${ok} delivered` };
    }
    case "/resolve":
    case "/reject": {
      if (!admin) return denyAdmin(ctx, chatId, command, access);
      const idPart = (args.split(/\s+/)[0] ?? "").trim();
      const note = args.slice(idPart.length).trim();
      if (!idPart) {
        await say(ctx.token, chatId, `ℹ️ Usage: <code>${command} &lt;request_id&gt; [note]</code> — see /requests`);
        return { handled: true, handler: `${command}:usage` };
      }
      const { data: match } = await ctx.db
        .from("media_requests")
        .select("id, telegram_id, title")
        .eq("bot_id", ctx.botId)
        .ilike("id", `${idPart}%`)
        .limit(1)
        .maybeSingle();
      if (!match) {
        await say(ctx.token, chatId, `🚫 No request matching <code>${idPart}</code>.`);
        return { handled: true, handler: `${command}:missing` };
      }
      const req = match as { id: string; telegram_id: number; title: string };
      const status = command === "/resolve" ? "fulfilled" : "rejected";
      await ctx.db
        .from("media_requests")
        .update({ status, handled_by: user.id, handled_at: new Date().toISOString() })
        .eq("id", req.id);
      await sendMessage(
        ctx.token,
        req.telegram_id,
        status === "fulfilled"
          ? `✅ Your request "<b>${req.title}</b>" has been fulfilled.${note ? `\n\n${note}` : ""}`
          : `❌ Your request "<b>${req.title}</b>" was rejected.${note ? `\n\nReason: ${note}` : ""}`,
      );
      await say(ctx.token, chatId, `✅ Request <code>${req.id.slice(0, 8)}</code> marked ${status}.`);
      await logToChannel(
        ctx.db,
        config,
        ctx.token,
        activityLog("👑 <b>REQUEST MODERATION</b>", user, { Action: command, Title: req.title, Status: status }),
      );
      return { handled: true, handler: command };
    }

    default:
      return { handled: false, handler: command, detail: "Unknown command" };
  }

}

async function denyAdmin(ctx: FlixContext, chatId: number, command: string, access: Access): Promise<FlixResult> {
  // The real, verified role of the sender is reported back — never a guess.
  await say(
    ctx.token,
    chatId,
    [
      `⛔ <code>${command}</code> is restricted to administrators.`,
      "",
      `Your Telegram ID: <code>${access.userId}</code>`,
      `Verified role: <b>${access.role}</b> (${access.source})`,
    ].join("\n"),
  );
  await ctx.db.from("runtime_logs").insert({
    bot_id: ctx.botId,
    level: "WARNING",
    event: "ADMIN_DENIED",
    status: "denied",
    message: `${command} denied for ${access.userId} (role ${access.role}, ${access.source})`,
    update_id: ctx.update.update_id,
  });
  return { handled: true, handler: `${command}:denied` };
}

async function sendProfile(ctx: FlixContext, config: FlixConfig, chatId: number, user: LogUser) {
  const { data: profile } = await ctx.db
    .from("bot_users")
    .select("search_count, request_count, joined_at")
    .eq("bot_id", ctx.botId)
    .eq("telegram_id", user.id)
    .maybeSingle();
  const [fav, book, hist] = await Promise.all([
    ctx.db.from("user_media_marks").select("id", { count: "exact", head: true }).eq("bot_id", ctx.botId).eq("telegram_id", user.id).eq("kind", "favorite"),
    ctx.db.from("user_media_marks").select("id", { count: "exact", head: true }).eq("bot_id", ctx.botId).eq("telegram_id", user.id).eq("kind", "bookmark"),
    ctx.db.from("user_history").select("id", { count: "exact", head: true }).eq("bot_id", ctx.botId).eq("telegram_id", user.id),
  ]);
  await say(
    ctx.token,
    chatId,
    [
      "👤 <b>My Flix Profile</b>",
      "",
      `Name: ${displayName(user)}`,
      `Username: ${user.username ? `@${user.username}` : "—"}`,
      `Telegram ID: <code>${user.id}</code>`,
      "",
      `🔎 Searches: ${(profile as { search_count?: number } | null)?.search_count ?? 0}`,
      `📥 Requests: ${(profile as { request_count?: number } | null)?.request_count ?? 0}`,
      `❤️ Favorites: ${fav.count ?? 0}`,
      `🔖 Bookmarks: ${book.count ?? 0}`,
      `🕘 History: ${hist.count ?? 0}`,
    ].join("\n"),
    backToMenu,
  );
}

async function healthReport(ctx: FlixContext, config: FlixConfig): Promise<string> {
  const lines: string[] = ["🩺 <b>Runtime health</b>", ""];
  const { error: dbError } = await ctx.db.from("bots").select("id").eq("id", ctx.botId).maybeSingle();
  lines.push(`Database: ${dbError ? `❌ ${dbError.message}` : "✅ ok"}`);

  const info = await getWebhookInfo(ctx.token);
  lines.push(`Telegram API: ${info.ok ? "✅ ok" : `❌ ${info.error}`}`);
  if (info.ok) {
    lines.push(`Webhook: ${info.result.url ? "✅ registered" : "❌ not registered"}`);
    if (info.result.last_error_message) lines.push(`Last webhook error: ${info.result.last_error_message}`);
  }

  if (!config.logChannelId) lines.push("Log channel: ⚠️ LOG_CHANNEL_ID / TELEGRAM_LOG_CHANNEL_ID not set");
  else {
    const chat = await getChat(ctx.token, config.logChannelId);
    const probe = await logToChannel(ctx.db, config, ctx.token, "🩺 Health probe");
    lines.push(
      `Log channel: ${probe.ok ? "✅ connected" : `❌ ${probe.error}`}`,
      `  Title: ${chat.ok ? (chat.result.title ?? "—") : `unavailable (${chat.error})`}`,
      `  ID: <code>${config.logChannelId}</code>`,
    );
  }


  if (!config.storageChannelId) lines.push("Storage channel: ⚠️ STORAGE_CHANNEL_ID not configured");
  else {
    const chat = await getChat(ctx.token, config.storageChannelId);
    lines.push(`Storage channel: ${chat.ok ? `✅ ${chat.result.title ?? config.storageChannelId}` : `❌ ${chat.error}`}`);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------- callbacks

async function handleCallback(ctx: FlixContext, config: FlixConfig, access: Access): Promise<FlixResult> {
  const cb = ctx.update.callback_query!;
  const user = cb.from;
  const chatId = cb.message?.chat.id ?? user.id;
  const data = (cb.data ?? "").trim();

  // The spinner on the tapped button is cleared first, before any slow work,
  // so the client never appears to hang. Only the first call actually hits the
  // Telegram API; later calls in this invocation are no-ops.
  let acked = false;
  const ack = async (text?: string) => {
    if (acked) return { ok: true } as Awaited<ReturnType<typeof answerCallbackQuery>>;
    acked = true;
    return answerCallbackQuery(ctx.token, cb.id, text?.slice(0, 190));
  };

  // Idempotency: one callback id is processed once, and rapid repeat taps of the
  // same button by the same user are collapsed for a short window.
  const idLock = await acquireLock(ctx.db, ctx.botId, `cbid:${cb.id}`, 120);
  if (!idLock.acquired) {
    await ack();
    return { handled: true, handler: "cb:duplicate", detail: `callback ${cb.id} already processed` };
  }
  const tapLock = await acquireLock(ctx.db, ctx.botId, `cbtap:${user.id}:${data}`, 6);
  if (!tapLock.acquired) {
    await ack("⏳ Already processing your previous tap…");
    await ctx.db.from("runtime_logs").insert({
      bot_id: ctx.botId,
      level: "INFO",
      event: "DUPLICATE_CALLBACK",
      status: "skipped",
      message: `Ignored repeat tap "${data}" from user ${user.id} (previous tap still running)`,
      update_id: ctx.update.update_id,
    });
    return { handled: true, handler: "cb:duplicate-tap", detail: data };
  }

  await upsertUser(ctx.db, ctx.botId, user);

  const [prefix, ...rest] = data.split(":");
  const arg = rest.join(":");

  try {

    switch (prefix) {
      case "menu":
        await ack();
        await say(ctx.token, chatId, "🏠 <b>My Flix menu</b>", mainMenuKeyboard(config));
        return { handled: true, handler: "cb:menu" };
      case "search":
        await ack();
        await setState(ctx.db, ctx.botId, user.id, "search", "await_query", {});
        await say(ctx.token, chatId, "🔎 Send the name of the media you are looking for.");
        return { handled: true, handler: "cb:search" };
      case "request":
        await ack();
        await setState(ctx.db, ctx.botId, user.id, "request", "await_title", {});
        await say(ctx.token, chatId, "📥 Please send the name of the media you want.");
        return { handled: true, handler: "cb:request" };
      case "rq":
        await ack("Request sent");
        await createRequest(ctx, config, chatId, user, arg);
        return { handled: true, handler: "cb:request-quick" };
      case "latest":
      case "trending": {
        await ack();
        const rows = await listMedia(ctx.db, ctx.botId, prefix === "latest" ? "latest" : "trending");
        await sendResultList(ctx.token, chatId, prefix === "latest" ? "🆕 <b>Latest additions</b>" : "🔥 <b>Trending now</b>", rows, "📭 The library is empty right now.");
        return { handled: true, handler: `cb:${prefix}` };
      }
      case "categories":
      case "languages":
      case "favorites":
      case "bookmarks":
      case "history":
      case "profile":
      case "id":
      case "support": {
        await ack();
        const map: Record<string, string> = {
          categories: "/categories", languages: "/languages", favorites: "/favorites",
          bookmarks: "/bookmarks", history: "/history", profile: "/profile", id: "/id", support: "/support",
        };
        const fake: Msg = { message_id: cb.message?.message_id ?? 0, chat: { id: chatId, type: "private" }, from: user };
        return await handleCommand(ctx, config, fake, map[prefix]!, "", access);
      }
      // Exact result tapped -> warning -> the ACTUAL media, buttons attached to it.
      case "o":
      case "w":
      case "d": {
        if (!/^[0-9a-f-]{36}$/i.test(arg)) {
          await ack("This button has expired");
          return { handled: true, handler: "cb:deliver-invalid" };
        }
        const { data: row } = await ctx.db
          .from("media_library")
          .select("*")
          .eq("bot_id", ctx.botId)
          .eq("id", arg)
          .maybeSingle();
        if (!row) {
          await ack("No longer available");
          return { handled: true, handler: "cb:deliver-missing" };
        }
        await ack(prefix === "d" ? "Preparing download…" : "Sending…");
        const kind = prefix === "d" ? "download" : prefix === "w" ? "watch" : "select";
        await deliverMedia(ctx, config, chatId, row as LibraryRow, user, kind);
        return { handled: true, handler: `cb:deliver-${kind}` };
      }
      case "f":
      case "b": {
        const kind = prefix === "f" ? "favorite" : "bookmark";
        if (!/^[0-9a-f-]{36}$/i.test(arg)) {
          await ack("This button has expired");
          return { handled: true, handler: `cb:${kind}-invalid` };
        }
        const { data: media } = await ctx.db
          .from("media_library")
          .select("id")
          .eq("bot_id", ctx.botId)
          .eq("id", arg)
          .maybeSingle();
        if (!media) {
          await ack("No longer available");
          return { handled: true, handler: `cb:${kind}-missing` };
        }
        const { data: existing } = await ctx.db
          .from("user_media_marks")
          .select("id")
          .eq("bot_id", ctx.botId)
          .eq("telegram_id", user.id)
          .eq("media_id", arg)
          .eq("kind", kind)
          .maybeSingle();
        if (existing) {
          await ctx.db.from("user_media_marks").delete().eq("id", existing.id);
          await ack(kind === "favorite" ? "💔 Removed from favourites" : "🔖 Bookmark removed");
          return { handled: true, handler: `cb:${kind}-removed` };
        }
        await ctx.db.from("user_media_marks").insert({
          bot_id: ctx.botId, telegram_id: user.id, media_id: arg, kind,
        });
        await ack(kind === "favorite" ? "❤️ Added to favourites" : "🔖 Bookmarked");
        return { handled: true, handler: `cb:${kind}-added` };
      }
      case "rr":
      case "rx": {
        if (!access.isAdmin) {
          await ack("Administrators only");
          return { handled: true, handler: "cb:request-denied" };
        }
        const status = prefix === "rr" ? "resolved" : "rejected";
        const { data: req } = await ctx.db
          .from("media_requests")
          .update({ status, handled_by: user.id, handled_at: new Date().toISOString() })
          .eq("bot_id", ctx.botId)
          .eq("id", arg)
          .select("title, telegram_id")
          .maybeSingle();
        await ack(status === "resolved" ? "✅ Resolved" : "❌ Rejected");
        if (req) {
          const r = req as { title: string; telegram_id: number };
          await sendMessage(
            ctx.token,
            r.telegram_id,
            status === "resolved"
              ? `✅ Your request <b>${r.title}</b> has been added. Search for it now!`
              : `❌ Your request <b>${r.title}</b> was rejected.`,
            html,
          );
          await logToChannel(ctx.db, config, ctx.token, activityLog("👑 <b>ADMIN ACTION</b>", user, { Action: `request ${status}`, Target: r.title }));
        }
        if (cb.message) {
          await editMessageText(ctx.token, chatId, cb.message.message_id, `${cb.message.text ?? "Request"}\n\n➡️ Status: ${status}`, html);
        }
        return { handled: true, handler: `cb:request-${status}` };
      }
      case "pub": {
        if (!access.isAdmin) {
          await ack("Administrators only");
          return { handled: true, handler: "cb:publish-denied" };
        }
        const state = await getState(ctx.db, ctx.botId, user.id);
        if (!state || state.flow !== "addmovie") {
          await ack("Nothing to publish");
          return { handled: true, handler: "cb:publish-none" };
        }
        if (arg === "no") {
          await clearState(ctx.db, ctx.botId, user.id);
          await ack("Cancelled");
          await say(ctx.token, chatId, "❌ Upload cancelled.");
          return { handled: true, handler: "cb:publish-cancel" };
        }
        await ack("Publishing…");
        await publishWizard(ctx, config, chatId, user, state.data);
        return { handled: true, handler: "cb:publish" };
      }
      default:
        await ack();
        return { handled: false, handler: `cb:${prefix}`, detail: "Unknown callback" };
    }
  } catch (e) {
    await ack("Something went wrong");
    return { handled: false, handler: `cb:${prefix}`, detail: redact(e instanceof Error ? e.message : "callback error") };
  } finally {
    // The work for this tap is finished; the next tap may run immediately.
    await releaseLock(ctx.db, ctx.botId, `cbtap:${user.id}:${data}`).catch(() => undefined);
  }
}


// ---------------------------------------------------------------- text / state

async function handleText(ctx: FlixContext, config: FlixConfig, msg: Msg, access: Access): Promise<FlixResult> {
  const user = msg.from as LogUser;
  const chatId = msg.chat.id;
  const text = (msg.text ?? msg.caption ?? "").trim();
  const state = await getState(ctx.db, ctx.botId, user.id);
  const media = mediaOf(msg);

  // ---- admin upload wizard ----
  if (state?.flow === "addmovie" && access.isAdmin) {
    const payload = { ...state.data };
    const skip = text.toLowerCase() === "/skip";
    switch (state.step) {
      case "title":
        if (!text) {
          await say(ctx.token, chatId, "🎬 Please send a title.");
          return { handled: true, handler: "addmovie:title" };
        }
        payload["title"] = text;
        await wizardStep(ctx, config, chatId, user, "media", payload);
        return { handled: true, handler: "addmovie:title" };
      case "media":
        if (!media) {
          await say(ctx.token, chatId, "📼 Please send or forward the media file.");
          return { handled: true, handler: "addmovie:media" };
        }
        payload["media_type"] = media.media_type;
        payload["file_id"] = media.file_id;
        payload["file_unique_id"] = media.file_unique_id;
        payload["source_chat_id"] = chatId;
        payload["source_message_id"] = msg.message_id;
        await wizardStep(ctx, config, chatId, user, "poster", payload);
        return { handled: true, handler: "addmovie:media" };
      case "poster":
        if (!skip && msg.photo?.length) payload["poster_file_id"] = msg.photo[msg.photo.length - 1]!.file_id;
        await wizardStep(ctx, config, chatId, user, "language", payload);
        return { handled: true, handler: "addmovie:poster" };
      case "language":
        if (!skip && text) payload["language"] = text;
        await wizardStep(ctx, config, chatId, user, "genre", payload);
        return { handled: true, handler: "addmovie:language" };
      case "genre":
        if (!skip && text) payload["genre"] = text;
        await wizardStep(ctx, config, chatId, user, "description", payload);
        return { handled: true, handler: "addmovie:genre" };
      case "description":
        if (!skip && text) payload["description"] = text;
        await wizardStep(ctx, config, chatId, user, "watch", payload);
        return { handled: true, handler: "addmovie:description" };
      case "watch":
        if (!skip && /^https?:\/\//i.test(text)) payload["watch_url"] = text;
        await wizardStep(ctx, config, chatId, user, "download", payload);
        return { handled: true, handler: "addmovie:watch" };
      case "download":
        if (!skip && /^https?:\/\//i.test(text)) payload["download_url"] = text;
        await wizardStep(ctx, config, chatId, user, "preview", payload);
        return { handled: true, handler: "addmovie:download" };
      default:
        break;
    }
  }

  // ---- request flow ----
  if (state?.flow === "request" && state.step === "await_title") {
    await createRequest(ctx, config, chatId, user, text);
    return { handled: true, handler: "request:capture" };
  }

  // ---- explicit search flow ----
  if (state?.flow === "search" && state.step === "await_query") {
    await clearState(ctx.db, ctx.botId, user.id);
    await runSearch(ctx, config, chatId, user, text);
    return { handled: true, handler: "search:prompted" };
  }

  // ---- admin forwards media straight from the storage channel to index it ----
  if (media && access.isAdmin) {
    const title = (msg.caption?.split("\n")[0] ?? "").trim() || (media as { file_name?: string }).file_name?.replace(/\.[a-z0-9]+$/i, "") || "";
    if (title) {
      const res = await indexFromMessage(ctx, config, msg, { title, added_by: user.id });
      if (res.ok) {
        await say(ctx.token, chatId, `✅ Indexed <b>${title}</b> from the forwarded message.`, backToMenu);
        await logToChannel(ctx.db, config, ctx.token, activityLog("👑 <b>ADMIN ACTION</b>", user, { Action: "index forwarded media", Target: title }));
        return { handled: true, handler: "admin:index-forward" };
      }
    }
    await say(ctx.token, chatId, "ℹ️ Send /addmovie first, or add a caption whose first line is the title.");
    return { handled: true, handler: "admin:index-hint" };
  }

  if (!text) return { handled: false, handler: "text", detail: "Empty message" };

  // ---- normal text => search ----
  await logToChannel(ctx.db, config, ctx.token, activityLog("💬 <b>MESSAGE</b>", user, { Text: text.slice(0, 200) }));
  await runSearch(ctx, config, chatId, user, text);
  return { handled: true, handler: "search" };
}

// ---------------------------------------------------------------- inline query

async function handleInlineQuery(ctx: FlixContext, config: FlixConfig): Promise<FlixResult> {
  const iq = ctx.update.inline_query!;
  const rows = iq.query.trim() ? await searchLibrary(ctx.db, ctx.botId, iq.query, 20) : await listMedia(ctx.db, ctx.botId, "latest", 20);
  const results = rows.map((m) => ({
    type: "article",
    id: m.id,
    title: m.title,
    description: [m.language, m.genre].filter(Boolean).join(" · ") || m.media_type,
    input_message_content: { message_text: `🎬 ${m.title}\n\nOpen @${config.botUsername ?? "the bot"} and search for it.` },
  }));
  const res = await answerInlineQuery(ctx.token, iq.id, results);
  return { handled: res.ok, handler: "inline_query", detail: res.ok ? `${results.length} results` : res.error };
}

// ---------------------------------------------------------------- entry point

export async function dispatchFlix(ctx: FlixContext): Promise<FlixResult | null> {
  return runtimeStore.run(ctx, () => dispatchFlixInner(ctx));
}

async function dispatchFlixInner(ctx: FlixContext): Promise<FlixResult | null> {
  const config = await loadConfig(ctx.db, ctx.botId);
  const update = ctx.update;
  void purgeExpiredLocks(ctx.db);

  try {
    if (update.inline_query) return await handleInlineQuery(ctx, config);
    if (update.callback_query) {
      const cbAccess = await resolveAccess(ctx.db, ctx.token, config, update.callback_query.from.id);
      if (cbAccess.blocked) {
        await answerCallbackQuery(ctx.token, update.callback_query.id, "🚫 You are blocked from using this bot.");
        await ctx.db.from("runtime_logs").insert({
          bot_id: ctx.botId,
          level: "WARNING",
          event: "BLOCKED_SENDER",
          status: "denied",
          message: `Blocked user ${cbAccess.userId} tapped a button`,
          update_id: update.update_id,
        });
        return { handled: true, handler: "cb:blocked" };
      }
      return await handleCallback(ctx, config, cbAccess);
    }

    const channelPost = update.channel_post;
    if (channelPost) return await handleStorageChannelPost(ctx, config, channelPost);

    const msg = update.message ?? update.edited_message;
    if (!msg?.from) return null;

    // Idempotency for incoming messages: Telegram retries and concurrent
    // invocations of the same message are collapsed to a single execution.
    const msgLock = await acquireLock(ctx.db, ctx.botId, `msg:${msg.chat.id}:${msg.message_id}`, 120);
    if (!msgLock.acquired) {
      await ctx.db.from("runtime_logs").insert({
        bot_id: ctx.botId,
        level: "INFO",
        event: "DUPLICATE_MESSAGE",
        status: "skipped",
        message: `Ignored duplicate delivery of message ${msg.message_id} in chat ${msg.chat.id}`,
        update_id: update.update_id,
      });
      return { handled: true, handler: "duplicate-message" };
    }

    // Storage channel media can also arrive as a regular message when the bot is a member.
    if (config.storageChannelId && msg.chat.id === config.storageChannelId) {
      const indexed = await handleStorageChannelPost(ctx, config, msg);
      if (indexed) return indexed;
    }

    await upsertUser(ctx.db, ctx.botId, msg.from);

    // Real sender verification: ban state from the database, owner/admin either
    // configured for this bot or verified live against Telegram.
    const access = await resolveAccess(ctx.db, ctx.token, config, msg.from.id);
    if (access.blocked) {
      await say(ctx.token, msg.chat.id, "🚫 Your access to this bot has been blocked by an administrator.");
      await ctx.db.from("runtime_logs").insert({
        bot_id: ctx.botId,
        level: "WARNING",
        event: "BLOCKED_SENDER",
        status: "denied",
        message: `Blocked user ${access.userId} sent a message`,
        update_id: update.update_id,
      });
      return { handled: true, handler: "blocked-sender" };
    }


    const text = (msg.text ?? "").trim();
    if (text.startsWith("/")) {
      const raw = text.split(/\s+/)[0]!;
      const command = raw.split("@")[0]!.toLowerCase();
      const args = text.slice(raw.length).trim();
      if (COMMANDS.has(command)) return await handleCommand(ctx, config, msg, command, args, access);
      if (command === "/skip") return await handleText(ctx, config, msg, access);
      return null; // let adapted project handlers try unknown commands
    }

    return await handleText(ctx, config, msg, access);
  } catch (e) {
    const message = redact(e instanceof Error ? e.message : "Runtime error");
    const chatId = update.message?.chat.id ?? update.callback_query?.message?.chat.id;
    if (chatId) {
      await sendMessage(ctx.token, chatId, "⚠️ Something went wrong. Please try again in a moment.").catch(() => undefined);
    }
    await ctx.db.from("runtime_logs").insert({
      bot_id: ctx.botId,
      level: "ERROR",
      event: "RUNTIME",
      status: "error",
      message,
      update_id: update.update_id,
    });
    await logToChannel(ctx.db, config, ctx.token, `⚠️ <b>RUNTIME ERROR</b>\n\n${message}\n${stamp()}`).catch(() => undefined);
    return { handled: false, handler: "runtime:error", detail: message };
  }
}

/** Final fallback when nothing else handled the update. */
export async function flixFallback(ctx: FlixContext): Promise<FlixResult | null> {
  const msg = ctx.update.message;
  if (!msg?.from || !msg.text) return null;
  const config = await loadConfig(ctx.db, ctx.botId);
  await say(
    ctx.token,
    msg.chat.id,
    "🤔 I did not understand that command.\n\nUse the menu below or just type a title to search.",
    mainMenuKeyboard(config),
  );
  return { handled: true, handler: "fallback" };
}

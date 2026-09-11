/**
 * Durable temporary-message lifecycle for bot deliveries.
 *
 * A serverless invocation cannot stay alive until the message expires, so every
 * temporary message the bot creates is written to `scheduled_deletions` with an
 * `expires_at` timestamp and `status = 'pending'`. A durable pg_cron job (every
 * 10 seconds) calls /api/public/cleanup/deliveries which sweeps expired rows.
 *
 * There is NO setTimeout/setInterval anywhere in this lifecycle — the database
 * row is the single source of truth and survives restarts and redeploys.
 *
 * Only messages the bot itself created are ever deleted: never user messages,
 * never storage-channel media, never database records.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendMessage, deleteMessage } from "../telegram.server";

export const DEFAULT_AUTO_DELETE_SECONDS = 45;

/** AUTO_DELETE_SECONDS from the bot environment; 45 only when unset/empty/invalid. */
export function autoDeleteSeconds(configured: number | null | undefined): number {
  if (typeof configured === "number" && Number.isFinite(configured) && configured > 0) {
    return Math.floor(configured);
  }
  return DEFAULT_AUTO_DELETE_SECONDS;
}

export function autoDeleteNotice(seconds: number): string {
  return [
    `⏳ This message will be automatically deleted in ${seconds} seconds.`,
    "💡 Please forward or save this message to another chat if you want to keep it.",
  ].join("\n");
}

export type DeliveryMessages = {
  /** The delivered file message. */
  fileMessageId?: number | null;
  /** The separate warning ("will be deleted") message, when one was sent. */
  warningMessageId?: number | null;
  /** The separate Watch/Download link message, when one was sent. */
  linkMessageId?: number | null;
};

/**
 * Record a durable pending delivery. Only real, sent message IDs are stored —
 * never a fake placeholder. Returns false when there is nothing to clean up.
 */
export async function recordDelivery(
  db: SupabaseClient,
  botId: string,
  chatId: number,
  messages: DeliveryMessages,
  seconds: number,
): Promise<boolean> {
  const primary =
    messages.fileMessageId ?? messages.warningMessageId ?? messages.linkMessageId ?? null;
  if (!primary) return false;

  const { error } = await db.from("scheduled_deletions").upsert(
    {
      bot_id: botId,
      chat_id: chatId,
      message_id: primary,
      warning_message_id: messages.warningMessageId ?? null,
      link_message_id: messages.linkMessageId ?? null,
      expires_at: new Date(Date.now() + seconds * 1000).toISOString(),
      delete_at: new Date(Date.now() + seconds * 1000).toISOString(),
      status: "pending",
      deleted_at: null,
    },
    { onConflict: "bot_id,chat_id,message_id" },
  );
  return !error;
}

/** Backwards-compatible single-message registration (used by sendEphemeral). */
export async function scheduleDeletion(
  db: SupabaseClient,
  botId: string,
  chatId: number,
  messageId: number,
  seconds: number,
): Promise<void> {
  await recordDelivery(db, botId, chatId, { fileMessageId: messageId }, seconds);
}

/**
 * Send a temporary message with the auto-delete notice and register it durably.
 * No in-process timer is involved.
 */
export async function sendEphemeral(
  db: SupabaseClient,
  token: string,
  botId: string,
  chatId: number,
  text: string,
  keyboard: unknown | undefined,
  seconds: number,
): Promise<{ ok: boolean; messageId?: number }> {
  const res = await sendMessage(token, chatId, `${text}\n\n${autoDeleteNotice(seconds)}`, {
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...(keyboard ? { reply_markup: keyboard } : {}),
  });
  if (!res.ok) return { ok: false };
  await recordDelivery(db, botId, chatId, { fileMessageId: res.result.message_id }, seconds);
  return { ok: true, messageId: res.result.message_id };
}

export type SweepStats = {
  found: number;
  deleted: number;
  alreadyGone: number;
  failed: number;
};

function alreadyGone(error: string | undefined): boolean {
  const e = (error ?? "").toLowerCase();
  return (
    e.includes("message to delete not found") ||
    e.includes("message can't be deleted") ||
    e.includes("message identifier is not specified") ||
    e.includes("chat not found")
  );
}

/**
 * Delete every temporary message of one expired delivery. Idempotent: a message
 * Telegram no longer knows about is counted as already gone, never as a crash.
 */
async function processDelivery(
  db: SupabaseClient,
  token: string,
  botId: string,
  row: {
    id: string;
    chat_id: number;
    message_id: number;
    warning_message_id: number | null;
    link_message_id: number | null;
    attempts: number;
  },
  stats: SweepStats,
): Promise<void> {
  await db.from("runtime_logs").insert({
    bot_id: botId,
    level: "INFO",
    event: "AUTO_DELETE_PROCESSING",
    status: "processing",
    message: `Processing expired delivery ${row.id} for chat ${row.chat_id}`,
  });

  // Order: file message -> Watch/Download link message -> warning message.
  const targets = [row.message_id, row.link_message_id, row.warning_message_id].filter(
    (id): id is number => typeof id === "number" && id > 0,
  );

  let failedError: string | null = null;
  for (const messageId of targets) {
    try {
      const res = await deleteMessage(token, row.chat_id, messageId);
      await db.from("runtime_logs").insert({
        bot_id: botId,
        level: res.ok ? "INFO" : "ERROR",
        event: "AUTO_DELETE_TELEGRAM_RESPONSE",
        status: res.ok ? "success" : "error",
        message: res.ok
          ? `Telegram deleteMessage returned ok=true for chat ${row.chat_id} message ${messageId}`
          : `Telegram deleteMessage returned ok=false for chat ${row.chat_id} message ${messageId}: ${res.error}`,
      });
      if (res.ok) {
        stats.deleted++;
        await db.from("runtime_logs").insert({
          bot_id: botId,
          level: "INFO",
          event: "AUTO_DELETE_SUCCESS",
          status: "deleted",
          message: `Telegram deleteMessage confirmed for chat ${row.chat_id} message ${messageId}`,
        });
      } else if (alreadyGone(res.error)) {
        stats.alreadyGone++;
        await db.from("runtime_logs").insert({
          bot_id: botId,
          level: "INFO",
          event: "AUTO_DELETE_SUCCESS",
          status: "already_gone",
          message: `Message ${messageId} in chat ${row.chat_id} already gone: ${res.error ?? ""}`,
        });
      } else {
        stats.failed++;
        failedError = res.error ?? "unknown Telegram error";
        await db.from("runtime_logs").insert({
          bot_id: botId,
          level: "ERROR",
          event: "AUTO_DELETE_FAILED",
          status: "error",
          message: `deleteMessage failed for chat ${row.chat_id} message ${messageId}: ${failedError}`,
        });
      }
    } catch (e) {
      stats.failed++;
      failedError = e instanceof Error ? e.message : "delete failed";
      await db.from("runtime_logs").insert({
        bot_id: botId,
        level: "ERROR",
        event: "AUTO_DELETE_FAILED",
        status: "error",
        message: `deleteMessage threw for chat ${row.chat_id} message ${messageId}: ${failedError}`,
      });
    }
  }

  const attempts = (row.attempts ?? 0) + 1;
  // Retry transient failures a few times, then stop so the sweep never loops forever.
  const done = !failedError || attempts >= 3;
  await db
    .from("scheduled_deletions")
    .update({
      attempts,
      last_error: failedError,
      ...(done
        ? { status: failedError ? "failed" : "deleted", deleted_at: failedError ? null : new Date().toISOString() }
        : { status: "pending" }),
    })
    .eq("id", row.id);
}


/**
 * Sweep the expired pending deliveries of a single bot. Safe to call from the
 * cron endpoint; never throws.
 */
export async function sweepDueDeletions(
  db: SupabaseClient,
  token: string,
  botId: string,
  limit = 50,
): Promise<SweepStats> {
  const stats: SweepStats = { found: 0, deleted: 0, alreadyGone: 0, failed: 0 };
  try {
    const { data } = await db
      .from("scheduled_deletions")
      .select("id, chat_id, message_id, warning_message_id, link_message_id, attempts")
      .eq("bot_id", botId)
      .eq("status", "pending")
      .lte("expires_at", new Date().toISOString())
      .order("expires_at", { ascending: true })
      .limit(limit);
    const candidates = (data ?? []) as Parameters<typeof processDelivery>[3][];
    for (const row of candidates) {
      // Claim each row before calling Telegram. Concurrent worker invocations
      // cannot process the same pending delivery.
      const { data: claimed } = await db
        .from("scheduled_deletions")
        .update({ status: "processing" })
        .eq("id", row.id)
        .eq("status", "pending")
        .select("id")
        .maybeSingle();
      if (!claimed) continue;
      stats.found++;
      await processDelivery(db, token, botId, row, stats);
    }

  } catch {
    /* one bot must never break the whole sweep */
  }
  return stats;
}

/** Observability snapshot used by /health. */
export async function cleanupStatus(db: SupabaseClient, botId: string) {
  const nowIso = new Date().toISOString();
  const [pending, expired, lastRun, lastOk] = await Promise.all([
    db
      .from("scheduled_deletions")
      .select("id", { count: "exact", head: true })
      .eq("bot_id", botId)
      .eq("status", "pending"),
    db
      .from("scheduled_deletions")
      .select("id", { count: "exact", head: true })
      .eq("bot_id", botId)
      .eq("status", "pending")
      .lte("expires_at", nowIso),
    db
      .from("cleanup_runs")
      .select("started_at, finished_at, found, deleted, failed, ok, error")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    db
      .from("cleanup_runs")
      .select("finished_at")
      .eq("ok", true)
      .order("finished_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  return {
    pending: pending.count ?? 0,
    expired: expired.count ?? 0,
    lastRun: (lastRun.data as { started_at?: string } | null)?.started_at ?? null,
    lastRunError: (lastRun.data as { error?: string | null } | null)?.error ?? null,
    lastSuccess: (lastOk.data as { finished_at?: string } | null)?.finished_at ?? null,
  };
}

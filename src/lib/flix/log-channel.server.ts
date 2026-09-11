/**
 * LOG_CHANNEL_ID delivery. Every call really hits the Telegram Bot API.
 * Failures are surfaced (runtime_logs + health page), never silently swallowed.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendMessage } from "../telegram.server";
import { redact } from "../crypto.server";
import type { FlixConfig } from "./config.server";

export type LogUser = {
  id: number;
  first_name?: string | undefined;
  last_name?: string | undefined;
  username?: string | undefined;
};

function esc(value: unknown): string {
  return String(value ?? "—")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function displayName(u: LogUser | null | undefined): string {
  if (!u) return "Unknown";
  return [u.first_name, u.last_name].filter(Boolean).join(" ") || `User ${u.id}`;
}

export function stamp(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

/** Send a formatted event to the configured log channel. */
export async function logToChannel(
  db: SupabaseClient,
  config: FlixConfig,
  token: string,
  text: string,
): Promise<{ ok: boolean; error?: string; messageId?: number }> {
  if (!config.logChannelId) {
    return { ok: false, error: "LOG_CHANNEL_ID is not configured" };
  }
  const res = await sendMessage(token, config.logChannelId, redact(text), {
    parse_mode: "HTML",
    disable_web_page_preview: true,
  });
  if (!res.ok) {
    await db.from("runtime_logs").insert({
      bot_id: config.botId,
      level: "ERROR",
      event: "LOG_CHANNEL",
      status: "failed",
      message: redact(`Telegram refused the log channel message: ${res.error}`),
    });
    return { ok: false, error: res.error };
  }
  return { ok: true, messageId: res.result.message_id };
}

export function activityLog(kind: string, user: LogUser, lines: Record<string, unknown>): string {
  const head = `${kind}\n`;
  const base: Record<string, unknown> = {
    User: displayName(user),
    Username: user.username ? `@${user.username}` : "—",
    "Telegram ID": user.id,
    ...lines,
    Time: stamp(),
  };
  return (
    head +
    Object.entries(base)
      .map(([k, v]) => `<b>${esc(k)}:</b> ${esc(v)}`)
      .join("\n")
  );
}

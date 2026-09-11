/**
 * Runtime configuration for a hosted bot.
 *
 * Values come from the encrypted bot_environment_variables table plus the
 * bots / storage_channels rows. Nothing here is ever returned to the browser.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptSecret, encryptSecret } from "../crypto.server";

export type FlixConfig = {
  botId: string;
  botName: string;
  botUsername: string | null;
  botTelegramId: number | null;
  ownerId: number | null;
  adminIds: number[];
  logChannelId: number | null;
  storageChannelId: number | null;
  supportUsername: string | null;
  /** Ready-to-open https link for the support button, when one is configured. */
  supportUrl: string | null;
  autoDeleteSeconds: number | null;
  forceJoinChannels: string[];
};

/** Environment key written by /setsupport. Highest priority support source. */
export const SUPPORT_CONTACT_KEY = "SUPPORT_CONTACT";

/**
 * Accepts "@name", "name", "t.me/name", "https://t.me/name" or any https URL and
 * returns a safe username/url pair. Returns null for anything unusable.
 */
export function normalizeSupport(
  raw: string | null | undefined,
): { username: string | null; url: string } | null {
  const value = (raw ?? "").trim();
  if (!value) return null;

  const tme = value.match(/^(?:https?:\/\/)?(?:www\.)?t(?:elegram)?\.me\/(?:@)?([A-Za-z0-9_]{3,64})\/?$/i);
  if (tme) return { username: tme[1]!, url: `https://t.me/${tme[1]!}` };

  const handle = value.match(/^@?([A-Za-z0-9_]{3,64})$/);
  if (handle) return { username: handle[1]!, url: `https://t.me/${handle[1]!}` };

  if (/^https:\/\/[^\s]+$/i.test(value) && value.length <= 300) {
    return { username: null, url: value };
  }
  return null;
}


function toNumber(value: string | undefined | null): number | null {
  if (!value) return null;
  const n = Number(String(value).trim());
  return Number.isFinite(n) && n !== 0 ? n : null;
}

/** First non-empty value among the supported aliases. Empty vars never win. */
function pick(env: Record<string, string>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = (env[key] ?? "").trim();
    if (value) return value;
  }
  return null;
}


/** Load and decrypt every environment variable configured for a bot. */
export async function loadEnv(db: SupabaseClient, botId: string): Promise<Record<string, string>> {
  const { data } = await db
    .from("bot_environment_variables")
    .select("key, value_ciphertext, value_iv")
    .eq("bot_id", botId);
  const out: Record<string, string> = {};
  for (const row of data ?? []) {
    try {
      out[row.key as string] = await decryptSecret(
        row.value_ciphertext as string,
        row.value_iv as string,
      );
    } catch {
      /* a single unreadable variable must not break the runtime */
    }
  }
  return out;
}

export async function loadConfig(db: SupabaseClient, botId: string): Promise<FlixConfig> {
  const env = await loadEnv(db, botId);

  const { data: bot } = await db
    .from("bots")
    .select("name, telegram_username, telegram_bot_id, owner_telegram_id")
    .eq("id", botId)
    .maybeSingle();

  const { data: channel } = await db
    .from("storage_channels")
    .select("chat_id, verified_at")
    .eq("bot_id", botId)
    .not("verified_at", "is", null)
    .maybeSingle();

  const adminIds = (pick(env, "ADMIN_IDS", "OWNER_IDS", "TELEGRAM_ADMIN_IDS") ?? "")
    .split(/[,\s]+/)
    .map((v) => Number(v.trim()))
    .filter((v) => Number.isFinite(v) && v !== 0);

  const ownerId =
    toNumber(pick(env, "OWNER_ID", "OWNER_IDS", "TELEGRAM_OWNER_ID")) ??
    (bot?.owner_telegram_id as number | null) ??
    null;
  if (ownerId && !adminIds.includes(ownerId)) adminIds.push(ownerId);

  // Priority: explicit saved support contact (/setsupport) -> SUPPORT_URL -> SUPPORT_USERNAME.
  const support =
    normalizeSupport(pick(env, SUPPORT_CONTACT_KEY)) ??
    normalizeSupport(pick(env, "SUPPORT_URL")) ??
    normalizeSupport(pick(env, "SUPPORT_USERNAME", "SUPPORT_CHAT"));

  return {
    botId,
    botName: (bot?.name as string) ?? "My Flix",
    botUsername: (bot?.telegram_username as string | null) ?? null,
    botTelegramId: (bot?.telegram_bot_id as number | null) ?? null,
    ownerId,
    adminIds,
    logChannelId: toNumber(pick(env, "LOG_CHANNEL_ID", "TELEGRAM_LOG_CHANNEL_ID", "LOG_CHANNEL")),
    storageChannelId:
      toNumber(pick(env, "STORAGE_CHANNEL_ID", "TELEGRAM_STORAGE_CHANNEL_ID", "STORAGE_CHANNEL")) ??
      ((channel?.chat_id as number | undefined) ?? null),
    supportUsername: support?.username ?? null,
    supportUrl: support?.url ?? null,
    autoDeleteSeconds: toNumber(pick(env, "AUTO_DELETE_SECONDS")),

    forceJoinChannels: (pick(env, "FORCE_JOIN_CHANNELS") ?? "")
      .split(/[,\s]+/)
      .map((v) => v.trim())
      .filter(Boolean),
  };
}

/**
 * Persist the support contact through the existing encrypted settings mechanism.
 * It is read back by loadConfig on the very next update — no redeploy needed.
 */
export async function saveSupportContact(
  db: SupabaseClient,
  botId: string,
  raw: string,
): Promise<{ ok: true; username: string | null; url: string } | { ok: false; error: string }> {
  const normalized = normalizeSupport(raw);
  if (!normalized) {
    return { ok: false, error: "invalid" };
  }
  const enc = await encryptSecret(normalized.username ? `@${normalized.username}` : normalized.url);
  await db
    .from("bot_environment_variables")
    .delete()
    .eq("bot_id", botId)
    .eq("key", SUPPORT_CONTACT_KEY);
  const { error } = await db.from("bot_environment_variables").insert({
    bot_id: botId,
    key: SUPPORT_CONTACT_KEY,
    value_ciphertext: enc.ciphertext,
    value_iv: enc.iv,
    is_secret: false,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, username: normalized.username, url: normalized.url };
}


export function isAdmin(config: FlixConfig, telegramId: number | undefined | null): boolean {
  if (!telegramId) return false;
  return config.adminIds.includes(telegramId);
}

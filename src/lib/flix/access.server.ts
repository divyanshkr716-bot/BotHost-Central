/**
 * Real sender verification for every incoming update.
 *
 * Nothing here is assumed or hardcoded: the ban flag comes from the database and
 * owner/admin status is either configured for this bot or verified live against
 * Telegram (creator / administrator of the bot's own log or storage channel).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getChatMember } from "../telegram.server";
import type { FlixConfig } from "./config.server";

export type Access = {
  userId: number;
  isOwner: boolean;
  isAdmin: boolean;
  blocked: boolean;
  role: "owner" | "admin" | "user";
  /** Where the decision came from — used in real replies and logs. */
  source: string;
  registered: boolean;
};

export async function resolveAccess(
  db: SupabaseClient,
  token: string,
  config: FlixConfig,
  userId: number | undefined | null,
): Promise<Access> {
  const base: Access = {
    userId: userId ?? 0,
    isOwner: false,
    isAdmin: false,
    blocked: false,
    role: "user",
    source: "unverified sender",
    registered: false,
  };
  if (!userId) return base;

  const { data: row } = await db
    .from("bot_users")
    .select("is_blocked")
    .eq("bot_id", config.botId)
    .eq("telegram_id", userId)
    .maybeSingle();
  base.registered = Boolean(row);
  base.blocked = Boolean((row as { is_blocked?: boolean } | null)?.is_blocked);

  if (config.ownerId && config.ownerId === userId) {
    return { ...base, isOwner: true, isAdmin: true, role: "owner", source: "configured owner" };
  }
  if (config.adminIds.includes(userId)) {
    return { ...base, isAdmin: true, role: "admin", source: "configured admin list" };
  }

  // Live Telegram verification against the bot's own channels.
  const chats = [config.logChannelId, config.storageChannelId].filter(
    (v): v is number => typeof v === "number" && v !== 0,
  );
  for (const chatId of chats) {
    const member = await getChatMember(token, chatId, userId);
    if (!member.ok) continue;
    const status = member.result.status;
    if (status === "creator") {
      // Remember the verified owner so later updates resolve without an API call.
      await db
        .from("bots")
        .update({ owner_telegram_id: userId })
        .eq("id", config.botId)
        .is("owner_telegram_id", null);
      return {
        ...base,
        isOwner: true,
        isAdmin: true,
        role: "owner",
        source: `Telegram creator of chat ${chatId}`,
      };
    }
    if (status === "administrator") {
      return {
        ...base,
        isAdmin: true,
        role: "admin",
        source: `Telegram administrator of chat ${chatId}`,
      };
    }
  }
  return base;
}

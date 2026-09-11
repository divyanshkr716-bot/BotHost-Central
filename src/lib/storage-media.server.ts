/**
 * Media & storage-channel services. All calls hit the real Telegram Bot API.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getChat, getChatMember, copyMessage, deleteMessage } from "./telegram.server";

export type StorageVerification = {
  ok: boolean;
  chatId?: number;
  title?: string | null;
  type?: string;
  botIsAdmin: boolean;
  canPostMessages: boolean | null;
  error?: string;
};

export async function verifyStorageChannel(
  token: string,
  chatId: number,
  botTelegramId: number,
): Promise<StorageVerification> {
  const chat = await getChat(token, chatId);
  if (!chat.ok)
    return { ok: false, botIsAdmin: false, canPostMessages: null, error: `getChat failed: ${chat.error}` };

  const member = await getChatMember(token, chatId, botTelegramId);
  if (!member.ok)
    return {
      ok: false,
      chatId,
      title: chat.result.title ?? null,
      type: chat.result.type,
      botIsAdmin: false,
      canPostMessages: null,
      error: `getChatMember failed: ${member.error}`,
    };

  const isAdmin = member.result.status === "administrator" || member.result.status === "creator";
  const canPost = member.result.can_post_messages ?? (member.result.status === "creator" ? true : null);
  return {
    ok: isAdmin,
    chatId,
    title: chat.result.title ?? null,
    type: chat.result.type,
    botIsAdmin: isAdmin,
    canPostMessages: canPost,
    ...(isAdmin ? {} : { error: `Bot is "${member.result.status}" in this chat, not an administrator.` }),
  };
}

export async function storeMedia(
  db: SupabaseClient,
  args: {
    botId: string;
    storageChatId: number;
    messageId: number;
    fileId: string;
    fileUniqueId?: string | null;
    mediaType: string;
    fileName?: string | null;
    fileSize?: number | null;
    caption?: string | null;
  },
) {
  return db.from("media").insert({
    bot_id: args.botId,
    storage_chat_id: args.storageChatId,
    message_id: args.messageId,
    file_id: args.fileId,
    file_unique_id: args.fileUniqueId ?? null,
    media_type: args.mediaType,
    file_name: args.fileName ?? null,
    file_size: args.fileSize ?? null,
    caption: args.caption ?? null,
  });
}

export async function getStoredMedia(db: SupabaseClient, botId: string, limit = 100) {
  return db
    .from("media")
    .select("*")
    .eq("bot_id", botId)
    .order("created_at", { ascending: false })
    .limit(limit);
}

export async function sendStoredMedia(
  token: string,
  targetChatId: number,
  storageChatId: number,
  messageId: number,
) {
  return copyMessage(token, targetChatId, storageChatId, messageId);
}

export async function deleteStoredMedia(
  db: SupabaseClient,
  token: string,
  mediaId: string,
): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await db.from("media").select("*").eq("id", mediaId).maybeSingle();
  if (error || !data) return { ok: false, error: error?.message ?? "Media not found" };
  const removed = await deleteMessage(token, data.storage_chat_id, data.message_id);
  await db.from("media").delete().eq("id", mediaId);
  return removed.ok ? { ok: true } : { ok: true, error: `Row removed; Telegram delete failed: ${removed.error}` };
}

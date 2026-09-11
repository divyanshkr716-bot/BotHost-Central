/**
 * Webhook adapter runtime + handler registry.
 *
 * Telegram Update -> Webhook Adapter -> Handler Registry -> Business logic -> Telegram API
 *
 * Handlers come from two sources:
 *  1. Built-in platform handlers (media capture into the private storage channel).
 *  2. The declarative adapter plan generated from the user's uploaded project.
 *
 * Nothing here spawns processes or keeps state between invocations.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendMessage, answerCallbackQuery, forwardMessage } from "./telegram.server";
import type { AdapterPlan } from "./analyze.server";
import { dispatchFlix, flixFallback, type FlixUpdate } from "./flix/runtime.server";

/** Real My Flix runtime: commands, callbacks, search, requests, storage indexing. */
async function flixHandler(ctx: HandlerContext): Promise<HandlerResult | null> {
  return dispatchFlix({
    botId: ctx.botId,
    token: ctx.token,
    db: ctx.db,
    update: ctx.update as unknown as FlixUpdate,
  });
}

async function flixFallbackHandler(ctx: HandlerContext): Promise<HandlerResult | null> {
  return flixFallback({
    botId: ctx.botId,
    token: ctx.token,
    db: ctx.db,
    update: ctx.update as unknown as FlixUpdate,
  });
}

export type TgUpdate = {
  update_id: number;
  message?: TgMessage;
  edited_message?: TgMessage;
  channel_post?: TgMessage;
  callback_query?: {
    id: string;
    data?: string;
    from: { id: number };
    message?: TgMessage;
  };
};

export type TgMessage = {
  message_id: number;
  chat: { id: number; type: string };
  from?: { id: number; username?: string };
  text?: string;
  caption?: string;
  photo?: { file_id: string; file_unique_id: string; file_size?: number }[];
  video?: { file_id: string; file_unique_id: string; file_size?: number; file_name?: string };
  document?: { file_id: string; file_unique_id: string; file_size?: number; file_name?: string };
  audio?: { file_id: string; file_unique_id: string; file_size?: number; file_name?: string };
};

export type HandlerContext = {
  botId: string;
  token: string;
  update: TgUpdate;
  plan: AdapterPlan;
  storageChatId: number | null;
  db: SupabaseClient;
};

export type HandlerResult = { handled: boolean; handler: string; detail?: string };

export function classifyUpdate(update: TgUpdate): { type: string; chatId?: number; userId?: number } {
  if (update.message) return { type: "message", chatId: update.message.chat.id, ...(update.message.from ? { userId: update.message.from.id } : {}) };
  if (update.edited_message)
    return { type: "edited_message", chatId: update.edited_message.chat.id };
  if (update.callback_query)
    return { type: "callback_query", userId: update.callback_query.from.id, ...(update.callback_query.message ? { chatId: update.callback_query.message.chat.id } : {}) };
  if (update.channel_post) return { type: "channel_post", chatId: update.channel_post.chat.id };
  return { type: "unknown" };
}

function mediaOf(msg: TgMessage) {
  if (msg.photo?.length) {
    const p = msg.photo[msg.photo.length - 1]!;
    return { media_type: "photo", ...p, file_name: null };
  }
  if (msg.video) return { media_type: "video", ...msg.video };
  if (msg.document) return { media_type: "document", ...msg.document };
  if (msg.audio) return { media_type: "audio", ...msg.audio };
  return null;
}

/** Media capture: forward into the bot's private Telegram storage channel and index metadata. */
async function mediaHandler(ctx: HandlerContext): Promise<HandlerResult | null> {
  const msg = ctx.update.message;
  if (!msg) return null;
  const media = mediaOf(msg);
  if (!media) return null;
  if (!ctx.storageChatId)
    return { handled: false, handler: "media", detail: "No verified storage channel configured" };

  const fwd = await forwardMessage(ctx.token, ctx.storageChatId, msg.chat.id, msg.message_id);
  if (!fwd.ok) return { handled: false, handler: "media", detail: fwd.error };

  await ctx.db.from("media").insert({
    bot_id: ctx.botId,
    storage_chat_id: ctx.storageChatId,
    message_id: fwd.result.message_id,
    file_id: media.file_id,
    file_unique_id: media.file_unique_id,
    media_type: media.media_type,
    file_name: media.file_name ?? null,
    file_size: media.file_size ?? null,
    caption: msg.caption ?? null,
  });
  return { handled: true, handler: "media", detail: `${media.media_type} stored` };
}

/**
 * Generic uploaded-project adapter.
 *
 * The platform deliberately does NOT turn statically discovered reply strings
 * into fake command handlers. A command must be handled by a trusted runtime
 * adapter (for example the built-in Flix runtime) or by a future sandboxed
 * execution worker. This prevents the dashboard from claiming that arbitrary
 * uploaded code is running when it is not.
 */
async function planHandler(_ctx: HandlerContext): Promise<HandlerResult | null> {
  return null;
}

export const HANDLER_REGISTRY = [flixHandler, mediaHandler, planHandler];

export async function runHandlers(ctx: HandlerContext): Promise<HandlerResult> {
  for (const handler of HANDLER_REGISTRY) {
    const result = await handler(ctx);
    if (result) return result;
  }
  return { handled: false, handler: "none", detail: "No handler matched this update" };
}

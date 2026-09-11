/**
 * Thin, real Telegram Bot API client. Every call here hits api.telegram.org.
 * No polling, no getUpdates, no persistent process.
 */
import { redact } from "./crypto.server";

const API = "https://api.telegram.org";

export type TgResult<T> = { ok: true; result: T } | { ok: false; error: string; code?: number };

export async function tgCall<T>(
  token: string,
  method: string,
  body?: Record<string, unknown>,
): Promise<TgResult<T>> {
  try {
    const res = await fetch(`${API}/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    const json = (await res.json()) as {
      ok: boolean;
      result?: T;
      description?: string;
      error_code?: number;
    };
    if (!json.ok) {
      return {
        ok: false,
        error: redact(json.description ?? `Telegram API error (${res.status})`),
        code: json.error_code ?? res.status,
      };
    }
    return { ok: true, result: json.result as T };
  } catch (e) {
    return { ok: false, error: redact(e instanceof Error ? e.message : "Network error") };
  }
}

export type TgUser = {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
  can_join_groups?: boolean;
};

export type TgChat = { id: number; type: string; title?: string; username?: string };

export type TgChatMember = {
  status: string;
  can_post_messages?: boolean;
  can_delete_messages?: boolean;
};

export type TgWebhookInfo = {
  url: string;
  has_custom_certificate: boolean;
  pending_update_count: number;
  last_error_date?: number;
  last_error_message?: string;
  ip_address?: string;
};

export const getMe = (token: string) => tgCall<TgUser>(token, "getMe");

export const getChat = (token: string, chat_id: number | string) =>
  tgCall<TgChat>(token, "getChat", { chat_id });

export const getChatMember = (token: string, chat_id: number | string, user_id: number) =>
  tgCall<TgChatMember>(token, "getChatMember", { chat_id, user_id });

export const setWebhook = (
  token: string,
  url: string,
  secret_token: string,
  allowed_updates?: string[],
) =>
  tgCall<boolean>(token, "setWebhook", {
    url,
    secret_token,
    allowed_updates: allowed_updates ?? [
      "message",
      "edited_message",
      "channel_post",
      "callback_query",
    ],
    drop_pending_updates: false,
    max_connections: 40,
  });

export const deleteWebhook = (token: string) =>
  tgCall<boolean>(token, "deleteWebhook", { drop_pending_updates: false });

export const getWebhookInfo = (token: string) => tgCall<TgWebhookInfo>(token, "getWebhookInfo");

export const sendMessage = (
  token: string,
  chat_id: number | string,
  text: string,
  extra?: Record<string, unknown>,
) => tgCall<{ message_id: number }>(token, "sendMessage", { chat_id, text, ...extra });

export const copyMessage = (
  token: string,
  chat_id: number | string,
  from_chat_id: number | string,
  message_id: number,
  extra?: Record<string, unknown>,
) => tgCall<{ message_id: number }>(token, "copyMessage", { chat_id, from_chat_id, message_id, ...extra });

export const forwardMessage = (
  token: string,
  chat_id: number | string,
  from_chat_id: number | string,
  message_id: number,
) => tgCall<{ message_id: number }>(token, "forwardMessage", { chat_id, from_chat_id, message_id });

export const deleteMessage = (token: string, chat_id: number | string, message_id: number) =>
  tgCall<boolean>(token, "deleteMessage", { chat_id, message_id });

export const answerCallbackQuery = (token: string, callback_query_id: string, text?: string) =>
  tgCall<boolean>(token, "answerCallbackQuery", { callback_query_id, text });

export const editMessageText = (
  token: string,
  chat_id: number | string,
  message_id: number,
  text: string,
  extra?: Record<string, unknown>,
) => tgCall<unknown>(token, "editMessageText", { chat_id, message_id, text, ...extra });

export const sendPhoto = (
  token: string,
  chat_id: number | string,
  photo: string,
  extra?: Record<string, unknown>,
) => tgCall<{ message_id: number }>(token, "sendPhoto", { chat_id, photo, ...extra });

export const sendVideo = (
  token: string,
  chat_id: number | string,
  video: string,
  extra?: Record<string, unknown>,
) => tgCall<{ message_id: number }>(token, "sendVideo", { chat_id, video, ...extra });

export const sendDocument = (
  token: string,
  chat_id: number | string,
  document: string,
  extra?: Record<string, unknown>,
) => tgCall<{ message_id: number }>(token, "sendDocument", { chat_id, document, ...extra });

export const sendAudio = (
  token: string,
  chat_id: number | string,
  audio: string,
  extra?: Record<string, unknown>,
) => tgCall<{ message_id: number }>(token, "sendAudio", { chat_id, audio, ...extra });

export const answerInlineQuery = (
  token: string,
  inline_query_id: string,
  results: unknown[],
) => tgCall<boolean>(token, "answerInlineQuery", { inline_query_id, results, cache_time: 5 });

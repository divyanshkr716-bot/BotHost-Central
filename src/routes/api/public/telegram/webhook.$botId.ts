import { createFileRoute } from "@tanstack/react-router";
import { decryptSecret, redact } from "@/lib/crypto.server";
import { classifyUpdate, runHandlers, type TgUpdate } from "@/lib/bot-runtime.server";

async function handleWebhook(request: Request, botId: string) {
  const db = (await import("@/integrations/supabase/client.server")).supabaseAdmin;
  const { data: cred } = await db.from("bot_credentials").select("token_ciphertext, token_iv, webhook_secret_ciphertext, webhook_secret_iv").eq("bot_id", botId).maybeSingle();
  if (!cred) return new Response("Unknown bot", { status: 404 });
  if (!cred.webhook_secret_ciphertext) return new Response("Webhook not configured", { status: 409 });

  const expected = await decryptSecret(cred.webhook_secret_ciphertext, cred.webhook_secret_iv!);
  const provided = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!provided || provided.length !== expected.length || provided !== expected) return new Response("Unauthorized", { status: 401 });

  let update: TgUpdate;
  try { update = (await request.json()) as TgUpdate; } catch { return new Response("Invalid JSON", { status: 400 }); }
  if (!Number.isInteger(update.update_id)) return new Response("Invalid update", { status: 400 });

  const c = classifyUpdate(update);
  const inserted = await db.from("telegram_updates").insert({ bot_id: botId, update_id: update.update_id, update_type: c.type, chat_id: c.chatId ?? null, from_user_id: c.userId ?? null, status: "processing" });
  if (inserted.error) {
    if ((inserted.error as { code?: string }).code === "23505") return Response.json({ ok: true, duplicate: true });
    await db.from("runtime_logs").insert({ bot_id: botId, level: "ERROR", event: "WEBHOOK", status: "error", message: redact(inserted.error.message), update_id: update.update_id });
    return Response.json({ ok: false }, { status: 500 });
  }

  try {
    const { data: bot } = await db.from("bots").select("id,status").eq("id", botId).maybeSingle();
    if (!bot) return new Response("Unknown bot", { status: 404 });
    if (["STOPPED", "DISABLED"].includes(bot.status)) {
      await db.from("telegram_updates").update({ status: "ignored", handler: "bot-disabled" }).eq("bot_id", botId).eq("update_id", update.update_id);
      return Response.json({ ok: true, ignored: true });
    }

    const { data: project } = await db.from("bot_projects").select("active_version_id").eq("bot_id", botId).maybeSingle();
    const { data: version } = project?.active_version_id ? await db.from("bot_project_versions").select("adapter_plan").eq("id", project.active_version_id).maybeSingle() : { data: null };
    const { data: channel } = await db.from("storage_channels").select("chat_id,verified_at").eq("bot_id", botId).maybeSingle();
    const { data: credentials } = await db.from("bot_credentials").select("token_ciphertext, token_iv").eq("bot_id", botId).maybeSingle();
    if (!credentials) throw new Error("Bot credentials unavailable");
    const token = await decryptSecret(credentials.token_ciphertext, credentials.token_iv);

    const result = await runHandlers({ botId, token, update, plan: (version?.adapter_plan ?? { handlers: [], unsupported: [] }) as any, storageChatId: channel?.verified_at ? Number(channel.chat_id) : null, db });
    await db.from("telegram_updates").update({ status: result.handled ? "handled" : "unhandled", handler: result.handler, processed_at: new Date().toISOString() }).eq("bot_id", botId).eq("update_id", update.update_id);
    await db.from("runtime_logs").insert({ bot_id: botId, level: result.handled ? "INFO" : "WARNING", event: "UPDATE_PROCESSED", status: result.handled ? "handled" : "unhandled", message: result.detail ?? result.handler, update_id: update.update_id });
    await db.from("bots").update({ last_activity_at: new Date().toISOString() }).eq("id", botId);
    return Response.json({ ok: true, handled: result.handled });
  } catch (e) {
    const message = redact(e instanceof Error ? e.message : "Webhook runtime error");
    await db.from("telegram_updates").update({ status: "error", handler: "runtime:error", processed_at: new Date().toISOString() }).eq("bot_id", botId).eq("update_id", update.update_id);
    await db.from("runtime_logs").insert({ bot_id: botId, level: "ERROR", event: "WEBHOOK_RUNTIME", status: "error", message, update_id: update.update_id });
    return Response.json({ ok: false, error: "runtime_error" }, { status: 200 });
  }
}

export const Route = createFileRoute("/api/public/telegram/webhook/$botId")({
  server: { handlers: { POST: async ({ request, params }) => handleWebhook(request, params.botId) } },
});

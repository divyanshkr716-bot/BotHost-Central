/**
 * Durable temporary-message cleanup endpoint.
 *
 * Called every 10 seconds by a pg_cron + pg_net job (durable, database-side).
 * It sweeps expired pending deliveries, deletes only the bot-created temporary
 * messages, and records the run for observability. No in-process timers.
 */
import { createFileRoute } from "@tanstack/react-router";
import { decryptSecret, redact } from "@/lib/crypto.server";
import { sweepDueDeletions, type SweepStats } from "@/lib/flix/ephemeral.server";

async function runCleanup() {
  const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
  const started = new Date().toISOString();
  const { data: run } = await db
    .from("cleanup_runs")
    .insert({ started_at: started })
    .select("id")
    .single();
  const runId = run?.id as string | undefined;

  const totals: SweepStats = { found: 0, deleted: 0, alreadyGone: 0, failed: 0 };
  let error: string | null = null;

  try {
    const { data: due } = await db
      .from("scheduled_deletions")
      .select("bot_id")
      .eq("status", "pending")
      .lte("expires_at", new Date().toISOString())
      .limit(500);
    const botIds = [...new Set(((due ?? []) as { bot_id: string }[]).map((r) => r.bot_id))];

    for (const botId of botIds) {
      await db.from("runtime_logs").insert({
        bot_id: botId,
        level: "INFO",
        event: "AUTO_DELETE_WORKER_RUNNING",
        status: "processing",
        message: "Auto-delete worker found expired pending deliveries",
      });
      const { data: cred } = await db
        .from("bot_credentials")
        .select("token_ciphertext, token_iv")
        .eq("bot_id", botId)
        .maybeSingle();
      if (!cred) {
        totals.failed++;
        await db.from("runtime_logs").insert({
          bot_id: botId,
          level: "ERROR",
          event: "AUTO_DELETE_FAILED",
          status: "error",
          message: "Auto-delete worker could not find bot credentials",
        });
        continue;
      }
      let token: string;
      try {
        token = await decryptSecret(cred.token_ciphertext as string, cred.token_iv as string);
      } catch (credentialError) {
        totals.failed++;
        await db.from("runtime_logs").insert({
          bot_id: botId,
          level: "ERROR",
          event: "AUTO_DELETE_FAILED",
          status: "error",
          message: redact(
            credentialError instanceof Error
              ? `Auto-delete worker could not decrypt bot credentials: ${credentialError.message}`
              : "Auto-delete worker could not decrypt bot credentials",
          ),
        });
        continue;
      }
      const stats = await sweepDueDeletions(db, token, botId);
      totals.found += stats.found;
      totals.deleted += stats.deleted;
      totals.alreadyGone += stats.alreadyGone;
      totals.failed += stats.failed;
    }
  } catch (e) {
    error = redact(e instanceof Error ? e.message : "cleanup error");
  }

  if (runId) {
    await db
      .from("cleanup_runs")
      .update({
        finished_at: new Date().toISOString(),
        found: totals.found,
        deleted: totals.deleted,
        already_gone: totals.alreadyGone,
        failed: totals.failed,
        ok: error === null,
        error,
      })
      .eq("id", runId);
  }

  return { ok: error === null, ...totals, error };
}

function authorized(request: Request): boolean {
  const authorization = request.headers.get("authorization") ?? "";
  const bearer = authorization.replace(/^Bearer\s+/i, "");
  const provided = request.headers.get("x-cron-secret") ?? request.headers.get("apikey") ?? bearer;
  if (!provided) return false;

  // Preferred: a dedicated private scheduler secret. Vercel automatically sends
  // Authorization: Bearer <CRON_SECRET> for Cron requests when CRON_SECRET is set.
  const cronSecret = process.env["CRON_SECRET"];
  if (cronSecret && provided.length === cronSecret.length && provided === cronSecret) return true;

  // Backwards compatibility for existing Supabase-side schedulers.
  const accepted = [
    process.env["SUPABASE_PUBLISHABLE_KEY"],
    process.env["VITE_SUPABASE_PUBLISHABLE_KEY"],
    process.env["SUPABASE_ANON_KEY"],
  ].filter((value): value is string => typeof value === "string" && value.length > 0);

  return accepted.some((expected) => provided.length === expected.length && provided === expected);
}

export const Route = createFileRoute("/api/public/cleanup/deliveries")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!authorized(request)) return new Response("Unauthorized", { status: 401 });
        return Response.json(await runCleanup());
      },
      GET: async ({ request }) => {
        if (!authorized(request)) return new Response("Unauthorized", { status: 401 });
        return Response.json(await runCleanup());
      },
    },
  },
});

/** Read models for the dashboard. RLS scopes every query to the caller. */
import type { SupabaseClient } from "@supabase/supabase-js";
import { webhookUrlFor } from "./public-url";

export async function listOverview(db: SupabaseClient) {
  const [{ data: bots }, { data: webhooks }, { data: deployments }, { data: logs }] =
    await Promise.all([
      db.from("bots").select("*").order("created_at", { ascending: false }),
      db.from("bot_webhooks").select("*"),
      db.from("bot_deployments").select("*").order("created_at", { ascending: false }).limit(10),
      db.from("runtime_logs").select("*").order("created_at", { ascending: false }).limit(15),
    ]);

  const list = bots ?? [];
  const hooks = webhooks ?? [];
  return {
    bots: list.map((b) => ({
      ...b,
      webhook: hooks.find((h) => h.bot_id === b.id) ?? null,
    })),
    stats: {
      totalBots: list.length,
      activeBots: list.filter((b) => b.status === "RUNNING").length,
      webhookConnected: hooks.filter((h) => h.is_registered).length,
      webhookErrors: hooks.filter((h) => !!h.last_error_message).length,
    },
    recentDeployments: deployments ?? [],
    recentActivity: logs ?? [],
  };
}

export async function botDetail(db: SupabaseClient, botId: string, requestUrl: string) {
  const { data: bot } = await db.from("bots").select("*").eq("id", botId).maybeSingle();
  if (!bot) throw new Error("Bot not found or you do not have access to it.");
  const [
    { data: webhook },
    { data: channel },
    { data: project },
    { data: versions },
    { count: updatesTotal },
    { count: updatesErrors },
    { data: lastDeployment },
  ] = await Promise.all([
    db.from("bot_webhooks").select("*").eq("bot_id", botId).maybeSingle(),
    db.from("storage_channels").select("*").eq("bot_id", botId).maybeSingle(),
    db.from("bot_projects").select("*").eq("bot_id", botId).maybeSingle(),
    db
      .from("bot_project_versions")
      .select("*")
      .eq("bot_id", botId)
      .order("version", { ascending: false }),
    db.from("telegram_updates").select("id", { count: "exact", head: true }).eq("bot_id", botId),
    db
      .from("telegram_updates")
      .select("id", { count: "exact", head: true })
      .eq("bot_id", botId)
      .eq("status", "error"),
    db
      .from("bot_deployments")
      .select("*")
      .eq("bot_id", botId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  return {
    bot,
    webhook: webhook ?? null,
    channel: channel ?? null,
    project: project ?? null,
    versions: versions ?? [],
    webhookUrl: webhookUrlFor(requestUrl, botId),
    metrics: {
      updatesProcessed: updatesTotal ?? 0,
      updateErrors: updatesErrors ?? 0,
      restartCount: (bot as { restart_count?: number }).restart_count ?? 0,
      lastDeployedAt: (bot as { last_deployed_at?: string | null }).last_deployed_at ?? null,
    },
    lastDeployment: lastDeployment ?? null,
  };
}


export async function botLogs(db: SupabaseClient, botId: string, level?: string, event?: string) {
  let q = db
    .from("runtime_logs")
    .select("*")
    .eq("bot_id", botId)
    .order("created_at", { ascending: false })
    .limit(300);
  if (level) q = q.eq("level", level);
  if (event) q = q.eq("event", event);
  const [{ data: logs }, { data: updates }] = await Promise.all([
    q,
    db
      .from("telegram_updates")
      .select("*")
      .eq("bot_id", botId)
      .order("processed_at", { ascending: false })
      .limit(100),
  ]);
  return { logs: logs ?? [], updates: updates ?? [] };
}

export async function botDeployments(db: SupabaseClient, botId: string) {
  const { data: deployments } = await db
    .from("bot_deployments")
    .select("*")
    .eq("bot_id", botId)
    .order("created_at", { ascending: false });
  const { data: logs } = await db
    .from("deployment_logs")
    .select("*")
    .eq("bot_id", botId)
    .order("created_at", { ascending: true });
  return { deployments: deployments ?? [], logs: logs ?? [] };
}

export async function botMedia(db: SupabaseClient, botId: string) {
  const { data } = await db
    .from("media")
    .select("*")
    .eq("bot_id", botId)
    .order("created_at", { ascending: false })
    .limit(200);
  return data ?? [];
}

export async function adminOverview(db: SupabaseClient, userId: string) {
  const { data: isAdmin } = await db.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (!isAdmin) throw new Error("Admin access required.");
  const [{ data: profiles }, { data: bots }, { data: deployments }, { data: hooks }, { data: errors }] =
    await Promise.all([
      db.from("profiles").select("*").order("created_at", { ascending: false }).limit(200),
      db.from("bots").select("*").order("created_at", { ascending: false }).limit(500),
      db.from("bot_deployments").select("*").order("created_at", { ascending: false }).limit(100),
      db.from("bot_webhooks").select("*"),
      db
        .from("runtime_logs")
        .select("*")
        .in("level", ["ERROR", "SECURITY"])
        .order("created_at", { ascending: false })
        .limit(100),
    ]);
  return {
    profiles: profiles ?? [],
    bots: bots ?? [],
    deployments: deployments ?? [],
    webhooks: hooks ?? [],
    errors: errors ?? [],
  };
}

import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { dashboardOverview } from "@/lib/bots.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/StatusBadge";
import { Plus } from "lucide-react";

export const Route = createFileRoute("/_authenticated/dashboard/")({
  component: Overview,
});

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <Card className="p-4">
      <p className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-2 text-3xl font-semibold tabular-nums">{value}</p>
    </Card>
  );
}

function Overview() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["overview"],
    queryFn: () => dashboardOverview(),
    refetchInterval: 30_000,
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading real data…</p>;
  if (error) return <p className="text-sm text-destructive">{(error as Error).message}</p>;
  if (!data) return null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Overview</h1>
          <p className="text-sm text-muted-foreground">Live values from your database and Telegram webhook state.</p>
        </div>
        <Button asChild>
          <Link to="/dashboard/bots/new">
            <Plus className="mr-1 size-4" /> Add bot
          </Link>
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Total bots" value={data.stats.totalBots} />
        <Stat label="Active bots" value={data.stats.activeBots} />
        <Stat label="Webhook connected" value={data.stats.webhookConnected} />
        <Stat label="Webhook errors" value={data.stats.webhookErrors} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <h2 className="text-sm font-medium">Recent activity</h2>
          {data.recentActivity.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">No activity recorded yet.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {data.recentActivity.map((l) => (
                <li key={l.id} className="flex items-start gap-2 text-sm">
                  <StatusBadge status={l.level} />
                  <span className="min-w-0 flex-1 break-words text-muted-foreground">{l.message}</span>
                  <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                    {new Date(l.created_at).toLocaleTimeString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-4">
          <h2 className="text-sm font-medium">Recent deployments</h2>
          {data.recentDeployments.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">No deployments yet.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {data.recentDeployments.map((d) => (
                <li key={d.id} className="flex items-center gap-2 text-sm">
                  <StatusBadge status={d.status} />
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">
                    {d.error ?? d.webhook_status ?? "—"}
                  </span>
                  <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                    {new Date(d.created_at).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="p-4">
        <h2 className="text-sm font-medium">Bots</h2>
        {data.bots.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            No bots yet.{" "}
            <Link to="/dashboard/bots/new" className="text-primary hover:underline">
              Add your first bot
            </Link>
            .
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-border">
            {data.bots.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center gap-3 py-3">
                <Link to="/dashboard/bots/$id" params={{ id: b.id }} className="font-medium hover:underline">
                  {b.name}
                </Link>
                <span className="font-mono text-xs text-muted-foreground">
                  {b.telegram_username ? `@${b.telegram_username}` : "—"}
                </span>
                <StatusBadge status={b.status} />
                {b.webhook?.is_registered ? <StatusBadge status="ok" className="opacity-80" /> : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

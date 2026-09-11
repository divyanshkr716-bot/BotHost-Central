import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  dashboardOverview,
  deployBotFn,
  stopWebhookFn,
  testBotFn,
  deleteBotFn,
  refreshWebhookFn,
} from "@/lib/bots.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/StatusBadge";
import { toast } from "sonner";
import { Plus } from "lucide-react";

export const Route = createFileRoute("/_authenticated/dashboard/bots/")({
  component: BotList,
});

function BotList() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data, isLoading, error } = useQuery({
    queryKey: ["overview"],
    queryFn: () => dashboardOverview(),
  });

  const onError = (e: Error) => toast.error(e.message);
  const onDone = (label: string) => () => {
    toast.success(`${label} completed`);
    qc.invalidateQueries();
  };

  const deploy = useMutation({
    mutationFn: (botId: string) => deployBotFn({ data: { botId } }),
    onSuccess: onDone("Deployment"),
    onError,
  });
  const stop = useMutation({
    mutationFn: (botId: string) => stopWebhookFn({ data: { botId } }),
    onSuccess: onDone("Webhook stop"),
    onError,
  });
  const test = useMutation({
    mutationFn: (botId: string) => testBotFn({ data: { botId } }),
    onSuccess: onDone("Test"),
    onError,
  });
  const refresh = useMutation({
    mutationFn: (botId: string) => refreshWebhookFn({ data: { botId } }),
    onSuccess: onDone("Webhook refresh"),
    onError,
  });
  const remove = useMutation({
    mutationFn: (botId: string) => deleteBotFn({ data: { botId } }),
    onSuccess: () => {
      toast.success("Bot deleted");
      qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (error) return <p className="text-sm text-destructive">{(error as Error).message}</p>;

  const busy = deploy.isPending || stop.isPending || test.isPending || remove.isPending;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Bots</h1>
          <p className="text-sm text-muted-foreground">Every bot is fully isolated: token, secret, webhook, storage, project and logs.</p>
        </div>
        <Button asChild>
          <Link to="/dashboard/bots/new">
            <Plus className="mr-1 size-4" /> Add bot
          </Link>
        </Button>
      </div>

      {data?.bots.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          No bots yet. Add one to begin.
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {data?.bots.map((b) => (
            <Card key={b.id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <Link to="/dashboard/bots/$id" params={{ id: b.id }} className="text-base font-medium hover:underline">
                    {b.name}
                  </Link>
                  <p className="font-mono text-xs text-muted-foreground">
                    {b.telegram_username ? `@${b.telegram_username}` : "no username"} · id {b.telegram_bot_id ?? "—"}
                  </p>
                </div>
                <StatusBadge status={b.status} />
              </div>

              <dl className="mt-4 grid grid-cols-2 gap-2 text-xs">
                <div>
                  <dt className="text-muted-foreground">Webhook</dt>
                  <dd className="mt-1">
                    <StatusBadge status={b.webhook?.is_registered ? "ok" : "not_available"} />
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Last activity</dt>
                  <dd className="mt-1 font-mono">
                    {b.last_activity_at ? new Date(b.last_activity_at).toLocaleString() : "Not available"}
                  </dd>
                </div>
              </dl>
              {b.last_error ? (
                <p className="mt-3 break-words rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
                  {b.last_error}
                </p>
              ) : null}
              {b.webhook?.last_error_message ? (
                <p className="mt-2 break-words text-xs text-warning">
                  Telegram: {b.webhook.last_error_message}
                </p>
              ) : null}

              <div className="mt-4 flex flex-wrap gap-2">
                <Button size="sm" disabled={busy} onClick={() => deploy.mutate(b.id)}>
                  {b.status === "RUNNING" ? "Redeploy" : "Deploy"}
                </Button>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => stop.mutate(b.id)}>
                  Stop webhook
                </Button>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => test.mutate(b.id)}>
                  Test
                </Button>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => refresh.mutate(b.id)}>
                  Refresh
                </Button>
                <Button asChild size="sm" variant="ghost">
                  <Link to="/dashboard/bots/$id/logs" params={{ id: b.id }}>Logs</Link>
                </Button>
                <Button asChild size="sm" variant="ghost">
                  <Link to="/dashboard/bots/$id/settings" params={{ id: b.id }}>Settings</Link>
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive hover:text-destructive"
                  disabled={busy}
                  onClick={() => {
                    if (confirm(`Delete "${b.name}"? This removes its project, logs and configuration.`)) {
                      remove.mutate(b.id);
                      navigate({ to: "/dashboard/bots" });
                    }
                  }}
                >
                  Delete
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

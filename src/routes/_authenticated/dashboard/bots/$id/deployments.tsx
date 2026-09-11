import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { getBotDeployments } from "@/lib/bots.functions";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/StatusBadge";

export const Route = createFileRoute("/_authenticated/dashboard/bots/$id/deployments")({
  component: Deployments,
});

function Deployments() {
  const { id } = Route.useParams();
  const { data, isLoading } = useQuery({
    queryKey: ["bot-deployments", id],
    queryFn: () => getBotDeployments({ data: { botId: id } }),
    refetchInterval: 10_000,
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading deployments…</p>;

  return (
    <div className="space-y-4">
      {data?.deployments.length === 0 ? (
        <Card className="p-6 text-sm text-muted-foreground">No deployments yet.</Card>
      ) : (
        data?.deployments.map((d) => (
          <Card key={d.id} className="p-4">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={d.status} />
              <span className="font-mono text-xs text-muted-foreground">
                {new Date(d.created_at).toLocaleString()}
              </span>
              {d.finished_at ? (
                <span className="font-mono text-xs text-muted-foreground">
                  · {Math.max(0, new Date(d.finished_at).getTime() - new Date(d.created_at).getTime())}ms
                </span>
              ) : null}
              {d.webhook_status ? <span className="text-xs text-muted-foreground">{d.webhook_status}</span> : null}
            </div>
            {d.error ? <p className="mt-2 break-words text-xs text-destructive">{d.error}</p> : null}
            <div className="terminal mt-3 max-h-64 overflow-auto p-3 text-xs">
              {(data.logs.filter((l) => l.deployment_id === d.id) ?? []).map((l) => (
                <div key={l.id} className="flex gap-2 py-0.5">
                  <span className="shrink-0 text-muted-foreground">
                    {new Date(l.created_at).toISOString().slice(11, 19)}
                  </span>
                  <span className="shrink-0 text-primary">{l.step}</span>
                  <span className="min-w-0 flex-1 break-words">{l.message}</span>
                </div>
              ))}
              {data.logs.filter((l) => l.deployment_id === d.id).length === 0 ? (
                <span className="text-muted-foreground">No step logs recorded.</span>
              ) : null}
            </div>
          </Card>
        ))
      )}
    </div>
  );
}

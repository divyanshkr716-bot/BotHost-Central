import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { getAdminOverview } from "@/lib/bots.functions";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/StatusBadge";

export const Route = createFileRoute("/_authenticated/admin")({
  component: Admin,
});

function Admin() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin"],
    queryFn: () => getAdminOverview(),
    retry: false,
    refetchInterval: 30_000,
  });

  if (isLoading) return <p className="p-6 text-sm text-muted-foreground">Loading…</p>;
  if (error)
    return (
      <div className="p-6">
        <h1 className="text-xl font-semibold">Admin</h1>
        <p className="mt-2 text-sm text-destructive">{(error as Error).message}</p>
      </div>
    );
  if (!data) return null;

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Admin</h1>
        <p className="text-sm text-muted-foreground">Platform-wide state. Role checked server-side via has_role.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        {[
          ["Users", data.profiles.length],
          ["Bots", data.bots.length],
          ["Deployments", data.deployments.length],
          ["Errors", data.errors.length],
        ].map(([label, value]) => (
          <Card key={label as string} className="p-4">
            <p className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
            <p className="mt-2 text-3xl font-semibold tabular-nums">{value}</p>
          </Card>
        ))}
      </div>

      <Card className="p-4">
        <h2 className="text-sm font-medium">All bots</h2>
        <ul className="mt-3 space-y-1 text-xs">
          {data.bots.map((b: { id: string; name: string; status: string; user_id: string }) => (
            <li key={b.id} className="flex flex-wrap items-center gap-2 border-b border-border/40 py-1">
              <span className="font-medium">{b.name}</span>
              <StatusBadge status={b.status} />
              <span className="ml-auto font-mono text-muted-foreground">{b.user_id.slice(0, 8)}…</span>
            </li>
          ))}
        </ul>
      </Card>

      <Card className="p-4">
        <h2 className="text-sm font-medium">Recent errors & security events</h2>
        <div className="terminal mt-3 max-h-80 overflow-auto p-3 text-xs">
          {data.errors.length === 0 ? (
            <span className="text-muted-foreground">Nothing recorded.</span>
          ) : (
            data.errors.map((l: { id: string; created_at: string; level: string; event: string; message: string }) => (
              <div key={l.id} className="flex gap-2 py-0.5">
                <span className="shrink-0 text-muted-foreground">{new Date(l.created_at).toISOString().slice(0, 19)}</span>
                <StatusBadge status={l.level} />
                <span className="shrink-0 text-primary">{l.event}</span>
                <span className="min-w-0 flex-1 break-words">{l.message}</span>
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  );
}

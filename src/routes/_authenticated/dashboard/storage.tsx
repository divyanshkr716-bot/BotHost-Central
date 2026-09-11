import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { dashboardOverview } from "@/lib/bots.functions";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/StatusBadge";

export const Route = createFileRoute("/_authenticated/dashboard/storage")({
  component: StorageOverview,
});

function StorageOverview() {
  const { data, isLoading } = useQuery({ queryKey: ["overview"], queryFn: () => dashboardOverview() });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Storage</h1>
        <p className="text-sm text-muted-foreground">
          Media is Telegram-backed. Project archives use Supabase when available and are mirrored to the verified Telegram storage channel for backup/fallback.
        </p>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : data?.bots.length === 0 ? (
        <Card className="p-6 text-sm text-muted-foreground">Add a bot to configure a storage channel.</Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {data?.bots.map((b) => (
            <Card key={b.id} className="flex items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <Link to="/dashboard/bots/$id/storage" params={{ id: b.id }} className="font-medium hover:underline">
                  {b.name}
                </Link>
                <p className="font-mono text-xs text-muted-foreground">
                  {b.storage_channel_id ? `channel ${b.storage_channel_id}` : "no channel configured"}
                </p>
              </div>
              <StatusBadge status={b.storage_channel_id ? "ok" : "not_available"} />
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

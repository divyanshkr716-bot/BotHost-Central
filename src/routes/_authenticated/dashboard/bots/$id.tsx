import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { getBotDetail } from "@/lib/bots.functions";
import { StatusBadge } from "@/components/StatusBadge";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/dashboard/bots/$id")({
  component: BotLayout,
});

export function useBotDetail(id: string) {
  return useQuery({
    queryKey: ["bot", id],
    queryFn: () => getBotDetail({ data: { botId: id } }),
    refetchInterval: 20_000,
  });
}

function BotLayout() {
  const { id } = Route.useParams();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { data, isLoading, error } = useBotDetail(id);

  const tabs = [
    { to: `/dashboard/bots/${id}`, label: "Overview" },
    { to: `/dashboard/bots/${id}/logs`, label: "Logs" },
    { to: `/dashboard/bots/${id}/deployments`, label: "Deployments" },
    { to: `/dashboard/bots/${id}/storage`, label: "Storage" },
    { to: `/dashboard/bots/${id}/settings`, label: "Settings" },
  ];

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading bot…</p>;
  if (error) return <p className="text-sm text-destructive">{(error as Error).message}</p>;
  if (!data) return null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold">{data.bot.name}</h1>
          <p className="font-mono text-xs text-muted-foreground">
            {data.bot.telegram_username ? `@${data.bot.telegram_username}` : "no username"} · bot id{" "}
            {data.bot.telegram_bot_id ?? "—"}
          </p>
        </div>
        <StatusBadge status={data.bot.status} />
      </div>

      <nav className="flex flex-wrap gap-1 border-b border-border">
        {tabs.map((t) => (
          <Link
            key={t.to}
            to={t.to}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm transition-colors",
              pathname === t.to
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      <Outlet />
    </div>
  );
}

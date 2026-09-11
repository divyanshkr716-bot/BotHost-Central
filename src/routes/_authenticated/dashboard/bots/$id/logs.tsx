import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { getBotLogs } from "@/lib/bots.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/StatusBadge";

export const Route = createFileRoute("/_authenticated/dashboard/bots/$id/logs")({
  component: Logs,
});

const LEVELS = ["ALL", "INFO", "WARN", "ERROR", "SECURITY"] as const;

function Logs() {
  const { id } = Route.useParams();
  const [level, setLevel] = useState<(typeof LEVELS)[number]>("ALL");
  const [live, setLive] = useState(true);

  const { data, isLoading } = useQuery({
    queryKey: ["bot-logs", id, level],
    queryFn: () => getBotLogs({ data: { botId: id, ...(level === "ALL" ? {} : { level }) } }),
    refetchInterval: live ? 5_000 : false,
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {LEVELS.map((l) => (
          <Button key={l} size="sm" variant={level === l ? "default" : "outline"} onClick={() => setLevel(l)}>
            {l}
          </Button>
        ))}
        <Button size="sm" variant="ghost" onClick={() => setLive((v) => !v)}>
          {live ? "Live: on" : "Live: off"}
        </Button>
      </div>

      <Card className="p-0">
        <div className="terminal max-h-[520px] overflow-auto p-3 text-xs">
          {isLoading ? (
            <p className="text-muted-foreground">Loading logs…</p>
          ) : data?.logs.length === 0 ? (
            <p className="text-muted-foreground">No logs recorded yet.</p>
          ) : (
            data?.logs.map((l) => (
              <div key={l.id} className="flex gap-2 border-b border-border/40 py-1">
                <span className="shrink-0 text-muted-foreground">
                  {new Date(l.created_at).toISOString().replace("T", " ").slice(0, 19)}
                </span>
                <StatusBadge status={l.level} />
                <span className="shrink-0 text-primary">{l.event}</span>
                <span className="min-w-0 flex-1 break-words">{l.message}</span>
                {l.duration_ms != null ? (
                  <span className="shrink-0 text-muted-foreground">{l.duration_ms}ms</span>
                ) : null}
              </div>
            ))
          )}
        </div>
      </Card>

      <Card className="p-4">
        <h2 className="text-sm font-medium">Processed Telegram updates</h2>
        {data?.updates.length === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">No updates received yet.</p>
        ) : (
          <ul className="mt-2 space-y-1 text-xs">
            {data?.updates.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center gap-2 border-b border-border/40 py-1">
                <span className="font-mono text-muted-foreground">#{u.update_id}</span>
                <StatusBadge status={u.status} />
                <span className="text-muted-foreground">{u.kind ?? "update"}</span>
                <span className="ml-auto font-mono text-muted-foreground">
                  {new Date(u.processed_at).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

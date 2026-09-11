import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import {
  getBotDetail,
  deployBotFn,
  stopWebhookFn,
  startBotFn,
  restartBotFn,
  refreshWebhookFn,
  testBotFn,
  sendTestMessageFn,
} from "@/lib/bots.functions";

import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/StatusBadge";
import { ProjectUpload, CompatibilityReport } from "@/components/ProjectUpload";
import type { Analysis, AdapterPlan } from "@/lib/analyze.server";

export const Route = createFileRoute("/_authenticated/dashboard/bots/$id/")({
  component: BotOverview,
});

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-wrap justify-between gap-3 border-b border-border/60 py-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="break-all text-right font-mono">{value}</span>
    </div>
  );
}

function BotOverview() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const [chatId, setChatId] = useState("");
  const [text, setText] = useState("BotHost Central test message");

  const { data } = useQuery({
    queryKey: ["bot", id],
    queryFn: () => getBotDetail({ data: { botId: id } }),
    refetchInterval: 20_000,
  });

  const onError = (e: Error) => toast.error(e.message);
  const done = (label: string) => () => {
    toast.success(label);
    void qc.invalidateQueries();
  };

  const deploy = useMutation({ mutationFn: () => deployBotFn({ data: { botId: id } }), onSuccess: (r) => {
    if ((r as { status?: string }).status === "FAILED") toast.error("Deployment failed — see deployments tab");
    else toast.success("Deployed and webhook registered");
    void qc.invalidateQueries();
  }, onError });
  const stop = useMutation({ mutationFn: () => stopWebhookFn({ data: { botId: id } }), onSuccess: done("Webhook removed"), onError });
  const start = useMutation({ mutationFn: () => startBotFn({ data: { botId: id } }), onSuccess: done("Bot started — webhook confirmed by Telegram"), onError });
  const restart = useMutation({ mutationFn: () => restartBotFn({ data: { botId: id } }), onSuccess: done("Bot restarted"), onError });
  const refresh = useMutation({ mutationFn: () => refreshWebhookFn({ data: { botId: id } }), onSuccess: done("Webhook info refreshed"), onError });
  const test = useMutation({ mutationFn: () => testBotFn({ data: { botId: id } }), onSuccess: done("Health check finished"), onError });

  const send = useMutation({
    mutationFn: () => sendTestMessageFn({ data: { botId: id, chatId: Number(chatId), text } }),
    onSuccess: done("Message sent through Telegram"),
    onError,
  });

  if (!data) return null;
  const version = data.versions[0] as
    | { version: number; analysis: Analysis; adapter_plan: AdapterPlan }
    | undefined;
  const health = test.data as { checks?: Record<string, { status: string; detail: string }> } | undefined;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="p-4">
        <h2 className="text-sm font-medium">Runtime</h2>
        <div className="mt-3">
          <Row label="Status" value={<StatusBadge status={data.bot.status} />} />
          <Row label="Webhook URL" value={data.webhookUrl} />
          <Row
            label="Webhook registered"
            value={<StatusBadge status={data.webhook?.is_registered ? "ok" : "not_available"} />}
          />
          <Row label="Pending updates" value={data.webhook?.pending_update_count ?? "Not available"} />
          <Row label="Telegram error" value={data.webhook?.last_error_message ?? "None"} />
          <Row
            label="Last activity"
            value={data.bot.last_activity_at ? new Date(data.bot.last_activity_at).toLocaleString() : "Not available"}
          />
          <Row label="Updates processed" value={data.metrics.updatesProcessed} />
          <Row label="Update errors" value={data.metrics.updateErrors} />
          <Row label="Restarts" value={data.metrics.restartCount} />
          <Row
            label="Last deployed"
            value={data.metrics.lastDeployedAt ? new Date(data.metrics.lastDeployedAt).toLocaleString() : "Never"}
          />
          <Row label="Last error" value={data.bot.last_error ?? "None"} />
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button size="sm" disabled={deploy.isPending} onClick={() => deploy.mutate()}>
            {deploy.isPending ? "Deploying…" : data.bot.status === "RUNNING" ? "Redeploy" : "Deploy"}
          </Button>
          <Button size="sm" variant="outline" disabled={start.isPending} onClick={() => start.mutate()}>
            {start.isPending ? "Starting…" : "Start"}
          </Button>
          <Button size="sm" variant="outline" disabled={restart.isPending} onClick={() => restart.mutate()}>
            {restart.isPending ? "Restarting…" : "Restart"}
          </Button>
          <Button size="sm" variant="outline" disabled={stop.isPending} onClick={() => stop.mutate()}>
            Stop webhook
          </Button>

          <Button size="sm" variant="outline" disabled={refresh.isPending} onClick={() => refresh.mutate()}>
            Refresh webhook info
          </Button>
          <Button size="sm" variant="outline" disabled={test.isPending} onClick={() => test.mutate()}>
            Run health check
          </Button>
        </div>

        {health?.checks ? (
          <div className="mt-4 space-y-1">
            {Object.entries(health.checks).map(([k, v]) => (
              <div key={k} className="flex flex-wrap items-center gap-2 text-xs">
                <StatusBadge status={v.status} />
                <span className="font-medium">{k}</span>
                <span className="text-muted-foreground">{v.detail}</span>
              </div>
            ))}
          </div>
        ) : null}
      </Card>

      <Card className="p-4">
        <h2 className="text-sm font-medium">Send a real Telegram message</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Uses the bot's own encrypted token against api.telegram.org.
        </p>
        <div className="mt-3 space-y-2">
          <Input
            placeholder="Chat ID (e.g. your Telegram user id)"
            value={chatId}
            onChange={(e) => setChatId(e.target.value.replace(/[^\d-]/g, ""))}
          />
          <Input placeholder="Message" value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} />
          <Button size="sm" disabled={!chatId || send.isPending} onClick={() => send.mutate()}>
            {send.isPending ? "Sending…" : "Send message"}
          </Button>
        </div>
      </Card>

      <div className="lg:col-span-2">
        <ProjectUpload botId={id} />
      </div>

      {version ? (
        <div className="lg:col-span-2">
          <CompatibilityReport analysis={version.analysis} plan={version.adapter_plan} version={version.version} />
        </div>
      ) : null}
    </div>
  );
}

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { deleteBotFn, getBotDetail, listEnvKeysFn, setEnvVarFn } from "@/lib/bots.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/_authenticated/dashboard/bots/$id/settings")({
  component: BotSettings,
});

function BotSettings() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");

  const detail = useQuery({ queryKey: ["bot", id], queryFn: () => getBotDetail({ data: { botId: id } }) });
  const envKeys = useQuery({ queryKey: ["bot-env", id], queryFn: () => listEnvKeysFn({ data: { botId: id } }) });

  const saveEnv = useMutation({
    mutationFn: () => setEnvVarFn({ data: { botId: id, key: key.trim().toUpperCase(), value } }),
    onSuccess: () => {
      toast.success("Variable saved (encrypted)");
      setKey("");
      setValue("");
      void qc.invalidateQueries({ queryKey: ["bot-env", id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: () => deleteBotFn({ data: { botId: id } }),
    onSuccess: () => {
      toast.success("Bot deleted");
      void qc.invalidateQueries();
      navigate({ to: "/dashboard/bots" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="p-4">
        <h2 className="text-sm font-medium">Environment variables</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Values are encrypted with AES-256-GCM and never returned to the browser.
        </p>
        <ul className="mt-3 space-y-1 text-xs">
          {(envKeys.data ?? []).map((k) => (
            <li key={k.key} className="flex justify-between border-b border-border/40 py-1 font-mono">
              <span>{k.key}</span>
              <span className="text-muted-foreground">•••••• · {new Date(k.created_at).toLocaleDateString()}</span>
            </li>
          ))}
          {(envKeys.data ?? []).length === 0 ? (
            <li className="text-muted-foreground">None yet.</li>
          ) : null}
        </ul>
        <div className="mt-4 space-y-2">
          <Label htmlFor="key">Key</Label>
          <Input id="key" value={key} onChange={(e) => setKey(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ""))} placeholder="DATABASE_URL" />
          <Label htmlFor="value">Value</Label>
          <Input id="value" type="password" value={value} onChange={(e) => setValue(e.target.value)} autoComplete="off" />
          <Button size="sm" disabled={!key || !value || saveEnv.isPending} onClick={() => saveEnv.mutate()}>
            Save variable
          </Button>
        </div>
      </Card>

      <Card className="p-4">
        <h2 className="text-sm font-medium">Bot configuration</h2>
        <dl className="mt-3 space-y-1 text-xs">
          <div className="flex justify-between border-b border-border/40 py-1">
            <dt className="text-muted-foreground">Webhook URL</dt>
            <dd className="break-all text-right font-mono">{detail.data?.webhookUrl}</dd>
          </div>
          <div className="flex justify-between border-b border-border/40 py-1">
            <dt className="text-muted-foreground">Owner Telegram ID</dt>
            <dd className="font-mono">{detail.data?.bot.owner_telegram_id ?? "Not set"}</dd>
          </div>
          <div className="flex justify-between border-b border-border/40 py-1">
            <dt className="text-muted-foreground">Created</dt>
            <dd className="font-mono">
              {detail.data ? new Date(detail.data.bot.created_at).toLocaleString() : "—"}
            </dd>
          </div>
        </dl>

        <div className="mt-6 rounded-md border border-destructive/30 p-3">
          <h3 className="text-sm font-medium text-destructive">Danger zone</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Deletes the bot, its encrypted credentials, project versions, logs and removes the Telegram webhook.
          </p>
          <Button
            className="mt-3"
            size="sm"
            variant="destructive"
            disabled={remove.isPending}
            onClick={() => {
              if (confirm("Delete this bot permanently?")) remove.mutate();
            }}
          >
            Delete bot
          </Button>
        </div>
      </Card>
    </div>
  );
}

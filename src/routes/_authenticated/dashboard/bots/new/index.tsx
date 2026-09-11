import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { createBotFn, validateBotToken } from "@/lib/bots.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/StatusBadge";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/dashboard/bots/new/")({
  component: NewBot,
});

function NewBot() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [token, setToken] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [channelId, setChannelId] = useState("");
  const [envText, setEnvText] = useState("");
  const [verified, setVerified] = useState<{ id: number; username: string | null; first_name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const validate = useMutation({
    mutationFn: () => validateBotToken({ data: { token: token.trim() } }),
    onSuccess: (res) => {
      if (res.valid) {
        setVerified(res.bot);
        setError(null);
        toast.success("Telegram bot verified");
      } else {
        setVerified(null);
        setError(res.error);
      }
    },
    onError: (e: Error) => setError(e.message),
  });

  const create = useMutation({
    mutationFn: () => {
      const env = envText
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => {
          const idx = l.indexOf("=");
          if (idx < 1) throw new Error(`Invalid environment line: "${l}". Use KEY=value.`);
          return { key: l.slice(0, idx).trim().toUpperCase(), value: l.slice(idx + 1).trim() };
        });
      return createBotFn({
        data: {
          name: name.trim(),
          token: token.trim(),
          ownerTelegramId: ownerId ? Number(ownerId) : null,
          storageChannelId: channelId ? Number(channelId) : null,
          env,
        },
      });
    },
    onSuccess: (res) => {
      toast.success("Bot created");
      navigate({ to: "/dashboard/bots/$id", params: { id: res.bot.id } });
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Add bot</h1>
        <p className="text-sm text-muted-foreground">
          Step 1 of the deployment wizard. Every field is validated server-side; the token is checked
          against the real Telegram API and encrypted before storage.
        </p>
      </div>

      <Card className="space-y-4 p-4">
        <div className="space-y-2">
          <Label htmlFor="name">Bot name</Label>
          <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Support bot" maxLength={60} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="token">Telegram bot token</Label>
          <Input
            id="token"
            type="password"
            value={token}
            onChange={(e) => {
              setToken(e.target.value);
              setVerified(null);
            }}
            placeholder="123456789:AA…"
            autoComplete="off"
          />
          <div className="flex items-center gap-2">
            <Button type="button" size="sm" variant="outline" disabled={token.length < 20 || validate.isPending} onClick={() => validate.mutate()}>
              {validate.isPending ? "Calling getMe…" : "Validate with Telegram"}
            </Button>
            {verified ? (
              <span className="flex items-center gap-2 text-xs">
                <StatusBadge status="ok" /> Telegram Bot Verified — @{verified.username} (id {verified.id})
              </span>
            ) : null}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="owner">Owner Telegram ID</Label>
            <Input id="owner" inputMode="numeric" value={ownerId} onChange={(e) => setOwnerId(e.target.value.replace(/\D/g, ""))} placeholder="123456789" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="channel">Private storage channel ID</Label>
            <Input id="channel" value={channelId} onChange={(e) => setChannelId(e.target.value.replace(/[^\d-]/g, ""))} placeholder="-1001234567890" />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="env">Custom environment variables (KEY=value per line)</Label>
          <textarea
            id="env"
            value={envText}
            onChange={(e) => setEnvText(e.target.value)}
            rows={4}
            className="w-full rounded-md border border-input bg-secondary/40 p-2 font-mono text-xs"
            placeholder={"DATABASE_URL=postgres://…\nAPI_BASE=https://…"}
          />
          <p className="text-xs text-muted-foreground">
            Stored encrypted. BOT_TOKEN, OWNER_ID and STORAGE_CHANNEL_ID are added automatically.
          </p>
        </div>

        {error ? <p className="break-words text-sm text-destructive">{error}</p> : null}

        <Button disabled={!name || !verified || create.isPending} onClick={() => create.mutate()}>
          {create.isPending ? "Creating…" : "Create bot"}
        </Button>
        {!verified ? (
          <p className="text-xs text-muted-foreground">Validate the token before creating the bot.</p>
        ) : null}
      </Card>
    </div>
  );
}

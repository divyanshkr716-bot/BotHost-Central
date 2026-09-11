import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { getBotDetail, getBotMedia, verifyStorageFn } from "@/lib/bots.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/StatusBadge";

export const Route = createFileRoute("/_authenticated/dashboard/bots/$id/storage")({
  component: Storage,
});

function Storage() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const [chatId, setChatId] = useState("");

  const detail = useQuery({ queryKey: ["bot", id], queryFn: () => getBotDetail({ data: { botId: id } }) });
  const media = useQuery({ queryKey: ["bot-media", id], queryFn: () => getBotMedia({ data: { botId: id } }) });

  const verify = useMutation({
    mutationFn: () => verifyStorageFn({ data: { botId: id, chatId: Number(chatId) } }),
    onSuccess: (r) => {
      if ((r as { ok: boolean }).ok) toast.success("Storage channel verified — the bot can post there");
      else toast.error((r as { error?: string }).error ?? "Verification failed");
      void qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const channel = detail.data?.channel;

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <h2 className="text-sm font-medium">Telegram-as-storage</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Media is Telegram-backed, while project archives can use Supabase plus Telegram backup/fallback. Add the
          bot to the channel as an administrator, then verify it below.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Input
            className="max-w-xs"
            placeholder="-1001234567890"
            value={chatId || (channel?.chat_id ?? "")}
            onChange={(e) => setChatId(e.target.value.replace(/[^\d-]/g, ""))}
          />
          <Button size="sm" disabled={!(chatId || channel?.chat_id) || verify.isPending} onClick={() => verify.mutate()}>
            {verify.isPending ? "Verifying…" : "Verify channel"}
          </Button>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <StatusBadge status={channel?.is_verified ? "ok" : "not_available"} />
          <span className="text-muted-foreground">
            {channel
              ? `${channel.title ?? "Channel"} · ${channel.chat_id} · ${channel.is_verified ? "verified" : "not verified"}`
              : "No storage channel configured"}
          </span>
        </div>
      </Card>

      <Card className="p-4">
        <h2 className="text-sm font-medium">Stored media ({media.data?.length ?? 0})</h2>
        {media.data && media.data.length > 0 ? (
          <ul className="mt-3 space-y-1 text-xs">
            {media.data.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-2 border-b border-border/40 py-1">
                <span className="font-medium">{m.file_name ?? m.kind}</span>
                <span className="text-muted-foreground">{m.mime_type ?? "unknown type"}</span>
                <span className="text-muted-foreground">
                  {m.file_size ? `${Math.round(m.file_size / 1024)} KB` : "size unknown"}
                </span>
                <span className="ml-auto truncate font-mono text-muted-foreground">{m.telegram_file_id}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">
            No media stored yet. Media sent to the bot is archived automatically once a verified channel exists.
          </p>
        )}
      </Card>
    </div>
  );
}

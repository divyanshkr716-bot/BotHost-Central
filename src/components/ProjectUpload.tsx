import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { uploadProjectFn, deployBotFn } from "@/lib/bots.functions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/StatusBadge";
import { toast } from "sonner";
import type { Analysis, AdapterPlan } from "@/lib/analyze.server";

async function fileToBase64(file: File): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < buf.length; i += chunk) {
    bin += String.fromCharCode(...buf.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export function ProjectUpload({
  botId,
  onAnalyzed,
}: {
  botId: string;
  onAnalyzed?: (a: Analysis) => void;
}) {
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<{ analysis: Analysis; plan: AdapterPlan; version: { version: number } } | null>(null);

  const deploy = useMutation({
    mutationFn: () => deployBotFn({ data: { botId } }),
    onSuccess: () => { toast.success("Bot deployed and webhook verified"); qc.invalidateQueries(); },
    onError: (e: Error) => toast.error(`Deploy failed: ${e.message}`),
  });

  const upload = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Choose a .zip file first.");
      if (!file.name.toLowerCase().endsWith(".zip")) throw new Error("Only .zip archives are accepted.");
      if (file.size > 15 * 1024 * 1024) throw new Error("ZIP is larger than the 15 MB limit.");
      const zipBase64 = await fileToBase64(file);
      return uploadProjectFn({ data: { botId, fileName: file.name, zipBase64 } });
    },
    onSuccess: (data) => {
      setResult(data as never);
      onAnalyzed?.((data as { analysis: Analysis }).analysis);
      toast.success("Project uploaded and analyzed");
      qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <h3 className="text-sm font-medium">Upload project ZIP</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          One ZIP is all the user uploads. The platform analyzes it, stores the version, selects a trusted runtime adapter, and configures the Telegram webhook. Arbitrary source is never executed directly in the web request.
        </p>
        <input
          type="file"
          accept=".zip,application/zip"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="mt-3 block w-full cursor-pointer rounded-md border border-input bg-secondary/40 p-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-sm file:text-primary-foreground"
        />
        <Button className="mt-3" disabled={!file || upload.isPending} onClick={() => upload.mutate()}>
          {upload.isPending ? "Analyzing…" : "Upload & analyze"}
        </Button>
        {result ? <Button className="mt-2" disabled={deploy.isPending} onClick={() => deploy.mutate()}>{deploy.isPending ? "Deploying…" : "Deploy bot & configure webhook"}</Button> : null}
      </Card>

      {result ? <CompatibilityReport analysis={result.analysis} plan={result.plan} version={result.version.version} /> : null}
    </div>
  );
}

export function CompatibilityReport({
  analysis,
  plan,
  version,
}: {
  analysis: Analysis;
  plan?: AdapterPlan;
  version?: number;
}) {
  const rows: [string, string][] = [
    ["Project type", analysis.projectType],
    ["Node.js", analysis.isNode ? "Yes" : "No"],
    ["TypeScript", analysis.isTypeScript ? "Yes" : "No"],
    ["Telegram framework", analysis.framework ?? "Not detected"],
    ["Entrypoint", analysis.entrypoint ?? "Not found"],
    ["Build script", analysis.buildScript ?? "Not available"],
    ["Start script", analysis.startScript ?? "Not available"],
    ["Node version", analysis.packageJson?.nodeVersion ?? "Not specified"],
    ["Telegram mode", analysis.telegramMode],
    ["Polling detected", analysis.pollingSignals.length ? analysis.pollingSignals.join(", ") : "No"],
    ["Webhook compatible", analysis.compatibility === "READY" ? "Yes" : analysis.compatibility === "NEEDS_ADAPTATION" ? "After adaptation" : "No"],
    ["Environment variables", analysis.envVars.length ? analysis.envVars.join(", ") : "None detected"],
    ["Database requirements", analysis.databaseDeps.length ? analysis.databaseDeps.join(", ") : "None detected"],
    ["Media requirements", analysis.mediaHandling ? "Yes" : "No"],
    ["Files analyzed", String(analysis.fileCount)],
  ];

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">
          Compatibility report{version ? ` — version ${version}` : ""}
        </h3>
        <StatusBadge status={analysis.compatibility} />
      </div>

      <dl className="mt-4 grid gap-x-6 gap-y-2 text-xs sm:grid-cols-2">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3 border-b border-border/60 py-1">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="break-all text-right font-mono">{v}</dd>
          </div>
        ))}
      </dl>

      {analysis.issues.length ? (
        <ul className="mt-4 space-y-2">
          {analysis.issues.map((i, idx) => (
            <li
              key={idx}
              className={
                i.severity === "error"
                  ? "rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive"
                  : i.severity === "warning"
                    ? "rounded-md border border-warning/30 bg-warning/10 p-2 text-xs text-warning"
                    : "rounded-md border border-border p-2 text-xs text-muted-foreground"
              }
            >
              {i.message}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-4">
        <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Detected handlers ({analysis.handlers.length})
        </h4>
        {analysis.handlers.length === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">None detected.</p>
        ) : (
          <ul className="mt-2 space-y-1 text-xs">
            {analysis.handlers.map((h, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-primary">{h.trigger}</span>
                <span className="text-muted-foreground">{h.kind}</span>
                <span className="text-muted-foreground">· {h.source}</span>
                <StatusBadge status={h.adaptable ? "ok" : "failed"} />
                {h.reason ? <span className="text-muted-foreground">{h.reason}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      {plan ? (
        <div className="mt-4">
          <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Webhook adapter plan
          </h4>
          <pre className="terminal mt-2 max-h-64 overflow-auto p-3">
            {JSON.stringify(plan, null, 2)}
          </pre>
        </div>
      ) : null}
    </Card>
  );
}

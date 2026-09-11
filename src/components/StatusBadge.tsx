import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const MAP: Record<string, { label: string; className: string }> = {
  RUNNING: { label: "RUNNING", className: "bg-success/15 text-success border-success/30" },
  DEPLOYING: { label: "DEPLOYING", className: "bg-info/15 text-info border-info/30" },
  ANALYZING: { label: "ANALYZING", className: "bg-info/15 text-info border-info/30" },
  NOT_DEPLOYED: { label: "NOT DEPLOYED", className: "bg-muted text-muted-foreground border-border" },
  STOPPED: { label: "STOPPED", className: "bg-muted text-muted-foreground border-border" },
  NEEDS_ADAPTATION: { label: "NEEDS ADAPTATION", className: "bg-warning/15 text-warning border-warning/30" },
  ERROR: { label: "ERROR", className: "bg-destructive/15 text-destructive border-destructive/30" },
  WEBHOOK_ERROR: { label: "WEBHOOK ERROR", className: "bg-destructive/15 text-destructive border-destructive/30" },
  READY: { label: "READY", className: "bg-success/15 text-success border-success/30" },
  INCOMPATIBLE: { label: "INCOMPATIBLE", className: "bg-destructive/15 text-destructive border-destructive/30" },
  SUCCESS: { label: "SUCCESS", className: "bg-success/15 text-success border-success/30" },
  FAILED: { label: "FAILED", className: "bg-destructive/15 text-destructive border-destructive/30" },
  healthy: { label: "HEALTHY", className: "bg-success/15 text-success border-success/30" },
  unhealthy: { label: "UNHEALTHY", className: "bg-destructive/15 text-destructive border-destructive/30" },
  not_available: { label: "NOT AVAILABLE", className: "bg-muted text-muted-foreground border-border" },
  ok: { label: "OK", className: "bg-success/15 text-success border-success/30" },
  failed: { label: "FAILED", className: "bg-destructive/15 text-destructive border-destructive/30" },
  skipped: { label: "SKIPPED", className: "bg-muted text-muted-foreground border-border" },
  ERROR_LEVEL: { label: "ERROR", className: "bg-destructive/15 text-destructive border-destructive/30" },
};

export function StatusBadge({ status, className }: { status: string | null | undefined; className?: string }) {
  const entry = MAP[status ?? ""] ?? {
    label: (status ?? "UNKNOWN").toUpperCase(),
    className: "bg-muted text-muted-foreground border-border",
  };
  return (
    <Badge variant="outline" className={cn("font-mono text-[10px] tracking-wider", entry.className, className)}>
      {entry.label}
    </Badge>
  );
}

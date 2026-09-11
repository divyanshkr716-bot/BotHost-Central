import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";
export function Badge({ className, variant="default", ...props }: HTMLAttributes<HTMLDivElement> & { variant?: "default"|"outline" }) { return <div className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium", variant === "outline" ? "bg-transparent" : "bg-primary text-primary-foreground border-transparent", className)} {...props} />; }

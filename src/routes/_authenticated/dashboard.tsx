import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { syncProfile } from "@/lib/bots.functions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Bot, LayoutDashboard, HardDrive, Settings, Shield, LogOut, Menu, X } from "lucide-react";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: DashboardLayout,
});

const NAV = [
  { to: "/dashboard", label: "Overview", icon: LayoutDashboard, exact: true },
  { to: "/dashboard/bots", label: "Bots", icon: Bot, exact: false },
  { to: "/dashboard/storage", label: "Storage", icon: HardDrive, exact: false },
  { to: "/dashboard/settings", label: "Settings", icon: Settings, exact: false },
  { to: "/admin", label: "Admin", icon: Shield, exact: false },
] as const;

function DashboardLayout() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    void syncProfile();
  }, []);

  useEffect(() => setOpen(false), [pathname]);

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/login", replace: true });
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 flex items-center justify-between border-b border-border bg-background/90 px-4 py-3 backdrop-blur md:hidden">
        <Link to="/dashboard" className="font-mono text-sm font-semibold">
          bot<span className="text-primary">host</span>
        </Link>
        <Button variant="ghost" size="icon" onClick={() => setOpen((v) => !v)} aria-label="Toggle navigation">
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </Button>
      </header>

      <div className="mx-auto flex w-full max-w-[1400px]">
        <aside
          className={cn(
            "fixed inset-x-0 top-[57px] z-30 border-b border-border bg-sidebar p-3 md:sticky md:top-0 md:block md:h-screen md:w-60 md:shrink-0 md:border-b-0 md:border-r",
            open ? "block" : "hidden",
          )}
        >
          <Link to="/dashboard" className="hidden px-2 py-4 font-mono text-sm font-semibold md:block">
            bot<span className="text-primary">host</span>/central
          </Link>
          <nav className="space-y-1">
            {NAV.map((item) => {
              const active = item.exact ? pathname === item.to : pathname.startsWith(item.to);
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={cn(
                    "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                    active
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
                  )}
                >
                  <item.icon className="size-4" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <Button variant="ghost" className="mt-4 w-full justify-start gap-3 text-muted-foreground" onClick={signOut}>
            <LogOut className="size-4" /> Sign out
          </Button>
        </aside>

        <main className="min-w-0 flex-1 px-4 py-6 md:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

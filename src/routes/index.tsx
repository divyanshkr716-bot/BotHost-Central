import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { ArrowRight, ShieldCheck, Webhook, PackageSearch, Server, Database, Radio } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "BotHost Central — Serverless Telegram Bot Hosting" },
      {
        name: "description",
        content:
          "Upload your Node.js Telegram bot, get a real compatibility report, and run it on a serverless webhook runtime. No VPS, no Docker, no polling.",
      },
      { property: "og:title", content: "BotHost Central — Serverless Telegram Bot Hosting" },
      {
        property: "og:description",
        content:
          "Serverless Telegram bot control plane: ZIP analysis, webhook adapter, encrypted credentials, real deployment verification.",
      },
    ],
  }),
  component: Landing,
});

const FEATURES = [
  {
    icon: PackageSearch,
    title: "Real project analysis",
    body: "Upload a ZIP. We parse package.json, entrypoints, frameworks, env vars, handlers and polling patterns — and tell you the truth about compatibility.",
  },
  {
    icon: Webhook,
    title: "Webhook adapter",
    body: "Polling bots can't run serverlessly. Statically resolvable handlers are adapted to a webhook runtime; the rest is reported as unsupported, never faked.",
  },
  {
    icon: ShieldCheck,
    title: "Encrypted credentials",
    body: "Bot tokens and webhook secrets are AES-256-GCM encrypted at rest, never returned to the browser and redacted from every log line.",
  },
  {
    icon: Radio,
    title: "Verified deployments",
    body: "RUNNING means getMe passed, setWebhook succeeded, getWebhookInfo confirmed the URL and the health check is green. Nothing less.",
  },
  {
    icon: Database,
    title: "Telegram media storage",
    body: "Private channels act as media storage, verified with getChat and getChatMember. Metadata is indexed in Postgres.",
  },
  {
    icon: Server,
    title: "Zero servers",
    body: "No VPS, no Docker runner, no persistent process. A Telegram update wakes the function; the reply is sent; the invocation ends.",
  },
];

function Landing() {
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b border-border/70 bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <span className="font-mono text-sm font-semibold tracking-tight">
            bot<span className="text-primary">host</span>/central
          </span>
          <nav className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm">
              <Link to="/login">Login</Link>
            </Button>
            <Button asChild size="sm">
              <Link to="/register">Create account</Link>
            </Button>
          </nav>
        </div>
      </header>

      <main>
        <section className="grid-backdrop border-b border-border">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:py-28">
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-primary">
              Serverless control plane
            </p>
            <h1 className="mt-4 max-w-3xl text-4xl font-semibold leading-tight sm:text-6xl">
              Telegram bot hosting without a single server.
            </h1>
            <p className="mt-6 max-w-2xl text-base text-muted-foreground sm:text-lg">
              Telegram → HTTPS webhook → serverless function → your bot logic → reply → idle.
              Upload your existing Node.js bot, see an honest compatibility report, and deploy a
              webhook runtime that is verified against the real Telegram API.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild size="lg">
                <Link to="/register">
                  Start hosting <ArrowRight className="ml-1 size-4" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link to="/login">I already have an account</Link>
              </Button>
            </div>
            <pre className="terminal mt-12 overflow-x-auto p-4 text-muted-foreground">
{`Telegram  ->  HTTPS webhook  ->  serverless function
          ->  identify bot   ->  verify secret
          ->  dedupe update  ->  run adapted handler
          ->  Telegram API   ->  reply  ->  HTTP 200  ->  idle`}
            </pre>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-16">
          <h2 className="text-2xl font-semibold">Built for real deployments</h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <article key={f.title} className="panel p-5">
                <f.icon className="size-5 text-primary" />
                <h3 className="mt-4 text-base font-medium">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{f.body}</p>
              </article>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-border py-8">
        <div className="mx-auto max-w-6xl px-4 text-xs text-muted-foreground">
          BotHost Central — serverless Telegram bot hosting. No VPS. No persistent bot process.
        </div>
      </footer>
    </div>
  );
}

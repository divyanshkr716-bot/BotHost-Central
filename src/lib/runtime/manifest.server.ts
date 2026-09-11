/**
 * Manifest-based runtime detection.
 *
 * Reads an uploaded project (already extracted by analyze.server) and derives
 * what the platform must provide for it: package manager, install/build/start
 * commands, HTTP paths (webhook / health / download / stream), required
 * environment variables, and whether the bot needs a long-lived streaming
 * runtime (MTProto, Range/206 large-file delivery).
 *
 * Nothing here is bot-specific: every value comes from the project's own
 * BOT_HOST_MANIFEST.json / package.json / env template / source code.
 */
import type { ExtractedFile } from "../analyze.server";
import { normalizeRoot } from "../analyze.server";

export type RuntimeCapabilities = {
  runtime: "node";
  packageManager: "npm" | "pnpm" | "yarn" | "bun";
  nodeVersion: string | null;
  install: string;
  build: string | null;
  start: string;
  entry: string | null;
  webhookPath: string | null;
  healthPath: string | null;
  routes: { name: string; path: string }[];
  needsHttp: boolean;
  needsPort: boolean;
  needsStreaming: boolean;
  needsLongLived: boolean;
  streamingReasons: string[];
  requiredEnv: string[];
  optionalEnv: string[];
  managedEnv: string[];
};

export type RuntimeManifest = {
  detectedAt: string;
  source: "manifest" | "package.json";
  name: string | null;
  version: string | null;
  manifestFile: string | null;
  envFile: string | null;
  declared: Record<string, unknown>;
  capabilities: RuntimeCapabilities;
  issues: { severity: "error" | "warning" | "info"; message: string }[];
};

const MANIFEST_NAMES = [
  "BOT_HOST_MANIFEST.json",
  "bothost.json",
  "bot-manifest.json",
  "runtime.json",
];

/** Env vars the platform always supplies itself; never asked from the user. */
export const MANAGED_ENV = ["PORT", "BASE_URL", "WEBHOOK_SECRET", "BOT_TOKEN", "NODE_ENV"];

const STREAM_SIGNALS: [RegExp, string][] = [
  [/\bfrom ['"]telegram(\/|['"])/, "MTProto client (telegram/GramJS)"],
  [/\bTelegramClient\b/, "GramJS TelegramClient"],
  [/\bStringSession\b/, "GramJS session"],
  [/\biterDownload\b|downloadMedia\s*\(/, "Telegram media download stream"],
  [/\bRange\b.*bytes|bytes=/, "HTTP Range requests"],
  [/\b206\b/, "HTTP 206 partial responses"],
  [/ReadableStream|createReadStream|pipeThrough/, "streamed HTTP response"],
];

function readJson(text: string | null): Record<string, unknown> | null {
  if (!text) return null;
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function envKeysFromTemplate(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("#"))
        .map((l) => l.split("=")[0]!.trim())
        .filter((k) => /^[A-Z][A-Z0-9_]*$/.test(k)),
    ),
  ];
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function detectManifest(rawFiles: ExtractedFile[]): RuntimeManifest {
  const files = normalizeRoot(rawFiles);
  const byPath = new Map(files.map((f) => [f.path, f]));
  const issues: RuntimeManifest["issues"] = [];

  const manifestFile = MANIFEST_NAMES.find((n) => byPath.has(n)) ?? null;
  const declared = manifestFile ? (readJson(byPath.get(manifestFile)!.text) ?? {}) : {};
  if (manifestFile && Object.keys(declared).length === 0)
    issues.push({ severity: "warning", message: `${manifestFile} could not be parsed as JSON; falling back to package.json.` });

  const pkg = readJson(byPath.get("package.json")?.text ?? null);
  if (!pkg) issues.push({ severity: "error", message: "package.json is missing or invalid — the runtime cannot install or start this project." });

  const scripts = (pkg?.["scripts"] as Record<string, string> | undefined) ?? {};
  const deps = {
    ...((pkg?.["dependencies"] as Record<string, string>) ?? {}),
    ...((pkg?.["devDependencies"] as Record<string, string>) ?? {}),
  };

  const packageManager: RuntimeCapabilities["packageManager"] = byPath.has("bun.lock") || byPath.has("bun.lockb")
    ? "bun"
    : byPath.has("pnpm-lock.yaml")
      ? "pnpm"
      : byPath.has("yarn.lock")
        ? "yarn"
        : "npm";

  const install =
    str(declared["install_command"]) ??
    (packageManager === "npm"
      ? byPath.has("package-lock.json")
        ? "npm ci"
        : "npm install"
      : packageManager === "bun"
        ? "bun install"
        : packageManager === "pnpm"
          ? "pnpm install"
          : "yarn install");

  const build = str(declared["build_command"]) ?? (scripts["build"] ? `${packageManager} run build` : null);
  if (!build && byPath.has("tsconfig.json"))
    issues.push({ severity: "warning", message: "TypeScript project without a build script — the runtime will start it directly with the declared start command." });

  const start =
    str(declared["start_command"]) ??
    (scripts["start"] ? `${packageManager} run start` : null) ??
    (str(declared["server_entry"]) ? `node ${str(declared["server_entry"])}` : null) ??
    "npm start";
  if (!scripts["start"] && !str(declared["start_command"]))
    issues.push({ severity: "warning", message: "No start script declared; the runtime will try `npm start`." });

  const entry = str(declared["server_entry"]) ?? str(declared["entry"]) ?? str(pkg?.["main"]) ?? null;

  const code = files
    .filter((f) => f.text !== null && /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(f.path))
    .map((f) => f.text!)
    .join("\n");

  const streamingReasons = STREAM_SIGNALS.filter(([re]) => re.test(code)).map(([, label]) => label);
  if (str(declared["large_file_requirement"])) streamingReasons.push(str(declared["large_file_requirement"])!);
  if (deps["telegram"]) streamingReasons.push("depends on the `telegram` MTProto library");

  const routes: RuntimeCapabilities["routes"] = [];
  for (const [key, value] of Object.entries(declared)) {
    if (key.endsWith("_path") && typeof value === "string" && value.startsWith("/"))
      routes.push({ name: key.replace(/_path$/, ""), path: value });
  }

  const webhookPath = str(declared["webhook_path"]) ?? (/\/telegram\/webhook/.test(code) ? "/telegram/webhook" : null);
  const healthPath = str(declared["health_path"]) ?? (/['"]\/health['"]/.test(code) ? "/health" : null);

  const envFile = str(declared["env_file"]) ?? [".env.example", "bot.env", ".env.template", ".env.sample"].find((n) => byPath.has(n)) ?? null;
  const templateKeys = envFile && byPath.get(envFile)?.text ? envKeysFromTemplate(byPath.get(envFile)!.text!) : [];
  const codeKeys = [
    ...new Set(
      [...code.matchAll(/process\.env(?:\.([A-Z0-9_]+)|\[['"]([A-Z0-9_]+)['"]\])/g)].map((m) => m[1] ?? m[2]!),
    ),
  ];
  const declaredRequired = Array.isArray(declared["required_env"])
    ? (declared["required_env"] as unknown[]).filter((v): v is string => typeof v === "string")
    : [];

  const all = [...new Set([...declaredRequired, ...templateKeys, ...codeKeys])].sort();
  const requiredEnv = all.filter((k) => !MANAGED_ENV.includes(k));
  const optionalEnv = all.filter((k) => /^(CLEAN_|LINK_TTL|MT_PROTO|LOG_|DEBUG)/.test(k));

  const needsHttp = Boolean(webhookPath || healthPath || routes.length || /createServer|@hono\/node-server|express\(/.test(code));

  return {
    detectedAt: new Date().toISOString(),
    source: manifestFile ? "manifest" : "package.json",
    name: str(declared["name"]) ?? str(pkg?.["name"]),
    version: str(declared["version"]) ?? str(pkg?.["version"]),
    manifestFile,
    envFile,
    declared,
    capabilities: {
      runtime: "node",
      packageManager,
      nodeVersion: str((pkg?.["engines"] as Record<string, string> | undefined)?.["node"]),
      install,
      build,
      start,
      entry,
      webhookPath,
      healthPath,
      routes,
      needsHttp,
      needsPort: needsHttp,
      needsStreaming: streamingReasons.length > 0,
      needsLongLived: streamingReasons.length > 0,
      streamingReasons: [...new Set(streamingReasons)],
      requiredEnv: requiredEnv.filter((k) => !optionalEnv.includes(k)),
      optionalEnv,
      managedEnv: MANAGED_ENV,
    },
    issues,
  };
}

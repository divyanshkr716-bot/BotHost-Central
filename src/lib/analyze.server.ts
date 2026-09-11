/**
 * Static analysis of an uploaded Node.js/TypeScript Telegram bot project.
 *
 * IMPORTANT (honesty about the runtime): a serverless webhook invocation cannot
 * run `npm install`, spawn processes, or keep a polling loop alive. So this
 * module does NOT execute uploaded code. It parses it, reports real findings,
 * and builds a declarative webhook adapter plan from statically resolvable
 * handlers. Anything that cannot be resolved statically is reported as
 * unsupported instead of being faked.
 */
import { unzipSync } from "fflate";

export const LIMITS = {
  MAX_ZIP_BYTES: 15 * 1024 * 1024,
  MAX_EXTRACTED_BYTES: 60 * 1024 * 1024,
  MAX_FILES: 3000,
  MAX_FILE_BYTES: 5 * 1024 * 1024,
};

export type ExtractedFile = { path: string; text: string | null; size: number };

export class ZipError extends Error {}

function isUnsafePath(path: string): boolean {
  if (path.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(path)) return true;
  if (path.includes("\\")) return true;
  const parts = path.split("/");
  if (parts.some((p) => p === "..")) return true;
  if (path.includes("\0")) return true;
  return false;
}

const TEXT_EXT =
  /\.(ts|tsx|js|jsx|mjs|cjs|json|env|md|txt|yml|yaml|toml|sql|html|css|sh|lock)$|(^|\/)\.env/i;

export function safeExtract(zip: Uint8Array): ExtractedFile[] {
  if (zip.byteLength > LIMITS.MAX_ZIP_BYTES) {
    throw new ZipError(
      `ZIP is too large (${(zip.byteLength / 1048576).toFixed(1)} MB). Limit is ${LIMITS.MAX_ZIP_BYTES / 1048576} MB.`,
    );
  }
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(zip);
  } catch (e) {
    throw new ZipError(`Invalid or corrupted ZIP archive: ${(e as Error).message}`);
  }

  const names = Object.keys(entries);
  if (names.length === 0) throw new ZipError("ZIP archive is empty.");
  if (names.length > LIMITS.MAX_FILES)
    throw new ZipError(`Too many files in ZIP (${names.length}). Limit is ${LIMITS.MAX_FILES}.`);

  let total = 0;
  const out: ExtractedFile[] = [];
  for (const name of names) {
    if (isUnsafePath(name))
      throw new ZipError(`Unsafe path detected in archive: "${name}". Extraction aborted.`);
    const data = entries[name]!;
    if (name.endsWith("/")) continue;
    total += data.byteLength;
    if (total > LIMITS.MAX_EXTRACTED_BYTES)
      throw new ZipError(
        `Extracted size exceeds ${LIMITS.MAX_EXTRACTED_BYTES / 1048576} MB limit.`,
      );
    if (name.includes("node_modules/") || name.includes(".git/")) continue;
    const isText = TEXT_EXT.test(name) && data.byteLength <= LIMITS.MAX_FILE_BYTES;
    out.push({
      path: stripRoot(name),
      size: data.byteLength,
      text: isText ? new TextDecoder().decode(data) : null,
    });
  }
  if (out.length === 0) throw new ZipError("ZIP contains no usable project files.");
  return out;
}

/** Remove a single common top-level folder (e.g. "my-bot/") so paths are stable. */
function stripRoot(name: string): string {
  return name;
}

export function normalizeRoot(files: ExtractedFile[]): ExtractedFile[] {
  const tops = new Set(files.map((f) => f.path.split("/")[0]));
  if (tops.size === 1 && files.every((f) => f.path.includes("/"))) {
    const root = [...tops][0]!;
    return files.map((f) => ({ ...f, path: f.path.slice(root.length + 1) }));
  }
  return files;
}

export type DetectedHandler = {
  kind: "command" | "text" | "callback" | "media" | "start";
  trigger: string;
  source: string;
  replyText: string | null;
  adaptable: boolean;
  reason?: string;
};

export type Analysis = {
  projectType: string;
  isNode: boolean;
  isTypeScript: boolean;
  packageJson: { name?: string; version?: string; nodeVersion?: string } | null;
  hasPackageLock: boolean;
  hasTsconfig: boolean;
  entrypoint: string | null;
  buildScript: string | null;
  startScript: string | null;
  framework: string | null;
  telegramMode: "polling" | "webhook" | "unknown";
  pollingSignals: string[];
  webhookSignals: string[];
  envVars: string[];
  dependencies: string[];
  databaseDeps: string[];
  mediaHandling: boolean;
  handlers: DetectedHandler[];
  issues: { severity: "error" | "warning" | "info"; message: string }[];
  fileCount: number;
  totalBytes: number;
  compatibility: "READY" | "NEEDS_ADAPTATION" | "INCOMPATIBLE";
};

const FRAMEWORKS: Record<string, string> = {
  telegraf: "Telegraf",
  grammy: "grammY",
  "node-telegram-bot-api": "node-telegram-bot-api",
  telebot: "TeleBot",
  nestjs: "NestJS",
  telegramsjs: "telegrams.js",
};

const DB_DEPS = ["pg", "mongoose", "mongodb", "mysql2", "prisma", "@prisma/client", "sequelize", "redis", "ioredis", "sqlite3", "better-sqlite3", "@supabase/supabase-js"];

const ENTRY_CANDIDATES = [
  "src/main.ts",
  "src/index.ts",
  "src/server.ts",
  "src/bot.ts",
  "src/app.ts",
  "index.ts",
  "main.ts",
  "bot.ts",
  "src/main.js",
  "src/index.js",
  "src/bot.js",
  "index.js",
  "main.js",
  "dist/main.js",
  "dist/index.js",
];

const POLLING_PATTERNS: [RegExp, string][] = [
  [/\bgetUpdates\b/, "getUpdates call"],
  [/\bbot\.start\s*\(/, "bot.start()"],
  [/\bstartPolling\s*\(/, "startPolling()"],
  [/polling\s*:\s*true/, "polling: true"],
  [/\.launch\s*\(/, "telegraf .launch() (long polling by default)"],
  [/new\s+TelegramBot\([^)]*polling/, "node-telegram-bot-api polling constructor"],
  [/long[_ -]?polling/i, "long polling reference"],
];

const WEBHOOK_PATTERNS: [RegExp, string][] = [
  [/setWebhook/i, "setWebhook call"],
  [/webhookCallback/i, "webhookCallback adapter"],
  [/\bbot\.handleUpdate\s*\(/, "bot.handleUpdate()"],
  [/createWebhook/i, "createWebhook"],
  [/processUpdate\s*\(/, "processUpdate()"],
];

function extractStringLiteral(src: string, from: number): string | null {
  const m = src.slice(from, from + 600).match(/(?:reply|sendMessage|replyWithHTML)\s*\(\s*(['"`])([\s\S]{0,400}?)\1/);
  if (!m) return null;
  const text = m[2]!;
  if (/\$\{|\+\s*\w/.test(text)) return null; // dynamic interpolation -> not statically resolvable
  return text;
}

export function analyzeProject(rawFiles: ExtractedFile[]): Analysis {
  const files = normalizeRoot(rawFiles);
  const byPath = new Map(files.map((f) => [f.path, f]));
  const code = files.filter((f) => f.text !== null && /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(f.path));
  const allCode = code.map((f) => f.text!).join("\n");

  const issues: Analysis["issues"] = [];
  const pkgFile = byPath.get("package.json");
  let pkg: Record<string, unknown> | null = null;
  if (pkgFile?.text) {
    try {
      pkg = JSON.parse(pkgFile.text) as Record<string, unknown>;
    } catch {
      issues.push({ severity: "error", message: "package.json exists but is not valid JSON." });
    }
  } else {
    issues.push({ severity: "error", message: "No package.json found at project root." });
  }

  const deps = {
    ...((pkg?.["dependencies"] as Record<string, string>) ?? {}),
    ...((pkg?.["devDependencies"] as Record<string, string>) ?? {}),
  };
  const dependencies = Object.keys(deps);
  const scripts = (pkg?.["scripts"] as Record<string, string>) ?? {};

  let framework: string | null = null;
  for (const [dep, label] of Object.entries(FRAMEWORKS)) {
    if (dependencies.some((d) => d === dep || d.includes(dep))) framework = label;
  }
  if (!framework) {
    if (/from ['"]telegraf['"]/.test(allCode)) framework = "Telegraf";
    else if (/from ['"]grammy['"]/.test(allCode)) framework = "grammY";
    else if (/require\(['"]node-telegram-bot-api['"]\)/.test(allCode))
      framework = "node-telegram-bot-api";
  }

  const isTypeScript = files.some((f) => /\.tsx?$/.test(f.path));
  const entrypoint =
    ENTRY_CANDIDATES.find((c) => byPath.has(c)) ??
    (typeof pkg?.["main"] === "string" && byPath.has(pkg["main"] as string)
      ? (pkg["main"] as string)
      : null);
  if (!entrypoint)
    issues.push({
      severity: "error",
      message:
        "No recognizable entrypoint found (looked for src/main.ts, src/index.ts, src/server.ts, index.ts, dist/index.js, package.json main).",
    });

  const pollingSignals = POLLING_PATTERNS.filter(([re]) => re.test(allCode)).map(([, l]) => l);
  const webhookSignals = WEBHOOK_PATTERNS.filter(([re]) => re.test(allCode)).map(([, l]) => l);
  const telegramMode: Analysis["telegramMode"] =
    pollingSignals.length > 0 ? "polling" : webhookSignals.length > 0 ? "webhook" : "unknown";

  const envVars = [
    ...new Set(
      [...allCode.matchAll(/process\.env(?:\.([A-Z0-9_]+)|\[['"]([A-Z0-9_]+)['"]\])/g)].map(
        (m) => m[1] ?? m[2]!,
      ),
    ),
  ].sort();

  const databaseDeps = dependencies.filter((d) => DB_DEPS.includes(d));
  const mediaHandling = /\b(on\(['"](photo|video|document|audio|voice)|message\.(photo|video|document|audio)|sendPhoto|sendVideo|sendDocument|sendAudio)\b/.test(
    allCode,
  );

  // ---- handler extraction (webhook adapter plan) ----
  const handlers: DetectedHandler[] = [];
  for (const f of code) {
    const src = f.text!;
    for (const m of src.matchAll(/\bbot\.(?:command|onText|hears)\s*\(\s*(?:\/\^?\\?\/?)?['"`/]?([A-Za-z0-9_]+)/g)) {
      const trigger = m[1]!;
      const replyText = extractStringLiteral(src, m.index ?? 0);
      handlers.push({
        kind: trigger === "start" ? "start" : "command",
        trigger: `/${trigger}`,
        source: f.path,
        replyText,
        adaptable: replyText !== null,
        ...(replyText === null
          ? { reason: "Reply is computed at runtime (dynamic code) — cannot be executed serverlessly without manual adaptation." }
          : {}),
      });
    }
    for (const m of src.matchAll(/\bbot\.(?:on|action)\s*\(\s*['"`]([a-z_:]+)['"`]/g)) {
      const trigger = m[1]!;
      const kind: DetectedHandler["kind"] = /photo|video|document|audio|voice/.test(trigger)
        ? "media"
        : trigger.includes("callback")
          ? "callback"
          : "text";
      const replyText = extractStringLiteral(src, m.index ?? 0);
      handlers.push({
        kind,
        trigger,
        source: f.path,
        replyText,
        adaptable: replyText !== null,
        ...(replyText === null
          ? { reason: "Handler body is dynamic — requires manual adaptation." }
          : {}),
      });
    }
  }

  // ---- compatibility verdict ----
  let compatibility: Analysis["compatibility"] = "READY";
  if (issues.some((i) => i.severity === "error")) compatibility = "INCOMPATIBLE";
  else if (telegramMode === "polling") {
    compatibility = "NEEDS_ADAPTATION";
    issues.push({
      severity: "warning",
      message: `Polling detected (${pollingSignals.join(", ")}). Polling cannot run in a serverless webhook. Statically resolvable handlers will be adapted to the webhook runtime; the rest needs manual adaptation.`,
    });
  } else if (telegramMode === "unknown") {
    compatibility = "NEEDS_ADAPTATION";
    issues.push({
      severity: "warning",
      message: "No Telegram transport detected. The project could not be confirmed webhook-compatible.",
    });
  }

  if (/child_process|spawn\(|exec\(/.test(allCode)) {
    compatibility = compatibility === "INCOMPATIBLE" ? compatibility : "NEEDS_ADAPTATION";
    issues.push({
      severity: "warning",
      message: "child_process / spawn usage detected. Subprocesses are not available in a serverless webhook runtime.",
    });
  }
  if (/fs\.(writeFile|createWriteStream|appendFile)/.test(allCode)) {
    issues.push({
      severity: "warning",
      message: "Filesystem writes detected. Serverless invocations have no persistent filesystem — use the database or Telegram storage channel instead.",
    });
  }
  if (handlers.length === 0) {
    issues.push({
      severity: "warning",
      message: "No Telegram handlers could be statically detected. Nothing can be auto-adapted from this project.",
    });
    if (compatibility === "READY") compatibility = "NEEDS_ADAPTATION";
  }
  if (handlers.length > 0 && handlers.every((h) => !h.adaptable)) {
    issues.push({
      severity: "error",
      message: "All detected handlers are dynamic. Automatic webhook adaptation is not safely possible for this project.",
    });
    compatibility = "INCOMPATIBLE";
  }

  return {
    projectType: pkg ? "Node.js" : "Unknown",
    isNode: !!pkg,
    isTypeScript,
    packageJson: pkg
      ? {
          ...(typeof pkg["name"] === "string" ? { name: pkg["name"] } : {}),
          ...(typeof pkg["version"] === "string" ? { version: pkg["version"] } : {}),
          ...(typeof (pkg["engines"] as Record<string, string>)?.["node"] === "string"
            ? { nodeVersion: (pkg["engines"] as Record<string, string>)["node"]! }
            : {}),
        }
      : null,
    hasPackageLock: byPath.has("package-lock.json") || byPath.has("bun.lock") || byPath.has("yarn.lock"),
    hasTsconfig: byPath.has("tsconfig.json"),
    entrypoint,
    buildScript: scripts["build"] ?? null,
    startScript: scripts["start"] ?? null,
    framework,
    telegramMode,
    pollingSignals,
    webhookSignals,
    envVars,
    dependencies,
    databaseDeps,
    mediaHandling,
    handlers,
    issues,
    fileCount: files.length,
    totalBytes: files.reduce((a, f) => a + f.size, 0),
    compatibility,
  };
}

/** Declarative, serverless-executable adapter plan derived from the analysis. */
export type AdapterPlan = {
  generatedAt: string;
  handlers: {
    kind: DetectedHandler["kind"];
    match: string;
    reply: string;
    source: string;
  }[];
  unsupported: { trigger: string; reason: string; source: string }[];
  mediaCapture: boolean;
};

export function buildAdapterPlan(analysis: Analysis): AdapterPlan {
  return {
    generatedAt: new Date().toISOString(),
    handlers: analysis.handlers
      .filter((h) => h.adaptable && h.replyText)
      .map((h) => ({ kind: h.kind, match: h.trigger, reply: h.replyText!, source: h.source })),
    unsupported: analysis.handlers
      .filter((h) => !h.adaptable)
      .map((h) => ({ trigger: h.trigger, reason: h.reason ?? "Not statically resolvable", source: h.source })),
    mediaCapture: analysis.mediaHandling,
  };
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Project root: this file is src/config/index.ts (dev) or dist/config/index.js (built). */
export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
/** @deprecated alias kept for scripts */
export const REPO_ROOT = PROJECT_ROOT;

export type AdapterSetting = "auto" | "com" | "applescript" | "mock";

export interface AppConfig {
  transport: "stdio" | "http";
  http: { host: string; port: number; authToken?: string; secretPath?: string };
  photoshop: { adapter: AdapterSetting; timeoutMs: number; jobTimeoutMs: number; autoLaunch: boolean };
  allowedPaths: string[];
  outputDir: string;
  maxBatchFiles: number;
  download: { maxBytes: number; timeoutMs: number; allowPrivate: boolean; retries: number };
  assets: { dir: string; maxPixels: number; maxDimension: number; searchTimeoutMs: number; keys: { unsplash?: string; pexels?: string; pixabay?: string; serpapi?: string; googleCseKey?: string; googleCseId?: string } };
  logLevel: string;
  logDir?: string;
}

export function isLoopback(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

/** Load KEY=VALUE lines from the project-root .env without overriding variables already set. */
export function loadDotEnv(file = join(PROJECT_ROOT, ".env")): string | undefined {
  if (!existsSync(file)) return undefined;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trimStart().startsWith("#")) continue;
    const [, k, raw] = m;
    if (process.env[k!] === undefined) process.env[k!] = raw!.replace(/^["']|["']$/g, "");
  }
  return file;
}

function int(v: string | undefined, d: number, min: number, max: number): number {
  const n = v === undefined || v === "" ? d : Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`Invalid integer setting: ${v}`);
  return n;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, argv: string[] = process.argv): AppConfig {
  const argTransport = argv.includes("--transport") ? argv[argv.indexOf("--transport") + 1] : undefined;
  const transport = (argTransport ?? env.MCP_TRANSPORT ?? "stdio") as AppConfig["transport"];
  if (transport !== "stdio" && transport !== "http") throw new Error(`MCP_TRANSPORT must be stdio or http, got ${transport}`);
  const adapter = (argv.includes("--mock") ? "mock" : env.PHOTOSHOP_ADAPTER || "auto") as AdapterSetting;
  if (!["auto", "com", "applescript", "mock"].includes(adapter)) throw new Error(`PHOTOSHOP_ADAPTER must be auto, com, applescript or mock, got ${adapter}`);

  const httpHost = env.MCP_HTTP_HOST || "127.0.0.1";
  const authToken = env.MCP_AUTH_TOKEN || undefined;
  if (transport === "http" && !isLoopback(httpHost) && !authToken && !env.MCP_SECRET_PATH) {
    throw new Error("MCP_AUTH_TOKEN (or MCP_SECRET_PATH) is required when MCP_HTTP_HOST is not a loopback address.");
  }
  if (env.MCP_SECRET_PATH && !/^[A-Za-z0-9_-]{24,}$/.test(env.MCP_SECRET_PATH)) throw new Error("MCP_SECRET_PATH must be at least 24 URL-safe characters (use scripts/new-token.ps1).");

  const outputDir = resolve(PROJECT_ROOT, "output");
  const allowed = (env.ALLOWED_PATHS ?? "").split(";").map((s) => s.trim()).filter(Boolean);
  const allowedPaths = allowed.length ? allowed.map((p) => resolve(p)) : [outputDir, join(homedir(), "Documents", "PhotoshopMCP")];
  for (const p of allowedPaths) mkdirSync(p, { recursive: true });

  return {
    transport,
    http: { host: httpHost, port: int(env.MCP_HTTP_PORT, 3333, 1, 65535), authToken, secretPath: env.MCP_SECRET_PATH || undefined },
    photoshop: {
      adapter,
      timeoutMs: int(env.PHOTOSHOP_TIMEOUT_MS, 60_000, 1000, 3_600_000),
      jobTimeoutMs: int(env.PHOTOSHOP_JOB_TIMEOUT_MS, 900_000, 1000, 24 * 3_600_000),
      autoLaunch: (env.PHOTOSHOP_AUTO_LAUNCH ?? "true") !== "false",
    },
    allowedPaths,
    outputDir: allowedPaths[0]!,
    maxBatchFiles: int(env.MAX_BATCH_FILES, 200, 1, 10_000),
    download: {
      maxBytes: int(env.MAX_DOWNLOAD_MB, 50, 1, 2048) * 1024 * 1024,
      timeoutMs: int(env.DOWNLOAD_TIMEOUT_MS, 30_000, 1000, 600_000),
      allowPrivate: env.ALLOW_PRIVATE_DOWNLOADS === "true",
      retries: int(env.DOWNLOAD_RETRIES, 2, 0, 10),
    },
    assets: {
      dir: env.ASSETS_DIR ? resolve(allowedPaths[0]!, env.ASSETS_DIR) : join(allowedPaths[0]!, "assets"),
      maxPixels: int(env.MAX_IMAGE_MEGAPIXELS, 200, 1, 2000) * 1_000_000,
      maxDimension: int(env.MAX_IMAGE_DIMENSION, 30000, 16, 300000),
      searchTimeoutMs: int(env.IMAGE_SEARCH_TIMEOUT_MS, 15_000, 1000, 120_000),
      keys: { unsplash: env.UNSPLASH_ACCESS_KEY || undefined, pexels: env.PEXELS_API_KEY || undefined, pixabay: env.PIXABAY_API_KEY || undefined,
        serpapi: env.SERPAPI_API_KEY || undefined, googleCseKey: env.GOOGLE_CSE_API_KEY || undefined, googleCseId: env.GOOGLE_CSE_ID || undefined },
    },
    logLevel: env.LOG_LEVEL ?? "info",
    logDir: env.LOG_DIR ? resolve(PROJECT_ROOT, env.LOG_DIR) : undefined,
  };
}

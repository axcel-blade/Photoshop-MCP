#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig, loadDotEnv } from "./config/index.js";
import { createContext, createServer, SERVER_INFO } from "./server.js";
import { startHttp } from "./transport/http.js";
import { configureLogger, logger } from "./utils/logger.js";

async function main(): Promise<void> {
  if (process.argv.includes("--version") || process.argv.includes("-v")) {
    process.stdout.write(`${SERVER_INFO.name} ${SERVER_INFO.version}\n`);
    return;
  }
  const envFile = loadDotEnv();
  const config = loadConfig();
  configureLogger({ level: config.logLevel, dir: config.logDir });
  if (envFile) logger.info("loaded settings file", { file: envFile });
  const ctx = createContext(config);
  logger.info("starting photoshop-ai-mcp", { transport: config.transport, adapter: config.photoshop.adapter, allowedPaths: config.allowedPaths });

  let close: () => Promise<void>;
  if (config.transport === "http") {
    const http = await startHttp(config, ctx);
    close = () => new Promise((r) => http.close(() => r()));
  } else {
    const server = createServer(ctx);
    await server.connect(new StdioServerTransport());
    close = () => server.close();
  }

  // Safe shutdown: stop accepting work, let the in-flight Photoshop op finish (bounded wait).
  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    logger.info("shutting down", { signal, pending: ctx.bridge.pending });
    const deadline = Date.now() + 15000;
    while (ctx.bridge.pending > 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 200));
    await close().catch(() => undefined);
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.stdin.on("close", () => {
    if (config.transport === "stdio") void shutdown("stdin closed");
  });
}

main().catch((err) => {
  console.error(`photoshop-ai-mcp failed to start: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});

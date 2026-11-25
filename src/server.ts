import { readFileSync } from "node:fs";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ProviderRegistry } from "./ai/providers.js";
import { PROJECT_ROOT, type AppConfig } from "./config/index.js";
import { PlanStore } from "./design-engine/plan-store.js";
import { ExecutionStore } from "./jobs/executions.js";
import { JobManager } from "./jobs/job-manager.js";
import { registerPrompts } from "./mcp/prompts/index.js";
import { registerResources } from "./mcp/resources/index.js";
import { defineAllTools } from "./mcp/tools/index.js";
import { registerAll, type ToolContext, type ToolOutput } from "./mcp/tools/registry.js";
import { AppleScriptAdapter } from "./photoshop/bridge/applescript-adapter.js";
import { PhotoshopBridge } from "./photoshop/bridge/bridge.js";
import { ComAdapter } from "./photoshop/bridge/com-adapter.js";
import { MockAdapter } from "./photoshop/bridge/mock-adapter.js";
import type { BridgeAdapter } from "./photoshop/bridge/types.js";
import { PathPolicy } from "./utils/paths.js";

/** Version comes from package.json so releases only bump one file. */
const PKG = JSON.parse(readFileSync(join(PROJECT_ROOT, "package.json"), "utf8")) as { name: string; version: string };
export const SERVER_INFO = { name: PKG.name, version: PKG.version };

/** Pick COM on Windows, AppleScript on macOS; explicit adapter names always win. */
export function createAdapter(config: AppConfig): BridgeAdapter {
  const kind = config.photoshop.adapter;
  if (kind === "mock") return new MockAdapter();
  if (kind === "com") return new ComAdapter({ autoLaunch: config.photoshop.autoLaunch });
  if (kind === "applescript") return new AppleScriptAdapter({ autoLaunch: config.photoshop.autoLaunch });
  if (process.platform === "win32") return new ComAdapter({ autoLaunch: config.photoshop.autoLaunch });
  if (process.platform === "darwin") return new AppleScriptAdapter({ autoLaunch: config.photoshop.autoLaunch });
  throw new Error(`No Photoshop bridge for platform "${process.platform}". Use PHOTOSHOP_ADAPTER=mock for tests, or run on Windows/macOS.`);
}

/** Shared state for one process: one bridge/queue regardless of how many MCP sessions connect. */
export function createContext(config: AppConfig, adapter: BridgeAdapter = createAdapter(config), env: NodeJS.ProcessEnv = process.env): ToolContext {
  return {
    bridge: new PhotoshopBridge(adapter, config.photoshop.timeoutMs),
    config,
    paths: new PathPolicy(config.allowedPaths),
    plans: new PlanStore(join(config.outputDir, "plans")),
    jobs: new JobManager<ToolOutput>(),
    executions: new ExecutionStore(join(config.outputDir, "workflows")),
    providers: ProviderRegistry.fromEnv(env),
    session: { units: "px" },
  };
}

export function createServer(ctx: ToolContext): McpServer {
  defineAllTools();
  const server = new McpServer(SERVER_INFO, {
    capabilities: { tools: {}, resources: {}, prompts: {}, logging: {} },
    instructions:
      "Controls Adobe Photoshop. Coordinates: document pixels, origin top-left, x right, y DOWN. Layers are referenced by {id} (preferred) or {name}. " +
      "Every result states its source (photoshop | mock | server). Never claim visual inspection unless a tool returned a preview image (capture_preview). " +
      "Destructive tools need confirm: true after asking the user; files are never overwritten without overwrite: true. " +
      "Design plans (plan_design / generate_design) build editable layers; large designs and batch work accept background: true and return a jobId (wait_for_job). " +
      "Tools tagged unsupported/requires_provider explain why and give an alternative. Start with photoshop_status.",
  });
  registerAll(server, ctx);
  registerResources(server, ctx, SERVER_INFO);
  registerPrompts(server);
  return server;
}

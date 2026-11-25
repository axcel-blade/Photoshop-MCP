import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { PHOTOSHOP_AI_CAPABILITIES } from "../../ai/providers.js";
import { toPsError } from "../../shared.js";
import { CANVAS_PRESETS, STYLES, WORKFLOW_TEMPLATES } from "../../workflow-engine/index.js";
import { TOOL_CATALOG, type ToolContext } from "../tools/registry.js";

const json = (uri: string, value: unknown) => ({ contents: [{ uri, mimeType: "application/json", text: JSON.stringify(value, null, 2) }] });

async function live(ctx: ToolContext, uri: string, command: string, params: Record<string, unknown> = {}) {
  try {
    const r = await ctx.bridge.run(command, params, { timeoutMs: 15_000 });
    return json(uri, { ok: true, source: ctx.bridge.adapterName === "mock" ? "mock" : "photoshop", data: r.data, warnings: r.warnings });
  } catch (err) {
    return json(uri, { ok: false, error: toPsError(err).toJSON() });
  }
}

export function catalogSummary() {
  const modules: Record<string, { name: string; status: string; description: string; commands: string[]; limitations?: string }[]> = {};
  for (const t of TOOL_CATALOG.values()) (modules[t.module] ??= []).push({ name: t.name, status: t.status, description: t.description, commands: t.commands, limitations: t.limitations });
  return { total: TOOL_CATALOG.size, modules };
}

export function registerResources(server: McpServer, ctx: ToolContext, serverInfo: { name: string; version: string }): void {
  const reg = (name: string, path: string, description: string, read: (uri: string) => Promise<ReturnType<typeof json>> | ReturnType<typeof json>) =>
    server.registerResource(name, `photoshop://${path}`, { title: name, description, mimeType: "application/json" }, async (uri) => read(uri.href));

  reg("connection-status", "status", "Bridge connection status, Photoshop versions, queue, recent operations.", (uri) =>
    json(uri, { server: serverInfo, bridge: ctx.bridge.status(), recentOperations: ctx.bridge.recent(20), allowedPaths: ctx.paths.roots }));
  reg("photoshop-version", "version", "Photoshop and ExtendScript versions (live).", (uri) => live(ctx, uri, "ps.info"));
  reg("active-document", "documents/active", "Active document info (live).", (uri) => live(ctx, uri, "doc.info"));
  reg("open-documents", "documents", "All open documents (live).", (uri) => live(ctx, uri, "doc.list"));
  reg("layers", "documents/active/layers", "Layer structure of the active document (live).", (uri) => live(ctx, uri, "layer.list"));
  reg("tool-catalog", "catalog", "Every tool by module with implementation status (supported/partial/unsupported/requires_provider), JSX bridge ops and limitations.", (uri) => json(uri, catalogSummary()));
  reg("ai-capabilities", "capabilities/ai", "Honest status of Photoshop AI features and configured external providers.", (uri) => json(uri, { photoshop: PHOTOSHOP_AI_CAPABILITIES, providers: ctx.providers.status() }));
  reg("executions", "executions", "Workflow / batch executions and their per-step status.", (uri) => json(uri, ctx.executions.list().slice(0, 50)));
  reg("workflow-templates", "workflows/templates", "Built-in workflow templates (run with execute_workflow { template }).", (uri) => json(uri, WORKFLOW_TEMPLATES));
  reg("design-presets", "design/presets", "Canvas size presets and art-direction styles used by the design tools.", (uri) => json(uri, { canvas: CANVAS_PRESETS, styles: STYLES }));
}

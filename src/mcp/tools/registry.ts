import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { z, type ZodRawShape } from "zod";
import { PsMcpError, toPsError } from "../../shared.js";
import type { ProviderRegistry } from "../../ai/providers.js";
import type { AppConfig } from "../../config/index.js";
import type { PhotoshopBridge } from "../../photoshop/bridge/bridge.js";
import type { PathPolicy } from "../../utils/paths.js";
import type { ExecutionStore } from "../../jobs/executions.js";
import type { JobManager } from "../../jobs/job-manager.js";
import type { PlanStore } from "../../design-engine/plan-store.js";
import type { Unit } from "../../utils/units.js";
import { logger } from "../../utils/logger.js";

export interface ToolContext {
  bridge: PhotoshopBridge;
  config: AppConfig;
  paths: PathPolicy;
  plans: PlanStore;
  jobs: JobManager<ToolOutput>;
  executions: ExecutionStore;
  providers: ProviderRegistry;
  session: { units: Unit };
}

export interface ToolOutput {
  data: unknown;
  warnings?: string[];
  images?: { base64: string; mimeType: string }[];
  /** "photoshop": confirmed by Photoshop; "mock": simulated; "server": computed without Photoshop. */
  source?: "photoshop" | "mock" | "server";
}

export interface ToolMeta {
  name: string;
  module: string;
  title?: string;
  description: string;
  annotations?: ToolAnnotations;
  /** JSX bridge ops this tool may run (for docs and the capability catalog). */
  commands: string[];
  status: "supported" | "partial" | "unsupported" | "requires_provider";
  limitations?: string;
  inputSchema: z.ZodObject<ZodRawShape>;
}

export const TOOL_CATALOG = new Map<string, ToolMeta>();
type Runner = (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolOutput>;
/** Validated in-process entry points; used by the workflow engine and batch tools. */
export const TOOL_HANDLERS = new Map<string, Runner>();

export const READ_ONLY: ToolAnnotations = { readOnlyHint: true, openWorldHint: false };
export const WRITE: ToolAnnotations = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
export const DESTRUCTIVE: ToolAnnotations = { readOnlyHint: false, destructiveHint: true, openWorldHint: false };
export const EXTERNAL: ToolAnnotations = { readOnlyHint: false, destructiveHint: false, openWorldHint: true };

export function requireConfirm(confirm: unknown, what: string): void {
  if (confirm !== true) {
    throw new PsMcpError("CONFIRMATION_REQUIRED", `${what} is destructive. Ask the user, then call again with confirm: true.`);
  }
}

export function toCallResult(tool: string, out: ToolOutput, ctx: ToolContext): CallToolResult {
  const source = out.source ?? (ctx.bridge.adapterName === "mock" ? "mock" : "photoshop");
  const warnings = [...(out.warnings ?? [])];
  if (source === "mock") warnings.unshift("MOCK ADAPTER: Photoshop was not used; results are simulated for testing.");
  return {
    content: [
      { type: "text", text: JSON.stringify({ ok: true, tool, source, data: out.data, warnings }, null, 2) },
      ...(out.images ?? []).map((i) => ({ type: "image" as const, data: i.base64, mimeType: i.mimeType })),
    ],
  };
}

export interface ToolDef<S extends ZodRawShape> {
  name: string;
  module: string;
  title?: string;
  description: string;
  input: S;
  annotations?: ToolAnnotations;
  commands?: string[];
  status?: ToolMeta["status"];
  limitations?: string;
  handler: (args: z.objectOutputType<S, z.ZodTypeAny>, ctx: ToolContext) => Promise<ToolOutput>;
}

/**
 * Tools that can run for minutes (whole designs, batch exports). They accept `background: true`,
 * which queues the call as a job and returns its id at once; poll with get_job / wait_for_job.
 */
export const LONG_RUNNING_TOOLS = new Set([
  "execute_design_plan", "generate_design", "revise_design", "improve_design", "generate_design_variations", "create_ui_design",
  "create_poster", "create_flyer", "create_banner", "create_social_media_design", "create_thumbnail", "create_advertisement",
  "create_magazine_cover", "create_album_cover", "create_typography_design", "create_image_contact_sheet", "create_photo_collage",
  "create_photo_composite", "create_product_composite", "create_double_exposure", "combine_images", "enhance_portrait", "restore_photo",
  "export_multiple_sizes", "create_delivery_package", "optimize_image", "batch_operation", "generate_design_report",
  "create_logo", "create_social_media_graphic", "create_business_card", "create_brand_identity", "create_packaging_design", "create_infographic",
  "create_icon_set", "create_vector_illustration", "create_editorial_layout", "create_app_screen", "create_landing_page", "create_web_dashboard", "create_ui_kit",
]);

const backgroundArg = z.boolean().default(false).describe(
  "Run as a background job: returns a jobId immediately instead of waiting. Use for large designs or batch exports, then poll get_job / wait_for_job.",
);

/** Pending registrations; `registerAll` attaches them to an McpServer (one catalog, many sessions). */
const DEFS: ToolDef<ZodRawShape>[] = [];

export function tool<S extends ZodRawShape>(def: ToolDef<S>): void {
  if (TOOL_CATALOG.has(def.name)) throw new Error(`Duplicate tool ${def.name}`);
  const parser = z.object(def.input);
  TOOL_CATALOG.set(def.name, {
    name: def.name, module: def.module, title: def.title, description: def.description, annotations: def.annotations,
    commands: def.commands ?? [], status: def.status ?? "supported", limitations: def.limitations, inputSchema: parser as never,
  });
  TOOL_HANDLERS.set(def.name, async (raw, ctx) => {
    const parsed = parser.safeParse(raw ?? {});
    if (!parsed.success) {
      throw new PsMcpError("VALIDATION_ERROR", `Invalid arguments for ${def.name}: ${parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"} ${i.message}`).join("; ")}`);
    }
    return def.handler(parsed.data as never, ctx);
  });
  DEFS.push(def as unknown as ToolDef<ZodRawShape>);
}

/** Call another tool in-process (validated), used by composite tools and workflows. */
export async function callTool(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutput> {
  const h = TOOL_HANDLERS.get(name);
  if (!h) throw new PsMcpError("VALIDATION_ERROR", `Unknown tool: ${name}`);
  return h(args, ctx);
}

export function registerAll(server: McpServer, ctx: ToolContext): void {
  for (const def of DEFS) {
    const longRunning = LONG_RUNNING_TOOLS.has(def.name);
    let desc = def.status && def.status !== "supported" ? `${def.description} [status: ${def.status}${def.limitations ? ` — ${def.limitations}` : ""}]` : def.description;
    if (longRunning) desc += " Supports background: true for long runs (returns a jobId; poll get_job / wait_for_job).";
    const inputSchema = longRunning ? { ...def.input, background: backgroundArg } : def.input;
    server.registerTool(
      def.name,
      { title: def.title, description: desc, inputSchema, annotations: def.annotations },
      (async (rawArgs: Record<string, unknown>): Promise<CallToolResult> => {
        const started = Date.now();
        try {
          // Only long-running tools own `background` (the job flag); for others (e.g. create_document) it is a real argument.
          let args: Record<string, unknown> = rawArgs;
          let background = false;
          if (longRunning) ({ background = false, ...args } = rawArgs as Record<string, unknown> & { background?: boolean });
          if (background) {
            const job = ctx.jobs.start(def.name, () => ctx.bridge.withTimeoutScope(ctx.config.photoshop.jobTimeoutMs, () => TOOL_HANDLERS.get(def.name)!(args, ctx)));
            return toCallResult(def.name, { data: { jobId: job.id, state: job.state, queuedJobs: ctx.jobs.active, next: `Call wait_for_job { jobId: "${job.id}" } or get_job to collect the result.` }, source: "server" }, ctx);
          }
          const out = await TOOL_HANDLERS.get(def.name)!(args, ctx);
          logger.info("tool ok", { tool: def.name, ms: Date.now() - started });
          return toCallResult(def.name, out, ctx);
        } catch (err) {
          const e = toPsError(err);
          logger.warn("tool error", { tool: def.name, code: e.code, message: e.message });
          return { isError: true, content: [{ type: "text", text: JSON.stringify({ ok: false, tool: def.name, error: e.toJSON() }, null, 2) }] };
        }
      }) as never,
    );
  }
}

/** Run one bridge op and wrap the result. */
export async function cmd(ctx: ToolContext, command: string, params: Record<string, unknown> = {}, warnings: string[] = []): Promise<ToolOutput> {
  const r = await ctx.bridge.run(command, stripUndefined(params));
  return { data: r.data, warnings: [...warnings, ...r.warnings] };
}

export function stripUndefined<T extends Record<string, unknown>>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

/** Merge several step outputs into one result that lists each step. */
export function combine(steps: { step: string; out: ToolOutput }[], data: Record<string, unknown> = {}): ToolOutput {
  return {
    data: { ...data, steps: steps.map((s) => ({ step: s.step, result: s.out.data })) },
    warnings: steps.flatMap((s) => s.out.warnings ?? []),
    images: steps.flatMap((s) => s.out.images ?? []),
  };
}

/** Run a sequence of bridge ops, recording each; stops on first error (error names the failed step). */
export class Sequence {
  readonly steps: { step: string; out: ToolOutput }[] = [];
  constructor(private readonly ctx: ToolContext) {}
  async run(step: string, command: string, params: Record<string, unknown> = {}): Promise<ToolOutput> {
    try {
      const out = await cmd(this.ctx, command, params);
      this.steps.push({ step, out });
      return out;
    } catch (err) {
      const e = toPsError(err);
      throw new PsMcpError(e.code, `Step "${step}" failed: ${e.message}`, { completedSteps: this.steps.map((s) => s.step), details: e.details });
    }
  }
  async tool(step: string, name: string, args: Record<string, unknown>): Promise<ToolOutput> {
    try {
      const out = await callTool(name, args, this.ctx);
      this.steps.push({ step, out });
      return out;
    } catch (err) {
      const e = toPsError(err);
      throw new PsMcpError(e.code, `Step "${step}" failed: ${e.message}`, { completedSteps: this.steps.map((s) => s.step), details: e.details });
    }
  }
  result(data: Record<string, unknown> = {}, warnings: string[] = []): ToolOutput {
    const r = combine(this.steps, data);
    r.warnings = [...warnings, ...(r.warnings ?? [])];
    return r;
  }
}

/** Extract `{layer:{id}}` from a bridge result for chaining. */
export function layerIdOf(out: ToolOutput): number | undefined {
  const d = out.data as { layer?: { id?: number } } | undefined;
  return d?.layer?.id;
}

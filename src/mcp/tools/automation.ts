import { readdirSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { z } from "zod";
import { PsMcpError, SAVE_FORMATS, toPsError } from "../../shared.js";
import { Workflow, WorkflowStep } from "../../schemas/index.js";
import { planFromBrief, runWorkflow, WORKFLOW_TEMPLATES } from "../../workflow-engine/index.js";
import { IMAGE_INPUT_EXTENSIONS, FORMAT_EXTENSIONS } from "../../utils/paths.js";
import { callTool, cmd, DESTRUCTIVE, READ_ONLY, requireConfirm, tool, TOOL_HANDLERS, WRITE, type ToolContext, type ToolOutput } from "./registry.js";
import { color, confirm, overwrite, path } from "./args.js";

const M = "automation";
const inputs = { files: z.array(path).max(10000).optional(), folder: path.optional(), recursive: z.boolean().default(false) };
const NOT_IN_BATCH = new Set(["batch_process", "resize_batch", "convert_batch", "export_batch", "watermark_batch", "execute_workflow", "run_action", "close_document", "open_document"]);

function listInputs(ctx: ToolContext, a: { files?: string[]; folder?: string; recursive?: boolean }): string[] {
  const out = (a.files ?? []).map((f) => ctx.paths.resolve(f, { extensions: IMAGE_INPUT_EXTENSIONS, mustExist: true }));
  const walk = (dir: string, depth: number) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      if (e.isDirectory() && a.recursive && depth < 5) walk(full, depth + 1);
      else if (e.isFile() && IMAGE_INPUT_EXTENSIONS.includes(extname(e.name).toLowerCase())) out.push(ctx.paths.resolve(full));
    }
  };
  if (a.folder) walk(ctx.paths.resolveDir(a.folder), 0);
  if (!out.length) throw new PsMcpError("VALIDATION_ERROR", "No input images: give files or a folder inside an allowed directory");
  if (out.length > ctx.config.maxBatchFiles) throw new PsMcpError("LIMIT_EXCEEDED", `${out.length} files exceeds MAX_BATCH_FILES=${ctx.config.maxBatchFiles}`);
  return out;
}

interface BatchSpec {
  steps: z.infer<typeof WorkflowStep>[];
  outputFolder: string;
  format: (typeof SAVE_FORMATS)[number];
  quality?: number;
  width?: number;
  height?: number;
  suffix: string;
  overwrite: boolean;
}

/** open → steps → export copy → close without saving, per file. Source files are never modified. */
async function runBatch(ctx: ToolContext, files: string[], spec: BatchSpec, execId: string): Promise<unknown> {
  const outDir = ctx.paths.resolveDir(spec.outputFolder, true);
  for (const s of spec.steps) if (NOT_IN_BATCH.has(s.tool)) throw new PsMcpError("VALIDATION_ERROR", `${s.tool} cannot be used inside a batch step list`);
  const status = ctx.executions.get(execId)!;
  const results: { input: string; output?: string; ok: boolean; error?: unknown }[] = [];
  status.state = "running";
  status.steps = files.map((f, index) => ({ index, tool: "batch_item", description: basename(f), state: "pending" }));
  for (const [i, file] of files.entries()) {
    const rec = status.steps[i]!;
    if (ctx.executions.isCancelled(execId)) {
      status.steps.slice(i).forEach((s) => (s.state = "cancelled"));
      status.state = "cancelled";
      break;
    }
    status.currentStep = i;
    rec.state = "running";
    rec.startedAt = new Date().toISOString();
    let docId: number | undefined;
    try {
      const out = ctx.paths.resolveOutput(join(outDir, `${basename(file, extname(file))}${spec.suffix}${FORMAT_EXTENSIONS[spec.format]![0]}`), { extensions: FORMAT_EXTENSIONS[spec.format], overwrite: spec.overwrite });
      const opened = await cmd(ctx, "doc.open", { path: file });
      docId = (opened.data as { document: { id: number } }).document.id;
      for (const s of spec.steps) await callTool(s.tool, { ...s.args, doc: { id: docId } }, ctx);
      await cmd(ctx, "doc.saveAs", { doc: { id: docId }, path: out, format: spec.format, quality: spec.quality, width: spec.width, height: spec.height, asCopy: true });
      results.push({ input: file, output: out, ok: true });
      rec.state = "ok";
      rec.data = { output: out };
    } catch (err) {
      const e = toPsError(err);
      results.push({ input: file, ok: false, error: e.toJSON() });
      rec.state = "failed";
      rec.error = e.toJSON();
    } finally {
      if (docId !== undefined) await cmd(ctx, "doc.close", { doc: { id: docId }, save: "no" }).catch(() => undefined);
      rec.finishedAt = new Date().toISOString();
    }
  }
  const failed = results.filter((r) => !r.ok).length;
  if (status.state === "running") status.state = failed === 0 ? "succeeded" : failed === results.length ? "failed" : "partial";
  status.finishedAt = new Date().toISOString();
  status.currentStep = undefined;
  const summary = { processed: results.length, succeeded: results.length - failed, failed, results };
  ctx.executions.setResult(execId, summary);
  return summary;
}

/** Start long work; wait for it unless background: true. */
async function launch(ctx: ToolContext, name: string, background: boolean, work: (id: string) => Promise<unknown>): Promise<ToolOutput> {
  const exec = ctx.executions.create(name);
  const p = ctx.bridge.withTimeout(Math.max(ctx.config.photoshop.timeoutMs, 300_000), () => work(exec.id)).catch((err) => {
    const e = toPsError(err);
    const s = ctx.executions.get(exec.id);
    if (s) {
      s.state = "failed";
      s.finishedAt = new Date().toISOString();
      ctx.executions.setResult(exec.id, { error: e.toJSON() });
    }
    throw e;
  });
  if (background) {
    p.catch(() => undefined);
    return { data: { executionId: exec.id, state: "running", next: `get_execution_status { id: "${exec.id}" }` }, source: "server" };
  }
  const result = await p;
  return { data: { executionId: exec.id, state: ctx.executions.get(exec.id)?.state, result } };
}

const batchCommon = { ...inputs, outputFolder: path.describe("Output folder inside an allowed directory"), suffix: z.string().max(40).regex(/^[\w.-]*$/).default(""), overwrite, background: z.boolean().default(false).describe("Return an executionId immediately") };

export function registerAutomationTools(): void {
  tool({ name: "get_action_sets", module: M, description: "List action sets (from the Actions panel).", annotations: READ_ONLY, commands: ["action.list"], input: {},
    handler: async (_a, ctx) => { const o = await cmd(ctx, "action.list"); return { data: { sets: (o.data as { sets: { name: string; actions: string[] }[] }).sets.map((s) => ({ name: s.name, count: s.actions.length })) } }; } });
  tool({ name: "get_actions", module: M, description: "List actions, optionally for one set.", annotations: READ_ONLY, commands: ["action.list"], input: { set: z.string().max(255).optional() },
    handler: async (a, ctx) => { const o = await cmd(ctx, "action.list"); const sets = (o.data as { sets: { name: string; actions: string[] }[] }).sets; return { data: { sets: a.set ? sets.filter((s) => s.name === a.set) : sets } }; } });
  tool({
    name: "run_action", module: M, description: "Play a recorded Photoshop action. Actions can do anything the user recorded (including saving or deleting), so this requires confirm: true.", annotations: DESTRUCTIVE, commands: ["action.run"],
    input: { set: z.string().min(1).max(255), action: z.string().min(1).max(255), confirm },
    handler: (a, ctx) => { requireConfirm(a.confirm, `Running action "${a.set} / ${a.action}"`); return cmd(ctx, "action.run", { set: a.set, action: a.action }); },
  });
  tool({
    name: "batch_process", module: M, description: "Batch: for each input file run tool steps (doc is injected), export a copy, close without saving. Source files are never changed.", annotations: WRITE, commands: ["doc.open", "doc.saveAs", "doc.close"],
    input: { ...batchCommon, steps: z.array(WorkflowStep).max(50).default([]), format: z.enum(SAVE_FORMATS).default("jpg"), quality: z.number().min(0).max(100).optional() },
    handler: async (a, ctx) => { const files = listInputs(ctx, a); return launch(ctx, "batch_process", a.background, (id) => runBatch(ctx, files, { steps: a.steps, outputFolder: a.outputFolder, format: a.format, quality: a.quality, suffix: a.suffix, overwrite: a.overwrite }, id)); },
  });
  tool({
    name: "resize_batch", module: M, description: "Batch resize copies (width and/or height; aspect kept if one is omitted).", annotations: WRITE, commands: ["doc.open", "doc.saveAs", "doc.close"],
    input: { ...batchCommon, width: z.number().int().min(1).max(30000).optional(), height: z.number().int().min(1).max(30000).optional(), format: z.enum(SAVE_FORMATS).default("jpg"), quality: z.number().min(0).max(100).optional() },
    handler: async (a, ctx) => {
      if (!a.width && !a.height) throw new PsMcpError("VALIDATION_ERROR", "Give width and/or height");
      const files = listInputs(ctx, a);
      return launch(ctx, "resize_batch", a.background, (id) => runBatch(ctx, files, { steps: [], outputFolder: a.outputFolder, format: a.format, quality: a.quality, width: a.width, height: a.height, suffix: a.suffix || `-${a.width ?? a.height}`, overwrite: a.overwrite }, id));
    },
  });
  tool({
    name: "convert_batch", module: M, description: "Batch convert files to another format.", annotations: WRITE, commands: ["doc.open", "doc.saveAs", "doc.close"],
    input: { ...batchCommon, format: z.enum(SAVE_FORMATS), quality: z.number().min(0).max(100).optional() },
    handler: async (a, ctx) => { const files = listInputs(ctx, a); return launch(ctx, "convert_batch", a.background, (id) => runBatch(ctx, files, { steps: [], outputFolder: a.outputFolder, format: a.format, quality: a.quality, suffix: a.suffix, overwrite: a.overwrite }, id)); },
  });
  tool({
    name: "export_batch", module: M, description: "Batch export (e.g. PSDs → PNG + JPEG): one pass per format.", annotations: WRITE, commands: ["doc.open", "doc.saveAs", "doc.close"],
    input: { ...batchCommon, formats: z.array(z.enum(SAVE_FORMATS)).min(1).max(5), quality: z.number().min(0).max(100).optional() },
    handler: async (a, ctx) => {
      const files = listInputs(ctx, a);
      return launch(ctx, "export_batch", a.background, async (id) => {
        const all: unknown[] = [];
        for (const f of a.formats) {
          const sub = ctx.executions.create(`export_batch:${f}`);
          all.push({ format: f, ...(await runBatch(ctx, files, { steps: [], outputFolder: a.outputFolder, format: f, quality: a.quality, suffix: a.suffix, overwrite: a.overwrite }, sub.id) as object) });
        }
        const s = ctx.executions.get(id)!;
        s.state = "succeeded";
        s.finishedAt = new Date().toISOString();
        return all;
      });
    },
  });
  tool({
    name: "watermark_batch", module: M, description: "Batch watermark copies with text (and/or a logo image) at a corner or center.", annotations: WRITE, commands: ["doc.open", "text.create", "image.place", "doc.saveAs", "doc.close"],
    input: {
      ...batchCommon, text: z.string().max(200).optional(), logo: path.optional(), position: z.enum(["bottomRight", "bottomLeft", "topRight", "topLeft", "center"]).default("bottomRight"),
      opacity: z.number().min(5).max(100).default(50), color: color.default("#FFFFFF"), sizePercent: z.number().min(1).max(50).default(4), format: z.enum(SAVE_FORMATS).default("jpg"), quality: z.number().min(0).max(100).optional(),
    },
    handler: async (a, ctx) => {
      if (!a.text && !a.logo) throw new PsMcpError("VALIDATION_ERROR", "Give text and/or logo");
      const logo = a.logo ? ctx.paths.resolve(a.logo, { extensions: IMAGE_INPUT_EXTENSIONS, mustExist: true }) : undefined;
      const files = listInputs(ctx, a);
      const steps: z.infer<typeof WorkflowStep>[] = [{ tool: "add_watermark", args: { text: a.text, logo, position: a.position, opacity: a.opacity, color: a.color, sizePercent: a.sizePercent }, continueOnError: false }];
      return launch(ctx, "watermark_batch", a.background, (id) => runBatch(ctx, files, { steps, outputFolder: a.outputFolder, format: a.format, quality: a.quality, suffix: a.suffix || "-wm", overwrite: a.overwrite }, id));
    },
  });
  tool({
    name: "add_watermark", module: M, description: "Add a text and/or logo watermark to the document.", annotations: WRITE, commands: ["doc.info", "text.create", "image.place", "layer.props"],
    input: { doc: z.any().optional(), text: z.string().max(200).optional(), logo: z.string().optional(), position: z.enum(["bottomRight", "bottomLeft", "topRight", "topLeft", "center"]).default("bottomRight"), opacity: z.number().min(5).max(100).default(50), color: color.default("#FFFFFF"), sizePercent: z.number().min(1).max(50).default(4) },
    handler: async (a, ctx) => {
      const info = await cmd(ctx, "doc.info", { doc: a.doc });
      const d = (info.data as { document: { width: number; height: number } }).document;
      const m = Math.round(Math.min(d.width, d.height) * 0.03);
      const size = Math.max(8, Math.round((Math.min(d.width, d.height) * a.sizePercent) / 100));
      const right = a.position.endsWith("Right"), left = a.position.endsWith("Left"), top = a.position.startsWith("top");
      const x = right ? d.width - m : left ? m : d.width / 2;
      const y = a.position === "center" ? d.height / 2 : top ? m + size : d.height - m;
      const out: unknown[] = [];
      if (a.text) {
        const t = await cmd(ctx, "text.create", { doc: a.doc, text: a.text, x, y, size, color: a.color, alignment: right ? "right" : left ? "left" : "center", font: "ArialMT", name: "Watermark" });
        await cmd(ctx, "layer.props", { doc: a.doc, layer: { id: (t.data as { layer: { id: number } }).layer.id }, opacity: a.opacity });
        out.push(t.data);
      }
      if (a.logo) {
        const logo = ctx.paths.resolve(a.logo, { extensions: IMAGE_INPUT_EXTENSIONS, mustExist: true });
        const lw = size * 4;
        const lx = right ? d.width - m - lw : left ? m : d.width / 2 - lw / 2;
        const ly = a.position === "center" ? d.height / 2 - lw / 2 : top ? m + (a.text ? size * 1.5 : 0) : d.height - m - lw - (a.text ? size * 1.5 : 0);
        const l = await cmd(ctx, "image.place", { doc: a.doc, path: logo, x: lx, y: ly, width: lw, height: lw, fit: "contain", name: "Watermark Logo" });
        await cmd(ctx, "layer.props", { doc: a.doc, layer: { id: (l.data as { layer: { id: number } }).layer.id }, opacity: a.opacity });
        out.push(l.data);
      }
      return { data: { added: out } };
    },
  });

  tool({
    name: "plan_workflow", module: M, description: "Turn a natural-language design brief into an ordered plan of tool calls (nothing is executed). Review it, then run it with execute_workflow { steps }.", annotations: READ_ONLY, commands: [],
    input: { brief: z.string().min(5).max(4000), assets: z.array(path).max(20).optional(), outputFolder: z.string().max(200).default("designs") },
    handler: async (a, ctx) => {
      let has = false;
      try { await cmd(ctx, "doc.info"); has = true; } catch { has = false; }
      const assets = (a.assets ?? []).map((p) => ctx.paths.resolve(p, { mustExist: true }));
      const plan = planFromBrief(a.brief, { hasActiveDocument: has, assets, outputFolder: a.outputFolder });
      return { data: { name: plan.name, summary: plan.summary, intent: plan.brief.intent, style: plan.brief.style.id, size: plan.brief.size, assumptions: plan.assumptions, missingInputs: plan.missingInputs, steps: plan.steps }, source: "server" };
    },
  });
  tool({
    name: "create_automation_workflow", module: M, description: "Store a reusable workflow (named list of tool steps; later steps may reference {{steps.<id>.data...}} and {{vars.x}}).", annotations: WRITE, commands: [],
    input: { workflow: Workflow, overwrite },
    handler: async (a, ctx) => {
      for (const s of a.workflow.steps) if (!["execute_workflow"].includes(s.tool) && !TOOL_HANDLERS.has(s.tool)) throw new PsMcpError("VALIDATION_ERROR", `Unknown tool in step: ${s.tool}`);
      return { data: { saved: ctx.executions.saveWorkflow(a.workflow, a.overwrite), name: a.workflow.name, steps: a.workflow.steps.length }, source: "server" };
    },
  });
  tool({
    name: "list_workflows", module: M, description: "Stored workflows and built-in templates.", annotations: READ_ONLY, commands: [],
    input: {}, handler: async (_a, ctx) => ({ data: { stored: ctx.executions.listWorkflows(), templates: Object.entries(WORKFLOW_TEMPLATES).map(([k, v]) => ({ name: k, description: v.description, steps: v.steps.length })) }, source: "server" }),
  });
  tool({
    name: "execute_workflow", module: M, description: "Execute a workflow: inline steps, a stored workflow name, a built-in template, or a natural-language brief (planned then executed). Steps run in order and each result is verified; stops at the first failure. background: true returns an executionId.", annotations: WRITE, commands: [],
    input: {
      steps: z.array(WorkflowStep).max(200).optional(), name: z.string().max(120).optional(), template: z.enum(Object.keys(WORKFLOW_TEMPLATES) as [string, ...string[]]).optional(),
      brief: z.string().max(4000).optional(), assets: z.array(path).max(20).optional(), vars: z.record(z.unknown()).default({}), background: z.boolean().default(false),
    },
    handler: async (a, ctx) => {
      let steps = a.steps;
      let label = "inline";
      let plan: ReturnType<typeof planFromBrief> | undefined;
      if (a.name) { steps = ctx.executions.loadWorkflow(a.name).steps; label = a.name; }
      if (a.template) { steps = WORKFLOW_TEMPLATES[a.template]!.steps; label = a.template; }
      if (a.brief) {
        let has = false;
        try { await cmd(ctx, "doc.info"); has = true; } catch { has = false; }
        plan = planFromBrief(a.brief, { hasActiveDocument: has, assets: (a.assets ?? []).map((p) => ctx.paths.resolve(p, { mustExist: true })) });
        if (plan.missingInputs.length) throw new PsMcpError("VALIDATION_ERROR", `Missing inputs: ${plan.missingInputs.join(" ")}`, { plan: { summary: plan.summary, steps: plan.steps } });
        steps = plan.steps;
        label = `brief:${plan.name}`;
      }
      if (!steps?.length) throw new PsMcpError("VALIDATION_ERROR", "Give steps, name, template or brief");
      for (const s of steps) if (s.tool === "execute_workflow") throw new PsMcpError("VALIDATION_ERROR", "Workflows cannot call execute_workflow recursively");
      const finalSteps = steps;
      const images: { base64: string; mimeType: string }[] = [];
      const out = await launch(ctx, label, a.background, async (id) => {
        const status = ctx.executions.get(id)!;
        await runWorkflow(status, finalSteps, async (t, args) => {
          const r = await callTool(t, args, ctx);
          images.push(...(r.images ?? []));
          return r;
        }, { vars: a.vars, isCancelled: () => ctx.executions.isCancelled(id) });
        const files = status.steps.filter((s) => s.state === "ok" && s.data && typeof (s.data as { path?: string }).path === "string").map((s) => (s.data as { path: string }).path);
        return { state: status.state, files, steps: status.steps.map((s) => ({ index: s.index, tool: s.tool, description: s.description, state: s.state, error: s.error })) };
      });
      if (plan) (out.data as Record<string, unknown>).plan = { summary: plan.summary, assumptions: plan.assumptions };
      const res = (out.data as { result?: { state?: string; steps?: { index: number; tool: string; state: string; error?: { message: string } }[] } }).result;
      const failed = res?.steps?.find((s) => s.state === "failed");
      if (failed) out.warnings = [...(out.warnings ?? []), `Workflow ${res?.state}: step ${failed.index} (${failed.tool}) failed: ${failed.error?.message}`];
      out.images = images.slice(-1);
      return out;
    },
  });
  tool({
    name: "get_execution_status", module: M, description: "Status of a workflow/batch execution (per-step states), or all recent executions when id is omitted.", annotations: READ_ONLY, commands: [],
    input: { id: z.string().max(100).optional() },
    handler: async (a, ctx) => {
      if (!a.id) return { data: { executions: ctx.executions.list().slice(0, 25), bridge: ctx.bridge.status(), recentOperations: ctx.bridge.recent(10) }, source: "server" };
      const s = ctx.executions.get(a.id);
      if (!s) throw new PsMcpError("VALIDATION_ERROR", `Unknown execution ${a.id}`);
      const { cancel: _c, ...rest } = s as typeof s & { abort?: unknown };
      delete (rest as { abort?: unknown }).abort;
      return { data: rest, source: "server" };
    },
  });
  tool({
    name: "cancel_execution", module: M, description: "Cancel a running execution: no further steps/files start; the Photoshop command in flight finishes or is completes (ExtendScript cannot be interrupted).", annotations: WRITE, commands: [],
    input: { id: z.string().max(100) }, handler: async (a, ctx) => ({ data: { id: a.id, cancelled: ctx.executions.cancel(a.id) }, source: "server" }),
  });
}


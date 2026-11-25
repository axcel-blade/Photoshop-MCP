import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPreset, parseBrief, planFromBrief, resolvePlaceholders, runWorkflow, type ExecutionStatus, type StepResult } from "../../src/workflow-engine/index.js";
import { samplePng, setup } from "../helpers.js";

describe("brief parsing & planning", () => {
  it("parses the luxury perfume brief", () => {
    const b = parseBrief('Create a luxury perfume advertisement "Noir Absolu". Remove the original background, place the perfume on a black marble surface, add golden lighting, create realistic reflections, add elegant typography and export the final image as a 4K PNG.', getPreset);
    expect(b.intent).toBe("product_ad");
    expect(b.style.id).toBe("luxury");
    expect(b.texts.headline).toBe("Noir Absolu");
    expect(b.wants).toMatchObject({ removeBackground: true, reflection: true, glow: true, surface: "marble" });
    expect(b.outputs).toEqual([{ format: "png", width: 3840 }]);
  });

  it("explicit dimensions and presets", () => {
    expect(parseBrief("youtube thumbnail for my gaming video", getPreset).size).toMatchObject({ width: 1280, height: 720 });
    expect(parseBrief("a 1500x500 banner", getPreset).size).toMatchObject({ width: 1500, height: 500 });
  });

  it("plans ordered steps and reports missing inputs", () => {
    const plan = planFromBrief('luxury perfume advertisement "Noir" export 4k png', { hasActiveDocument: false });
    expect(plan.missingInputs[0]).toMatch(/product photo/);
    const tools = plan.steps.map((s) => s.tool);
    expect(tools[0]).toBe("inspect_document");
    expect(tools.indexOf("create_document")).toBeLessThan(tools.indexOf("add_text"));
    expect(tools.slice(-3)).toEqual(["validate_document", "save_document_as", "export_document"]);
  });
});

describe("runner", () => {
  it("resolves placeholders keeping types", () => {
    const steps = new Map<string, StepResult>([["a", { index: 0, tool: "x", state: "ok", data: { layer: { id: 42, name: "L" } } }]]);
    expect(resolvePlaceholders({ layer: { id: "{{steps.a.data.layer.id}}" }, label: "n={{steps.a.data.layer.name}}", v: "{{vars.q}}" }, steps, { q: 7 })).toEqual({ layer: { id: 42 }, label: "n=L", v: 7 });
  });

  it("stops at the first failure and supports continueOnError and cancellation", async () => {
    const st = (): ExecutionStatus => ({ id: "1", workflow: "w", state: "queued", createdAt: "", steps: [] });
    const exec = async (tool: string) => { if (tool === "bad") throw new Error("boom"); return { data: { tool } }; };
    const failed = await runWorkflow(st(), [{ tool: "ok", args: {}, continueOnError: false }, { tool: "bad", args: {}, continueOnError: false }, { tool: "ok", args: {}, continueOnError: false }], exec);
    expect(failed.state).toBe("failed");
    expect(failed.steps.map((s) => s.state)).toEqual(["ok", "failed", "skipped"]);
    const partial = await runWorkflow(st(), [{ tool: "bad", args: {}, continueOnError: true }, { tool: "ok", args: {}, continueOnError: false }], exec);
    expect(partial.state).toBe("partial");
    let n = 0;
    const cancelled = await runWorkflow(st(), [{ tool: "ok", args: {}, continueOnError: false }, { tool: "ok", args: {}, continueOnError: false }], exec, { isCancelled: () => n++ > 0 });
    expect(cancelled.state).toBe("cancelled");
  });
});

describe("workflow tools (mock Photoshop)", () => {
  let t: Awaited<ReturnType<typeof setup>>;
  beforeAll(async () => { t = await setup(); });
  afterAll(async () => t.close());

  it("execute_workflow from a brief produces PSD + exports", async () => {
    const product = samplePng(t.dir, "perfume.png");
    const r = await t.call("execute_workflow", { brief: 'luxury perfume advertisement "Noir Absolu" remove the background, golden lighting, reflections, export as 4K PNG', assets: [product] });
    expect(r.ok).toBe(true);
    expect(r.data.result.state).toBe("partial"); // inspect_document fails (no doc yet) and is allowed to
    expect(r.data.result.files.some((f: string) => f.endsWith(".psd"))).toBe(true);
    expect(r.data.result.files.some((f: string) => f.endsWith("-3840.png"))).toBe(true);
  });

  it("stores, lists and runs a custom workflow with step references", async () => {
    const wf = { name: "two-layers", steps: [
      { id: "doc", tool: "create_document", args: { width: 300, height: 300 } },
      { id: "l", tool: "create_layer", args: { name: "First" } },
      { tool: "rename_layer", args: { layer: { id: "{{steps.l.data.layer.id}}" }, name: "{{vars.title}}" } },
    ] };
    expect((await t.call("create_automation_workflow", { workflow: wf })).ok).toBe(true);
    expect((await t.call("list_workflows")).data.stored).toContain("two-layers");
    const r = await t.call("execute_workflow", { name: "two-layers", vars: { title: "Renamed" } });
    expect(r.data.result.state).toBe("succeeded");
    const layers = await t.call("get_layers");
    expect(layers.data.layers.map((l: { name: string }) => l.name)).toContain("Renamed");
  });

  it("background batch + status + cancel", async () => {
    for (let i = 0; i < 3; i++) samplePng(t.dir, `batch/in${i}.png`.replace("batch/", ""));
    const start = await t.call("resize_batch", { folder: ".", width: 50, outputFolder: "resized", background: true, format: "png" });
    const id = start.data.executionId;
    expect(id).toBeTruthy();
    let status;
    for (let i = 0; i < 50; i++) {
      status = (await t.call("get_execution_status", { id })).data;
      if (status.state !== "running" && status.state !== "queued") break;
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(["succeeded", "partial"]).toContain(status.state);
    expect(status.result.succeeded).toBeGreaterThanOrEqual(3);
    expect((await t.call("cancel_execution", { id })).data.cancelled).toBe(false);
  });

  it("rejects batch steps that could recurse", async () => {
    samplePng(t.dir, "r.png");
    const r = await t.call("batch_process", { files: ["r.png"], outputFolder: "o", steps: [{ tool: "batch_process", args: {} }] });
    expect(r.isError).toBe(true);
    expect(r.error.code).toBe("VALIDATION_ERROR");
  });
});

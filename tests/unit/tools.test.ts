import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { customShapePoints } from "../../src/mcp/tools/shapes.js";
import { interpretStats } from "../../src/mcp/tools/ai.js";
import { samplePng, setup } from "../helpers.js";

let t: Awaited<ReturnType<typeof setup>>;
beforeAll(async () => { t = await setup(); });
afterAll(async () => t.close());

describe("document operations", () => {
  it("create → info → resize → canvas → save as → close", async () => {
    const c = await t.call("create_document", { name: "Doc", width: 800, height: 600, resolution: 300 });
    expect(c.data.document).toMatchObject({ width: 800, height: 600, resolution: 300 });
    expect((await t.call("resize_document", { width: 400 })).data.document).toMatchObject({ width: 400, height: 300 });
    expect((await t.call("resize_canvas", { width: 500, height: 500 })).data.document).toMatchObject({ width: 500, height: 500 });
    const s = await t.call("save_document_as", { path: "out/doc.psd" });
    expect(s.ok).toBe(true);
    expect(existsSync(join(t.dir, "out", "doc.psd"))).toBe(true);
    const again = await t.call("save_document_as", { path: "out/doc.psd" });
    expect(again.isError).toBe(true);
    expect(again.error.code).toBe("FILE_EXISTS");
    const closeNoSave = await t.call("close_document", { save: "no" });
    expect(closeNoSave.error.code).toBe("CONFIRMATION_REQUIRED");
    expect((await t.call("close_document", { save: "no", confirm: true })).ok).toBe(true);
  });

  it("reports NO_ACTIVE_DOCUMENT honestly", async () => {
    const r = await t.call("get_document_info");
    expect(r.isError).toBe(true);
    expect(r.error.code).toBe("NO_ACTIVE_DOCUMENT");
  });
});

describe("layer operations", () => {
  it("create, rename, move, reorder, props, group, delete", async () => {
    await t.call("create_document", { width: 400, height: 400 });
    const a = (await t.call("create_layer", { name: "A" })).data.layer;
    const b = (await t.call("create_layer", { name: "B", fill: "#FF0000" })).data.layer;
    expect((await t.call("rename_layer", { layer: { id: a.id }, name: "Alpha" })).data.layer.name).toBe("Alpha");
    const moved = (await t.call("move_layer", { layer: { id: a.id }, dx: 10, dy: 5 })).data.layer;
    expect(moved.bounds.left).toBe(10);
    await t.call("reorder_layers", { layer: { id: a.id }, position: "top" });
    expect((await t.call("set_layer_opacity", { layer: { id: b.id }, opacity: 40 })).data.layer.opacity).toBe(40);
    expect((await t.call("set_blend_mode", { layer: { id: b.id }, blendMode: "multiply" })).data.layer.blendMode).toBe("multiply");
    expect((await t.call("hide_layer", { layer: { id: b.id } })).data.layer.visible).toBe(false);
    const g = await t.call("group_layers", { layers: [{ id: a.id }, { id: b.id }], name: "G" });
    expect(g.data.members).toEqual([a.id, b.id]);
    expect((await t.call("delete_layer", { layer: { id: a.id } })).error.code).toBe("CONFIRMATION_REQUIRED");
    expect((await t.call("delete_layer", { layer: { id: a.id }, confirm: true })).data.deleted).toEqual([a.id]);
    const bounds = await t.call("get_layer_bounds", { layer: { id: b.id } });
    expect(bounds.data.bounds.width).toBe(400);
    const missing = await t.call("get_layer_info", { layer: { name: "Nope" } });
    expect(missing.error.code).toBe("LAYER_NOT_FOUND");
  });
});

describe("text operations", () => {
  it("add, edit, style, replace across layers", async () => {
    await t.call("create_document", { width: 1000, height: 500 });
    const h = (await t.call("add_text", { text: "Hello World", x: 500, y: 250, size: 80, alignment: "center", color: "#112233" })).data.layer;
    expect(h.kind).toBe("text");
    expect(h.text.contents).toBe("Hello World");
    await t.call("add_text", { text: "Hello again", x: 10, y: 400 });
    const rep = await t.call("replace_text", { find: "Hello", replace: "Hi" });
    expect(rep.data.changed.length).toBe(2);
    expect((await t.call("set_font_size", { layer: { id: h.id }, size: 120 })).data.layers[0].text.size).toBe(120);
    const fx = await t.call("create_text_shadow", { layer: { id: h.id } });
    expect(fx.data.effects).toContain("dropShadow");
    const bad = await t.call("add_text", { text: "x", x: 0, y: 0, color: "red" });
    expect(bad.isError).toBe(true);
  });
});

describe("shapes & design", () => {
  it("custom shapes produce valid polygons", () => {
    const b = { left: 0, top: 0, right: 100, bottom: 100 };
    expect(customShapePoints("star", b, { points: 5 })).toHaveLength(10);
    expect(customShapePoints("triangle", b)).toEqual([{ x: 50, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]);
    for (const s of ["heart", "arrow", "diamond", "hexagon", "octagon", "speech_bubble", "burst"]) {
      for (const p of customShapePoints(s, b)) {
        expect(p.x).toBeGreaterThanOrEqual(-0.01);
        expect(p.x).toBeLessThanOrEqual(100.01);
      }
    }
  });

  it("generate_design plans, builds, verifies and previews (Illustrator-MCP design engine)", async () => {
    const g = await t.call("generate_design", { brief: 'luxury skincare poster headline "PURE BEAUTY" cta "Shop now"' });
    expect(g.ok).toBe(true);
    expect(g.data.planId).toBeTruthy();
    expect(g.data.verification.missing).toEqual([]);
    expect(g.images).toHaveLength(1);
    const c = await t.call("critique_design", {});
    expect(c.data.verifiedAnalysis.score).toBeGreaterThanOrEqual(0);
    const r2 = await t.call("revise_design", { planId: g.data.planId, instructions: "make the headline bigger" });
    expect(r2.data.applied).toContain("make the headline bigger");
    const k = await t.call("search_design_knowledge", { domain: "product", query: "skincare" });
    expect(k.ok).toBe(true);
  });

  it("create_banner builds an editable layer stack", async () => {
    const r = await t.call("create_banner", { headline: "Summer Fest", subhead: "July 12", cta: "Get tickets", style: "playful" });
    expect(r.ok).toBe(true);
    const tools = r.data.steps.map((s: { tool: string }) => s.tool);
    expect(tools).toEqual(expect.arrayContaining(["create_document", "create_gradient", "add_text", "create_rectangle"]));
    expect(r.data.steps.every((s: { state: string }) => s.state === "ok")).toBe(true);
  });

  it("create_pattern selects many cells and fills one layer", async () => {
    await t.call("create_document", { width: 200, height: 200 });
    const r = await t.call("create_pattern", { kind: "dots", spacing: 50, size: 10 });
    expect(r.data.cells).toBe(16);
  });
});

describe("image operations", () => {
  it("place, metadata, dimensions, convert", async () => {
    const png = samplePng(t.dir, "in.png", 12, 7);
    const meta = await t.call("get_image_metadata", { path: png });
    expect(meta.data).toMatchObject({ format: "png", width: 12, height: 7 });
    expect(meta.source).toBe("server");
    await t.call("create_document", { width: 400, height: 400 });
    const placed = await t.call("place_image", { path: png, x: 0, y: 0, width: 100, height: 100 });
    expect(placed.data.layer.kind).toBe("smartObject");
    const conv = await t.call("convert_image", { input: png, output: "conv/out.jpg", format: "jpg" });
    expect(conv.ok).toBe(true);
    expect(existsSync(join(t.dir, "conv", "out.jpg"))).toBe(true);
    expect((await t.call("crop_image", { bounds: { left: 0, top: 0, right: 10, bottom: 10 } })).error.code).toBe("CONFIRMATION_REQUIRED");
  });
});

describe("selection, masks, retouch, color", () => {
  it("remove_background = select subject + mask", async () => {
    await t.call("open_document", { path: samplePng(t.dir, "photo.png") });
    const r = await t.call("remove_background");
    expect(r.ok).toBe(true);
    expect(r.data.steps.map((s: { step: string }) => s.step)).toEqual(["target layer", "select subject", "mask background", "deselect"]);
  });

  it("adjustments are adjustment layers; exposure correction is computed from measured stats", async () => {
    const a = await t.call("adjust_levels", { inputBlack: 10, inputWhite: 240 });
    expect(a.data.layer.kind).toBe("adjustment");
    const e = await t.call("correct_exposure", {});
    const L = e.data.measured.meanLuminance;
    expect(L).toBeGreaterThan(0.3); // decoded from the mock PNG sample, not a canned number
    expect(e.data.exposureStops).toBeCloseTo(Math.log2(0.46 / L), 1);
  });

  it("content-aware tools refuse without pixel layer issues hidden", async () => {
    const r = await t.call("remove_object", { region: { shape: "rect", bounds: { left: 1, top: 1, right: 5, bottom: 5 } } });
    expect(r.ok).toBe(true);
    expect(r.data.steps.map((s: { step: string }) => s.step)).toContain("content-aware fill");
  });

  it("unsupported features say so with an alternative", async () => {
    const r = await t.call("apply_liquify");
    expect(r.isError).toBe(true);
    expect(r.error.code).toBe("UNSUPPORTED_OPERATION");
    expect(r.error.details.alternative).toBeTruthy();
    const g = await t.call("generate_image", { prompt: "a cat on a roof" });
    expect(g.error.code).toBe("PROVIDER_NOT_CONFIGURED");
  });

  it("image analysis interpretation cites measured numbers", () => {
    const r = interpretStats({ mean: { r: 160, g: 120, b: 90 }, luminance: { mean: 0.2, stdev: 0.1, p1: 0, p99: 0.6 }, saturationMean: 0.3, clipping: { shadows: 0, highlights: 0 }, palette: [] });
    expect(r.findings.join(" ")).toMatch(/Underexposed: mean luminance 0.20/);
    expect(r.suggestions.map((s) => s.tool)).toEqual(expect.arrayContaining(["correct_exposure", "correct_white_balance", "adjust_curves"]));
  });
});

describe("export operations", () => {
  it("exports formats, sizes and a delivery package with manifest", async () => {
    await t.call("create_document", { name: "Deliver", width: 1200, height: 800 });
    await t.call("add_text", { text: "Title", x: 600, y: 400, size: 60 });
    for (const [tool, file] of [["export_png", "x/a.png"], ["export_jpeg", "x/a.jpg"], ["export_webp", "x/a.webp"], ["export_tiff", "x/a.tif"], ["export_pdf", "x/a.pdf"], ["export_psd", "x/a.psd"]] as const) {
      const r = await t.call(tool, { path: file });
      expect(r.ok, tool).toBe(true);
    }
    const wrongExt = await t.call("export_png", { path: "x/a.jpg" });
    expect(wrongExt.error.code).toBe("VALIDATION_ERROR");
    const sizes = await t.call("export_multiple_sizes", { folder: "sizes", baseName: "hero", format: "png", sizes: [{ width: 600 }, { width: 300, suffix: "-small" }] });
    expect(sizes.data.files).toHaveLength(2);
    const pkg = await t.call("create_delivery_package", { folder: "delivery", name: "client", formats: ["png", "jpg"], sizes: [600] });
    expect(pkg.ok).toBe(true);
    const manifest = JSON.parse(readFileSync(pkg.data.manifest, "utf8"));
    expect(manifest.files.length).toBe(5);
    const preview = await t.call("capture_preview", { maxSize: 256 });
    expect(preview.images).toHaveLength(1);
  });
});

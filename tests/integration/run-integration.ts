/**
 * Integration test against a REAL Photoshop (COM on Windows, AppleScript on macOS). Not part of `pnpm test`.
 *   pnpm test:integration        (Photoshop is launched if needed unless PHOTOSHOP_AUTO_LAUNCH=false)
 * Every step talks to Photoshop through the same tools an MCP client uses and checks the result.
 * Output files go to output/integration-<timestamp>/. A step marked FAIL names the Photoshop error.
 */
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, loadDotEnv } from "../../src/config/index.js";
import { createContext } from "../../src/server.js";
import { defineAllTools } from "../../src/mcp/tools/index.js";
import { callTool } from "../../src/mcp/tools/registry.js";
import { configureLogger } from "../../src/utils/logger.js";

loadDotEnv();
configureLogger({ level: "warn" });
const config = loadConfig({ ...process.env, PHOTOSHOP_ADAPTER: process.env.PHOTOSHOP_ADAPTER ?? "auto" }, ["node", "x"]);
const ctx = createContext(config);
defineAllTools();

const outDir = `integration-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const results: { step: string; ok: boolean; ms: number; note?: string }[] = [];
let lastLayer: number | undefined;

async function step(name: string, tool: string, args: Record<string, unknown>, check?: (data: any) => string | void) {
  const t0 = Date.now();
  try {
    const out = await callTool(tool, args, ctx);
    const note = check?.(out.data);
    const id = (out.data as { layer?: { id?: number } })?.layer?.id;
    if (id) lastLayer = id;
    results.push({ step: name, ok: !note, ms: Date.now() - t0, note: note ?? (out.warnings?.length ? out.warnings.join("; ") : undefined) });
    return out.data as any;
  } catch (e) {
    results.push({ step: name, ok: false, ms: Date.now() - t0, note: `${(e as { code?: string }).code ?? ""} ${(e as Error).message}` });
    return undefined;
  }
}
const file = (n: string) => join(config.outputDir, outDir, n);
const exists = (n: string) => () => (existsSync(file(n)) && statSync(file(n)).size > 0 ? undefined : `${n} not written`);

async function main() {
  console.log("Adapter:", ctx.bridge.adapterName, (await ctx.bridge.detect()).notes.join(" "));

  await step("status", "photoshop_status", { probe: true }, (d) => (d.application ? undefined : "no Photoshop info"));
  await step("create document", "create_document", { name: "MCP Integration", width: 1200, height: 800, resolution: 72 }, (d) => (d.document.width === 1200 ? undefined : "wrong width"));
  await step("gradient fill layer", "create_gradient", { name: "BG", gradient: { type: "linear", angle: 90, stops: [{ color: "#0B1020", location: 0 }, { color: "#1E1B4B", location: 100 }] } }, (d) => (d.layer.kind === "gradientFill" ? undefined : `kind ${d.layer.kind}`));
  await step("rectangle shape", "create_rectangle", { name: "Card", bounds: { left: 100, top: 100, right: 600, bottom: 400 }, fill: "#22D3EE", radius: 24, stroke: { color: "#FFFFFF", width: 4, position: "inside" } });
  await step("ellipse shape", "create_ellipse", { name: "Orb", bounds: { left: 700, top: 150, right: 1000, bottom: 450 }, fill: "#A855F7" });
  await step("custom star", "create_custom_shape", { shape: "star", bounds: { left: 800, top: 500, right: 1000, bottom: 700 }, fill: "#FACC15" });
  await step("text layer", "add_text", { name: "Title", text: "Photoshop MCP", x: 600, y: 650, size: 72, font: "Arial-BoldMT", color: "#FFFFFF", alignment: "center" }, (d) => (d.layer.kind === "text" ? undefined : "not text"));
  const titleId = lastLayer;
  await step("edit text", "edit_text", { layer: { id: titleId }, text: "Photoshop MCP ✓" });
  await step("text shadow", "create_text_shadow", { layer: { id: titleId } }, (d) => (d.effects?.includes("dropShadow") ? undefined : "no dropShadow"));
  await step("gradient text", "create_gradient_text", { layer: { id: titleId }, gradient: { type: "linear", angle: 0, stops: [{ color: "#F7E7A1", location: 0 }, { color: "#B8860B", location: 100 }] } });
  await step("pixel layer + fill", "create_layer", { name: "Pixels", fill: "#808080" });
  const pixelId = lastLayer;
  await step("noise filter (smart)", "apply_noise", { layer: { id: pixelId }, amount: 4 });
  const smartId = lastLayer; // converting to a smart object creates a new layer id
  await step("gaussian blur (smart)", "apply_gaussian_blur", { layer: { id: smartId }, radius: 3 });
  await step("opacity/blend", "set_layer_opacity", { layer: { id: smartId }, opacity: 20 });
  await step("levels adjustment", "adjust_levels", { inputBlack: 5, inputWhite: 245 }, (d) => (d.layer ? undefined : "no layer"));
  await step("curves adjustment", "adjust_curves", { points: [{ input: 0, output: 0 }, { input: 128, output: 140 }, { input: 255, output: 255 }] });
  await step("hue/sat adjustment", "adjust_saturation", { saturation: 10 });
  await step("cinematic grade", "apply_cinematic_color_grade", { style: "teal_orange", strength: 50 });
  await step("rect selection", "select_rectangle", { bounds: { left: 10, top: 10, right: 200, bottom: 200 } }, (d) => (d.hasSelection ? undefined : "no selection"));
  await step("feather", "feather_selection", { radius: 5 });
  await step("selection info", "get_selection_info", {}, (d) => (d.hasSelection ? undefined : "lost selection"));
  await step("deselect", "deselect", {});
  await step("analyze", "ai_image_analysis", { includePreview: false }, (d) => (typeof d.measured?.luminance?.mean === "number" ? undefined : "no stats"));
  await step("preview", "capture_preview", { maxSize: 512 }, (d) => (d.width > 0 ? undefined : "empty preview"));
  await step("validate", "validate_document", {});
  await step("history", "get_history", {}, (d) => (d.states.length > 5 ? undefined : "short history"));
  await step("save PSD", "save_document_as", { path: file("integration.psd"), format: "psd" }, exists("integration.psd"));
  await step("export PNG", "export_png", { path: file("integration.png") }, exists("integration.png"));
  await step("export JPEG resized", "export_jpeg", { path: file("integration-600.jpg"), width: 600, quality: 9 }, exists("integration-600.jpg"));
  await step("export WebP", "export_webp", { path: file("integration.webp") }, exists("integration.webp"));
  await step("export TIFF", "export_tiff", { path: file("integration.tif") }, exists("integration.tif"));
  await step("generate design (design engine)", "generate_design", { brief: 'minimal poster headline "INTEGRATION" cta "Go"', preview: true }, (d) => (d.verification?.missing?.length === 0 ? undefined : "missing elements"));
  await step("critique design", "critique_design", {}, (d) => (typeof d.verifiedAnalysis?.score === "number" ? undefined : "no score"));
  await step("close design", "close_document", { save: "no", confirm: true });
  await step("undo", "undo", { steps: 1 });
  await step("close", "close_document", { save: "no", confirm: true });

  const pad = Math.max(...results.map((r) => r.step.length));
  for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.step.padEnd(pad)}  ${String(r.ms).padStart(6)} ms  ${r.note ?? ""}`);
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} steps passed against Photoshop via ${ctx.bridge.adapterName}. Files: ${join(config.outputDir, outDir)}`);
  process.exit(failed ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  process.exit(1);
});

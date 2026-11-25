import { z } from "zod";
import { cmd, READ_ONLY, tool, WRITE, type ToolContext } from "./registry.js";
import { doc } from "./args.js";

const M = "history_inspection";

type LayerSummary = { id: number; name: string; kind: string; visible: boolean; bounds: { left: number; top: number; right: number; bottom: number; width: number; height: number }; text?: { contents: string; font: string; fontAvailable?: boolean } };

export async function validateDocument(ctx: ToolContext, d?: unknown) {
  const info = await cmd(ctx, "doc.info", { doc: d });
  const docInfo = (info.data as { document: { width: number; height: number; mode: string; bitDepth: number; resolution: number } }).document;
  const list = await cmd(ctx, "layer.list", { doc: d });
  const layers = (list.data as { layers: LayerSummary[] }).layers;
  const errors: string[] = [];
  const warnings: string[] = [];
  for (const l of layers) {
    if (l.kind === "text" && l.text && !l.text.contents.trim()) errors.push(`Empty text layer "${l.name}" (${l.id}).`);
    if (l.kind === "text" && l.text?.fontAvailable === false) errors.push(`Missing font ${l.text.font} in "${l.name}".`);
    if (l.kind !== "group" && l.kind !== "adjustment" && (l.bounds.width === 0 || l.bounds.height === 0) && l.kind !== "solidColor" && l.kind !== "gradientFill") warnings.push(`Empty layer "${l.name}" (${l.id}).`);
    if (l.bounds.width > 0 && (l.bounds.right <= 0 || l.bounds.bottom <= 0 || l.bounds.left >= docInfo.width || l.bounds.top >= docInfo.height)) warnings.push(`Layer "${l.name}" is entirely outside the canvas.`);
    if (!l.visible) warnings.push(`Hidden layer "${l.name}" will not export.`);
  }
  if (layers.length === 0) errors.push("Document has no layers.");
  return { valid: errors.length === 0, errors, warnings, document: docInfo, layerCount: layers.length };
}

export function registerInspectionTools(): void {
  tool({ name: "undo", module: M, description: "Step backward in history (1-50 steps).", annotations: WRITE, commands: ["ps.undo"], input: { doc, steps: z.number().int().min(1).max(50).default(1) }, handler: (a, ctx) => cmd(ctx, "ps.undo", a) });
  tool({ name: "redo", module: M, description: "Step forward in history.", annotations: WRITE, commands: ["ps.redo"], input: { doc, steps: z.number().int().min(1).max(50).default(1) }, handler: (a, ctx) => cmd(ctx, "ps.redo", a) });
  tool({ name: "get_history", module: M, description: "History states of the document and the current state index.", annotations: READ_ONLY, commands: ["ps.history"], input: { doc }, handler: (a, ctx) => cmd(ctx, "ps.history", a) });
  tool({ name: "get_active_tool", module: M, description: "The tool currently selected in the Photoshop toolbar.", annotations: READ_ONLY, commands: ["ps.activeTool"], input: {}, handler: (_a, ctx) => cmd(ctx, "ps.activeTool") });
  tool({
    name: "get_document_state", module: M, description: "Document info + selection + history position + selected layers in one call.", annotations: READ_ONLY, commands: ["doc.info", "ps.history", "layer.list"],
    input: { doc }, handler: async (a, ctx) => {
      const [info, hist, sel] = [await cmd(ctx, "doc.info", a), await cmd(ctx, "ps.history", a), await cmd(ctx, "layer.list", { ...a, selectedOnly: true })];
      const h = hist.data as { states: unknown[]; current: number };
      return { data: { ...(info.data as object), history: { count: h.states.length, current: h.current, currentState: h.states[h.current] }, selectedLayers: (sel.data as { layers: unknown[] }).layers } };
    },
  });
  tool({
    name: "get_canvas_info", module: M, description: "Canvas width, height, resolution, physical print size, mode and bit depth.", annotations: READ_ONLY, commands: ["doc.info"],
    input: { doc }, handler: async (a, ctx) => {
      const d = ((await cmd(ctx, "doc.info", a)).data as { document: { width: number; height: number; resolution: number; mode: string; bitDepth: number } }).document;
      return { data: { width: d.width, height: d.height, resolution: d.resolution, printInches: { width: +(d.width / d.resolution).toFixed(2), height: +(d.height / d.resolution).toFixed(2) }, aspect: +(d.width / d.height).toFixed(4), mode: d.mode, bitDepth: d.bitDepth } };
    },
  });
  tool({ name: "get_selected_layers", module: M, description: "Layers currently selected in the Layers panel.", annotations: READ_ONLY, commands: ["layer.list"], input: { doc }, handler: (a, ctx) => cmd(ctx, "layer.list", { ...a, selectedOnly: true }) });
  tool({
    name: "get_selected_objects", module: M, description: "Selected layers plus the active pixel selection bounds.", annotations: READ_ONLY, commands: ["layer.list", "select.info"],
    input: { doc }, handler: async (a, ctx) => ({ data: { layers: ((await cmd(ctx, "layer.list", { ...a, selectedOnly: true })).data as { layers: unknown[] }).layers, selection: (await cmd(ctx, "select.info", a)).data } }),
  });
  tool({ name: "get_document_colors", module: M, description: "Dominant colors of the composite (measured by Photoshop, quantized) with their share.", annotations: READ_ONLY, commands: ["doc.colors"], input: { doc, count: z.number().int().min(2).max(16).default(8) }, handler: (a, ctx) => cmd(ctx, "doc.colors", a) });
  tool({
    name: "inspect_document", module: M, description: "Complete snapshot: document info, full layer tree, selection. Start here before editing.", annotations: READ_ONLY, commands: ["doc.info", "layer.list", "select.info"],
    input: { doc }, handler: async (a, ctx) => {
      const info = await cmd(ctx, "doc.info", a);
      const layers = await cmd(ctx, "layer.list", a);
      const sel = await cmd(ctx, "select.info", a);
      return { data: { ...(info.data as object), layers: (layers.data as { layers: unknown[] }).layers, selection: sel.data } };
    },
  });
  tool({
    name: "capture_preview", module: M, description: "Render a JPEG/PNG preview of the composite (or one layer) and return it as an image so the AI can see the result.", annotations: READ_ONLY, commands: ["ps.preview"],
    input: { doc, layer: z.object({ id: z.number().int().positive() }).optional(), maxSize: z.number().int().min(64).max(2048).default(1024), format: z.enum(["jpeg", "png"]).default("jpeg") },
    handler: async (a, ctx) => {
      const out = await cmd(ctx, "ps.preview", a);
      const r = out.data as { base64: string; mimeType: string; width: number; height: number; sourceWidth?: number; sourceHeight?: number };
      return { data: { width: r.width, height: r.height, sourceWidth: r.sourceWidth, sourceHeight: r.sourceHeight, mimeType: r.mimeType }, images: [{ base64: r.base64, mimeType: r.mimeType }], warnings: out.warnings };
    },
  });
  tool({ name: "validate_document", module: M, description: "Pre-delivery checks: empty or missing-font text, empty/off-canvas/hidden layers.", annotations: READ_ONLY, commands: ["doc.info", "layer.list"], input: { doc }, handler: async (a, ctx) => ({ data: await validateDocument(ctx, a.doc) }) });
}

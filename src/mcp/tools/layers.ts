import { z } from "zod";
import { LayerRef } from "../../schemas/index.js";
import { cmd, DESTRUCTIVE, READ_ONLY, requireConfirm, tool, WRITE } from "./registry.js";
import { blend, color, confirm, doc, layer, name, opacity } from "./args.js";
import { PsMcpError } from "../../utils/errors.js";
import { alignMoves, distributeMoves, unionBox, type Box, type Item, type Move } from "../../utils/align.js";
import type { ToolContext, ToolOutput } from "./registry.js";

const M = "layers";
const layers = z.array(LayerRef).min(1).max(500);

export function registerLayerTools(): void {
  tool({
    name: "get_layers", module: M, description: "Layer tree top-to-bottom: id, name, kind, visibility, opacity, blend mode, lock, bounds, masks, text summary.", annotations: READ_ONLY, commands: ["layer.list"],
    input: { doc, includeHidden: z.boolean().default(true) }, handler: (a, ctx) => cmd(ctx, "layer.list", a),
  });
  tool({ name: "get_layer_info", module: M, description: "Full info for one layer (text, effects, mask state).", annotations: READ_ONLY, commands: ["layer.info"], input: { doc, layer }, handler: (a, ctx) => cmd(ctx, "layer.info", a) });
  tool({
    name: "create_layer", module: M, description: "Create an empty pixel layer or a group; optionally fill it with a color.", annotations: WRITE, commands: ["layer.create", "layer.fill"],
    input: { doc, name, kind: z.enum(["pixel", "group"]).default("pixel"), fill: color.optional(), blendMode: blend, opacity },
    handler: async (a, ctx) => {
      const out = await cmd(ctx, "layer.create", { doc: a.doc, name: a.name, kind: a.kind, blendMode: a.blendMode, opacity: a.opacity });
      if (a.fill && a.kind === "pixel") {
        const id = (out.data as { layer: { id: number } }).layer.id;
        const f = await cmd(ctx, "layer.fill", { doc: a.doc, layer: { id }, color: a.fill });
        return { data: f.data, warnings: [...(out.warnings ?? []), ...(f.warnings ?? [])] };
      }
      return out;
    },
  });
  tool({
    name: "delete_layer", module: M, description: "Delete layer(s). Requires confirm: true.", annotations: DESTRUCTIVE, commands: ["layer.delete"],
    input: { doc, layer, layers: layers.optional(), confirm },
    handler: (a, ctx) => {
      requireConfirm(a.confirm, "Deleting layers");
      return cmd(ctx, "layer.delete", { doc: a.doc, layer: a.layer, layers: a.layers });
    },
  });
  tool({ name: "duplicate_layer", module: M, description: "Duplicate a layer (above the original).", annotations: WRITE, commands: ["layer.duplicate"], input: { doc, layer, name }, handler: (a, ctx) => cmd(ctx, "layer.duplicate", a) });
  tool({ name: "rename_layer", module: M, description: "Rename a layer.", annotations: WRITE, commands: ["layer.rename"], input: { doc, layer, name: z.string().min(1).max(255) }, handler: (a, ctx) => cmd(ctx, "layer.rename", a) });
  tool({
    name: "move_layer", module: M, description: "Move a layer's pixels: relative (dx, dy) or so its bounds' top-left lands at (x, y).", annotations: WRITE, commands: ["layer.translate"],
    input: { doc, layer, dx: z.number().optional(), dy: z.number().optional(), x: z.number().optional(), y: z.number().optional() },
    handler: (a, ctx) => cmd(ctx, "layer.translate", a),
  });
  tool({
    name: "align_layers", module: M,
    description: "Align layers (or groups) by an edge or center: to the canvas, to the bounding box of the layers themselves (default for 2+ layers), or to a reference layer. Moves only; sizes and order are untouched.",
    annotations: WRITE, commands: ["layer.list", "doc.info", "layer.translateMany"],
    input: {
      doc, layers,
      align: z.enum(["left", "centerHorizontal", "right", "top", "centerVertical", "bottom"]),
      to: z.enum(["canvas", "layers", "reference"]).optional().describe("Default: canvas for one layer, layers (their combined bounds) for several"),
      reference: LayerRef.optional().describe("Key layer to align to (with to: reference); it does not move"),
      margin: z.number().min(0).default(0).describe("Inset from the target edge (edge alignments only)"),
    },
    handler: async (a, ctx) => {
      const to = a.to ?? (a.reference ? "reference" : a.layers.length > 1 ? "layers" : "canvas");
      const all = await listItems(ctx, a.doc);
      const items = resolve(all, a.layers);
      let target: Box;
      if (to === "canvas") target = await canvasBox(ctx, a.doc);
      else if (to === "reference") {
        if (!a.reference) throw new PsMcpError("VALIDATION_ERROR", "to: reference needs a reference layer");
        target = resolve(all, [a.reference])[0]!.bounds;
      } else target = unionBox(items);
      const refId = to === "reference" && a.reference ? resolve(all, [a.reference])[0]!.id : undefined;
      return applyMoves(ctx, a.doc, alignMoves(items.filter((i) => i.id !== refId), a.align, target, a.margin), { align: a.align, to, target });
    },
  });
  tool({
    name: "distribute_layers", module: M,
    description: "Space layers evenly along an axis (keeping their order on it): equal gaps or equal center distances between the outermost layers, or a fixed gap starting from the first layer.",
    annotations: WRITE, commands: ["layer.list", "layer.translateMany"],
    input: {
      doc, layers: z.array(LayerRef).min(2).max(500),
      axis: z.enum(["horizontal", "vertical"]),
      by: z.enum(["gaps", "centers"]).default("gaps"),
      spacing: z.number().min(0).optional().describe("Fixed gap in px between neighbours; the first layer stays put"),
    },
    handler: async (a, ctx) => {
      const items = resolve(await listItems(ctx, a.doc), a.layers);
      if (a.spacing === undefined && items.length < 3) throw new PsMcpError("VALIDATION_ERROR", "Even distribution needs 3+ layers (or give spacing for 2)");
      return applyMoves(ctx, a.doc, distributeMoves(items, a.axis, { by: a.by, spacing: a.spacing }), { axis: a.axis, by: a.spacing !== undefined ? "spacing" : a.by });
    },
  });
  tool({
    name: "reorder_layers", module: M, description: "Change stacking order: top, bottom, up, down, or above/below another layer.", annotations: WRITE, commands: ["layer.arrange"],
    input: { doc, layer, position: z.enum(["top", "bottom", "up", "down", "above", "below"]), relativeTo: LayerRef.optional() },
    handler: (a, ctx) => cmd(ctx, "layer.arrange", a),
  });
  tool({
    name: "merge_layers", module: M, description: "Merge the given layers into one. Requires confirm: true.", annotations: DESTRUCTIVE, commands: ["layer.merge"],
    input: { doc, layers: layers.min(2), confirm }, handler: (a, ctx) => {
      requireConfirm(a.confirm, "Merging layers");
      return cmd(ctx, "layer.merge", { doc: a.doc, layers: a.layers });
    },
  });
  tool({
    name: "merge_visible_layers", module: M, description: "Merge all visible layers. Requires confirm: true.", annotations: DESTRUCTIVE, commands: ["layer.mergeVisible"],
    input: { doc, confirm }, handler: (a, ctx) => {
      requireConfirm(a.confirm, "Merge visible");
      return cmd(ctx, "layer.mergeVisible", { doc: a.doc });
    },
  });
  tool({ name: "group_layers", module: M, description: "Put layers in a new group.", annotations: WRITE, commands: ["layer.group"], input: { doc, layers, name }, handler: (a, ctx) => cmd(ctx, "layer.group", a) });
  tool({ name: "ungroup_layers", module: M, description: "Ungroup a group (children stay).", annotations: WRITE, commands: ["layer.ungroup"], input: { doc, layer }, handler: (a, ctx) => cmd(ctx, "layer.ungroup", a) });
  tool({ name: "hide_layer", module: M, description: "Hide a layer.", annotations: WRITE, commands: ["layer.props"], input: { doc, layer }, handler: (a, ctx) => cmd(ctx, "layer.props", { ...a, visible: false }) });
  tool({ name: "show_layer", module: M, description: "Show a layer.", annotations: WRITE, commands: ["layer.props"], input: { doc, layer }, handler: (a, ctx) => cmd(ctx, "layer.props", { ...a, visible: true }) });
  tool({
    name: "lock_layer", module: M, description: "Lock a layer (all, position, pixels or transparency).", annotations: WRITE, commands: ["layer.props"],
    input: { doc, layer, lock: z.enum(["all", "position", "pixels", "transparency"]).default("all") }, handler: (a, ctx) => cmd(ctx, "layer.props", a),
  });
  tool({ name: "unlock_layer", module: M, description: "Remove all locks from a layer.", annotations: WRITE, commands: ["layer.props"], input: { doc, layer }, handler: (a, ctx) => cmd(ctx, "layer.props", { ...a, lock: "none" }) });
  tool({ name: "set_layer_opacity", module: M, description: "Set layer opacity (0-100).", annotations: WRITE, commands: ["layer.props"], input: { doc, layer, opacity: z.number().min(0).max(100) }, handler: (a, ctx) => cmd(ctx, "layer.props", a) });
  tool({ name: "set_layer_fill_opacity", module: M, description: "Set fill opacity (0-100); layer effects stay fully visible.", annotations: WRITE, commands: ["layer.props"], input: { doc, layer, fillOpacity: z.number().min(0).max(100) }, handler: (a, ctx) => cmd(ctx, "layer.props", a) });
  tool({ name: "set_blend_mode", module: M, description: "Set a layer's blend mode.", annotations: WRITE, commands: ["layer.props"], input: { doc, layer, blendMode: blend.unwrap() }, handler: (a, ctx) => cmd(ctx, "layer.props", a) });
  tool({ name: "link_layers", module: M, description: "Link layers so they move together.", annotations: WRITE, commands: ["layer.link"], input: { doc, layers: layers.min(2) }, handler: (a, ctx) => cmd(ctx, "layer.link", a) });
  tool({
    name: "rasterize_layer", module: M, description: "Rasterize a text/shape/smart-object layer (loses editability). Requires confirm: true.", annotations: DESTRUCTIVE, commands: ["layer.rasterize"],
    input: { doc, layer, confirm }, handler: (a, ctx) => {
      requireConfirm(a.confirm, "Rasterizing");
      return cmd(ctx, "layer.rasterize", { doc: a.doc, layer: a.layer });
    },
  });
  tool({ name: "convert_to_smart_object", module: M, description: "Convert a layer to a smart object (enables smart filters, lossless transforms).", annotations: WRITE, commands: ["layer.smartObject"], input: { doc, layer }, handler: (a, ctx) => cmd(ctx, "layer.smartObject", a) });
  tool({
    name: "get_layer_bounds", module: M, description: "Pixel bounds of a layer (left, top, right, bottom, width, height).", annotations: READ_ONLY, commands: ["layer.info"],
    input: { doc, layer }, handler: async (a, ctx) => {
      const out = await cmd(ctx, "layer.info", a);
      const l = (out.data as { layer: { id: number; name: string; bounds: unknown } }).layer;
      return { data: { id: l.id, name: l.name, bounds: l.bounds }, warnings: out.warnings };
    },
  });
}

type Listed = Item & { name: string };
type Ref = { id?: number; name?: string };

async function listItems(ctx: ToolContext, d: unknown): Promise<Listed[]> {
  const out = await cmd(ctx, "layer.list", { doc: d });
  return (out.data as { layers: Listed[] }).layers;
}

/** Layer refs → listed layers (name refs take the topmost match, like the rest of the tools). */
function resolve(all: Listed[], refs: Ref[]): Listed[] {
  return refs.map((r) => {
    const hit = r.id !== undefined ? all.find((l) => l.id === r.id) : all.find((l) => l.name === r.name);
    if (!hit) throw new PsMcpError("LAYER_NOT_FOUND", `Layer not found: ${JSON.stringify(r)}`);
    return hit;
  });
}

async function canvasBox(ctx: ToolContext, d: unknown): Promise<Box> {
  const info = await cmd(ctx, "doc.info", { doc: d });
  const doc = (info.data as { document: { width: number; height: number } }).document;
  return { left: 0, top: 0, right: doc.width, bottom: doc.height };
}

async function applyMoves(ctx: ToolContext, d: unknown, moves: Move[], meta: Record<string, unknown>): Promise<ToolOutput> {
  const todo = moves.filter((m) => m.dx !== 0 || m.dy !== 0);
  if (!todo.length) return { data: { ...meta, moved: [], unchanged: moves.map((m) => m.id) } };
  const out = await cmd(ctx, "layer.translateMany", { doc: d, moves: todo });
  return { data: { ...meta, moves: todo, layers: (out.data as { layers: unknown[] }).layers }, warnings: out.warnings };
}

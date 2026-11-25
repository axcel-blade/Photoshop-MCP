import { z } from "zod";
import { LayerRef } from "../../schemas/index.js";
import { cmd, DESTRUCTIVE, READ_ONLY, requireConfirm, tool, WRITE } from "./registry.js";
import { blend, color, confirm, doc, layer, name, opacity } from "./args.js";

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

import { z } from "zod";
import { ColorRangePreset } from "../../schemas/index.js";
import { cmd, DESTRUCTIVE, READ_ONLY, requireConfirm, Sequence, tool, WRITE } from "./registry.js";
import { confirm, doc, layer, rect, region, regionSelect } from "./args.js";

const M = "selection";
const mode = z.enum(["new", "add", "subtract", "intersect"]).default("new");

export function registerSelectionTools(): void {
  tool({ name: "select_all", module: M, description: "Select the whole canvas.", annotations: WRITE, commands: ["select.all"], input: { doc }, handler: (a, ctx) => cmd(ctx, "select.all", a) });
  tool({ name: "deselect", module: M, description: "Remove the selection.", annotations: WRITE, commands: ["select.none"], input: { doc }, handler: (a, ctx) => cmd(ctx, "select.none", a) });
  tool({ name: "invert_selection", module: M, description: "Invert the selection.", annotations: WRITE, commands: ["select.invert"], input: { doc }, handler: (a, ctx) => cmd(ctx, "select.invert", a) });
  tool({
    name: "select_subject", module: M, description: "Photoshop Select Subject (built-in ML model) on the given/active layer.", annotations: WRITE, commands: ["layer.select", "select.subject"],
    input: { doc, layer, sampleAllLayers: z.boolean().default(false) },
    limitations: "Quality depends on the image; check get_selection_info / capture_preview.",
    handler: async (a, ctx) => {
      if (a.layer) await cmd(ctx, "layer.select", { doc: a.doc, layer: a.layer });
      return cmd(ctx, "select.subject", { doc: a.doc, sampleAllLayers: a.sampleAllLayers });
    },
  });
  tool({
    name: "select_object", module: M, description: "Select the main object inside a rectangle: Select Subject intersected with the rectangle.", annotations: WRITE, commands: ["select.subject", "select.rect"],
    status: "partial", limitations: "The interactive Object Selection tool is not scriptable; this approximates it with Select Subject ∩ bounds.",
    input: { doc, bounds: rect, layer },
    handler: async (a, ctx) => {
      const seq = new Sequence(ctx);
      if (a.layer) await seq.run("target layer", "layer.select", { doc: a.doc, layer: a.layer });
      await seq.run("select subject", "select.subject", { doc: a.doc });
      await seq.run("intersect with bounds", "select.rect", { doc: a.doc, bounds: a.bounds, mode: "intersect" });
      return seq.result({}, ["Approximation of the Object Selection tool (Select Subject ∩ rectangle)."]);
    },
  });
  tool({ name: "select_sky", module: M, description: "Photoshop Select > Sky (built-in ML model).", annotations: WRITE, commands: ["select.sky"], input: { doc }, handler: (a, ctx) => cmd(ctx, "select.sky", a) });
  tool({
    name: "select_color_range", module: M, description: "Select > Color Range using a preset range (reds…magentas, highlights, midtones, shadows, skin tones).", annotations: WRITE, commands: ["select.colorRange"],
    input: { doc, preset: ColorRangePreset, fuzziness: z.number().min(0).max(200).default(40), mode }, handler: (a, ctx) => cmd(ctx, "select.colorRange", a),
  });
  tool({
    name: "select_rectangle", module: M, description: "Rectangular selection (new/add/subtract/intersect), optional feather.", annotations: WRITE, commands: ["select.rect"],
    input: { doc, bounds: rect, mode, feather: z.number().min(0).max(1000).default(0) }, handler: (a, ctx) => cmd(ctx, "select.rect", a),
  });
  tool({
    name: "select_ellipse", module: M, description: "Elliptical selection.", annotations: WRITE, commands: ["select.ellipse"],
    input: { doc, bounds: rect, mode, feather: z.number().min(0).max(1000).default(0) }, handler: (a, ctx) => cmd(ctx, "select.ellipse", a),
  });
  tool({
    name: "select_polygon", module: M, description: "Polygonal lasso selection from points.", annotations: WRITE, commands: ["select.polygon"],
    input: { doc, points: z.array(z.object({ x: z.number(), y: z.number() })).min(3).max(2000), mode, feather: z.number().min(0).max(1000).default(0) }, handler: (a, ctx) => cmd(ctx, "select.polygon", a),
  });
  tool({
    name: "select_layer_pixels", module: M, description: "Load a layer's transparency as a selection (Ctrl+click thumbnail).", annotations: WRITE, commands: ["select.layerPixels"],
    input: { doc, layer, mode }, handler: (a, ctx) => cmd(ctx, "select.layerPixels", a),
  });
  tool({
    name: "create_layer_mask", module: M, description: "Add a layer mask: from the current selection, reveal all or hide all. Background layers are converted to normal layers first.", annotations: WRITE, commands: ["mask.create"],
    input: { doc, layer, from: z.enum(["selection", "revealAll", "hideAll"]).default("selection") }, handler: (a, ctx) => cmd(ctx, "mask.create", a),
  });
  tool({
    name: "create_vector_mask", module: M, description: "Add a vector mask from a rectangle/ellipse/polygon region (or the current selection).", annotations: WRITE, commands: ["select.rect", "select.ellipse", "select.polygon", "mask.vector"],
    input: { doc, layer, region: region.optional() },
    handler: async (a, ctx) => {
      const seq = new Sequence(ctx);
      if (a.region) {
        const s = regionSelect(a.region);
        await seq.run("region", s.command, { doc: a.doc, ...s.params });
      }
      await seq.run("vector mask", "mask.vector", { doc: a.doc, layer: a.layer });
      await seq.run("deselect", "select.none", { doc: a.doc });
      return seq.result();
    },
  });
  tool({
    name: "delete_mask", module: M, description: "Delete a layer's mask (layer or vector). Requires confirm: true.", annotations: DESTRUCTIVE, commands: ["mask.delete"],
    input: { doc, layer, kind: z.enum(["layer", "vector"]).default("layer"), confirm }, handler: (a, ctx) => {
      requireConfirm(a.confirm, "Deleting a mask");
      return cmd(ctx, "mask.delete", { doc: a.doc, layer: a.layer, kind: a.kind });
    },
  });
  tool({ name: "invert_mask", module: M, description: "Invert a layer mask.", annotations: WRITE, commands: ["mask.invert"], input: { doc, layer }, handler: (a, ctx) => cmd(ctx, "mask.invert", a) });
  tool({
    name: "apply_mask", module: M, description: "Apply (bake) the layer mask into the pixels. Requires confirm: true.", annotations: DESTRUCTIVE, commands: ["mask.apply"],
    input: { doc, layer, confirm }, handler: (a, ctx) => {
      requireConfirm(a.confirm, "Applying a mask");
      return cmd(ctx, "mask.apply", { doc: a.doc, layer: a.layer });
    },
  });
  tool({
    name: "refine_mask", module: M, description: "Soften a layer mask non-destructively via Properties feather/density.", annotations: WRITE, commands: ["mask.refine"], status: "partial",
    limitations: "Select and Mask (edge detection, decontaminate colors) is interactive and not scriptable; only feather and density are set.",
    input: { doc, layer, feather: z.number().min(0).max(1000).optional(), density: z.number().min(0).max(100).optional() }, handler: (a, ctx) => cmd(ctx, "mask.refine", a),
  });
  const modify = (toolName: string, op: string, desc: string, max: number) =>
    tool({ name: toolName, module: M, description: desc, annotations: WRITE, commands: ["select.modify"], input: { doc, radius: z.number().min(0.1).max(max) }, handler: (a, ctx) => cmd(ctx, "select.modify", { doc: a.doc, op, amount: a.radius }) });
  modify("feather_selection", "feather", "Feather the selection (px).", 1000);
  modify("expand_selection", "expand", "Expand the selection (px).", 500);
  modify("contract_selection", "contract", "Contract the selection (px).", 500);
  modify("smooth_selection", "smooth", "Smooth the selection (px).", 500);
  tool({ name: "get_selection_info", module: M, description: "Whether a selection exists and its bounds.", annotations: READ_ONLY, commands: ["select.info"], input: { doc }, handler: (a, ctx) => cmd(ctx, "select.info", a) });
}

import { z } from "zod";
import { Gradient } from "../../schemas/index.js";
import { cmd, Sequence, tool, WRITE, type ToolContext, type ToolOutput } from "./registry.js";
import { color, doc, inputPath, layer, path, region, regionSelect, spots, spotsToShapes, type Region } from "./args.js";
import { contentAwareRegions } from "./retouch.js";
import { PsMcpError } from "../../utils/errors.js";

const M = "background";

async function targetLayerId(ctx: ToolContext, d: unknown, l: unknown): Promise<number> {
  const out = await cmd(ctx, "layer.info", { doc: d, layer: l });
  return (out.data as { layer: { id: number } }).layer.id;
}

/** Select Subject on the layer and hide the rest with a layer mask (fully reversible). */
export async function removeBackground(ctx: ToolContext, d: unknown, l: unknown): Promise<ToolOutput> {
  const seq = new Sequence(ctx);
  const id = await targetLayerId(ctx, d, l);
  await seq.run("target layer", "layer.select", { doc: d, layer: { id } });
  const sel = await seq.run("select subject", "select.subject", { doc: d, sampleAllLayers: false });
  if ((sel.data as { wholeLayer?: boolean }).wholeLayer) {
    // Select Subject picked the layer's whole rectangle (a photo smaller than the canvas): find the subject inside it instead.
    await seq.run("deselect", "select.none", { doc: d });
    const info = await cmd(ctx, "layer.info", { doc: d, layer: { id } });
    if ((info.data as { layer: { kind: string } }).layer.kind !== "smartObject") {
      throw new PsMcpError("PHOTOSHOP_ERROR", "Select Subject selected the whole layer, not a subject inside it. Convert the layer to a smart object (convert_to_smart_object) and retry, or open the photo as its own document.");
    }
    const out = await seq.run("mask subject inside smart object", "smartObject.maskSubject", { doc: d, layer: { id } });
    const layerId = (out.data as { layer: { id: number } }).layer.id;
    return seq.result({ layerId, method: "Select Subject inside the smart object + layer mask in its contents" }, ["The background is masked inside the smart object (non-destructive): open its contents to refine the mask."]);
  }
  await seq.run("mask background", "mask.create", { doc: d, layer: { id }, from: "selection" });
  await seq.run("deselect", "select.none", { doc: d });
  return seq.result({ layerId: id, method: "Select Subject + layer mask" }, ["Background is hidden by a layer mask (non-destructive). Use refine_mask to soften edges, or invert_mask if the subject was misdetected."]);
}

async function addBackgroundBelow(ctx: ToolContext, seq: Sequence, d: unknown, below: number, bg: { color?: string; gradient?: z.infer<typeof Gradient>; imagePath?: string }): Promise<number> {
  let made: ToolOutput;
  if (bg.imagePath) made = await seq.run("place background image", "image.place", { doc: d, path: bg.imagePath, fit: "cover", name: "New Background" });
  else if (bg.gradient) made = await seq.run("gradient background", "fill.gradient", { doc: d, gradient: bg.gradient, name: "New Background" });
  else made = await seq.run("solid background", "fill.solid", { doc: d, color: bg.color ?? "#FFFFFF", name: "New Background" });
  const id = (made.data as { layer: { id: number } }).layer.id;
  await seq.run("move below subject", "layer.arrange", { doc: d, layer: { id }, position: "below", relativeTo: { id: below } });
  return id;
}

function bgArgs(ctx: ToolContext, a: { color?: string; gradient?: z.infer<typeof Gradient>; imagePath?: string }) {
  return { color: a.color, gradient: a.gradient, imagePath: a.imagePath ? inputPath(ctx, a.imagePath) : undefined };
}

export function registerBackgroundTools(): void {
  tool({ name: "remove_background", module: M, description: "Remove the background non-destructively: Select Subject (Photoshop ML) → layer mask on the subject layer.", annotations: WRITE, commands: ["layer.info", "layer.select", "select.subject", "mask.create", "smartObject.maskSubject", "select.none"], input: { doc, layer }, handler: (a, ctx) => removeBackground(ctx, a.doc, a.layer) });
  const bgInput = { doc, layer, color: color.optional(), gradient: Gradient.optional(), imagePath: path.optional() };
  tool({
    name: "replace_background", module: M, description: "Mask out the background, then add a new background layer below the subject (solid color, gradient or image).", annotations: WRITE, commands: ["select.subject", "mask.create", "fill.solid", "fill.gradient", "image.place", "layer.arrange"],
    input: bgInput,
    handler: async (a, ctx) => {
      const r = await removeBackground(ctx, a.doc, a.layer);
      const subject = (r.data as { layerId: number }).layerId;
      const seq = new Sequence(ctx);
      const bg = await addBackgroundBelow(ctx, seq, a.doc, subject, bgArgs(ctx, a));
      return { ...seq.result({ subjectLayerId: subject, backgroundLayerId: bg }), warnings: [...(r.warnings ?? [])] };
    },
  });
  tool({
    name: "create_transparent_background", module: M, description: "Isolate the subject on transparency (mask) and hide any Background layer, ready for PNG export.", annotations: WRITE, commands: ["select.subject", "mask.create", "layer.list", "layer.props"],
    input: { doc, layer },
    handler: async (a, ctx) => {
      const r = await removeBackground(ctx, a.doc, a.layer);
      const subject = (r.data as { layerId: number }).layerId;
      const list = await cmd(ctx, "layer.list", { doc: a.doc });
      const hidden: number[] = [];
      for (const l of (list.data as { layers: { id: number; kind: string; visible: boolean }[] }).layers) {
        if (l.id !== subject && l.visible && (l.kind === "background" || l.kind === "solidColor" || l.kind === "gradientFill")) {
          await cmd(ctx, "layer.props", { doc: a.doc, layer: { id: l.id }, visible: false });
          hidden.push(l.id);
        }
      }
      return { data: { subjectLayerId: subject, hiddenLayers: hidden, next: "export_transparent_image or export_png" }, warnings: r.warnings };
    },
  });
  tool({
    name: "create_white_background", module: M, description: "Add a pure white (#FFFFFF) fill layer at the bottom of the stack (e-commerce).", annotations: WRITE, commands: ["fill.solid", "layer.arrange"],
    input: { doc },
    handler: async (a, ctx) => {
      const seq = new Sequence(ctx);
      const f = await seq.run("white fill", "fill.solid", { doc: a.doc, color: "#FFFFFF", name: "White Background" });
      await seq.run("send to bottom", "layer.arrange", { doc: a.doc, layer: { id: (f.data as { layer: { id: number } }).layer.id }, position: "bottom" });
      return seq.result();
    },
  });
  tool({
    name: "create_custom_background", module: M, description: "Add a solid, gradient or image background layer at the bottom of the stack.", annotations: WRITE, commands: ["fill.solid", "fill.gradient", "image.place", "layer.arrange"],
    input: { doc, color: color.optional(), gradient: Gradient.optional(), imagePath: path.optional() },
    handler: async (a, ctx) => {
      const seq = new Sequence(ctx);
      const b = bgArgs(ctx, a);
      const made = b.imagePath ? await seq.run("image", "image.place", { doc: a.doc, path: b.imagePath, fit: "cover", name: "Background Image" })
        : b.gradient ? await seq.run("gradient", "fill.gradient", { doc: a.doc, gradient: b.gradient, name: "Background Gradient" })
        : await seq.run("color", "fill.solid", { doc: a.doc, color: b.color ?? "#FFFFFF", name: "Background Color" });
      await seq.run("send to bottom", "layer.arrange", { doc: a.doc, layer: { id: (made.data as { layer: { id: number } }).layer.id }, position: "bottom" });
      return seq.result();
    },
  });
  tool({
    name: "extend_background", module: M, description: "Extend the canvas on any side and fill the new area with Content-Aware Fill on a flattened copy layer.", annotations: WRITE, status: "partial",
    limitations: "Content-Aware Fill works well for textures/skies; for complex scenes use generative_expand with a configured Firefly provider.",
    commands: ["doc.info", "doc.resizeCanvas", "layer.create", "select.rect", "select.invert", "edit.contentAwareFill"],
    input: { doc, left: z.number().int().min(0).max(20000).default(0), right: z.number().int().min(0).max(20000).default(0), top: z.number().int().min(0).max(20000).default(0), bottom: z.number().int().min(0).max(20000).default(0), layer },
    handler: async (a, ctx) => {
      const seq = new Sequence(ctx);
      const info = await seq.run("measure", "doc.info", { doc: a.doc });
      const d = (info.data as { document: { width: number; height: number } }).document;
      const W = d.width + a.left + a.right, H = d.height + a.top + a.bottom;
      // Anchor so the original keeps its pixels: grow right/bottom first, then shift.
      await seq.run("canvas", "doc.resizeCanvas", { doc: a.doc, width: W, height: H, anchor: "topLeft" });
      const target = a.layer ?? undefined;
      const id = await targetLayerId(ctx, a.doc, target);
      await seq.run("shift original", "layer.translate", { doc: a.doc, layer: { id }, dx: a.left, dy: a.top });
      await seq.run("select new area", "select.rect", { doc: a.doc, bounds: { left: a.left, top: a.top, right: a.left + d.width, bottom: a.top + d.height } });
      await seq.run("invert", "select.invert", { doc: a.doc });
      await seq.run("content-aware fill", "edit.contentAwareFill", { doc: a.doc, layer: { id } });
      await seq.run("deselect", "select.none", { doc: a.doc });
      return seq.result({ width: W, height: H }, ["Other layers were not shifted; if the document has several layers, move them by (left, top) or merge first."]);
    },
  });
  tool({
    name: "remove_object", module: M, description: "Remove an object inside a region (rect/ellipse/polygon) with Content-Aware Fill on a copy layer.", annotations: WRITE, commands: ["layer.duplicate", "select.rect", "edit.contentAwareFill"],
    input: { doc, layer, region, expand: z.number().min(0).max(200).default(8) },
    handler: (a, ctx) => removeObject(ctx, a.doc, a.layer, a.region, a.expand),
  });
  tool({
    name: "move_object", module: M, description: "Move an object: copy the region to its own layer, offset it, then fill the original spot with Content-Aware Fill.", annotations: WRITE, commands: ["layer.fromSelection", "layer.translate", "edit.contentAwareFill"],
    input: { doc, layer, region, dx: z.number(), dy: z.number() },
    handler: async (a, ctx) => {
      const seq = new Sequence(ctx);
      const src = await targetLayerId(ctx, a.doc, a.layer);
      const s = regionSelect(a.region);
      await seq.run("select object", s.command, { doc: a.doc, ...s.params });
      const moved = await seq.run("layer via copy", "layer.fromSelection", { doc: a.doc, layer: { id: src }, name: "Moved Object", cut: false });
      const movedId = (moved.data as { layer: { id: number } }).layer.id;
      await seq.run("offset", "layer.translate", { doc: a.doc, layer: { id: movedId }, dx: a.dx, dy: a.dy });
      const fill = await removeObject(ctx, a.doc, { id: src }, a.region, 6);
      return { ...seq.result({ movedLayerId: movedId, fill: fill.data }), warnings: fill.warnings };
    },
  });
  tool({
    name: "replace_object", module: M, description: "Remove the object in a region and place a replacement image fitted into the same region.", annotations: WRITE, commands: ["edit.contentAwareFill", "image.place"],
    input: { doc, layer, region, imagePath: path },
    handler: async (a, ctx) => {
      const removed = await removeObject(ctx, a.doc, a.layer, a.region, 8);
      const b = a.region.shape === "polygon"
        ? { left: Math.min(...a.region.points.map((p) => p.x)), top: Math.min(...a.region.points.map((p) => p.y)), right: Math.max(...a.region.points.map((p) => p.x)), bottom: Math.max(...a.region.points.map((p) => p.y)) }
        : a.region.bounds;
      const placed = await cmd(ctx, "image.place", { doc: a.doc, path: inputPath(ctx, a.imagePath), x: b.left, y: b.top, width: b.right - b.left, height: b.bottom - b.top, fit: "contain", name: "Replacement Object" });
      return { data: { removed: removed.data, placed: placed.data }, warnings: [...(removed.warnings ?? []), ...(placed.warnings ?? [])] };
    },
  });
  tool({
    name: "clean_image", module: M, description: "General cleanup: subtle dust & scratches + median on a smart copy, plus optional spot removal.", annotations: WRITE, commands: ["filter.apply", "edit.contentAwareFill"],
    input: { doc, layer, spots: spots.optional(), strength: z.number().min(0).max(100).default(30) },
    handler: async (a, ctx) => {
      const seq = new Sequence(ctx);
      const dup = await seq.run("duplicate", "layer.duplicate", { doc: a.doc, layer: a.layer, name: "Cleanup" });
      let id = (dup.data as { layer: { id: number } }).layer.id;
      id = ((await seq.run("smart object", "layer.smartObject", { doc: a.doc, layer: { id } })).data as { layer: { id: number } }).layer.id; // conversion creates a new layer id
      await seq.run("dust & scratches", "filter.apply", { doc: a.doc, layer: { id }, kind: "dustAndScratches", settings: { radius: 1 + Math.round(a.strength / 40), threshold: 15 }, smart: true });
      await seq.run("median", "filter.apply", { doc: a.doc, layer: { id }, kind: "median", settings: { radius: 1 }, smart: true });
      await seq.run("blend", "layer.props", { doc: a.doc, layer: { id }, opacity: Math.max(30, a.strength + 30) });
      const extra = a.spots ? await contentAwareRegions(ctx, a.doc, a.layer, spotsToShapes(a.spots), "Spot Cleanup") : undefined;
      return seq.result({ layerId: id, spots: extra?.data });
    },
  });
}

export async function removeObject(ctx: ToolContext, d: unknown, l: unknown, r: Region, expand: number): Promise<ToolOutput> {
  const seq = new Sequence(ctx);
  const dup = await seq.run("working copy", "layer.duplicate", { doc: d, layer: l, name: "Object Removal" });
  const id = (dup.data as { layer: { id: number; kind: string } }).layer.id;
  if ((dup.data as { layer: { kind: string } }).layer.kind !== "pixel") await seq.run("rasterize copy", "layer.rasterize", { doc: d, layer: { id } });
  const s = regionSelect(r);
  await seq.run("select region", s.command, { doc: d, ...s.params });
  if (expand > 0) await seq.run("expand", "select.modify", { doc: d, op: "expand", amount: expand });
  await seq.run("content-aware fill", "edit.contentAwareFill", { doc: d, layer: { id } });
  await seq.run("deselect", "select.none", { doc: d });
  return seq.result({ layerId: id }, ["Inspect with capture_preview; Content-Aware Fill can repeat nearby patterns."]);
}

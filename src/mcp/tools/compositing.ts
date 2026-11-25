import { z } from "zod";
import { PsMcpError } from "../../shared.js";
import { cmd, Sequence, tool, WRITE, type ToolContext, type ToolOutput } from "./registry.js";
import { color, doc, inputPath, layer, path } from "./args.js";
import { cinematicGrade, matchColors } from "./color.js";
import { removeBackground } from "./background.js";

const M = "compositing";
type Bounds = { left: number; top: number; right: number; bottom: number; width: number; height: number };

async function layerInfo(ctx: ToolContext, d: unknown, l: unknown): Promise<{ id: number; name: string; bounds: Bounds }> {
  const out = await cmd(ctx, "layer.info", { doc: d, layer: l });
  return (out.data as { layer: { id: number; name: string; bounds: Bounds } }).layer;
}
async function docSize(ctx: ToolContext, d: unknown): Promise<{ width: number; height: number }> {
  const out = await cmd(ctx, "doc.info", { doc: d });
  return (out.data as { document: { width: number; height: number } }).document;
}
const idOf = (o: ToolOutput) => (o.data as { layer: { id: number } }).layer.id;

export async function realisticShadow(ctx: ToolContext, d: unknown, l: unknown, o: { opacity: number; blur: number; squash: number; offsetY: number }): Promise<ToolOutput> {
  const src = await layerInfo(ctx, d, l);
  const seq = new Sequence(ctx);
  const sh = await seq.run("shadow layer", "layer.create", { doc: d, name: `${src.name} Shadow`, blendMode: "multiply" });
  let id = idOf(sh);
  await seq.run("move below subject", "layer.arrange", { doc: d, layer: { id }, position: "below", relativeTo: { id: src.id } });
  await seq.run("load subject shape", "select.layerPixels", { doc: d, layer: { id: src.id }, includeMask: true, mode: "new" });
  await seq.run("fill black", "edit.fillSelection", { doc: d, layer: { id }, color: "#000000" });
  await seq.run("deselect", "select.none", { doc: d });
  await seq.run("flatten onto ground", "layer.transform", { doc: d, layer: { id }, scaleY: o.squash, anchor: "bottom" });
  if (o.offsetY) await seq.run("offset", "layer.translate", { doc: d, layer: { id }, dy: o.offsetY });
  id = ((await seq.run("smart object", "layer.smartObject", { doc: d, layer: { id } })).data as { layer: { id: number } }).layer.id; // conversion creates a new layer id
  await seq.run("soften", "filter.apply", { doc: d, layer: { id }, kind: "gaussianBlur", settings: { radius: o.blur }, smart: true });
  await seq.run("opacity", "layer.props", { doc: d, layer: { id }, opacity: o.opacity });
  return seq.result({ shadowLayerId: id });
}

export async function reflection(ctx: ToolContext, d: unknown, l: unknown, opacity: number, gap: number): Promise<ToolOutput> {
  const src = await layerInfo(ctx, d, l);
  const seq = new Sequence(ctx);
  const dup = await seq.run("duplicate", "layer.duplicate", { doc: d, layer: { id: src.id }, name: `${src.name} Reflection` });
  const id = idOf(dup);
  await seq.run("flip", "layer.transform", { doc: d, layer: { id }, flip: "vertical" });
  await seq.run("move below subject", "layer.translate", { doc: d, layer: { id }, dy: src.bounds.height + gap });
  await seq.run("stack below", "layer.arrange", { doc: d, layer: { id }, position: "below", relativeTo: { id: src.id } });
  await seq.run("fade mask", "mask.gradient", { doc: d, layer: { id }, from: { x: 0, y: src.bounds.bottom + gap }, to: { x: 0, y: src.bounds.bottom + gap + src.bounds.height * 0.6 } });
  await seq.run("opacity", "layer.props", { doc: d, layer: { id }, opacity });
  return seq.result({ reflectionLayerId: id });
}

async function vignette(ctx: ToolContext, seq: Sequence, d: unknown, strength: number): Promise<void> {
  await seq.run("vignette", "fill.gradient", { doc: d, name: "Vignette", gradient: { type: "radial", angle: 90, stops: [{ color: "#000000", location: 0, opacity: 0 }, { color: "#000000", location: 100 }] }, blendMode: "multiply", opacity: strength, transparentCenter: true });
}

export function registerCompositingTools(): void {
  tool({
    name: "combine_images", module: M, description: "Combine images into one document: stacked layers, side-by-side, or a grid. Each image is a smart object layer.", annotations: WRITE, commands: ["doc.create", "image.place"],
    input: { paths: z.array(path).min(2).max(50), layout: z.enum(["stack", "horizontal", "vertical", "grid"]).default("horizontal"), cell: z.number().int().min(32).max(10000).default(1000), gap: z.number().int().min(0).max(1000).default(0), background: color.default("#FFFFFF") },
    handler: async (a, ctx) => {
      const files = a.paths.map((p) => inputPath(ctx, p));
      const n = files.length;
      const cols = a.layout === "grid" ? Math.ceil(Math.sqrt(n)) : a.layout === "horizontal" ? n : a.layout === "vertical" ? 1 : 1;
      const rows = a.layout === "stack" ? 1 : Math.ceil(n / cols);
      const W = a.layout === "stack" ? a.cell : cols * a.cell + (cols + 1) * a.gap, H = a.layout === "stack" ? a.cell : rows * a.cell + (rows + 1) * a.gap;
      const seq = new Sequence(ctx);
      await seq.run("document", "doc.create", { name: "Combined", width: W, height: H, background: "white" });
      await seq.run("background", "fill.solid", { color: a.background, name: "Background" });
      for (const [i, f] of files.entries()) {
        const c = i % cols, r = Math.floor(i / cols);
        const x = a.layout === "stack" ? 0 : a.gap + c * (a.cell + a.gap), y = a.layout === "stack" ? 0 : a.gap + r * (a.cell + a.gap);
        await seq.run(`image ${i + 1}`, "image.place", { path: f, x, y, width: a.cell, height: a.cell, fit: "contain" });
      }
      return seq.result({ width: W, height: H, images: n });
    },
  });
  tool({
    name: "create_photo_collage", module: M, description: "Photo collage: each photo fills (cover) a grid cell, clipped to a cell shape, with gaps and background.", annotations: WRITE, commands: ["doc.create", "shape.rect", "image.place", "layer.clip"],
    input: { paths: z.array(path).min(2).max(60), columns: z.number().int().min(1).max(12).default(3), width: z.number().int().min(100).max(20000).default(3000), height: z.number().int().min(100).max(20000).default(2000), gap: z.number().int().min(0).max(500).default(20), radius: z.number().min(0).max(500).default(0), background: color.default("#FFFFFF") },
    handler: async (a, ctx) => {
      const files = a.paths.map((p) => inputPath(ctx, p));
      const rows = Math.ceil(files.length / a.columns);
      const cw = (a.width - (a.columns + 1) * a.gap) / a.columns, ch = (a.height - (rows + 1) * a.gap) / rows;
      const seq = new Sequence(ctx);
      await seq.run("document", "doc.create", { name: "Collage", width: a.width, height: a.height, background: "white" });
      await seq.run("background", "fill.solid", { color: a.background, name: "Background" });
      for (const [i, f] of files.entries()) {
        const c = i % a.columns, r = Math.floor(i / a.columns);
        const left = Math.round(a.gap + c * (cw + a.gap)), top = Math.round(a.gap + r * (ch + a.gap));
        await seq.run(`cell ${i + 1}`, "shape.rect", { bounds: { left, top, right: Math.round(left + cw), bottom: Math.round(top + ch) }, fill: "#808080", radius: a.radius, name: `Cell ${i + 1}` });
        const img = await seq.run(`photo ${i + 1}`, "image.place", { path: f, x: left, y: top, width: Math.round(cw), height: Math.round(ch), fit: "cover", name: `Photo ${i + 1}` });
        await seq.run(`clip ${i + 1}`, "layer.clip", { layer: { id: idOf(img) } });
      }
      return seq.result({ cells: files.length });
    },
  });
  tool({
    name: "create_photo_composite", module: M, description: "Composite a subject photo onto a background photo: subject cut out (mask), scaled into a box, color-matched to the background, with contact shadow.", annotations: WRITE, commands: ["doc.create", "image.place", "select.subject", "mask.create", "ps.analyze", "adjust.layer"],
    input: { background: path, subject: path, width: z.number().int().min(64).max(20000).default(2000), height: z.number().int().min(64).max(20000).default(1333), subjectBox: z.object({ x: z.number(), y: z.number(), width: z.number().min(1), height: z.number().min(1) }).optional(), shadow: z.boolean().default(true), matchColors: z.boolean().default(true) },
    handler: async (a, ctx) => {
      const seq = new Sequence(ctx);
      await seq.run("document", "doc.create", { name: "Composite", width: a.width, height: a.height });
      await seq.run("background", "image.place", { path: inputPath(ctx, a.background), x: 0, y: 0, width: a.width, height: a.height, fit: "cover", name: "Background Plate" });
      const box = a.subjectBox ?? { x: a.width * 0.25, y: a.height * 0.2, width: a.width * 0.5, height: a.height * 0.75 };
      const sub = await seq.run("subject", "image.place", { path: inputPath(ctx, a.subject), ...box, fit: "contain", name: "Subject" });
      const sid = idOf(sub);
      const cut = await removeBackground(ctx, undefined, { id: sid });
      const parts: ToolOutput[] = [cut];
      if (a.matchColors) parts.push(await matchColors(ctx, { layer: { id: sid }, referenceLayer: { name: "Background Plate" }, strength: 60 }));
      if (a.shadow) parts.push(await realisticShadow(ctx, undefined, { id: sid }, { opacity: 45, blur: 18, squash: 25, offsetY: 0 }));
      return { ...seq.result({ subjectLayerId: sid, parts: parts.map((p) => p.data) }), warnings: parts.flatMap((p) => p.warnings ?? []) };
    },
  });
  tool({
    name: "create_double_exposure", module: M, description: "Double exposure: portrait on light background, texture photo inside the subject silhouette (Select Subject mask) with Screen blend.", annotations: WRITE, commands: ["doc.create", "image.place", "select.subject", "mask.create", "layer.props"],
    input: { portrait: path, texture: path, width: z.number().int().min(64).max(20000).default(2000), height: z.number().int().min(64).max(20000).default(2500), background: color.default("#F4F1EC") },
    handler: async (a, ctx) => {
      const seq = new Sequence(ctx);
      await seq.run("document", "doc.create", { name: "Double Exposure", width: a.width, height: a.height });
      await seq.run("background", "fill.solid", { color: a.background, name: "Background" });
      const p = await seq.run("portrait", "image.place", { path: inputPath(ctx, a.portrait), x: 0, y: 0, width: a.width, height: a.height, fit: "contain", name: "Portrait" });
      const pid = idOf(p);
      await seq.run("portrait → B&W", "adjust.layer", { kind: "blackAndWhite", settings: {}, layer: { id: pid }, clip: true, name: "Portrait B&W" });
      const t = await seq.run("texture", "image.place", { path: inputPath(ctx, a.texture), x: 0, y: 0, width: a.width, height: a.height, fit: "cover", name: "Texture" });
      const tid = idOf(t);
      await seq.run("target portrait", "layer.select", { layer: { id: pid } });
      await seq.run("select subject", "select.subject", {});
      await seq.run("mask texture to silhouette", "mask.create", { layer: { id: tid }, from: "selection" });
      await seq.run("deselect", "select.none", {});
      await seq.run("screen blend", "layer.props", { layer: { id: tid }, blendMode: "screen", opacity: 85 });
      return seq.result({ portraitLayerId: pid, textureLayerId: tid });
    },
  });
  const sceneTool = (nm: string, desc: string, grade: string, extra: (seq: Sequence, d: unknown, size: { width: number; height: number }, glow?: string) => Promise<void>) =>
    tool({
      name: nm, module: M, description: `${desc} Works on the active document with editable layers.`, annotations: WRITE, status: "partial", commands: ["adjust.layer", "fill.gradient", "shape.ellipse", "filter.apply"],
      limitations: "Builds mood (grade, light, atmosphere, vignette) from layers; it does not generate new scene content unless you place assets or use generate_image.",
      input: { doc, strength: z.number().min(0).max(100).default(70), lightColor: color.optional(), elements: z.array(path).max(20).optional().describe("Optional extra images to place (smart objects)") },
      handler: async (a, ctx) => {
        const seq = new Sequence(ctx);
        const size = await docSize(ctx, a.doc);
        for (const e of a.elements ?? []) await seq.run(`place ${e}`, "image.place", { doc: a.doc, path: inputPath(ctx, e), fit: "contain", width: size.width * 0.5, height: size.height * 0.5, x: size.width * 0.25, y: size.height * 0.25 });
        const g = await cinematicGrade(ctx, grade, a.strength, a.doc);
        await extra(seq, a.doc, size, a.lightColor);
        await vignette(ctx, seq, a.doc, Math.round(a.strength * 0.6));
        return { ...seq.result({ grade: g.data }), warnings: g.warnings };
      },
    });
  const lightOrb = async (seq: Sequence, d: unknown, s: { width: number; height: number }, c = "#FFD58A", cx = 0.7, cy = 0.25, scale = 0.5) => {
    const r = Math.min(s.width, s.height) * scale;
    const o = await seq.run("light source", "shape.ellipse", { doc: d, bounds: { left: s.width * cx - r / 2, top: s.height * cy - r / 2, right: s.width * cx + r / 2, bottom: s.height * cy + r / 2 }, fill: c, name: "Light Glow", opacity: 55 });
    await seq.run("light blend", "layer.props", { doc: d, layer: { id: idOf(o) }, blendMode: "screen" });
    await seq.run("light soften", "filter.apply", { doc: d, layer: { id: idOf(o) }, kind: "gaussianBlur", settings: { radius: Math.round(r * 0.3) }, smart: true });
  };
  sceneTool("create_cinematic_scene", "Cinematic look: teal/orange grade, warm key light glow, vignette.", "teal_orange", (seq, d, s, c) => lightOrb(seq, d, s, c ?? "#FFB86B"));
  sceneTool("create_fantasy_scene", "Fantasy mood: cool night grade, magical glow, haze.", "cool_night", async (seq, d, s, c) => {
    await lightOrb(seq, d, s, c ?? "#9B8CFF", 0.5, 0.35, 0.7);
    const haze = await seq.run("haze", "fill.gradient", { doc: d, name: "Haze", gradient: { type: "linear", angle: 90, stops: [{ color: "#FFFFFF", location: 0, opacity: 0 }, { color: "#CFE3FF", location: 100 }] }, opacity: 35, blendMode: "screen" });
    void haze;
  });
  sceneTool("create_surreal_artwork", "Surreal mood: warm film grade, dreamy glow, soft haze.", "warm_film", (seq, d, s, c) => lightOrb(seq, d, s, c ?? "#FFC6E0", 0.5, 0.5, 0.9));

  tool({
    name: "create_product_composite", module: M, description: "Product shot: cut out the product, place on a gradient set, add reflection, contact shadow and rim glow.", annotations: WRITE, commands: ["doc.create", "fill.gradient", "image.place", "select.subject", "mask.create", "layer.effects"],
    input: { product: path, width: z.number().int().min(64).max(20000).default(2000), height: z.number().int().min(64).max(20000).default(2000), backdrop: z.tuple([color, color]).default(["#2A2A2A", "#050505"]), reflection: z.boolean().default(true), glow: color.optional() },
    handler: async (a, ctx) => {
      const seq = new Sequence(ctx);
      await seq.run("document", "doc.create", { name: "Product Composite", width: a.width, height: a.height });
      await seq.run("backdrop", "fill.gradient", { name: "Backdrop", gradient: { type: "radial", angle: 90, stops: [{ color: a.backdrop[0], location: 0 }, { color: a.backdrop[1], location: 100 }] } });
      const p = await seq.run("product", "image.place", { path: inputPath(ctx, a.product), x: a.width * 0.25, y: a.height * 0.12, width: a.width * 0.5, height: a.height * 0.6, fit: "contain", name: "Product" });
      const id = idOf(p);
      const parts = [await removeBackground(ctx, undefined, { id })];
      if (a.reflection) parts.push(await reflection(ctx, undefined, { id }, 28, 2));
      parts.push(await realisticShadow(ctx, undefined, { id }, { opacity: 55, blur: 14, squash: 12, offsetY: 4 }));
      if (a.glow) parts.push(await cmd(ctx, "layer.effects", { layer: { id }, effects: { outerGlow: { color: a.glow, opacity: 40, size: 40, spread: 0, blendMode: "screen" } } }));
      return { ...seq.result({ productLayerId: id, parts: parts.map((x) => x.data) }), warnings: parts.flatMap((x) => x.warnings ?? []) };
    },
  });
  tool({
    name: "create_realistic_shadow", module: M, description: "Contact/cast shadow from a layer's shape: filled silhouette below the layer, squashed, blurred (smart filter) and multiplied.", annotations: WRITE, commands: ["layer.create", "select.layerPixels", "edit.fillSelection", "layer.transform", "filter.apply"],
    input: { doc, layer, opacity: z.number().min(0).max(100).default(50), blur: z.number().min(0).max(500).default(15), squash: z.number().min(1).max(100).default(30).describe("Vertical scale % of the silhouette"), offsetY: z.number().default(0) },
    handler: (a, ctx) => realisticShadow(ctx, a.doc, a.layer, a),
  });
  tool({
    name: "create_reflection", module: M, description: "Mirror reflection below a layer: flipped copy with a gradient fade mask.", annotations: WRITE, commands: ["layer.duplicate", "layer.transform", "mask.gradient", "layer.props"],
    input: { doc, layer, opacity: z.number().min(0).max(100).default(30), gap: z.number().min(0).max(1000).default(0) },
    handler: (a, ctx) => reflection(ctx, a.doc, a.layer, a.opacity, a.gap),
  });
  tool({
    name: "match_lighting", module: M, description: "Match a layer's brightness/color to the rest of the image: measured statistics → clipped Levels on the layer.", annotations: WRITE, status: "partial", limitations: "Global statistics only; directional light is not re-rendered.", commands: ["ps.analyze", "adjust.layer"],
    input: { doc, layer, referenceLayer: layer, strength: z.number().min(0).max(100).default(70) },
    handler: (a, ctx) => {
      if (!a.layer) throw new PsMcpError("VALIDATION_ERROR", "Give the layer to adjust");
      return matchColors(ctx, { doc: a.doc, layer: a.layer, referenceDoc: a.doc, referenceLayer: a.referenceLayer, strength: a.strength });
    },
  });
  tool({
    name: "match_colors_between_images", module: M, description: "Match the target document's colors to a reference document (both open): per-channel Levels from measured means.", annotations: WRITE, status: "partial", limitations: "Statistical match, not the Match Color dialog.", commands: ["ps.analyze", "adjust.layer"],
    input: { targetDoc: doc, referenceDoc: doc.unwrap(), strength: z.number().min(0).max(100).default(80) },
    handler: (a, ctx) => matchColors(ctx, { doc: a.targetDoc, referenceDoc: a.referenceDoc, strength: a.strength }),
  });
  tool({
    name: "create_depth_effect", module: M, description: "Fake shallow depth of field: blurred smart copy masked to everything except the subject (Select Subject).", annotations: WRITE, commands: ["layer.duplicate", "filter.apply", "select.subject", "mask.create"],
    input: { doc, layer, blur: z.number().min(1).max(200).default(12) },
    handler: async (a, ctx) => {
      const src = await layerInfo(ctx, a.doc, a.layer);
      const seq = new Sequence(ctx);
      const dup = await seq.run("duplicate", "layer.duplicate", { doc: a.doc, layer: { id: src.id }, name: "Background Blur" });
      let id = idOf(dup);
      id = ((await seq.run("smart object", "layer.smartObject", { doc: a.doc, layer: { id } })).data as { layer: { id: number } }).layer.id; // conversion creates a new layer id
      await seq.run("blur", "filter.apply", { doc: a.doc, layer: { id }, kind: "gaussianBlur", settings: { radius: a.blur }, smart: true });
      await seq.run("target source", "layer.select", { doc: a.doc, layer: { id: src.id } });
      await seq.run("select subject", "select.subject", { doc: a.doc });
      await seq.run("invert", "select.invert", { doc: a.doc });
      await seq.run("feather", "select.modify", { doc: a.doc, op: "feather", amount: 3 });
      await seq.run("mask blur to background", "mask.create", { doc: a.doc, layer: { id }, from: "selection" });
      await seq.run("deselect", "select.none", { doc: a.doc });
      return seq.result({ blurLayerId: id });
    },
  });
}

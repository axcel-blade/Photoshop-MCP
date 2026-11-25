import { z } from "zod";
import { cmd, Sequence, tool, WRITE, type ToolContext, type ToolOutput } from "./registry.js";
import { doc, layer, rect, region, regionSelect, spots, spotsToShapes } from "./args.js";
import { adjustment, analyze } from "./color.js";

const M = "retouching";
const HEURISTIC = "Heuristic, non-destructive layer stack built from Photoshop filters/adjustments; it is not a Neural Filter. Review with capture_preview.";

/** Duplicate the target as a working layer (rasterised copy if needed) so the original is never touched. */
async function workingCopy(seq: Sequence, d: unknown, l: unknown, name: string, pixel: boolean): Promise<number> {
  const dup = await seq.run(`duplicate as "${name}"`, "layer.duplicate", { doc: d, layer: l, name });
  const id = (dup.data as { layer: { id: number; kind: string } }).layer.id;
  const kind = (dup.data as { layer: { kind: string } }).layer.kind;
  if (pixel && kind !== "pixel") await seq.run("rasterize working copy", "layer.rasterize", { doc: d, layer: { id } });
  return id;
}

export async function contentAwareRegions(ctx: ToolContext, d: unknown, l: unknown, shapes: { left: number; top: number; right: number; bottom: number }[], name: string, expand = 4, ellipse = true): Promise<ToolOutput> {
  const seq = new Sequence(ctx);
  const id = await workingCopy(seq, d, l, name, true);
  await seq.run("select regions", ellipse ? "select.ellipse" : "select.rect", { doc: d, shapes, mode: "new" });
  if (expand > 0) await seq.run("expand", "select.modify", { doc: d, op: "expand", amount: expand });
  await seq.run("content-aware fill", "edit.contentAwareFill", { doc: d, layer: { id } });
  await seq.run("deselect", "select.none", { doc: d });
  return seq.result({ layerId: id, regions: shapes.length }, ["Content-Aware Fill result depends on surrounding pixels; inspect with capture_preview."]);
}

export async function smoothSkin(ctx: ToolContext, d: unknown, l: unknown, strength: number): Promise<ToolOutput> {
  const seq = new Sequence(ctx);
  let id = await workingCopy(seq, d, l, "Skin Smoothing", false);
  id = ((await seq.run("smart object", "layer.smartObject", { doc: d, layer: { id } })).data as { layer: { id: number } }).layer.id; // conversion creates a new layer id
  const radius = Math.max(2, Math.round(3 + strength * 0.12));
  await seq.run("surface blur", "filter.apply", { doc: d, layer: { id }, kind: "surfaceBlur", settings: { radius, threshold: Math.round(10 + strength * 0.15) }, smart: true });
  const warnings = [HEURISTIC];
  const skin = await seq.run("select skin tones", "select.colorRange", { doc: d, preset: "skinTone", fuzziness: 40, mode: "new" });
  if ((skin.data as { hasSelection: boolean }).hasSelection) {
    await seq.run("feather", "select.modify", { doc: d, op: "feather", amount: 4 });
    await seq.run("mask to skin", "mask.create", { doc: d, layer: { id }, from: "selection" });
    await seq.run("deselect", "select.none", { doc: d });
  } else {
    warnings.push("Color Range found no skin tones, so smoothing applies to the whole layer; mask it manually (create_layer_mask) if needed.");
  }
  await seq.run("strength", "layer.props", { doc: d, layer: { id }, opacity: Math.min(100, 30 + strength * 0.6) });
  return seq.result({ layerId: id, radius }, warnings);
}

async function sharpen(ctx: ToolContext, d: unknown, l: unknown, amount: number, radius: number, method: "unsharp" | "smart" | "highpass"): Promise<ToolOutput> {
  const seq = new Sequence(ctx);
  if (method === "highpass") {
    let id = await workingCopy(seq, d, l, "Sharpen (High Pass)", false);
    id = ((await seq.run("smart object", "layer.smartObject", { doc: d, layer: { id } })).data as { layer: { id: number } }).layer.id; // conversion creates a new layer id
    await seq.run("high pass", "filter.apply", { doc: d, layer: { id }, kind: "highPass", settings: { radius }, smart: true });
    await seq.run("overlay", "layer.props", { doc: d, layer: { id }, blendMode: "overlay", opacity: Math.min(100, amount) });
    return seq.result({ layerId: id });
  }
  const id = await workingCopy(seq, d, l, "Sharpen", false);
  await seq.run(method === "smart" ? "smart sharpen" : "unsharp mask", "filter.apply", { doc: d, layer: { id }, kind: method === "smart" ? "smartSharpen" : "unsharpMask", settings: method === "smart" ? { amount, radius, noiseReduction: 10 } : { amount, radius, threshold: 2 }, smart: true });
  return seq.result({ layerId: id });
}

export async function correctExposure(ctx: ToolContext, d: unknown, target: number): Promise<ToolOutput> {
  const { a, warnings } = await analyze(ctx, d);
  const mean = Math.max(0.01, a.luminance.mean);
  const stops = Math.round(Math.max(-2, Math.min(2, Math.log2(target / mean))) * 100) / 100;
  const black = Math.round(Math.max(0, Math.min(60, a.luminance.p1 * 255 - 2)));
  const white = Math.round(Math.min(255, Math.max(195, a.luminance.p99 * 255 + 2)));
  const seq = new Sequence(ctx);
  if (Math.abs(stops) >= 0.05) await seq.run(`exposure ${stops} EV`, "adjust.layer", { doc: d, kind: "exposure", settings: { exposure: stops, offset: 0, gamma: 1 }, name: `Auto Exposure ${stops > 0 ? "+" : ""}${stops} EV` });
  if (black > 2 || white < 253) await seq.run("levels endpoints", "adjust.layer", { doc: d, kind: "levels", settings: { channels: [{ channel: "composite", inputBlack: black, inputWhite: white, gamma: 1, outputBlack: 0, outputWhite: 255 }] }, name: "Auto Levels" });
  return seq.result({ measured: { meanLuminance: a.luminance.mean, p1: a.luminance.p1, p99: a.luminance.p99 }, exposureStops: stops, levels: { black, white }, changed: seq.steps.length > 0 }, warnings);
}

export async function correctWhiteBalance(ctx: ToolContext, d: unknown, strength: number): Promise<ToolOutput> {
  const { a, warnings } = await analyze(ctx, d);
  const gray = (a.mean.r + a.mean.g + a.mean.b) / 3;
  const k = strength / 100;
  const gamma = (m: number) => {
    const mn = Math.min(Math.max(m / 255, 0.02), 0.98), gr = Math.min(Math.max(gray / 255, 0.02), 0.98);
    return Math.round(Math.min(2.5, Math.max(0.4, 1 + (Math.log(mn) / Math.log(gr) - 1) * k)) * 100) / 100;
  };
  const channels = (["red", "green", "blue"] as const).map((c) => ({ channel: c, inputBlack: 0, inputWhite: 255, gamma: gamma(a.mean[c[0] as "r" | "g" | "b"]), outputBlack: 0, outputWhite: 255 }));
  const out = await adjustment(ctx, "levels", { channels }, { doc: d, name: "Auto White Balance" }, "Auto White Balance");
  return { data: { ...(out.data as object), measuredMean: a.mean, gammas: channels.map((c) => ({ channel: c.channel, gamma: c.gamma })), method: "gray-world" }, warnings: [...warnings, ...(out.warnings ?? [])] };
}

export async function restorePhoto(ctx: ToolContext, d: unknown, l: unknown, strength: number): Promise<ToolOutput> {
  const seq = new Sequence(ctx);
  let id = await workingCopy(seq, d, l, "Restoration", false);
  id = ((await seq.run("smart object", "layer.smartObject", { doc: d, layer: { id } })).data as { layer: { id: number } }).layer.id; // conversion creates a new layer id
  await seq.run("dust & scratches", "filter.apply", { doc: d, layer: { id }, kind: "dustAndScratches", settings: { radius: Math.max(1, Math.round(strength / 30)), threshold: 12 }, smart: true });
  await seq.run("noise reduction", "filter.apply", { doc: d, layer: { id }, kind: "median", settings: { radius: 1 }, smart: true });
  await seq.run("sharpen", "filter.apply", { doc: d, layer: { id }, kind: "unsharpMask", settings: { amount: 60, radius: 1, threshold: 3 }, smart: true });
  const tone = await correctExposure(ctx, d, 0.46);
  return { ...seq.result({ layerId: id }, ["Restoration removes fine dust and noise; large tears need remove_scratches/remove_object with regions."]), data: { ...(seq.result().data as object), tone: tone.data } };
}

export function registerRetouchTools(): void {
  const strength = z.number().min(0).max(100).default(50);
  tool({ name: "smooth_skin", module: M, description: "Skin smoothing: surface-blurred smart copy masked to skin tones (Color Range), blended by strength.", annotations: WRITE, status: "partial", limitations: HEURISTIC, commands: ["layer.duplicate", "layer.smartObject", "filter.apply", "select.colorRange", "mask.create", "layer.props"], input: { doc, layer, strength }, handler: (a, ctx) => smoothSkin(ctx, a.doc, a.layer, a.strength) });
  tool({ name: "retouch_skin", module: M, description: "Skin retouch: optional blemish removal at given spots, then skin smoothing.", annotations: WRITE, status: "partial", limitations: HEURISTIC, commands: ["edit.contentAwareFill", "filter.apply", "mask.create"],
    input: { doc, layer, strength, blemishes: spots.optional() },
    handler: async (a, ctx) => {
      const parts: ToolOutput[] = [];
      if (a.blemishes) parts.push(await contentAwareRegions(ctx, a.doc, a.layer, spotsToShapes(a.blemishes), "Blemish Fix"));
      parts.push(await smoothSkin(ctx, a.doc, a.layer, a.strength));
      return { data: parts.map((p) => p.data), warnings: parts.flatMap((p) => p.warnings ?? []) };
    } });
  tool({ name: "remove_blemishes", module: M, description: "Remove blemishes at given spots (x, y, radius) with Content-Aware Fill on a copy layer.", annotations: WRITE, commands: ["layer.duplicate", "select.ellipse", "edit.contentAwareFill"], input: { doc, layer, spots }, handler: (a, ctx) => contentAwareRegions(ctx, a.doc, a.layer, spotsToShapes(a.spots), "Blemish Fix") });
  tool({ name: "remove_spots", module: M, description: "Remove dust spots/specks at given points (Content-Aware Fill on a copy layer).", annotations: WRITE, commands: ["layer.duplicate", "select.ellipse", "edit.contentAwareFill"], input: { doc, layer, spots }, handler: (a, ctx) => contentAwareRegions(ctx, a.doc, a.layer, spotsToShapes(a.spots), "Spot Removal") });
  tool({ name: "remove_wrinkles", module: M, description: "Reduce wrinkles in regions: Content-Aware Fill on a copy layer blended at 60% to keep texture.", annotations: WRITE, status: "partial", limitations: HEURISTIC, commands: ["edit.contentAwareFill", "layer.props"],
    input: { doc, layer, regions: z.array(rect).min(1).max(100), blend: z.number().min(10).max(100).default(60) },
    handler: async (a, ctx) => {
      const out = await contentAwareRegions(ctx, a.doc, a.layer, a.regions, "Wrinkle Reduction", 2, true);
      const id = (out.data as { layerId: number }).layerId;
      await cmd(ctx, "layer.props", { doc: a.doc, layer: { id }, opacity: a.blend });
      return out;
    } });
  const regionAdjust = (nm: string, desc: string, build: (s: number) => { kind: "hueSaturation" | "curves"; settings: Record<string, unknown>; name: string }[]) =>
    tool({ name: nm, module: M, description: `${desc} Adjustment layers masked to the given regions.`, annotations: WRITE, commands: ["select.ellipse", "select.modify", "adjust.layer", "select.none"],
      input: { doc, regions: z.array(region).min(1).max(20), strength, feather: z.number().min(0).max(100).default(3) },
      handler: async (a, ctx) => {
        const seq = new Sequence(ctx);
        for (const [i, r] of a.regions.entries()) {
          const s = regionSelect(r, i === 0 ? "new" : "add");
          await seq.run(`region ${i + 1}`, s.command, { doc: a.doc, ...s.params });
        }
        if (a.feather) await seq.run("feather", "select.modify", { doc: a.doc, op: "feather", amount: a.feather });
        for (const adj of build(a.strength)) {
          await seq.run(adj.name, "adjust.layer", { doc: a.doc, kind: adj.kind, settings: adj.settings, name: adj.name, keepSelection: true });
        }
        await seq.run("deselect", "select.none", { doc: a.doc });
        return seq.result();
      } });
  regionAdjust("whiten_teeth", "Whiten teeth: desaturate yellows and lift lightness inside the teeth region(s).", (s) => [{ kind: "hueSaturation", name: "Teeth Whitening", settings: { saturation: -Math.round(20 + s * 0.4), lightness: Math.round(4 + s * 0.12) } }]);
  regionAdjust("brighten_eyes", "Brighten eyes: curves lift and slight saturation in the eye region(s).", (s) => [
    { kind: "curves", name: "Eye Brighten", settings: { channel: "composite", points: [{ input: 0, output: 0 }, { input: 128, output: Math.round(128 + s * 0.35) }, { input: 255, output: 255 }] } },
    { kind: "hueSaturation", name: "Eye Color", settings: { saturation: Math.round(s * 0.15) } },
  ]);
  regionAdjust("remove_red_eye", "Remove red eye: fully desaturate and darken the pupil region(s).", (s) => [{ kind: "hueSaturation", name: "Red Eye Fix", settings: { saturation: -100, lightness: -Math.round(30 + s * 0.3) } }]);

  tool({ name: "reduce_noise", module: M, description: "Noise reduction on a smart copy (median + surface blur), blended by strength.", annotations: WRITE, status: "partial", limitations: "Uses Median/Surface Blur; Camera Raw and Neural Filter denoise are not scriptable via ExtendScript.", commands: ["layer.duplicate", "filter.apply"],
    input: { doc, layer, strength },
    handler: async (a, ctx) => {
      const seq = new Sequence(ctx);
      let id = await workingCopy(seq, a.doc, a.layer, "Noise Reduction", false);
      id = ((await seq.run("smart object", "layer.smartObject", { doc: a.doc, layer: { id } })).data as { layer: { id: number } }).layer.id; // conversion creates a new layer id
      await seq.run("median", "filter.apply", { doc: a.doc, layer: { id }, kind: "median", settings: { radius: a.strength > 60 ? 2 : 1 }, smart: true });
      await seq.run("surface blur", "filter.apply", { doc: a.doc, layer: { id }, kind: "surfaceBlur", settings: { radius: Math.max(2, Math.round(a.strength / 15)), threshold: 8 }, smart: true });
      await seq.run("blend", "layer.props", { doc: a.doc, layer: { id }, opacity: Math.max(20, a.strength) });
      return seq.result({ layerId: id });
    } });
  tool({ name: "sharpen_image", module: M, description: "Sharpen on a copy layer: unsharp mask, smart sharpen or high-pass overlay.", annotations: WRITE, commands: ["layer.duplicate", "filter.apply"],
    input: { doc, layer, method: z.enum(["unsharp", "smart", "highpass"]).default("smart"), amount: z.number().min(1).max(500).default(80), radius: z.number().min(0.1).max(64).default(1.2) },
    handler: (a, ctx) => sharpen(ctx, a.doc, a.layer, a.amount, a.radius, a.method) });
  tool({ name: "correct_exposure", module: M, description: "Measure luminance in Photoshop and add Exposure + Levels adjustment layers to reach the target mean.", annotations: WRITE, commands: ["ps.analyze", "adjust.layer"],
    input: { doc, targetMean: z.number().min(0.1).max(0.9).default(0.46) }, handler: (a, ctx) => correctExposure(ctx, a.doc, a.targetMean) });
  tool({ name: "correct_white_balance", module: M, description: "Gray-world white balance: measured channel means → per-channel Levels gamma (adjustment layer).", annotations: WRITE, commands: ["ps.analyze", "adjust.layer"],
    input: { doc, strength: z.number().min(0).max(100).default(80) }, handler: (a, ctx) => correctWhiteBalance(ctx, a.doc, a.strength) });
  tool({ name: "remove_scratches", module: M, description: "Remove scratches: Dust & Scratches smart filter on a copy, optionally masked to regions; region list also gets Content-Aware Fill.", annotations: WRITE, commands: ["filter.apply", "edit.contentAwareFill"],
    input: { doc, layer, radius: z.number().int().min(1).max(50).default(3), threshold: z.number().int().min(0).max(255).default(12), regions: z.array(rect).max(100).optional() },
    handler: async (a, ctx) => {
      if (a.regions?.length) return contentAwareRegions(ctx, a.doc, a.layer, a.regions, "Scratch Fix", 3, false);
      const seq = new Sequence(ctx);
      let id = await workingCopy(seq, a.doc, a.layer, "Scratch Removal", false);
      id = ((await seq.run("smart object", "layer.smartObject", { doc: a.doc, layer: { id } })).data as { layer: { id: number } }).layer.id; // conversion creates a new layer id
      await seq.run("dust & scratches", "filter.apply", { doc: a.doc, layer: { id }, kind: "dustAndScratches", settings: { radius: a.radius, threshold: a.threshold }, smart: true });
      return seq.result({ layerId: id });
    } });
  tool({ name: "restore_photo", module: M, description: "Old-photo restoration stack: dust & scratches, noise reduction, sharpening (smart filters on a copy) + measured tonal correction.", annotations: WRITE, status: "partial", limitations: HEURISTIC, commands: ["filter.apply", "ps.analyze", "adjust.layer"],
    input: { doc, layer, strength }, handler: (a, ctx) => restorePhoto(ctx, a.doc, a.layer, a.strength) });
  tool({ name: "colorize_photo", module: M, description: "Tint/tone a black-and-white photo with a gradient map in Color blend mode (sepia, warm, cool or custom 3 colors).", annotations: WRITE, status: "partial",
    limitations: "Photoshop's Colorize Neural Filter is not scriptable; this applies an editable toning map, not AI colorization.", commands: ["adjust.layer"],
    input: { doc, preset: z.enum(["sepia", "warm", "cool", "custom"]).default("sepia"), colors: z.array(z.string()).length(3).optional().describe("shadow, mid, highlight hex (custom)"), opacity: z.number().min(0).max(100).default(70) },
    handler: async (a, ctx) => {
      const P: Record<string, [string, string, string]> = { sepia: ["#2B1B0E", "#A0714A", "#F3E3C3"], warm: ["#2A1408", "#C67B4E", "#FFE6C7"], cool: ["#0B1626", "#5C7FA3", "#E6F0FA"] };
      const c = a.preset === "custom" ? (a.colors as [string, string, string]) : P[a.preset]!;
      if (!c) throw new Error("custom preset needs colors");
      return cmd(ctx, "adjust.layer", { doc: a.doc, kind: "gradientMap", settings: { stops: [{ color: c[0], location: 0 }, { color: c[1], location: 50 }, { color: c[2], location: 100 }] }, name: `Colorize (${a.preset})`, blendMode: "color", opacity: a.opacity }, ["Toning map, not AI colorization."]);
    } });
  tool({ name: "enhance_portrait", module: M, description: "Portrait enhancement: measured exposure + white balance, vibrance, skin smoothing and sharpening, all on separate layers.", annotations: WRITE, status: "partial", limitations: HEURISTIC, commands: ["ps.analyze", "adjust.layer", "filter.apply", "mask.create"],
    input: { doc, layer, strength: z.number().min(0).max(100).default(40) },
    handler: async (a, ctx) => {
      // Resolve the photo layer first: later steps create adjustment layers that become active.
      const info = await cmd(ctx, "layer.info", { doc: a.doc, layer: a.layer });
      const photo = { id: (info.data as { layer: { id: number } }).layer.id };
      const parts = [
        await smoothSkin(ctx, a.doc, photo, a.strength),
        await sharpen(ctx, a.doc, photo, 60, 1, "smart"),
        await correctExposure(ctx, a.doc, 0.48),
        await correctWhiteBalance(ctx, a.doc, 60),
        await adjustment(ctx, "vibrance", { vibrance: 12, saturation: 0 }, { doc: a.doc }, "Portrait Vibrance"),
      ];
      return { data: parts.map((p) => p.data), warnings: [...new Set(parts.flatMap((p) => p.warnings ?? []))] };
    } });
}

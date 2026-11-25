import { z } from "zod";
import { GradientStop } from "../../schemas/index.js";
import { PsMcpError, unsupported, type AdjustmentKind } from "../../shared.js";
import { cmd, Sequence, tool, WRITE, type ToolContext, type ToolOutput } from "./registry.js";
import { blend, clip, color, doc, layer, name, opacity } from "./args.js";

const M = "color";
const common = { doc, layer: layer.describe("Insert the adjustment layer above this layer (default: active)"), clip, name, opacity, blendMode: blend };
type Common = { doc?: unknown; layer?: unknown; clip?: boolean; name?: string; opacity?: number; blendMode?: string };

/** Non-destructive: every color tool creates an adjustment layer (masked by the active selection, if any). */
export function adjustment(ctx: ToolContext, kind: AdjustmentKind, settings: Record<string, unknown>, c: Common, defaultName: string): Promise<ToolOutput> {
  return cmd(ctx, "adjust.layer", { doc: c.doc, layer: c.layer, kind, settings, clip: c.clip ?? false, name: c.name ?? defaultName, opacity: c.opacity, blendMode: c.blendMode });
}

interface Analysis { mean: { r: number; g: number; b: number }; luminance: { mean: number; stdev: number; p1: number; p99: number }; saturationMean: number; clipping: { shadows: number; highlights: number }; palette: string[] }

export async function analyze(ctx: ToolContext, d?: unknown, l?: unknown): Promise<{ a: Analysis; warnings: string[] }> {
  const out = await cmd(ctx, "ps.analyze", { doc: d, layer: l, sampleSize: 256 });
  return { a: out.data as Analysis, warnings: out.warnings ?? [] };
}

const channel = z.enum(["composite", "red", "green", "blue"]).default("composite");
const triple = z.tuple([z.number().min(-100).max(100), z.number().min(-100).max(100), z.number().min(-100).max(100)]).describe("[cyan↔red, magenta↔green, yellow↔blue]");

export const GRADES: Record<string, { label: string; steps: { kind: AdjustmentKind; settings: Record<string, unknown>; name: string; blendMode?: string; opacity?: number }[] }> = {
  teal_orange: {
    label: "Teal & orange",
    steps: [
      { kind: "colorBalance", name: "Grade: Teal Shadows / Warm Highlights", settings: { shadows: [-18, 0, 22], midtones: [4, 0, -6], highlights: [14, 0, -20], preserveLuminosity: true } },
      { kind: "curves", name: "Grade: Contrast", settings: { channel: "composite", points: [{ input: 0, output: 10 }, { input: 64, output: 52 }, { input: 192, output: 204 }, { input: 255, output: 245 }] } },
      { kind: "vibrance", name: "Grade: Vibrance", settings: { vibrance: 15, saturation: -5 } },
    ],
  },
  bleach_bypass: {
    label: "Bleach bypass",
    steps: [
      { kind: "blackAndWhite", name: "Grade: Bleach Bypass", settings: {}, blendMode: "overlay", opacity: 60 },
      { kind: "hueSaturation", name: "Grade: Desaturate", settings: { saturation: -35 } },
    ],
  },
  noir: {
    label: "Film noir",
    steps: [
      { kind: "blackAndWhite", name: "Grade: Noir B&W", settings: { reds: 30, yellows: 50, greens: 40, cyans: 60, blues: 20, magentas: 70 } },
      { kind: "curves", name: "Grade: Noir Contrast", settings: { channel: "composite", points: [{ input: 0, output: 0 }, { input: 70, output: 45 }, { input: 185, output: 215 }, { input: 255, output: 255 }] } },
    ],
  },
  warm_film: {
    label: "Warm film",
    steps: [
      { kind: "photoFilter", name: "Grade: Warm Filter", settings: { color: "#EC8A00", density: 25, preserveLuminosity: true } },
      { kind: "curves", name: "Grade: Faded Blacks", settings: { channel: "composite", points: [{ input: 0, output: 28 }, { input: 128, output: 130 }, { input: 255, output: 240 }] } },
    ],
  },
  cool_night: {
    label: "Cool night",
    steps: [
      { kind: "colorBalance", name: "Grade: Night Blue", settings: { shadows: [-20, 0, 30], midtones: [-10, 0, 18], highlights: [0, 0, 8], preserveLuminosity: true } },
      { kind: "brightnessContrast", name: "Grade: Night Exposure", settings: { brightness: -25, contrast: 15 } },
    ],
  },
};

export async function cinematicGrade(ctx: ToolContext, style: string, strength: number, d?: unknown): Promise<ToolOutput> {
  const g = GRADES[style];
  if (!g) throw new PsMcpError("VALIDATION_ERROR", `Unknown grade ${style}`);
  const seq = new Sequence(ctx);
  const group = await seq.run("group", "layer.create", { doc: d, kind: "group", name: `Color Grade: ${g.label}` });
  const groupId = (group.data as { layer: { id: number } }).layer.id;
  const skipped: string[] = [];
  for (const s of g.steps) {
    try {
      await seq.run(s.name, "adjust.layer", { doc: d, kind: s.kind, settings: s.settings, name: s.name, blendMode: s.blendMode, opacity: s.opacity, parent: { id: groupId } });
    } catch (e) {
      if (!/color mode/i.test((e as Error).message)) throw e;
      skipped.push(`${s.name}: not available in this document color mode (convert to RGB for the full grade)`);
    }
  }
  await seq.run("strength", "layer.props", { doc: d, layer: { id: groupId }, opacity: strength });
  return seq.result({ groupId, style, strength, skipped }, skipped);
}

export function registerColorTools(): void {
  const t = <S extends z.ZodRawShape>(nm: string, desc: string, input: S, build: (a: z.objectOutputType<S, z.ZodTypeAny> & Common, ctx: ToolContext) => Promise<ToolOutput>) =>
    tool({ name: nm, module: M, description: `${desc} Non-destructive adjustment layer.`, annotations: WRITE, commands: ["adjust.layer"], input: { ...common, ...input }, handler: (a, ctx) => build(a as never, ctx) });

  t("adjust_brightness", "Brightness.", { brightness: z.number().min(-150).max(150) }, (a, ctx) => adjustment(ctx, "brightnessContrast", { brightness: a.brightness, contrast: 0 }, a, "Brightness"));
  t("adjust_contrast", "Contrast.", { contrast: z.number().min(-50).max(100) }, (a, ctx) => adjustment(ctx, "brightnessContrast", { brightness: 0, contrast: a.contrast }, a, "Contrast"));
  t("adjust_exposure", "Exposure (stops), offset and gamma.", { exposure: z.number().min(-20).max(20).default(0), offset: z.number().min(-0.5).max(0.5).default(0), gamma: z.number().min(0.01).max(9.99).default(1) },
    (a, ctx) => adjustment(ctx, "exposure", { exposure: a.exposure, offset: a.offset, gamma: a.gamma }, a, "Exposure"));
  t("adjust_saturation", "Saturation (Hue/Saturation master).", { saturation: z.number().min(-100).max(100) }, (a, ctx) => adjustment(ctx, "hueSaturation", { saturation: a.saturation }, a, "Saturation"));
  t("adjust_vibrance", "Vibrance (protects skin tones) and saturation.", { vibrance: z.number().min(-100).max(100), saturation: z.number().min(-100).max(100).default(0) }, (a, ctx) => adjustment(ctx, "vibrance", { vibrance: a.vibrance, saturation: a.saturation }, a, "Vibrance"));
  t("adjust_hue", "Hue shift and optional lightness.", { hue: z.number().min(-180).max(180), lightness: z.number().min(-100).max(100).default(0) }, (a, ctx) => adjustment(ctx, "hueSaturation", { hue: a.hue, lightness: a.lightness }, a, "Hue"));
  t("adjust_temperature", "Warm (+) / cool (-) white balance via Color Balance midtones/highlights.", { temperature: z.number().min(-100).max(100) },
    (a, ctx) => { const v = a.temperature * 0.4; return adjustment(ctx, "colorBalance", { shadows: [0, 0, 0], midtones: [v, 0, -v], highlights: [v * 0.5, 0, -v * 0.5], preserveLuminosity: true }, a, "Temperature"); });
  t("adjust_tint", "Magenta (+) / green (-) tint via Color Balance.", { tint: z.number().min(-100).max(100) },
    (a, ctx) => { const v = a.tint * 0.4; return adjustment(ctx, "colorBalance", { shadows: [0, 0, 0], midtones: [0, -v, 0], highlights: [0, -v * 0.5, 0], preserveLuminosity: true }, a, "Tint"); });
  t("adjust_levels", "Levels: input black/white points, gamma, output range, per channel.", {
    channel, inputBlack: z.number().int().min(0).max(253).default(0), inputWhite: z.number().int().min(2).max(255).default(255), gamma: z.number().min(0.1).max(9.99).default(1),
    outputBlack: z.number().int().min(0).max(255).default(0), outputWhite: z.number().int().min(0).max(255).default(255),
  }, (a, ctx) => adjustment(ctx, "levels", { channels: [{ channel: a.channel, inputBlack: a.inputBlack, inputWhite: a.inputWhite, gamma: a.gamma, outputBlack: a.outputBlack, outputWhite: a.outputWhite }] }, a, "Levels"));
  t("adjust_curves", "Curves with control points (0-255) per channel.", { channel, points: z.array(z.object({ input: z.number().min(0).max(255), output: z.number().min(0).max(255) })).min(2).max(16) },
    (a, ctx) => adjustment(ctx, "curves", { channel: a.channel, points: [...a.points].sort((x, y) => x.input - y.input) }, a, "Curves"));
  t("adjust_color_balance", "Color Balance for shadows/midtones/highlights.", { shadows: triple.default([0, 0, 0]), midtones: triple.default([0, 0, 0]), highlights: triple.default([0, 0, 0]), preserveLuminosity: z.boolean().default(true) },
    (a, ctx) => adjustment(ctx, "colorBalance", { shadows: a.shadows, midtones: a.midtones, highlights: a.highlights, preserveLuminosity: a.preserveLuminosity }, a, "Color Balance"));
  t("apply_selective_color", "Selective Color corrections per color range.", {
    corrections: z.array(z.object({ color: z.enum(["reds", "yellows", "greens", "cyans", "blues", "magentas", "whites", "neutrals", "blacks"]), cyan: z.number().min(-100).max(100).default(0), magenta: z.number().min(-100).max(100).default(0), yellow: z.number().min(-100).max(100).default(0), black: z.number().min(-100).max(100).default(0) })).min(1).max(9),
    method: z.enum(["relative", "absolute"]).default("relative"),
  }, (a, ctx) => adjustment(ctx, "selectiveColor", { corrections: a.corrections, method: a.method }, a, "Selective Color"));
  t("apply_black_and_white", "Black & White with channel weights and optional tint.", {
    reds: z.number().min(-200).max(300).default(40), yellows: z.number().min(-200).max(300).default(60), greens: z.number().min(-200).max(300).default(40),
    cyans: z.number().min(-200).max(300).default(60), blues: z.number().min(-200).max(300).default(20), magentas: z.number().min(-200).max(300).default(80), tint: color.optional(),
  }, (a, ctx) => adjustment(ctx, "blackAndWhite", { reds: a.reds, yellows: a.yellows, greens: a.greens, cyans: a.cyans, blues: a.blues, magentas: a.magentas, tint: a.tint }, a, "Black & White"));
  t("apply_gradient_map", "Gradient Map (shadows→highlights colors).", { stops: z.array(GradientStop).min(2).max(16) }, (a, ctx) => adjustment(ctx, "gradientMap", { stops: a.stops }, a, "Gradient Map"));
  t("apply_photo_filter", "Photo Filter (warming/cooling or custom color).", { color: color.default("#EC8A00"), density: z.number().min(1).max(100).default(25), preserveLuminosity: z.boolean().default(true) },
    (a, ctx) => adjustment(ctx, "photoFilter", { color: a.color, density: a.density, preserveLuminosity: a.preserveLuminosity }, a, "Photo Filter"));
  t("apply_posterize", "Posterize.", { levels: z.number().int().min(2).max(255).default(6) }, (a, ctx) => adjustment(ctx, "posterize", { levels: a.levels }, a, "Posterize"));
  t("apply_threshold", "Threshold.", { level: z.number().int().min(1).max(255).default(128) }, (a, ctx) => adjustment(ctx, "threshold", { level: a.level }, a, "Threshold"));
  t("apply_invert", "Invert colors.", {}, (a, ctx) => adjustment(ctx, "invert", {}, a, "Invert"));

  tool({
    name: "apply_color_lookup", module: M, description: "Color Lookup (3D LUT).", annotations: WRITE, commands: [], status: "unsupported",
    limitations: "Loading a .cube/.3dl LUT into a Color Lookup layer requires embedding the LUT profile data; not supported via documented scripting APIs.",
    input: { ...common, lut: z.string().optional() },
    handler: async () => { throw unsupported("Color Lookup LUTs", "the LUT data descriptor is undocumented for scripting", "Use apply_cinematic_color_grade presets, or add the LUT once in Photoshop and record it as an action, then run_action."); },
  });
  tool({
    name: "apply_cinematic_color_grade", module: M, description: "Cinematic grade as a group of adjustment layers (teal_orange, bleach_bypass, noir, warm_film, cool_night); strength = group opacity.", annotations: WRITE, commands: ["layer.create", "adjust.layer", "layer.props"],
    input: { doc, style: z.enum(Object.keys(GRADES) as [string, ...string[]]).default("teal_orange"), strength: z.number().min(0).max(100).default(70) },
    handler: (a, ctx) => cinematicGrade(ctx, a.style, a.strength, a.doc),
  });
  tool({
    name: "match_colors", module: M, description: "Match the color/tonal statistics of a target layer (or document) to a reference document or layer using measured channel means → clipped Levels per channel.", annotations: WRITE, commands: ["ps.analyze", "adjust.layer"],
    status: "partial", limitations: "Statistical match (mean per channel and luminance), not Photoshop's Match Color dialog.",
    input: { doc, layer, referenceDoc: doc, referenceLayer: layer, strength: z.number().min(0).max(100).default(100) },
    handler: (a, ctx) => matchColors(ctx, a),
  });
}

/** Per-channel gamma so the target's channel means move to the reference's (both measured by Photoshop). */
export async function matchColors(ctx: ToolContext, a: { doc?: unknown; layer?: unknown; referenceDoc?: unknown; referenceLayer?: unknown; strength: number }): Promise<ToolOutput> {
  const tgt = await analyze(ctx, a.doc, a.layer);
  const ref = await analyze(ctx, a.referenceDoc ?? a.doc, a.referenceLayer);
  const k = a.strength / 100;
  const g = (m: number, r: number) => {
    const mn = Math.min(Math.max(m / 255, 0.02), 0.98), rf = Math.min(Math.max(r / 255, 0.02), 0.98);
    const gamma = Math.log(mn) / Math.log(rf);
    return Math.round(Math.min(3, Math.max(0.33, 1 + (gamma - 1) * k)) * 100) / 100;
  };
  const channels = (["red", "green", "blue"] as const).map((c) => {
    const key = c[0] as "r" | "g" | "b";
    return { channel: c, inputBlack: 0, inputWhite: 255, gamma: g(tgt.a.mean[key], ref.a.mean[key]), outputBlack: 0, outputWhite: 255 };
  });
  const out = await adjustment(ctx, "levels", { channels }, { doc: a.doc, layer: a.layer, clip: a.layer !== undefined, name: "Match Colors" }, "Match Colors");
  return { data: { ...(out.data as object), target: tgt.a.mean, reference: ref.a.mean, gammas: channels.map((c) => ({ channel: c.channel, gamma: c.gamma })) }, warnings: [...tgt.warnings, ...ref.warnings, ...(out.warnings ?? [])] };
}

import { z } from "zod";
import { unsupported, type FilterKind } from "../../shared.js";
import { cmd, tool, WRITE, type ToolContext, type ToolOutput } from "./registry.js";
import { doc, layer, smart } from "./args.js";
import { Bevel, DropShadow, Glow, StrokeFx } from "./effects.js";

const M = "filters";

export function filter(ctx: ToolContext, kind: FilterKind, settings: Record<string, unknown>, a: { doc?: unknown; layer?: unknown; smart?: boolean }): Promise<ToolOutput> {
  return cmd(ctx, "filter.apply", { doc: a.doc, layer: a.layer, kind, settings, smart: a.smart ?? true });
}

export function registerFilterTools(): void {
  const f = <S extends z.ZodRawShape>(nm: string, kind: FilterKind, desc: string, input: S, map: (a: z.objectOutputType<S, z.ZodTypeAny>) => Record<string, unknown> = (a) => a as never) =>
    tool({
      name: nm, module: M, description: `${desc} Applied as a Smart Filter by default (smart: false applies destructively to a pixel layer).`, annotations: WRITE, commands: ["filter.apply"],
      input: { doc, layer, smart, ...input },
      handler: (a, ctx) => {
        const { doc: d, layer: l, smart: s, ...rest } = a as Record<string, unknown>;
        const realKind = nm === "apply_distortion" ? (rest.kind as FilterKind) : kind;
        return filter(ctx, realKind, map(rest as never), { doc: d, layer: l, smart: s as boolean });
      },
    });

  f("apply_gaussian_blur", "gaussianBlur", "Gaussian Blur.", { radius: z.number().min(0.1).max(1000) });
  f("apply_motion_blur", "motionBlur", "Motion Blur.", { angle: z.number().min(-360).max(360).default(0), distance: z.number().int().min(1).max(2000).default(20) });
  f("apply_radial_blur", "radialBlur", "Radial Blur (spin or zoom) around the canvas center.", { amount: z.number().int().min(1).max(100).default(10), method: z.enum(["spin", "zoom"]).default("zoom"), quality: z.enum(["draft", "good", "best"]).default("good") });
  f("apply_surface_blur", "surfaceBlur", "Surface Blur (edge-preserving).", { radius: z.number().int().min(1).max(100).default(5), threshold: z.number().int().min(2).max(255).default(15) });
  f("apply_smart_sharpen", "smartSharpen", "Smart Sharpen.", { amount: z.number().min(1).max(500).default(100), radius: z.number().min(0.1).max(64).default(1), noiseReduction: z.number().min(0).max(100).default(10) });
  f("apply_unsharp_mask", "unsharpMask", "Unsharp Mask.", { amount: z.number().min(1).max(500).default(80), radius: z.number().min(0.1).max(1000).default(1.5), threshold: z.number().int().min(0).max(255).default(2) });
  f("apply_high_pass", "highPass", "High Pass (use with overlay blend for sharpening).", { radius: z.number().min(0.1).max(1000).default(3) });
  f("apply_noise", "addNoise", "Add Noise / film grain.", { amount: z.number().min(0.1).max(400).default(5), distribution: z.enum(["uniform", "gaussian"]).default("gaussian"), monochromatic: z.boolean().default(true) });
  f("apply_median", "median", "Median (noise / texture removal).", { radius: z.number().int().min(1).max(500).default(2) });
  f("apply_dust_and_scratches", "dustAndScratches", "Dust & Scratches.", { radius: z.number().int().min(1).max(500).default(2), threshold: z.number().int().min(0).max(255).default(10) });
  f("apply_texture", "texturizer", "Texturizer (brick, burlap, canvas, sandstone).", { texture: z.enum(["brick", "burlap", "canvas", "sandstone"]).default("canvas"), scaling: z.number().int().min(50).max(200).default(100), relief: z.number().int().min(0).max(50).default(4), light: z.enum(["top", "topLeft", "left", "bottomLeft", "bottom", "bottomRight", "right", "topRight"]).default("top") });
  f("apply_emboss", "emboss", "Emboss filter.", { angle: z.number().min(-360).max(360).default(135), height: z.number().int().min(1).max(100).default(3), amount: z.number().int().min(1).max(500).default(100) });
  f("apply_find_edges", "findEdges", "Find Edges.", {});
  f("apply_oil_paint", "oilPaint", "Oil Paint filter.", { stylization: z.number().min(0.1).max(10).default(4), cleanliness: z.number().min(0).max(10).default(5), scale: z.number().min(0.1).max(10).default(1), bristleDetail: z.number().min(0).max(10).default(3), lighting: z.boolean().default(true) });
  f("apply_distortion", "twirl", "Distortion filters: twirl, pinch, spherize, ripple.", { kind: z.enum(["twirl", "pinch", "spherize", "ripple"]).default("twirl"), amount: z.number().min(-999).max(999).default(50) });

  const fx = (nm: string, desc: string, key: string, schema: z.ZodTypeAny) =>
    tool({ name: nm, module: M, description: `${desc} Layer style (editable).`, annotations: WRITE, commands: ["layer.effects"], input: { doc, layer, settings: schema }, handler: (a, ctx) => cmd(ctx, "layer.effects", { doc: a.doc, layer: a.layer, effects: { [key]: a.settings } }) });
  fx("apply_glow", "Outer glow.", "outerGlow", Glow.default({}));
  fx("apply_inner_glow", "Inner glow.", "innerGlow", Glow.default({}));
  fx("apply_shadow", "Drop shadow.", "dropShadow", DropShadow.default({}));
  fx("apply_inner_shadow", "Inner shadow.", "innerShadow", DropShadow.default({}));
  fx("apply_stroke", "Stroke outline.", "stroke", StrokeFx.default({}));
  fx("apply_bevel", "Bevel & emboss.", "bevel", Bevel.default({}));
  tool({ name: "clear_layer_effects", module: M, description: "Remove all layer styles from a layer.", annotations: WRITE, commands: ["layer.clearEffects"], input: { doc, layer }, handler: (a, ctx) => cmd(ctx, "layer.clearEffects", a) });

  const no = (nm: string, feature: string, reason: string, alt: string) =>
    tool({ name: nm, module: M, description: `${feature}.`, annotations: WRITE, commands: [], status: "unsupported", limitations: reason, input: { doc, layer }, handler: async () => { throw unsupported(feature, reason, alt); } });
  no("apply_lens_blur", "Lens Blur", "Lens Blur uses a depth map in an interactive dialog; its descriptor is not documented for scripting.", "apply_gaussian_blur on a smart object plus a mask (create_depth_effect does this automatically).");
  no("apply_perspective_warp", "Perspective Warp", "Perspective Warp requires interactive quad placement.", "transform_image with skewX/skewY, or run a recorded action with run_action.");
  no("apply_liquify", "Liquify", "Liquify is an interactive brush workspace with no scripting API.", "apply_distortion (twirl/pinch/spherize) for global warps.");
}

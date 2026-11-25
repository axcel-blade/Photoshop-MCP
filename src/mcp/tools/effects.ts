import { z } from "zod";
import { BlendMode, Gradient, HexColor } from "../../schemas/index.js";

/** Layer-style (fx) schema; the JSX bridge turns it into a layerEffects descriptor merged with existing effects. */
export const DropShadow = z.object({
  color: HexColor.default("#000000"), opacity: z.number().min(0).max(100).default(60), angle: z.number().min(-360).max(360).default(120),
  distance: z.number().min(0).max(30000).default(10), size: z.number().min(0).max(250).default(15), spread: z.number().min(0).max(100).default(0),
  blendMode: BlendMode.default("multiply"),
});
export const Glow = z.object({
  color: HexColor.default("#FFE9A8"), opacity: z.number().min(0).max(100).default(60), size: z.number().min(0).max(250).default(20),
  spread: z.number().min(0).max(100).default(0), blendMode: BlendMode.default("screen"),
});
export const StrokeFx = z.object({
  color: HexColor.default("#000000"), size: z.number().min(1).max(250).default(3), position: z.enum(["outside", "inside", "center"]).default("outside"),
  opacity: z.number().min(0).max(100).default(100),
});
export const Bevel = z.object({
  style: z.enum(["innerBevel", "outerBevel", "emboss", "pillowEmboss"]).default("innerBevel"), depth: z.number().min(1).max(1000).default(100),
  size: z.number().min(0).max(250).default(5), soften: z.number().min(0).max(16).default(0), angle: z.number().default(120), altitude: z.number().min(0).max(90).default(30),
  direction: z.enum(["up", "down"]).default("up"),
});
export const GradientOverlay = z.object({ gradient: Gradient, opacity: z.number().min(0).max(100).default(100), blendMode: BlendMode.default("normal") });
export const ColorOverlay = z.object({ color: HexColor, opacity: z.number().min(0).max(100).default(100), blendMode: BlendMode.default("normal") });

export const Effects = z.object({
  dropShadow: DropShadow.optional(), innerShadow: DropShadow.optional(), outerGlow: Glow.optional(), innerGlow: Glow.optional(),
  stroke: StrokeFx.optional(), bevel: Bevel.optional(), gradientOverlay: GradientOverlay.optional(), colorOverlay: ColorOverlay.optional(),
}).refine((e) => Object.values(e).some(Boolean), "Give at least one effect");
export type Effects = z.infer<typeof Effects>;

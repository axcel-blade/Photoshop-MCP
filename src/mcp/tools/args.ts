import { z } from "zod";
import { BlendMode, Confirm, DocRef, FilePath, Gradient, HexColor, LayerRef, Overwrite, Rect } from "../../schemas/index.js";
import { FORMAT_EXTENSIONS, IMAGE_INPUT_EXTENSIONS } from "../../utils/paths.js";
import type { ToolContext } from "./registry.js";

export const layer = LayerRef.optional();
export const doc = DocRef.optional();
export const name = z.string().min(1).max(255).optional().describe("Layer name");
export const color = HexColor;
export const opacity = z.number().min(0).max(100).optional().describe("Opacity 0-100");
export const blend = BlendMode.optional();
export const confirm = Confirm;
export const overwrite = Overwrite;
export const path = FilePath;
export const rect = Rect;
export const gradient = Gradient;
export const clip = z.boolean().default(false).describe("Clip the adjustment to the layer below (affects only that layer)");
export const smart = z.boolean().default(true).describe("Apply as an editable Smart Filter (converts the layer to a smart object if needed)");
export const region = z.union([
  z.object({ shape: z.literal("rect"), bounds: Rect }),
  z.object({ shape: z.literal("ellipse"), bounds: Rect }),
  z.object({ shape: z.literal("polygon"), points: z.array(z.object({ x: z.number(), y: z.number() })).min(3).max(500) }),
]).describe("Image region in document pixels");
export type Region = z.infer<typeof region>;

export const spots = z.array(z.object({ x: z.number(), y: z.number(), radius: z.number().min(1).max(2000) })).min(1).max(500);

/** Resolve an input image path inside the sandbox. */
export function inputPath(ctx: ToolContext, p: string): string {
  return ctx.paths.resolve(p, { extensions: IMAGE_INPUT_EXTENSIONS, mustExist: true });
}

/** Resolve an output path for a format (validated extension, no silent overwrite). */
export function outputPath(ctx: ToolContext, p: string, format: string, ow: boolean): string {
  return ctx.paths.resolveOutput(p, { extensions: FORMAT_EXTENSIONS[format] ?? [`.${format}`], overwrite: ow });
}

/** Convert a region into the bridge's selection op + params. */
export function regionSelect(r: Region, mode: "new" | "add" | "subtract" | "intersect" = "new"): { command: string; params: Record<string, unknown> } {
  if (r.shape === "polygon") return { command: "select.polygon", params: { points: r.points, mode } };
  return { command: r.shape === "rect" ? "select.rect" : "select.ellipse", params: { bounds: r.bounds, mode } };
}

export function spotsToShapes(s: z.infer<typeof spots>): { left: number; top: number; right: number; bottom: number }[] {
  return s.map((p) => ({ left: p.x - p.radius, top: p.y - p.radius, right: p.x + p.radius, bottom: p.y + p.radius }));
}

export const docSize = { width: z.number().int().min(1).max(300000), height: z.number().int().min(1).max(300000) };

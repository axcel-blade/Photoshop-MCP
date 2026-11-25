import { z } from "zod";
import { BLEND_MODES, COLOR_RANGE_PRESETS, isHex } from "../shared.js";

export const HexColor = z.string().refine(isHex, "Expected a hex color like #1A2B3C").describe("Hex color, e.g. #1A2B3C");

/** A layer reference: by numeric id (stable) or by name (first match, top-down). Omitted = active layer. */
export const LayerRef = z
  .union([
    z.object({ id: z.number().int().positive() }),
    z.object({ name: z.string().min(1).max(255) }),
  ])
  .describe("Layer reference {id} (preferred, from get_layers) or {name}. Omit to use the active layer.");
export type LayerRef = z.infer<typeof LayerRef>;

export const DocRef = z
  .union([z.object({ id: z.number().int().positive() }), z.object({ name: z.string().min(1).max(255) })])
  .describe("Document reference {id} or {name}. Omit to use the active document.");

export const Point = z.object({ x: z.number(), y: z.number() });
export const Rect = z
  .object({ left: z.number(), top: z.number(), right: z.number(), bottom: z.number() })
  .refine((r) => r.right > r.left && r.bottom > r.top, "right/bottom must exceed left/top")
  .describe("Rectangle in document pixels (origin top-left)");
export type Rect = z.infer<typeof Rect>;

export const BlendMode = z.enum(BLEND_MODES);
export const ColorRangePreset = z.enum(COLOR_RANGE_PRESETS);
export const Percent = z.number().min(0).max(100);

export const GradientStop = z.object({
  color: HexColor,
  location: z.number().min(0).max(100),
  opacity: z.number().min(0).max(100).default(100).describe("Stop opacity (transparency stop at the same location)"),
});
export const Gradient = z.object({
  stops: z.array(GradientStop).min(2).max(16),
  angle: z.number().min(-360).max(360).default(90),
  type: z.enum(["linear", "radial", "angle", "reflected", "diamond"]).default("linear"),
});
export type Gradient = z.infer<typeof Gradient>;

export const Stroke = z.object({
  color: HexColor,
  width: z.number().min(0.1).max(250).default(2),
  position: z.enum(["outside", "inside", "center"]).default("outside"),
});

export const FilePath = z.string().min(1).max(1024).describe("File path inside an allowed directory (see ALLOWED_PATHS)");
export const Confirm = z.boolean().optional().describe("Must be true for destructive operations, after asking the user");
export const Overwrite = z.boolean().default(false).describe("Replace an existing file (never silent; default false)");

export const ExportFormat = z.enum(["png", "jpg", "webp", "tiff", "pdf", "psd", "psb", "gif", "bmp"]);
export type ExportFormat = z.infer<typeof ExportFormat>;

/** Workflow step definitions shared by the engine and the server. */
export const WorkflowStep = z.object({
  id: z.string().regex(/^[a-zA-Z][\w-]{0,40}$/).optional().describe("Step id; later steps may reference its result as {{steps.<id>.data.<path>}}"),
  tool: z.string().min(1).max(100),
  args: z.record(z.unknown()).default({}),
  description: z.string().max(500).optional(),
  continueOnError: z.boolean().default(false),
});
export type WorkflowStep = z.infer<typeof WorkflowStep>;

export const Workflow = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  steps: z.array(WorkflowStep).min(1).max(200),
});
export type Workflow = z.infer<typeof Workflow>;

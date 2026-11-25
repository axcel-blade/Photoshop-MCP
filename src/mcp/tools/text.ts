import { z } from "zod";
import { getStyle, STYLES, compileLayout } from "../../workflow-engine/index.js";
import { PsMcpError } from "../../shared.js";
import { cmd, DESTRUCTIVE, requireConfirm, tool, WRITE } from "./registry.js";
import { color, confirm, doc, gradient, layer, name } from "./args.js";
import { Bevel, DropShadow, Effects, Glow, StrokeFx } from "./effects.js";
import { runSteps } from "./compose.js";

const M = "text";
const font = z.string().min(1).max(200).describe("PostScript font name, e.g. ArialMT, Arial-BoldMT, TimesNewRomanPSMT, MyriadPro-Regular. Missing fonts are reported, never silently assumed.");
const alignment = z.enum(["left", "center", "right", "justify"]);

export function registerTextTools(): void {
  tool({
    name: "add_text", module: M, description: "Create a live (editable) text layer. (x, y) is the text anchor: baseline of the first line; for center/right alignment x is the center/right edge. Give box {width,height} for paragraph text.", annotations: WRITE, commands: ["text.create"],
    input: {
      doc, text: z.string().min(1).max(20000), x: z.number(), y: z.number(), name, font: font.default("ArialMT"), size: z.number().min(0.1).max(5000).default(48).describe("Size in px"),
      color: color.default("#000000"), alignment: alignment.default("left"), tracking: z.number().min(-1000).max(10000).default(0), leading: z.number().min(0.1).max(5000).optional(),
      box: z.object({ width: z.number().min(1), height: z.number().min(1) }).optional(),
    },
    handler: (a, ctx) => cmd(ctx, "text.create", a),
  });
  tool({ name: "edit_text", module: M, description: "Replace a text layer's contents.", annotations: WRITE, commands: ["text.edit"], input: { doc, layer, text: z.string().min(1).max(20000) }, handler: (a, ctx) => cmd(ctx, "text.edit", a) });
  tool({
    name: "delete_text", module: M, description: "Delete a text layer. Requires confirm: true.", annotations: DESTRUCTIVE, commands: ["layer.info", "layer.delete"],
    input: { doc, layer, confirm }, handler: async (a, ctx) => {
      requireConfirm(a.confirm, "Deleting a text layer");
      const info = await cmd(ctx, "layer.info", { doc: a.doc, layer: a.layer });
      const l = (info.data as { layer: { id: number; kind: string; name: string } }).layer;
      if (l.kind !== "text") throw new PsMcpError("VALIDATION_ERROR", `Layer "${l.name}" is ${l.kind}, not text; use delete_layer.`);
      return cmd(ctx, "layer.delete", { doc: a.doc, layer: { id: l.id } });
    },
  });
  tool({
    name: "replace_text", module: M, description: "Find & replace inside one text layer, or all text layers when layer is omitted.", annotations: WRITE, commands: ["text.edit"],
    input: { doc, layer, find: z.string().min(1).max(1000), replace: z.string().max(1000) },
    handler: (a, ctx) => cmd(ctx, "text.edit", { doc: a.doc, layer: a.layer, find: a.find, replace: a.replace, allTextLayers: a.layer === undefined }),
  });
  tool({ name: "set_font", module: M, description: "Set the font (PostScript name) of a text layer.", annotations: WRITE, commands: ["text.edit"], input: { doc, layer, font }, handler: (a, ctx) => cmd(ctx, "text.edit", a) });
  tool({ name: "set_font_size", module: M, description: "Set text size in px.", annotations: WRITE, commands: ["text.edit"], input: { doc, layer, size: z.number().min(0.1).max(5000) }, handler: (a, ctx) => cmd(ctx, "text.edit", a) });
  tool({ name: "set_font_color", module: M, description: "Set text color.", annotations: WRITE, commands: ["text.edit"], input: { doc, layer, color }, handler: (a, ctx) => cmd(ctx, "text.edit", a) });
  tool({
    name: "set_font_style", module: M, description: "Faux bold/italic, underline, all caps, small caps, strikethrough. Prefer a real bold/italic font via set_font.", annotations: WRITE, commands: ["text.edit"],
    input: { doc, layer, fauxBold: z.boolean().optional(), fauxItalic: z.boolean().optional(), underline: z.boolean().optional(), strikethrough: z.boolean().optional(), capitalization: z.enum(["normal", "allCaps", "smallCaps"]).optional() },
    handler: (a, ctx) => cmd(ctx, "text.edit", a),
  });
  tool({ name: "set_text_alignment", module: M, description: "Paragraph alignment.", annotations: WRITE, commands: ["text.edit"], input: { doc, layer, alignment }, handler: (a, ctx) => cmd(ctx, "text.edit", a) });
  tool({ name: "set_character_spacing", module: M, description: "Tracking in 1/1000 em.", annotations: WRITE, commands: ["text.edit"], input: { doc, layer, tracking: z.number().min(-1000).max(10000) }, handler: (a, ctx) => cmd(ctx, "text.edit", a) });
  tool({
    name: "set_line_spacing", module: M, description: "Leading in px, or auto.", annotations: WRITE, commands: ["text.edit"],
    input: { doc, layer, leading: z.union([z.number().min(0.1).max(5000), z.literal("auto")]) }, handler: (a, ctx) => cmd(ctx, "text.edit", a),
  });
  tool({
    name: "transform_text", module: M, description: "Scale / rotate a text layer while keeping it editable.", annotations: WRITE, commands: ["layer.transform"],
    input: { doc, layer, scale: z.number().min(1).max(5000).optional().describe("percent"), rotate: z.number().min(-360).max(360).optional() },
    handler: (a, ctx) => cmd(ctx, "layer.transform", { doc: a.doc, layer: a.layer, scaleX: a.scale, scaleY: a.scale, angle: a.rotate }),
  });
  tool({
    name: "add_text_effect", module: M, description: "Add layer styles (drop shadow, glow, stroke, bevel, gradient/color overlay) to any layer; merges with existing effects.", annotations: WRITE, commands: ["layer.effects"],
    input: { doc, layer, effects: Effects }, handler: (a, ctx) => cmd(ctx, "layer.effects", a),
  });
  tool({ name: "create_text_outline", module: M, description: "Outline text with a Stroke layer style (stays editable).", annotations: WRITE, commands: ["layer.effects"], input: { doc, layer, stroke: StrokeFx.default({}) }, handler: (a, ctx) => cmd(ctx, "layer.effects", { doc: a.doc, layer: a.layer, effects: { stroke: a.stroke } }) });
  tool({ name: "create_text_shadow", module: M, description: "Drop shadow on text.", annotations: WRITE, commands: ["layer.effects"], input: { doc, layer, shadow: DropShadow.default({}) }, handler: (a, ctx) => cmd(ctx, "layer.effects", { doc: a.doc, layer: a.layer, effects: { dropShadow: a.shadow } }) });
  tool({ name: "create_gradient_text", module: M, description: "Fill text with a gradient (Gradient Overlay style).", annotations: WRITE, commands: ["layer.effects"], input: { doc, layer, gradient }, handler: (a, ctx) => cmd(ctx, "layer.effects", { doc: a.doc, layer: a.layer, effects: { gradientOverlay: { gradient: a.gradient, opacity: 100, blendMode: "normal" } } }) });
  tool({
    name: "create_text_glow", module: M, description: "Outer glow around text.", annotations: WRITE, commands: ["layer.effects"],
    input: { doc, layer, glow: Glow.default({}) }, handler: (a, ctx) => cmd(ctx, "layer.effects", { doc: a.doc, layer: a.layer, effects: { outerGlow: a.glow } }),
  });
  tool({
    name: "convert_text_to_shape", module: M, description: "Convert text to a vector shape layer (no longer editable as text). Requires confirm: true.", annotations: DESTRUCTIVE, commands: ["text.toShape"],
    input: { doc, layer, confirm }, handler: (a, ctx) => {
      requireConfirm(a.confirm, "Converting text to shape");
      return cmd(ctx, "text.toShape", { doc: a.doc, layer: a.layer });
    },
  });
  tool({
    name: "create_typography_design", module: M, description: "Typographic composition on a new canvas: headline (+ optional subhead) with style-driven fonts, colors and effects.", annotations: WRITE, commands: ["doc.create", "fill.gradient", "text.create", "layer.effects"],
    input: {
      headline: z.string().min(1).max(200), subhead: z.string().max(300).optional(), width: z.number().int().min(64).max(20000).default(1920), height: z.number().int().min(64).max(20000).default(1080),
      style: z.enum(STYLES.map((s) => s.id) as [string, ...string[]]).default("bold"), bevel: Bevel.optional(), useActiveDocument: z.boolean().default(false),
    },
    handler: async (a, ctx) => {
      const steps = compileLayout({ kind: "typography", width: a.width, height: a.height, style: getStyle(a.style)!, headline: a.headline, subhead: a.subhead, useActiveDocument: a.useActiveDocument });
      if (a.bevel) steps.push({ tool: "add_text_effect", args: { layer: { name: "Headline" }, effects: { bevel: a.bevel } }, continueOnError: false });
      return runSteps(ctx, steps);
    },
  });
}

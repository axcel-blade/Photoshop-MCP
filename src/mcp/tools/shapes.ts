import { z } from "zod";
import { CANVAS_PRESETS, compileLayout, getPreset, getStyle, STYLES, type LayoutKind } from "../../workflow-engine/index.js";
import { HexColor, Stroke } from "../../schemas/index.js";
import { cmd, Sequence, tool, WRITE } from "./registry.js";
import { color, doc, gradient, layer, name, opacity, path, rect } from "./args.js";
import { runSteps } from "./compose.js";

const M = "shapes";
const fill = color.optional().describe("Fill color (default #000000)");
const stroke = Stroke.optional();

/** Polygon vertices for a custom shape inside bounds. */
export function customShapePoints(shape: string, b: { left: number; top: number; right: number; bottom: number }, opts: { points?: number; innerRatio?: number } = {}): { x: number; y: number }[] {
  const cx = (b.left + b.right) / 2, cy = (b.top + b.bottom) / 2, rx = (b.right - b.left) / 2, ry = (b.bottom - b.top) / 2;
  const P = (x: number, y: number) => ({ x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 });
  const ring = (n: number, rot = -Math.PI / 2, ratio?: number) => {
    const pts = [];
    const total = ratio ? n * 2 : n;
    for (let i = 0; i < total; i++) {
      const a = rot + (i * 2 * Math.PI) / total;
      const k = ratio && i % 2 === 1 ? ratio : 1;
      pts.push(P(cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k));
    }
    return pts;
  };
  switch (shape) {
    case "triangle": return [P(cx, b.top), P(b.right, b.bottom), P(b.left, b.bottom)];
    case "diamond": return [P(cx, b.top), P(b.right, cy), P(cx, b.bottom), P(b.left, cy)];
    case "hexagon": return ring(6, 0);
    case "octagon": return ring(8, Math.PI / 8);
    case "star": return ring(opts.points ?? 5, -Math.PI / 2, opts.innerRatio ?? 0.45);
    case "burst": return ring(opts.points ?? 16, -Math.PI / 2, opts.innerRatio ?? 0.75);
    case "arrow": {
      const sh = ry * 0.45;
      const head = b.left + (b.right - b.left) * 0.62;
      return [P(b.left, cy - sh), P(head, cy - sh), P(head, b.top), P(b.right, cy), P(head, b.bottom), P(head, cy + sh), P(b.left, cy + sh)];
    }
    case "heart": {
      const pts = [];
      for (let i = 0; i < 64; i++) {
        const t = (i / 64) * 2 * Math.PI;
        const x = 16 * Math.sin(t) ** 3;
        const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
        pts.push(P(cx + (x / 17) * rx, cy - (y / 17) * ry));
      }
      return pts;
    }
    case "speech_bubble": {
      const bh = (b.bottom - b.top) * 0.78;
      return [P(b.left, b.top), P(b.right, b.top), P(b.right, b.top + bh), P(b.left + (b.right - b.left) * 0.35, b.top + bh), P(b.left + (b.right - b.left) * 0.18, b.bottom), P(b.left + (b.right - b.left) * 0.2, b.top + bh), P(b.left, b.top + bh)];
    }
    default: throw new Error(`Unknown shape ${shape}`);
  }
}

const styleEnum = z.enum(STYLES.map((s) => s.id) as [string, ...string[]]);
const designInput = {
  headline: z.string().min(1).max(200), subhead: z.string().max(300).optional(), body: z.string().max(1000).optional(), cta: z.string().max(60).optional(),
  style: styleEnum.default("bold"), colors: z.array(HexColor).max(2).optional().describe("Override primary/accent colors"),
  imagePath: path.optional().describe("Optional hero image inside an allowed directory"), removeBackground: z.boolean().default(false),
  width: z.number().int().min(64).max(30000).optional(), height: z.number().int().min(64).max(30000).optional(),
  useActiveDocument: z.boolean().default(false).describe("Draw into the active document instead of creating one"),
};

function designTool(toolName: string, kind: LayoutKind, defaultPreset: string, description: string, extra: Record<string, z.ZodTypeAny> = {}) {
  tool({
    name: toolName, module: M, description: `${description} Builds fully editable layers (fill layers, vector shapes, live text, smart-object image) and returns every step.`,
    annotations: WRITE, commands: ["doc.create", "fill.gradient", "shape.rect", "shape.ellipse", "text.create", "image.place", "layer.effects", "filter.apply"],
    input: { ...designInput, preset: z.enum(CANVAS_PRESETS.map((p) => p.id) as [string, ...string[]]).default(defaultPreset), ...extra },
    handler: async (a, ctx) => {
      const preset = getPreset(String((a as { platform?: string }).platform ?? a.preset))!;
      const imagePath = a.imagePath ? ctx.paths.resolve(a.imagePath, { mustExist: true }) : undefined;
      const steps = compileLayout({
        kind, width: a.width ?? preset.width, height: a.height ?? preset.height, resolution: preset.resolution, style: getStyle(a.style)!,
        headline: a.headline, subhead: a.subhead, body: a.body, cta: a.cta, imagePath, removeBackground: a.removeBackground, shadow: Boolean(imagePath) && kind === "advertisement",
        colors: a.colors, useActiveDocument: a.useActiveDocument, documentName: `${toolName.replace("create_", "")}`,
      });
      const out = await runSteps(ctx, steps);
      out.warnings = [...(out.warnings ?? []), "Review the result with capture_preview before delivering; save with save_document_as."];
      return out;
    },
  });
}

export function registerShapeTools(): void {
  tool({
    name: "create_rectangle", module: M, description: "Vector rectangle shape layer (optional corner radius, fill, stroke).", annotations: WRITE, commands: ["shape.rect"],
    input: { doc, bounds: rect, fill, stroke, radius: z.number().min(0).max(10000).default(0), name, opacity }, handler: (a, ctx) => cmd(ctx, "shape.rect", a),
  });
  tool({
    name: "create_ellipse", module: M, description: "Vector ellipse shape layer.", annotations: WRITE, commands: ["shape.ellipse"],
    input: { doc, bounds: rect, fill, stroke, name, opacity }, handler: (a, ctx) => cmd(ctx, "shape.ellipse", a),
  });
  tool({
    name: "create_polygon", module: M, description: "Vector polygon shape layer from points, or a regular polygon from center/radius/sides.", annotations: WRITE, commands: ["shape.polygon"],
    input: {
      doc, points: z.array(z.object({ x: z.number(), y: z.number() })).min(3).max(1000).optional(),
      center: z.object({ x: z.number(), y: z.number() }).optional(), radius: z.number().min(1).optional(), sides: z.number().int().min(3).max(100).default(6),
      fill, stroke, name, opacity,
    },
    handler: (a, ctx) => {
      let points = a.points;
      if (!points) {
        if (!a.center || !a.radius) throw new Error("Give points, or center + radius");
        const c = a.center, r = a.radius;
        points = Array.from({ length: a.sides }, (_, i) => ({ x: c.x + r * Math.cos(-Math.PI / 2 + (i * 2 * Math.PI) / a.sides), y: c.y + r * Math.sin(-Math.PI / 2 + (i * 2 * Math.PI) / a.sides) }));
      }
      return cmd(ctx, "shape.polygon", { doc: a.doc, points, fill: a.fill, stroke: a.stroke, name: a.name, opacity: a.opacity });
    },
  });
  tool({
    name: "create_line", module: M, description: "Straight line as a thin vector shape layer.", annotations: WRITE, commands: ["shape.polygon"],
    input: { doc, from: z.object({ x: z.number(), y: z.number() }), to: z.object({ x: z.number(), y: z.number() }), width: z.number().min(0.5).max(1000).default(4), color: color.default("#000000"), name, opacity },
    handler: (a, ctx) => {
      const dx = a.to.x - a.from.x, dy = a.to.y - a.from.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = (-dy / len) * (a.width / 2), ny = (dx / len) * (a.width / 2);
      const points = [{ x: a.from.x + nx, y: a.from.y + ny }, { x: a.to.x + nx, y: a.to.y + ny }, { x: a.to.x - nx, y: a.to.y - ny }, { x: a.from.x - nx, y: a.from.y - ny }];
      return cmd(ctx, "shape.polygon", { doc: a.doc, points, fill: a.color, name: a.name ?? "Line", opacity: a.opacity });
    },
  });
  tool({
    name: "create_custom_shape", module: M, description: "Vector custom shape: star, burst, heart, arrow, triangle, diamond, hexagon, octagon, speech_bubble.", annotations: WRITE, commands: ["shape.polygon"],
    input: { doc, shape: z.enum(["star", "burst", "heart", "arrow", "triangle", "diamond", "hexagon", "octagon", "speech_bubble"]), bounds: rect, points: z.number().int().min(3).max(64).optional(), innerRatio: z.number().min(0.05).max(0.95).optional(), fill, stroke, name, opacity },
    handler: (a, ctx) => cmd(ctx, "shape.polygon", { doc: a.doc, points: customShapePoints(a.shape, a.bounds, { points: a.points, innerRatio: a.innerRatio }), fill: a.fill, stroke: a.stroke, name: a.name ?? a.shape, opacity: a.opacity }),
  });
  tool({
    name: "edit_shape", module: M, description: "Change a shape/fill layer's fill color, stroke or opacity.", annotations: WRITE, commands: ["shape.edit"],
    input: { doc, layer, fill, stroke: z.union([Stroke, z.literal("none")]).optional(), opacity }, handler: (a, ctx) => cmd(ctx, "shape.edit", a),
  });
  tool({
    name: "transform_shape", module: M, description: "Scale, rotate, flip or move a layer (shape layers stay vector).", annotations: WRITE, commands: ["layer.transform"],
    input: { doc, layer, scaleX: z.number().min(0.1).max(10000).optional(), scaleY: z.number().min(0.1).max(10000).optional(), angle: z.number().min(-360).max(360).optional(), dx: z.number().optional(), dy: z.number().optional(), flip: z.enum(["horizontal", "vertical"]).optional() },
    handler: (a, ctx) => cmd(ctx, "layer.transform", a),
  });
  tool({ name: "set_shape_fill", module: M, description: "Set a shape layer's fill color.", annotations: WRITE, commands: ["shape.edit"], input: { doc, layer, fill: color }, handler: (a, ctx) => cmd(ctx, "shape.edit", a) });
  tool({ name: "set_shape_stroke", module: M, description: "Set or remove a shape layer's stroke.", annotations: WRITE, commands: ["shape.edit"], input: { doc, layer, stroke: z.union([Stroke, z.literal("none")]) }, handler: (a, ctx) => cmd(ctx, "shape.edit", a) });
  tool({
    name: "create_gradient", module: M, description: "Gradient fill layer (editable). Covers the canvas, or only `bounds` (masked).", annotations: WRITE, commands: ["fill.gradient"],
    input: { doc, gradient, bounds: rect.optional(), name, opacity, blendMode: z.string().optional() }, handler: (a, ctx) => cmd(ctx, "fill.gradient", a),
  });
  tool({
    name: "create_pattern", module: M, description: "Procedural pattern (dots, grid, stripes, checker, diagonal) drawn as one pixel layer.", annotations: WRITE, commands: ["layer.create", "select.rect", "select.ellipse", "edit.fillSelection", "select.none"],
    input: {
      doc, kind: z.enum(["dots", "grid", "stripes", "checker", "diagonal"]).default("dots"), spacing: z.number().min(4).max(2000).default(40), size: z.number().min(1).max(2000).default(8),
      color: color.default("#000000"), opacity: z.number().min(0).max(100).default(30), bounds: rect.optional(), name: name.default("Pattern"),
    },
    handler: async (a, ctx) => {
      const info = await cmd(ctx, "doc.info", { doc: a.doc });
      const d = (info.data as { document: { width: number; height: number } }).document;
      const b = a.bounds ?? { left: 0, top: 0, right: d.width, bottom: d.height };
      const shapes: { left: number; top: number; right: number; bottom: number }[] = [];
      const s = a.spacing, z2 = a.size;
      let ellipse = false;
      if (a.kind === "dots") { ellipse = true; for (let y = b.top; y < b.bottom; y += s) for (let x = b.left; x < b.right; x += s) shapes.push({ left: x, top: y, right: x + z2, bottom: y + z2 }); }
      if (a.kind === "grid") { for (let x = b.left; x < b.right; x += s) shapes.push({ left: x, top: b.top, right: x + z2, bottom: b.bottom }); for (let y = b.top; y < b.bottom; y += s) shapes.push({ left: b.left, top: y, right: b.right, bottom: y + z2 }); }
      if (a.kind === "stripes") for (let y = b.top; y < b.bottom; y += s) shapes.push({ left: b.left, top: y, right: b.right, bottom: y + z2 });
      if (a.kind === "checker") for (let y = b.top, r = 0; y < b.bottom; y += s, r++) for (let x = b.left + (r % 2) * s; x < b.right; x += 2 * s) shapes.push({ left: x, top: y, right: x + s, bottom: y + s });
      if (a.kind === "diagonal") { ellipse = false; for (let k = b.left - (b.bottom - b.top); k < b.right; k += s) for (let y = b.top; y < b.bottom; y += z2) shapes.push({ left: k + (y - b.top), top: y, right: k + (y - b.top) + z2, bottom: y + z2 }); }
      if (shapes.length > 5000) throw new Error(`Pattern would need ${shapes.length} cells (max 5000); increase spacing.`);
      const seq = new Sequence(ctx);
      const created = await seq.run("layer", "layer.create", { doc: a.doc, name: a.name, opacity: a.opacity });
      const id = (created.data as { layer: { id: number } }).layer.id;
      await seq.run("select", ellipse ? "select.ellipse" : "select.rect", { doc: a.doc, shapes, mode: "new" });
      await seq.run("fill", "edit.fillSelection", { doc: a.doc, layer: { id }, color: a.color });
      await seq.run("deselect", "select.none", { doc: a.doc });
      return seq.result({ layerId: id, cells: shapes.length });
    },
  });

  designTool("create_banner", "banner", "web_banner", "Wide web/hero banner.");
  designTool("create_social_media_design", "social", "instagram_post", "Social post sized for a platform preset.", { platform: z.enum(CANVAS_PRESETS.map((p) => p.id) as [string, ...string[]]).optional().describe("Alias of preset") });
  designTool("create_thumbnail", "thumbnail", "youtube_thumbnail", "High-contrast YouTube-style thumbnail (1280x720).");
  designTool("create_advertisement", "advertisement", "instagram_post", "Advertisement with product image, headline and CTA.");
  designTool("create_magazine_cover", "magazine_cover", "magazine_cover", "Magazine cover with masthead band and cover lines.");
  designTool("create_album_cover", "album_cover", "album_cover", "Square album cover art layout.");
}

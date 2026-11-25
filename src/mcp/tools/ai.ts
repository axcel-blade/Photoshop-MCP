import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { PHOTOSHOP_AI_CAPABILITIES, type GeneratedImage } from "../../ai/providers.js";
import { contrastRatio, rgbToHex } from "../../shared.js";
import { regionMaskPng } from "../../utils/png.js";
import { callTool, cmd, EXTERNAL, READ_ONLY, tool, WRITE, type ToolContext, type ToolOutput } from "./registry.js";
import { doc, layer, rect, region } from "./args.js";
import { analyze } from "./color.js";
import { removeObject } from "./background.js";

const M = "ai";

function saveGenerated(ctx: ToolContext, imgs: GeneratedImage[], prefix: string): string[] {
  const dir = join(ctx.config.outputDir, "generated");
  mkdirSync(dir, { recursive: true });
  return imgs.map((img, i) => {
    const ext = img.mimeType.includes("png") ? "png" : "jpg";
    const file = ctx.paths.resolveOutput(join(dir, `${prefix}-${Date.now()}-${i + 1}.${ext}`), { overwrite: false });
    writeFileSync(file, img.bytes);
    return file;
  });
}

async function docSize(ctx: ToolContext, d: unknown): Promise<{ width: number; height: number }> {
  const out = await cmd(ctx, "doc.info", { doc: d });
  return (out.data as { document: { width: number; height: number } }).document;
}

/** Full-canvas JPEG of the composite (for providers). */
async function compositeBytes(ctx: ToolContext, d: unknown, max: number): Promise<{ bytes: Buffer; width: number; height: number; scale: number }> {
  const p = await cmd(ctx, "ps.preview", { doc: d, maxSize: max, format: "jpeg", quality: 92 });
  const r = p.data as { base64: string; width: number; height: number; sourceWidth: number };
  return { bytes: Buffer.from(r.base64, "base64"), width: r.width, height: r.height, scale: r.width / r.sourceWidth };
}

export interface ImageStats { mean: { r: number; g: number; b: number }; luminance: { mean: number; stdev: number; p1: number; p99: number }; saturationMean: number; clipping: { shadows: number; highlights: number }; palette: string[] }

/** Deterministic interpretation of measured statistics (no ML; every finding cites its number). */
export function interpretStats(s: ImageStats): { findings: string[]; suggestions: { tool: string; args: Record<string, unknown>; why: string }[] } {
  const findings: string[] = [];
  const suggestions: { tool: string; args: Record<string, unknown>; why: string }[] = [];
  const L = s.luminance;
  if (L.mean < 0.3) { findings.push(`Underexposed: mean luminance ${L.mean.toFixed(2)} (< 0.30).`); suggestions.push({ tool: "correct_exposure", args: {}, why: "raise mean luminance" }); }
  if (L.mean > 0.7) { findings.push(`Overexposed: mean luminance ${L.mean.toFixed(2)} (> 0.70).`); suggestions.push({ tool: "correct_exposure", args: {}, why: "lower mean luminance" }); }
  if (L.stdev < 0.14) { findings.push(`Flat contrast: luminance std-dev ${L.stdev.toFixed(2)}.`); suggestions.push({ tool: "adjust_curves", args: { points: [{ input: 0, output: 0 }, { input: 64, output: 50 }, { input: 192, output: 206 }, { input: 255, output: 255 }] }, why: "S-curve adds contrast" }); }
  if (s.clipping.highlights > 0.02) findings.push(`${(s.clipping.highlights * 100).toFixed(1)}% of pixels clipped to white.`);
  if (s.clipping.shadows > 0.04) findings.push(`${(s.clipping.shadows * 100).toFixed(1)}% of pixels clipped to black.`);
  const { r, g, b } = s.mean;
  const avg = (r + g + b) / 3;
  const cast = Math.max(Math.abs(r - avg), Math.abs(g - avg), Math.abs(b - avg));
  if (cast > 12) {
    const dom = r - avg > 12 ? "red/warm" : b - avg > 12 ? "blue/cool" : g - avg > 12 ? "green" : r - avg < -12 ? "cyan" : "magenta";
    findings.push(`Color cast toward ${dom}: channel means R${r.toFixed(0)} G${g.toFixed(0)} B${b.toFixed(0)}.`);
    suggestions.push({ tool: "correct_white_balance", args: {}, why: "neutralize cast (gray-world)" });
  }
  if (s.saturationMean < 0.12) { findings.push(`Low saturation (${s.saturationMean.toFixed(2)}).`); suggestions.push({ tool: "adjust_vibrance", args: { vibrance: 25 }, why: "add color without oversaturating skin" }); }
  if (s.saturationMean > 0.6) findings.push(`Very high saturation (${s.saturationMean.toFixed(2)}).`);
  if (!findings.length) findings.push("No exposure, contrast or color-cast problems detected by the statistics.");
  return { findings, suggestions };
}

export function registerAiTools(): void {
  tool({
    name: "get_ai_capabilities", module: M, description: "Honest status of AI features: Photoshop in-app AI vs. programmatic access, and which external providers are configured.", annotations: READ_ONLY, commands: [],
    input: {}, handler: async (_a, ctx) => ({ data: { photoshop: PHOTOSHOP_AI_CAPABILITIES, providers: ctx.providers.status() }, source: "server" }),
  });
  tool({
    name: "generative_fill", module: M, description: "Generative fill of a region via Adobe Firefly Services (needs FIREFLY_CLIENT_ID/SECRET). Result is placed as a new masked layer over the region.", annotations: EXTERNAL, status: "requires_provider",
    limitations: "Photoshop's in-app Generative Fill is not exposed to scripting; this uploads a JPEG of the canvas and a mask to Firefly.", commands: ["ps.preview", "image.place", "select.rect", "mask.create"],
    input: { doc, bounds: rect, prompt: z.string().max(1000).optional(), shape: z.enum(["rect", "ellipse"]).default("rect") },
    handler: async (a, ctx) => {
      const provider = ctx.providers.require("generative_fill");
      const comp = await compositeBytes(ctx, a.doc, 2048);
      const sb = { left: a.bounds.left * comp.scale, top: a.bounds.top * comp.scale, right: a.bounds.right * comp.scale, bottom: a.bounds.bottom * comp.scale, shape: a.shape };
      const mask = regionMaskPng(comp.width, comp.height, sb);
      const imgs = await provider.fill!({ image: comp.bytes, mask, prompt: a.prompt, width: comp.width, height: comp.height });
      const files = saveGenerated(ctx, imgs, "fill");
      const size = await docSize(ctx, a.doc);
      const placed = await cmd(ctx, "image.place", { doc: a.doc, path: files[0], x: 0, y: 0, width: size.width, height: size.height, fit: "stretch", name: `Generative Fill: ${a.prompt ?? "auto"}`.slice(0, 80) });
      const id = (placed.data as { layer: { id: number } }).layer.id;
      await cmd(ctx, a.shape === "rect" ? "select.rect" : "select.ellipse", { doc: a.doc, bounds: a.bounds, mode: "new" });
      await cmd(ctx, "mask.create", { doc: a.doc, layer: { id }, from: "selection" });
      await cmd(ctx, "select.none", { doc: a.doc });
      return { data: { provider: provider.id, files, layerId: id }, warnings: ["Generated by an external service; review before use."] };
    },
  });
  tool({
    name: "generative_expand", module: M, description: "Expand the canvas and fill the new area via Firefly Services; with allowFallback the server uses Content-Aware extend_background instead when no provider is configured (reported).", annotations: EXTERNAL, status: "requires_provider", commands: ["doc.resizeCanvas", "image.place", "edit.contentAwareFill"],
    input: { doc, left: z.number().int().min(0).default(0), right: z.number().int().min(0).default(0), top: z.number().int().min(0).default(0), bottom: z.number().int().min(0).default(0), prompt: z.string().max(1000).optional(), allowFallback: z.boolean().default(false) },
    handler: async (a, ctx) => {
      const provider = ctx.providers.find("generative_expand");
      if (!provider) {
        if (!a.allowFallback) ctx.providers.require("generative_expand");
        const out = await callTool("extend_background", { doc: a.doc, left: a.left, right: a.right, top: a.top, bottom: a.bottom }, ctx);
        return { ...out, warnings: ["No generative provider configured: used Content-Aware Fill (extend_background) instead.", ...(out.warnings ?? [])] };
      }
      const size = await docSize(ctx, a.doc);
      const comp = await compositeBytes(ctx, a.doc, 2048);
      const W = size.width + a.left + a.right, H = size.height + a.top + a.bottom;
      const s = Math.min(1, 2048 / Math.max(W, H));
      const imgs = await provider.expand!({ image: comp.bytes, width: Math.round(W * s), height: Math.round(H * s), prompt: a.prompt });
      const files = saveGenerated(ctx, imgs, "expand");
      await cmd(ctx, "doc.resizeCanvas", { doc: a.doc, width: W, height: H, anchor: "topLeft" });
      const placed = await cmd(ctx, "image.place", { doc: a.doc, path: files[0], x: 0, y: 0, width: W, height: H, fit: "stretch", name: "Generative Expand" });
      await cmd(ctx, "layer.arrange", { doc: a.doc, layer: { id: (placed.data as { layer: { id: number } }).layer.id }, position: "bottom" });
      return { data: { provider: provider.id, files, width: W, height: H }, warnings: ["Existing layers stay at the top-left; move them by (left, top) to align with the expanded plate."] };
    },
  });
  const genInput = { prompt: z.string().min(3).max(1000), width: z.number().int().min(256).max(2688).default(1024), height: z.number().int().min(256).max(2688).default(1024), negativePrompt: z.string().max(1000).optional() };
  tool({
    name: "generate_image", module: M, description: "Generate an image with Firefly Services (needs credentials), save it under output/generated and optionally place it into the active document.", annotations: EXTERNAL, status: "requires_provider", commands: ["image.place"],
    input: { ...genInput, place: z.boolean().default(true) },
    handler: async (a, ctx) => {
      const p = ctx.providers.require("generate_image");
      const files = saveGenerated(ctx, await p.generate!({ prompt: a.prompt, width: a.width, height: a.height, negativePrompt: a.negativePrompt }), "gen");
      const placed = a.place ? await cmd(ctx, "image.place", { path: files[0], fit: "cover", name: `Generated: ${a.prompt}`.slice(0, 80) }).catch((e: Error) => ({ data: { error: e.message } })) : undefined;
      return { data: { provider: p.id, files, placed: placed?.data } };
    },
  });
  tool({
    name: "generate_background", module: M, description: "Generate a background with Firefly at the document size and place it at the bottom of the stack.", annotations: EXTERNAL, status: "requires_provider", commands: ["image.place", "layer.arrange"],
    input: { doc, prompt: z.string().min(3).max(1000) },
    handler: async (a, ctx) => {
      const p = ctx.providers.require("generate_image");
      const size = await docSize(ctx, a.doc);
      const s = Math.min(1, 2048 / Math.max(size.width, size.height));
      const files = saveGenerated(ctx, await p.generate!({ prompt: a.prompt, width: Math.round(size.width * s), height: Math.round(size.height * s) }), "bg");
      const placed = await cmd(ctx, "image.place", { doc: a.doc, path: files[0], x: 0, y: 0, width: size.width, height: size.height, fit: "cover", name: "Generated Background" });
      await cmd(ctx, "layer.arrange", { doc: a.doc, layer: { id: (placed.data as { layer: { id: number } }).layer.id }, position: "bottom" });
      return { data: { provider: p.id, files } };
    },
  });
  tool({
    name: "generate_variations", module: M, description: "Generate several variations of a prompt (files only, nothing placed).", annotations: EXTERNAL, status: "requires_provider", commands: [],
    input: { ...genInput, count: z.number().int().min(1).max(4).default(3) },
    handler: async (a, ctx) => {
      const p = ctx.providers.require("generate_image");
      return { data: { provider: p.id, files: saveGenerated(ctx, await p.generate!({ prompt: a.prompt, width: a.width, height: a.height, count: a.count, negativePrompt: a.negativePrompt }), "var") }, source: "server" };
    },
  });
  tool({
    name: "ai_remove_object", module: M, description: "Remove an object in a region with Photoshop's Content-Aware Fill (native, no external service).", annotations: WRITE, commands: ["edit.contentAwareFill"],
    input: { doc, layer, region, expand: z.number().min(0).max(200).default(8) }, handler: (a, ctx) => removeObject(ctx, a.doc, a.layer, a.region, a.expand),
  });
  tool({
    name: "ai_replace_object", module: M, description: "Replace what is inside a rectangle with prompt-driven content (generative_fill via Firefly).", annotations: EXTERNAL, status: "requires_provider", commands: ["ps.preview", "image.place", "mask.create"],
    input: { doc, bounds: rect, prompt: z.string().min(3).max(1000) },
    handler: async (a, ctx) => {
      return callTool("generative_fill", { doc: a.doc, bounds: a.bounds, prompt: a.prompt }, ctx);
    },
  });
  tool({
    name: "ai_image_analysis", module: M, description: "Measure the image in Photoshop (luminance percentiles, channel means, saturation, clipping, dominant colors) and interpret it into findings + suggested tool calls, optionally with a preview image.", annotations: READ_ONLY, commands: ["ps.analyze", "ps.preview"],
    input: { doc, layer, includePreview: z.boolean().default(true) },
    handler: async (a, ctx) => {
      const { a: stats, warnings } = await analyze(ctx, a.doc, a.layer);
      const interp = interpretStats(stats);
      const out: ToolOutput = { data: { measured: stats, ...interp, method: "Pixel statistics measured by Photoshop; interpretation is rule-based (not a vision model)." }, warnings };
      if (a.includePreview) {
        const p = await cmd(ctx, "ps.preview", { doc: a.doc, maxSize: 768 });
        const r = p.data as { base64: string; mimeType: string };
        out.images = [{ base64: r.base64, mimeType: r.mimeType }];
      }
      return out;
    },
  });
  tool({
    name: "ai_design_assistant", module: M, description: "Design review of the active document: layer hygiene, text legibility (font size vs canvas, measured contrast against the layer's background sample), missing fonts, hidden/empty layers, and image statistics, with suggested next tool calls.", annotations: READ_ONLY, commands: ["doc.info", "layer.list", "ps.analyze", "ps.preview"],
    input: { doc, goal: z.string().max(500).optional() },
    handler: async (a, ctx) => {
      const info = await cmd(ctx, "doc.info", { doc: a.doc });
      const d = (info.data as { document: { width: number; height: number } }).document;
      const list = await cmd(ctx, "layer.list", { doc: a.doc });
      type L = { id: number; name: string; kind: string; visible: boolean; bounds: { left: number; top: number; right: number; bottom: number; width: number; height: number }; text?: { contents: string; size: number; color: string; font: string; fontAvailable?: boolean } };
      const layers = (list.data as { layers: L[] }).layers;
      const { a: stats } = await analyze(ctx, a.doc);
      const issues: string[] = [];
      const suggestions: { tool: string; args: Record<string, unknown>; why: string }[] = [];
      const minDim = Math.min(d.width, d.height);
      const bgHex = rgbToHex(stats.mean);
      for (const l of layers) {
        if (/^Layer \d+$/.test(l.name)) issues.push(`Layer ${l.id} has a default name "${l.name}".`);
        if (l.bounds.width === 0 || l.bounds.height === 0) issues.push(`Layer "${l.name}" is empty.`);
        if (l.bounds.right < 0 || l.bounds.bottom < 0 || l.bounds.left > d.width || l.bounds.top > d.height) issues.push(`Layer "${l.name}" lies outside the canvas.`);
        if (l.kind === "text" && l.text) {
          if (l.text.fontAvailable === false) issues.push(`Text "${l.name}" uses a missing font (${l.text.font}).`);
          if (l.text.size < minDim * 0.02) issues.push(`Text "${l.name}" is small (${l.text.size}px on a ${minDim}px canvas).`);
          const cr = contrastRatio(l.text.color, bgHex);
          if (cr < 3) {
            issues.push(`Text "${l.name}" (${l.text.color}) has ~${cr.toFixed(1)}:1 contrast against the image average ${bgHex}.`);
            suggestions.push({ tool: "create_text_shadow", args: { layer: { id: l.id } }, why: "improve legibility" });
          }
          if (!l.text.contents.trim()) issues.push(`Text layer "${l.name}" is empty.`);
        }
      }
      const interp = interpretStats(stats);
      const p = await cmd(ctx, "ps.preview", { doc: a.doc, maxSize: 768 });
      const r = p.data as { base64: string; mimeType: string };
      return {
        data: { goal: a.goal, canvas: d, layerCount: layers.length, issues, imageFindings: interp.findings, suggestions: [...suggestions, ...interp.suggestions], note: "Rule-based checks over Photoshop-reported data. Judge composition visually from the attached preview." },
        images: [{ base64: r.base64, mimeType: r.mimeType }],
      };
    },
  });
}

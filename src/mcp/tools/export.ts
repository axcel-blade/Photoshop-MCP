import { statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { PsMcpError, SAVE_FORMATS } from "../../shared.js";
import { cmd, tool, WRITE, type ToolContext, type ToolOutput } from "./registry.js";
import { doc, outputPath, overwrite, path } from "./args.js";
import { validateDocument } from "./inspection.js";

const M = "export";
const size = { width: z.number().int().min(1).max(300000).optional(), height: z.number().int().min(1).max(300000).optional() };

async function exportAs(ctx: ToolContext, a: { doc?: unknown; path: string; overwrite: boolean; width?: number; height?: number }, format: (typeof SAVE_FORMATS)[number], extra: Record<string, unknown> = {}): Promise<ToolOutput> {
  const p = outputPath(ctx, a.path, format, a.overwrite);
  const out = await cmd(ctx, "doc.saveAs", { doc: a.doc, path: p, format, width: a.width, height: a.height, asCopy: true, ...extra });
  let bytes: number | undefined;
  try { bytes = statSync(p).size; } catch { /* bridge reported success but file not visible: report it */ }
  if (bytes === undefined && ctx.bridge.adapterName !== "mock") return { data: out.data, warnings: [...(out.warnings ?? []), `Photoshop reported success but ${p} was not found on disk.`] };
  return { data: { ...(out.data as object), bytes }, warnings: out.warnings };
}

export function registerExportTools(): void {
  const base = { doc, path, overwrite, ...size };
  tool({ name: "export_png", module: M, description: "Export a PNG copy (keeps transparency).", annotations: WRITE, commands: ["doc.saveAs"], input: { ...base, compression: z.number().int().min(0).max(9).default(6), interlaced: z.boolean().default(false) }, handler: (a, ctx) => exportAs(ctx, a, "png", { compression: a.compression, interlaced: a.interlaced }) });
  tool({ name: "export_jpeg", module: M, description: "Export a JPEG copy (quality 0-12, flattened, no transparency).", annotations: WRITE, commands: ["doc.saveAs"], input: { ...base, quality: z.number().int().min(0).max(12).default(10) }, handler: (a, ctx) => exportAs(ctx, a, "jpg", { quality: a.quality }) });
  tool({ name: "export_webp", module: M, description: "Export a WebP copy (Photoshop 23.2+).", annotations: WRITE, commands: ["doc.saveAs"], input: { ...base, quality: z.number().int().min(0).max(100).default(85), lossless: z.boolean().default(false) }, handler: (a, ctx) => exportAs(ctx, a, "webp", { quality: a.quality, lossless: a.lossless }) });
  tool({ name: "export_tiff", module: M, description: "Export a TIFF copy (layers kept).", annotations: WRITE, commands: ["doc.saveAs"], input: { ...base, compression: z.enum(["none", "lzw", "zip", "jpeg"]).default("lzw") }, handler: (a, ctx) => exportAs(ctx, a, "tiff", { compression: a.compression }) });
  tool({ name: "export_pdf", module: M, description: "Export a Photoshop PDF copy.", annotations: WRITE, commands: ["doc.saveAs"], input: { ...base, preserveEditing: z.boolean().default(false) }, handler: (a, ctx) => exportAs(ctx, a, "pdf", { preserveEditing: a.preserveEditing }) });
  tool({ name: "export_psd", module: M, description: "Save a layered PSD copy (the open document keeps its own file).", annotations: WRITE, commands: ["doc.saveAs"], input: { doc, path, overwrite }, handler: (a, ctx) => exportAs(ctx, a, "psd") });
  tool({ name: "export_psb", module: M, description: "Save a Large Document Format (PSB) copy.", annotations: WRITE, commands: ["doc.saveAs"], input: { doc, path, overwrite }, handler: (a, ctx) => exportAs(ctx, a, "psb") });
  tool({
    name: "export_for_web", module: M, description: "Web export: sRGB-flattened copy, longest side limited to maxSize, JPEG/PNG/WebP at a web quality.", annotations: WRITE, commands: ["doc.info", "doc.saveAs"],
    input: { doc, path, overwrite, format: z.enum(["jpg", "png", "webp"]).default("jpg"), maxSize: z.number().int().min(16).max(16000).default(2048), quality: z.number().int().min(0).max(100).optional() },
    handler: async (a, ctx) => {
      const d = ((await cmd(ctx, "doc.info", { doc: a.doc })).data as { document: { width: number; height: number } }).document;
      const s = Math.min(1, a.maxSize / Math.max(d.width, d.height));
      const q = a.quality ?? (a.format === "jpg" ? 8 : 80);
      return exportAs(ctx, { ...a, width: Math.round(d.width * s), height: Math.round(d.height * s) }, a.format, { quality: a.format === "jpg" ? Math.min(12, q) : q, convertToSRGB: true });
    },
  });
  tool({
    name: "optimize_image", module: M, description: "Export JPEG/WebP under a target file size: tries decreasing quality (max 6 attempts) and reports each measured size.", annotations: WRITE, commands: ["doc.saveAs"],
    input: { doc, path, overwrite, format: z.enum(["jpg", "webp"]).default("jpg"), maxKB: z.number().min(5).max(100000), ...size },
    handler: async (a, ctx) => {
      const qs = a.format === "jpg" ? [12, 10, 8, 6, 4, 2] : [90, 80, 70, 60, 45, 30];
      const attempts: { quality: number; bytes: number }[] = [];
      let ow = a.overwrite;
      for (const q of qs) {
        const r = await exportAs(ctx, { ...a, overwrite: ow }, a.format, { quality: q });
        ow = true; // we own the file after the first write
        const bytes = (r.data as { bytes?: number }).bytes ?? Number.POSITIVE_INFINITY;
        attempts.push({ quality: q, bytes });
        if (bytes <= a.maxKB * 1024) return { data: { path: (r.data as { path: string }).path, quality: q, bytes, attempts, met: true } };
      }
      return { data: { attempts, met: false }, warnings: [`Could not reach ${a.maxKB} KB; reduce width/height and retry.`] };
    },
  });
  tool({
    name: "export_transparent_image", module: M, description: "Export a transparent PNG (warns if a visible Background layer would make it opaque).", annotations: WRITE, commands: ["layer.list", "doc.saveAs"],
    input: { doc, path, overwrite, ...size },
    handler: async (a, ctx) => {
      const layers = ((await cmd(ctx, "layer.list", { doc: a.doc })).data as { layers: { kind: string; visible: boolean; name: string }[] }).layers;
      const opaque = layers.filter((l) => l.visible && (l.kind === "background" || l.kind === "solidColor"));
      const out = await exportAs(ctx, a, "png");
      if (opaque.length) out.warnings = [...(out.warnings ?? []), `Visible opaque layers (${opaque.map((l) => l.name).join(", ")}) make the PNG non-transparent; hide them or use create_transparent_background.`];
      return out;
    },
  });
  tool({
    name: "export_multiple_sizes", module: M, description: "Export several resized copies in one call (e.g. 1080, 720, 320 wide).", annotations: WRITE, commands: ["doc.saveAs"],
    input: { doc, folder: path, baseName: z.string().min(1).max(100).regex(/^[\w.-]+$/), format: z.enum(SAVE_FORMATS).default("png"), sizes: z.array(z.object({ width: z.number().int().min(1).optional(), height: z.number().int().min(1).optional(), suffix: z.string().max(40).regex(/^[\w.-]*$/).optional() })).min(1).max(30), overwrite, quality: z.number().min(0).max(100).optional() },
    handler: async (a, ctx) => {
      const dir = ctx.paths.resolveDir(a.folder, true);
      const ext = a.format === "jpg" ? "jpg" : a.format;
      const files = [];
      for (const s of a.sizes) {
        if (!s.width && !s.height) throw new PsMcpError("VALIDATION_ERROR", "Each size needs width or height");
        const r = await exportAs(ctx, { doc: a.doc, path: join(dir, `${a.baseName}${s.suffix ?? `-${s.width ?? s.height}`}.${ext}`), overwrite: a.overwrite, width: s.width, height: s.height }, a.format, { quality: a.quality });
        files.push(r.data);
      }
      return { data: { files } };
    },
  });
  tool({
    name: "create_delivery_package", module: M, description: "Deliverables folder: validates the document, saves PSD + requested formats/sizes, and writes manifest.json listing every file with byte sizes.", annotations: WRITE, commands: ["doc.info", "layer.list", "doc.saveAs"],
    input: { doc, folder: path, name: z.string().min(1).max(100).regex(/^[\w.-]+$/), formats: z.array(z.enum(["png", "jpg", "webp", "tiff", "pdf"])).min(1).max(5).default(["png", "jpg"]), sizes: z.array(z.number().int().min(16).max(30000)).max(10).default([]).describe("Extra widths"), includePsd: z.boolean().default(true), overwrite },
    handler: async (a, ctx) => {
      const check = await validateDocument(ctx, a.doc);
      if (!check.valid) throw new PsMcpError("VALIDATION_ERROR", `Document failed validation: ${check.errors.join(" ")}`, check);
      const dir = ctx.paths.resolveDir(join(a.folder, a.name), true);
      const files: unknown[] = [];
      if (a.includePsd) files.push((await exportAs(ctx, { doc: a.doc, path: join(dir, `${a.name}.psd`), overwrite: a.overwrite }, "psd")).data);
      for (const f of a.formats) {
        files.push((await exportAs(ctx, { doc: a.doc, path: join(dir, `${a.name}.${f}`), overwrite: a.overwrite }, f, f === "jpg" ? { quality: 10 } : {})).data);
        for (const w of a.sizes) files.push((await exportAs(ctx, { doc: a.doc, path: join(dir, `${a.name}-${w}w.${f}`), overwrite: a.overwrite, width: w }, f, f === "jpg" ? { quality: 10 } : {})).data);
      }
      const manifest = ctx.paths.resolveOutput(join(dir, "manifest.json"), { overwrite: true });
      writeFileSync(manifest, JSON.stringify({ name: a.name, createdAt: new Date().toISOString(), document: check.document, warnings: check.warnings, files }, null, 2));
      return { data: { folder: dir, manifest, files }, warnings: check.warnings };
    },
  });
}

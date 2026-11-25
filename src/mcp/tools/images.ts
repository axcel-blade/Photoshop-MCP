import { readdirSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { z } from "zod";
import { PsMcpError, SAVE_FORMATS } from "../../shared.js";
import { IMAGE_INPUT_EXTENSIONS } from "../../utils/paths.js";
import { readImageMeta } from "../../utils/image-meta.js";
import { AssetLibrary } from "../../assets/library.js";
import { cmd, DESTRUCTIVE, READ_ONLY, requireConfirm, Sequence, tool, WRITE } from "./registry.js";
import type { ToolContext } from "./registry.js";
import { confirm, doc, inputPath, layer, name, outputPath, overwrite, path, rect } from "./args.js";

const M = "images";
const fit = z.enum(["contain", "cover", "stretch", "none"]).default("contain");
const url = z.string().url().max(4096).describe("http(s) URL of a PNG, JPEG, GIF, WebP, BMP, TIFF, AVIF, HEIC or SVG image (downloaded into the asset library first)");

/** Local path from either `path` or `url` (downloaded first). */
async function sourcePath(ctx: ToolContext, a: { path?: string; url?: string }, warnings: string[]): Promise<string> {
  if (a.path && a.url) throw new PsMcpError("VALIDATION_ERROR", "Pass either path or url, not both");
  if (a.url) {
    const { record } = await new AssetLibrary({ config: ctx.config, paths: ctx.paths }).download({ url: a.url });
    warnings.push(`Downloaded ${a.url} to ${record.file}. Check that you have the right to use this image.`);
    return record.file;
  }
  if (!a.path) throw new PsMcpError("VALIDATION_ERROR", "Pass path (a local file) or url (an image on the internet)");
  return inputPath(ctx, a.path);
}

export function registerImageTools(): void {
  tool({
    name: "import_image", module: M, description: "Open an image as a new document, from a local path or an internet url (downloaded first).", annotations: WRITE, commands: ["doc.open"],
    input: { path: path.optional(), url: url.optional() },
    handler: async (a, ctx) => {
      const w: string[] = [];
      return cmd(ctx, "doc.open", { path: await sourcePath(ctx, a, w) }, w);
    },
  });
  tool({
    name: "place_image", module: M, description: "Place an image into the document as an embedded smart object, optionally fitted into a box (x, y, width, height). Source is a local path or an internet url (downloaded into the asset library first).", annotations: WRITE, commands: ["image.place"],
    input: { doc, path: path.optional(), url: url.optional(), name, x: z.number().optional(), y: z.number().optional(), width: z.number().min(1).optional(), height: z.number().min(1).optional(), fit, linked: z.boolean().default(false) },
    handler: async (a, ctx) => {
      const w: string[] = [];
      const { url: _u, ...rest } = a;
      return cmd(ctx, "image.place", { ...rest, path: await sourcePath(ctx, a, w) }, w);
    },
  });
  tool({
    name: "crop_image", module: M, description: "Crop the canvas to bounds (pixels outside are deleted unless layers extend beyond). Requires confirm: true.", annotations: DESTRUCTIVE, commands: ["doc.crop"],
    input: { doc, bounds: rect, confirm }, handler: (a, ctx) => {
      requireConfirm(a.confirm, "Cropping");
      return cmd(ctx, "doc.crop", { doc: a.doc, bounds: a.bounds });
    },
  });
  tool({ name: "rotate_image", module: M, description: "Rotate the whole canvas (degrees, clockwise).", annotations: WRITE, commands: ["doc.rotate"], input: { doc, angle: z.number().min(-360).max(360) }, handler: (a, ctx) => cmd(ctx, "doc.rotate", a) });
  tool({
    name: "flip_image", module: M, description: "Flip the canvas, or one layer when target is 'layer'.", annotations: WRITE, commands: ["doc.flip", "layer.transform"],
    input: { doc, direction: z.enum(["horizontal", "vertical"]), target: z.enum(["document", "layer"]).default("document"), layer },
    handler: (a, ctx) => (a.target === "document" ? cmd(ctx, "doc.flip", { doc: a.doc, direction: a.direction }) : cmd(ctx, "layer.transform", { doc: a.doc, layer: a.layer, flip: a.direction })),
  });
  tool({
    name: "resize_image", module: M, description: "Resample the document (same as resize_document).", annotations: WRITE, commands: ["doc.resizeImage"],
    input: { doc, width: z.number().int().min(1).optional(), height: z.number().int().min(1).optional(), percent: z.number().min(1).max(10000).optional() },
    handler: (a, ctx) => cmd(ctx, "doc.resizeImage", a),
  });
  tool({
    name: "transform_image", module: M, description: "Free transform a layer: scale (%), rotate, skew, move, flip. Smart objects keep full quality.", annotations: WRITE, commands: ["layer.transform"],
    input: { doc, layer, scaleX: z.number().min(0.1).max(10000).optional(), scaleY: z.number().min(0.1).max(10000).optional(), angle: z.number().min(-360).max(360).optional(), skewX: z.number().min(-89).max(89).optional(), skewY: z.number().min(-89).max(89).optional(), dx: z.number().optional(), dy: z.number().optional(), flip: z.enum(["horizontal", "vertical"]).optional(), anchor: z.enum(["center", "topLeft", "bottom", "top"]).default("center") },
    handler: (a, ctx) => cmd(ctx, "layer.transform", a),
  });
  tool({ name: "duplicate_image", module: M, description: "Duplicate the document.", annotations: WRITE, commands: ["doc.duplicate"], input: { doc, name: z.string().max(255).optional() }, handler: (a, ctx) => cmd(ctx, "doc.duplicate", a) });
  tool({
    name: "replace_image", module: M, description: "Replace the contents of a smart object layer with another file (keeps transforms, masks, filters).", annotations: WRITE, commands: ["layer.replaceContents"],
    input: { doc, layer, path }, handler: (a, ctx) => cmd(ctx, "layer.replaceContents", { ...a, path: inputPath(ctx, a.path) }),
  });
  tool({
    name: "convert_image", module: M, description: "Convert an image file to another format: opens it, saves a copy, closes it without changes.", annotations: WRITE, commands: ["doc.open", "doc.saveAs", "doc.close"],
    input: { input: path, output: path, format: z.enum(SAVE_FORMATS), quality: z.number().min(0).max(100).optional(), overwrite },
    handler: async (a, ctx) => {
      const src = inputPath(ctx, a.input);
      const dst = outputPath(ctx, a.output, a.format, a.overwrite);
      const seq = new Sequence(ctx);
      const opened = await seq.run("open", "doc.open", { path: src });
      const id = (opened.data as { document: { id: number } }).document.id;
      try {
        await seq.run("save", "doc.saveAs", { doc: { id }, path: dst, format: a.format, quality: a.quality, asCopy: true });
      } finally {
        await cmd(ctx, "doc.close", { doc: { id }, save: "no" }).catch(() => undefined);
      }
      return seq.result({ input: src, output: dst });
    },
  });
  tool({
    name: "export_image", module: M, description: "Export the document as an image file (flattened copy). Same as export_document.", annotations: WRITE, commands: ["doc.saveAs"],
    input: { doc, path, format: z.enum(SAVE_FORMATS).default("png"), quality: z.number().min(0).max(100).optional(), width: z.number().int().min(1).optional(), height: z.number().int().min(1).optional(), overwrite },
    handler: (a, ctx) => cmd(ctx, "doc.saveAs", { ...a, path: outputPath(ctx, a.path, a.format, a.overwrite), asCopy: true }),
  });
  tool({
    name: "get_image_dimensions", module: M, description: "Pixel size of a file (header read, no Photoshop needed) or of the active document.", annotations: READ_ONLY, commands: ["doc.info"],
    input: { path: path.optional(), doc }, handler: async (a, ctx) => {
      if (a.path) {
        const m = readImageMeta(inputPath(ctx, a.path));
        return { data: { path: m.path, width: m.width, height: m.height }, source: "server" };
      }
      const out = await cmd(ctx, "doc.info", { doc: a.doc });
      const d = (out.data as { document: { width: number; height: number; resolution: number } }).document;
      return { data: { width: d.width, height: d.height, resolution: d.resolution } };
    },
  });
  tool({
    name: "get_image_metadata", module: M, description: "File metadata from the header: format, dimensions, bit depth, channels, color mode (PSD), size, modified time.", annotations: READ_ONLY, commands: [],
    input: { path }, handler: async (a, ctx) => ({ data: readImageMeta(inputPath(ctx, a.path)), source: "server" }),
  });
  tool({
    name: "create_image_contact_sheet", module: M, description: "Contact sheet: grid of thumbnails (smart objects) with file-name captions from a list of files or a folder.", annotations: WRITE, commands: ["doc.create", "image.place", "text.create"],
    input: {
      paths: z.array(path).max(400).optional(), folder: path.optional(), columns: z.number().int().min(1).max(20).default(4), cellSize: z.number().int().min(32).max(4000).default(400),
      gap: z.number().int().min(0).max(500).default(20), captions: z.boolean().default(true), background: z.string().default("#FFFFFF"),
    },
    handler: async (a, ctx) => {
      let files = (a.paths ?? []).map((p) => inputPath(ctx, p));
      if (a.folder) {
        const dir = ctx.paths.resolveDir(a.folder);
        files.push(...readdirSync(dir).filter((f) => IMAGE_INPUT_EXTENSIONS.includes(extname(f).toLowerCase())).sort().map((f) => join(dir, f)));
      }
      files = files.slice(0, ctx.config.maxBatchFiles);
      if (!files.length) throw new PsMcpError("VALIDATION_ERROR", "No input images found");
      const rows = Math.ceil(files.length / a.columns);
      const cap = a.captions ? Math.round(a.cellSize * 0.12) : 0;
      const W = a.columns * (a.cellSize + a.gap) + a.gap, H = rows * (a.cellSize + cap + a.gap) + a.gap;
      const seq = new Sequence(ctx);
      await seq.run("document", "doc.create", { name: "Contact Sheet", width: W, height: H, resolution: 72, background: "white" });
      for (let i = 0; i < files.length; i++) {
        const c = i % a.columns, r = Math.floor(i / a.columns);
        const x = a.gap + c * (a.cellSize + a.gap), y = a.gap + r * (a.cellSize + cap + a.gap);
        await seq.run(`place ${i + 1}`, "image.place", { path: files[i], x, y, width: a.cellSize, height: a.cellSize, fit: "contain", name: basename(files[i]!) });
        if (a.captions) await seq.run(`caption ${i + 1}`, "text.create", { text: basename(files[i]!).slice(0, 60), x: x + a.cellSize / 2, y: y + a.cellSize + cap * 0.75, size: Math.max(8, Math.round(cap * 0.55)), color: "#333333", alignment: "center", font: "ArialMT", name: `Caption ${i + 1}` });
      }
      return seq.result({ images: files.length, width: W, height: H });
    },
  });
}

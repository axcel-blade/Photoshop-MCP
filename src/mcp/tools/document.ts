import { z } from "zod";
import { SAVE_FORMATS } from "../../shared.js";
import { cmd, DESTRUCTIVE, READ_ONLY, requireConfirm, tool, WRITE } from "./registry.js";
import { confirm, doc, docSize, inputPath, outputPath, overwrite, path } from "./args.js";

const M = "document";
const anchor = z.enum(["topLeft", "top", "topRight", "left", "center", "right", "bottomLeft", "bottom", "bottomRight"]).default("center");
const resample = z.enum(["bicubicAutomatic", "bicubic", "bicubicSharper", "bicubicSmoother", "bilinear", "nearestNeighbor", "preserveDetails", "none"]).default("bicubicAutomatic");

export function registerDocumentTools(): void {
  tool({
    name: "create_document", module: M, description: "Create a new Photoshop document (pixels).", annotations: WRITE, commands: ["doc.create"],
    input: {
      name: z.string().min(1).max(255).default("Untitled"), ...docSize,
      resolution: z.number().min(1).max(10000).default(72), mode: z.enum(["rgb", "cmyk", "grayscale", "lab", "bitmap"]).default("rgb"),
      bitDepth: z.union([z.literal(8), z.literal(16), z.literal(32)]).default(8),
      background: z.enum(["white", "black", "transparent", "backgroundColor"]).default("white"),
    },
    handler: (a, ctx) => cmd(ctx, "doc.create", a),
  });
  tool({
    name: "open_document", module: M, description: "Open an image or PSD from an allowed directory.", annotations: WRITE, commands: ["doc.open"],
    input: { path },
    handler: (a, ctx) => cmd(ctx, "doc.open", { path: inputPath(ctx, a.path) }),
  });
  tool({
    name: "close_document", module: M, description: "Close a document. save: 'yes' saves first (needs an existing path); 'no' discards unsaved changes and requires confirm: true.", annotations: DESTRUCTIVE, commands: ["doc.close"],
    input: { doc, save: z.enum(["yes", "no"]).default("yes"), confirm },
    handler: (a, ctx) => {
      if (a.save === "no") requireConfirm(a.confirm, "Closing without saving");
      return cmd(ctx, "doc.close", { doc: a.doc, save: a.save });
    },
  });
  tool({
    name: "save_document", module: M, description: "Save the document to its current file (must have been saved before).", annotations: WRITE, commands: ["doc.save"],
    input: { doc }, handler: (a, ctx) => cmd(ctx, "doc.save", a),
  });
  tool({
    name: "save_document_as", module: M, description: "Save the document to a new file and make it the document's file (PSD/PSB/TIFF keep layers). Never overwrites unless overwrite: true.", annotations: WRITE, commands: ["doc.saveAs"],
    input: { doc, path, format: z.enum(SAVE_FORMATS).default("psd"), overwrite, quality: z.number().int().min(0).max(12).optional().describe("JPEG quality 0-12") },
    handler: (a, ctx) => cmd(ctx, "doc.saveAs", { doc: a.doc, path: outputPath(ctx, a.path, a.format, a.overwrite), format: a.format, quality: a.quality, asCopy: false }),
  });
  tool({ name: "get_document_info", module: M, description: "Size, resolution, color mode, bit depth, path, saved state and layer count.", annotations: READ_ONLY, commands: ["doc.info"], input: { doc }, handler: (a, ctx) => cmd(ctx, "doc.info", a) });
  tool({ name: "get_open_documents", module: M, description: "List all open documents.", annotations: READ_ONLY, commands: ["doc.list"], input: {}, handler: (_a, ctx) => cmd(ctx, "doc.list") });
  tool({ name: "get_active_document", module: M, description: "Info for the active document.", annotations: READ_ONLY, commands: ["doc.info"], input: {}, handler: (_a, ctx) => cmd(ctx, "doc.info") });
  tool({ name: "set_active_document", module: M, description: "Bring a document to the front.", annotations: WRITE, commands: ["doc.activate"], input: { doc: doc.unwrap() }, handler: (a, ctx) => cmd(ctx, "doc.activate", a) });
  tool({
    name: "resize_document", module: M, description: "Image Size: resample the whole document. Give width and/or height (aspect kept if one is omitted) or percent.", annotations: WRITE, commands: ["doc.resizeImage"],
    input: { doc, width: z.number().int().min(1).max(300000).optional(), height: z.number().int().min(1).max(300000).optional(), percent: z.number().min(1).max(10000).optional(), resample },
    handler: (a, ctx) => cmd(ctx, "doc.resizeImage", a),
  });
  tool({
    name: "resize_canvas", module: M, description: "Canvas Size: change the canvas without scaling pixels.", annotations: WRITE, commands: ["doc.resizeCanvas"],
    input: { doc, ...docSize, anchor }, handler: (a, ctx) => cmd(ctx, "doc.resizeCanvas", a),
  });
  tool({
    name: "change_resolution", module: M, description: "Change ppi. resample: 'none' keeps pixel dimensions (print size changes).", annotations: WRITE, commands: ["doc.resizeImage"],
    input: { doc, resolution: z.number().min(1).max(10000), resample: resample.default("none") },
    handler: (a, ctx) => cmd(ctx, "doc.resizeImage", { doc: a.doc, resolution: a.resolution, resample: a.resample }),
  });
  tool({
    name: "change_color_mode", module: M, description: "Convert color mode. Converting can flatten adjustment layers or change colors; requires confirm: true.", annotations: DESTRUCTIVE, commands: ["doc.mode"],
    input: { doc, mode: z.enum(["rgb", "cmyk", "grayscale", "lab", "bitmap", "indexed"]), confirm },
    handler: (a, ctx) => {
      requireConfirm(a.confirm, "Color mode conversion");
      return cmd(ctx, "doc.mode", { doc: a.doc, mode: a.mode });
    },
  });
  tool({
    name: "change_bit_depth", module: M, description: "Convert to 8, 16 or 32 bits per channel.", annotations: WRITE, commands: ["doc.bitDepth"],
    input: { doc, depth: z.union([z.literal(8), z.literal(16), z.literal(32)]) }, handler: (a, ctx) => cmd(ctx, "doc.bitDepth", a),
  });
  tool({
    name: "flatten_document", module: M, description: "Flatten all layers into Background. Destructive: requires confirm: true.", annotations: DESTRUCTIVE, commands: ["doc.flatten"],
    input: { doc, confirm }, handler: (a, ctx) => {
      requireConfirm(a.confirm, "Flatten");
      return cmd(ctx, "doc.flatten", { doc: a.doc });
    },
  });
  tool({
    name: "duplicate_document", module: M, description: "Duplicate the document (optionally merged).", annotations: WRITE, commands: ["doc.duplicate"],
    input: { doc, name: z.string().min(1).max(255).optional(), mergeLayers: z.boolean().default(false) }, handler: (a, ctx) => cmd(ctx, "doc.duplicate", a),
  });
  tool({
    name: "export_document", module: M, description: "Export a flattened copy in any supported format, optionally resized (the open document is not changed).", annotations: WRITE, commands: ["doc.saveAs"],
    input: {
      doc, path, format: z.enum(SAVE_FORMATS), overwrite, quality: z.number().min(0).max(100).optional().describe("JPEG 0-12, WebP 0-100"),
      width: z.number().int().min(1).max(300000).optional(), height: z.number().int().min(1).max(300000).optional(),
    },
    handler: (a, ctx) => cmd(ctx, "doc.saveAs", { ...a, path: outputPath(ctx, a.path, a.format, a.overwrite), asCopy: true }),
  });
}

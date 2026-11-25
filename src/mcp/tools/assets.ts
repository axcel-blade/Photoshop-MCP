import { z } from "zod";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { PsMcpError } from "../../shared.js";
import { AssetLibrary, type AssetRecord } from "../../assets/library.js";
import { PROVIDER_IDS, PROVIDERS, type AssetKind, type ProviderId } from "../../assets/providers.js";
import { cachedAssets, lookupAsset, matches, searchImages, summarize, type SearchRequest } from "../../assets/search.js";
import { DOWNLOAD_FORMATS } from "../../utils/download.js";
import { cmd, type ToolContext, type ToolOutput, tool, WRITE } from "./registry.js";
import { doc, inputPath } from "./args.js";

const M = "assets";
const SEARCH: ToolAnnotations = { readOnlyHint: true, openWorldHint: true };
const FETCH: ToolAnnotations = { readOnlyHint: false, destructiveHint: false, openWorldHint: true };

const providers = z.array(z.enum(PROVIDER_IDS)).max(6).optional().describe("Providers to search. Default: every configured provider suited to the search. openverse and wikimedia need no key; unsplash/pexels/pixabay need UNSPLASH_ACCESS_KEY / PEXELS_API_KEY / PIXABAY_API_KEY; google needs SERPAPI_API_KEY (or GOOGLE_CSE_API_KEY + GOOGLE_CSE_ID). Google results are web images with UNVERIFIED licences");
const orientation = z.enum(["landscape", "portrait", "square"]).optional();
const license = z.enum(["any", "commercial", "no-attribution"]).default("any").describe("commercial: commercial use allowed; no-attribution: also no credit required");
const searchInput = {
  query: z.string().min(1).max(200).describe("Keywords, e.g. 'mountain lake sunrise'"),
  providers,
  category: z.string().max(40).optional().describe("Category hint, e.g. nature, business, food, backgrounds, people, animals, buildings"),
  orientation,
  minWidth: z.number().int().min(1).max(100000).optional(),
  minHeight: z.number().int().min(1).max(100000).optional(),
  fileType: z.string().regex(/^[a-z,]+$/i).max(40).optional().describe(`Comma-separated file types: ${DOWNLOAD_FORMATS.join(", ")}`),
  license,
  color: z.string().max(20).optional().describe("Dominant colour hint (provider support varies), e.g. blue or #3366ff"),
  limit: z.number().int().min(1).max(100).default(20),
  page: z.number().int().min(1).max(100).default(1),
};
type SearchArgs = { query: string; providers?: ProviderId[]; category?: string; orientation?: "landscape" | "portrait" | "square"; minWidth?: number; minHeight?: number; fileType?: string; license: "any" | "commercial" | "no-attribution"; color?: string; limit: number; page: number };

const source = {
  assetId: z.string().max(100).optional().describe("Id of an already downloaded asset (asset_…), from download_image / get_downloaded_assets"),
  id: z.string().max(200).optional().describe("Image id from a search result (provider:id); downloaded first if needed"),
  url: z.string().url().max(4096).optional().describe("Direct image URL (validated, SSRF-checked); downloaded first"),
  path: z.string().min(1).max(1024).optional().describe("Local image file inside the allowed directories"),
};
type Source = { assetId?: string; id?: string; url?: string; path?: string };

const placement = {
  layerName: z.string().min(1).max(255).optional().describe("Layer name (default: the asset's name)"),
  x: z.number().optional(), y: z.number().optional(),
  width: z.number().min(1).optional(), height: z.number().min(1).optional(),
  fit: z.enum(["contain", "cover", "stretch", "none"]).default("contain").describe("How the image fills the x/y/width/height box"),
  fitToCanvas: z.boolean().default(false).describe("Fit the image to the whole canvas (uses fit for contain/cover/stretch)"),
  rotation: z.number().min(-360).max(360).optional().describe("Degrees clockwise, applied after placing"),
  scale: z.number().min(1).max(1000).optional().describe("Extra uniform scale in percent, applied after placing"),
  opacity: z.number().min(0).max(100).optional(),
};
type Placement = { layerName?: string; x?: number; y?: number; width?: number; height?: number; fit: "contain" | "cover" | "stretch" | "none"; fitToCanvas: boolean; rotation?: number; scale?: number; opacity?: number };

function providerCtx(ctx: ToolContext) {
  return { keys: ctx.config.assets.keys, fetchImpl: globalThis.fetch, timeoutMs: ctx.config.assets.searchTimeoutMs };
}
const lib = (ctx: ToolContext) => new AssetLibrary({ config: ctx.config, paths: ctx.paths, fetchImpl: globalThis.fetch });

async function runSearch(ctx: ToolContext, a: SearchArgs, extra: Partial<SearchRequest>): Promise<ToolOutput> {
  const r = await searchImages({ ...a, ...extra, query: extra.query ?? a.query, providers: a.providers ?? extra.providers, perPage: Math.min(a.limit, 30) }, providerCtx(ctx));
  const warnings = [...r.warnings];
  if (!r.results.length) warnings.push("No results: try fewer or more general keywords, drop size/orientation filters, or add provider keys (UNSPLASH_ACCESS_KEY, PEXELS_API_KEY, PIXABAY_API_KEY).");
  if (r.results.some((x) => x.licenseStatus === "unverified")) warnings.push("Google Images results are web images whose licence is UNVERIFIED (licenseStatus: unverified). Open the pageUrl and confirm the user may use an image before downloading it; prefer licensed providers for commercial work.");
  if (r.results.some((x) => x.attributionRequired)) warnings.push("Some results require attribution: keep the 'attribution' text and credit the creator in the final design or its delivery notes.");
  return {
    data: { query: r.query, count: r.results.length, results: r.results.map(summarize), providersSearched: r.providersSearched, skipped: r.skipped, next: "Pick ids, check license, then download_image { id } or import_image_to_photoshop { id }." },
    warnings, source: "server",
  };
}

function recordView(r: AssetRecord) {
  return { assetId: r.assetId, file: r.file, name: r.name, provider: r.provider, title: r.title, format: r.format, transparency: r.transparency ?? "unknown", width: r.width, height: r.height, bytes: r.bytes, creator: r.creator, license: r.license, licenseUrl: r.licenseUrl, licenseStatus: r.licenseStatus ?? "provider", attributionRequired: r.attributionRequired, attribution: r.attribution, sourceUrl: r.sourceUrl, pageUrl: r.pageUrl };
}

/** Resolve any source to a local file, downloading into the asset library when needed. */
async function resolveSource(ctx: ToolContext, s: Source): Promise<{ path: string; record?: AssetRecord; downloaded: boolean; name: string }> {
  const given = [s.assetId, s.id, s.url, s.path].filter(Boolean).length;
  if (given !== 1) throw new PsMcpError("VALIDATION_ERROR", "Pass exactly one of assetId, id, url or path");
  const L = lib(ctx);
  if (s.path) {
    const p = inputPath(ctx, s.path);
    return { path: p, record: L.get(p), downloaded: false, name: p.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, "") };
  }
  if (s.assetId) {
    const r = L.get(s.assetId);
    if (!r) throw new PsMcpError("OBJECT_NOT_FOUND", `No downloaded asset ${s.assetId}; see get_downloaded_assets`);
    return { path: r.file, record: r, downloaded: false, name: r.name };
  }
  if (s.id) {
    const have = L.get(s.id);
    if (have) return { path: have.file, record: have, downloaded: false, name: have.name };
    const { record } = await L.download({ asset: lookupAsset(s.id) });
    return { path: record.file, record, downloaded: true, name: record.name };
  }
  const { record } = await L.download({ url: s.url });
  return { path: record.file, record, downloaded: true, name: record.name };
}

async function canvasSize(ctx: ToolContext, d: unknown): Promise<{ width: number; height: number }> {
  const info = await cmd(ctx, "doc.info", { doc: d });
  return (info.data as { document: { width: number; height: number } }).document;
}

/** Place one local file as its own layer and apply optional transforms. */
async function placeOne(ctx: ToolContext, d: unknown, file: string, name: string, p: Placement, warnings: string[]): Promise<{ id: number; name: string; bounds?: unknown }> {
  let box: { x?: number; y?: number; width?: number; height?: number } = { x: p.x, y: p.y, width: p.width, height: p.height };
  if (p.fitToCanvas) {
    const c = await canvasSize(ctx, d);
    box = { x: 0, y: 0, width: c.width, height: c.height };
  }
  const placed = await cmd(ctx, "image.place", { doc: d, path: file, name: p.layerName ?? name, ...box, fit: p.fitToCanvas && p.fit === "none" ? "contain" : p.fit, linked: false });
  warnings.push(...(placed.warnings ?? []));
  let layer = (placed.data as { layer: { id: number; name: string; bounds?: unknown } }).layer;
  if (p.rotation || p.scale) {
    const t = await cmd(ctx, "layer.transform", { doc: d, layer: { id: layer.id }, angle: p.rotation, scaleX: p.scale, scaleY: p.scale, anchor: "center" });
    layer = (t.data as { layer: typeof layer }).layer ?? layer;
  }
  if (p.opacity !== undefined) await cmd(ctx, "layer.props", { doc: d, layer: { id: layer.id }, opacity: p.opacity });
  return layer;
}

const LICENSE_NOTE = "Check each asset's license and keep its attribution with the design (get_downloaded_assets { includeCredits: true } returns a credits block).";

export function registerAssetTools(): void {
  tool({
    name: "search_images", module: M,
    description: "Search images on Openverse, Wikimedia Commons, Unsplash, Pexels, Pixabay and Google Images by keywords, category, orientation, minimum size, file type, licence and colour. Returns normalized results with id, size, preview URL, creator and licence. No files are downloaded.",
    annotations: SEARCH, input: { ...searchInput, kind: z.enum(["photo", "illustration", "vector", "icon", "texture", "any"]).default("any") },
    handler: (a, ctx) => runSearch(ctx, a, { kind: a.kind as AssetKind }),
  });
  tool({
    name: "search_transparent_images", module: M, description: "Search cut-outs and graphics likely to have transparency (PNG / SVG / WebP) — objects, overlays, elements for compositing. Providers only report the file type, so many PNGs are still opaque: after downloading, check the asset's transparency field (\"alpha\" or \"none\"); for opaque photos on a plain background, import and run remove_background.",
    annotations: SEARCH, input: searchInput,
    handler: (a, ctx) => runSearch(ctx, a, { kind: "any", transparent: true, fileType: a.fileType ?? "png,svg", providers: ["openverse", "wikimedia", "pixabay", "google"] }),
  });
  tool({
    name: "search_stock_photos", module: M, description: "Search high-quality stock photographs (Unsplash, Pexels, Pixabay, Openverse photographs).",
    annotations: SEARCH, input: searchInput,
    handler: (a, ctx) => runSearch(ctx, a, { kind: "photo", providers: ["unsplash", "pexels", "pixabay", "openverse", "google"] }),
  });
  tool({
    name: "search_icons", module: M, description: "Search icons and simple vector symbols (SVG/PNG) from Openverse, Wikimedia Commons and Pixabay vectors.",
    annotations: SEARCH, input: searchInput,
    handler: (a, ctx) => runSearch(ctx, a, { kind: "icon", query: /\bicon\b/i.test(a.query) ? a.query : `${a.query} icon`, providers: ["openverse", "wikimedia", "pixabay", "google"] }),
  });
  tool({
    name: "search_textures", module: M, description: "Search textures and backgrounds (paper, grunge, wood, concrete, fabric, gradients…) for overlays and fills.",
    annotations: SEARCH, input: searchInput,
    handler: (a, ctx) => runSearch(ctx, a, { kind: "texture", category: a.category ?? "backgrounds", query: /texture|background|pattern/i.test(a.query) ? a.query : `${a.query} texture` }),
  });
  tool({
    name: "get_image_details", module: M, description: "Full details of a search result or downloaded asset: dimensions, file type, URLs, creator, licence, attribution text, tags and whether it is already downloaded.",
    annotations: { readOnlyHint: true, openWorldHint: false }, input: { id: z.string().min(1).max(200).describe("Search id (provider:id) or assetId") },
    handler: async (a, ctx) => {
      const L = lib(ctx);
      const local = L.get(a.id);
      if (local && a.id.startsWith("asset_")) return { data: { downloaded: true, asset: local }, source: "server" };
      const r = lookupAsset(a.id);
      const p = PROVIDERS[r.provider];
      const { allowedHosts: _h, trackDownloadUrl: _t, ...pub } = r;
      return { data: { ...pub, providerName: p.name, providerTerms: p.terms, downloaded: Boolean(local ?? L.get(r.id)), local: local ? recordView(local) : undefined }, source: "server" };
    },
  });
  tool({
    name: "filter_images", module: M, description: "Filter search results seen in this session (or the given ids) by orientation, size range, file type, transparency, licence, provider or text; optionally sort by resolution.",
    annotations: { readOnlyHint: true, openWorldHint: false },
    input: {
      ids: z.array(z.string().max(200)).max(500).optional().describe("Limit to these ids; default: all results seen this session"),
      orientation, minWidth: z.number().int().min(1).optional(), minHeight: z.number().int().min(1).optional(), maxWidth: z.number().int().min(1).optional(), maxHeight: z.number().int().min(1).optional(),
      fileTypes: z.array(z.string().max(10)).max(10).optional(), transparent: z.boolean().optional(), license, providers, text: z.string().max(100).optional(),
      sortBy: z.enum(["none", "resolution", "width", "height"]).default("none"), limit: z.number().int().min(1).max(200).default(50),
    },
    handler: async (a, ctx) => {
      void ctx;
      let pool = a.ids ? a.ids.map(lookupAsset) : cachedAssets();
      pool = pool.filter((x) => matches(x, a));
      const key = (x: { width?: number; height?: number }) => (a.sortBy === "width" ? x.width ?? 0 : a.sortBy === "height" ? x.height ?? 0 : (x.width ?? 0) * (x.height ?? 0));
      if (a.sortBy !== "none") pool.sort((p, q) => key(q) - key(p));
      return { data: { count: pool.length, results: pool.slice(0, a.limit).map(summarize) }, source: "server" };
    },
  });
  tool({
    name: "download_image", module: M,
    description: "Download an image into the local asset library (ASSETS_DIR) from a search result id (approved provider hosts only) or a validated public http(s) URL. Checks MIME/magic bytes (PNG, JPEG, WebP, GIF, TIFF, AVIF, HEIC, safe SVG), size and dimensions, retries transient failures, generates a unique sanitized filename and records source URL, creator and licence. Optionally places or opens it in Photoshop.",
    annotations: FETCH, commands: ["image.place", "doc.open"],
    input: {
      id: source.id, url: source.url,
      name: z.string().max(80).optional().describe("Base filename (sanitized); default from the title"),
      subfolder: z.string().max(40).optional().describe("Folder inside the asset library (default: provider name)"),
      minWidth: z.number().int().min(1).optional(), minHeight: z.number().int().min(1).optional(),
      then: z.enum(["none", "place", "open"]).default("none").describe("After downloading: nothing, place as a layer in the active document, or open as a new document"),
      doc, ...placement,
    },
    handler: async (a, ctx) => {
      if (Boolean(a.id) === Boolean(a.url)) throw new PsMcpError("VALIDATION_ERROR", "Pass either id (from a search) or url");
      const { record, duplicate, attempts } = await lib(ctx).download({ asset: a.id ? lookupAsset(a.id) : undefined, url: a.url }, a);
      const warnings = [LICENSE_NOTE];
      if (record.licenseStatus === "unverified") warnings.push(`Licence UNVERIFIED (found via Google Images). Confirm usage rights on ${record.pageUrl ?? record.sourceUrl} before using it in a design.`);
      if (record.provider === "url") warnings.push("Downloaded from a plain URL: the licence is unknown. Confirm the user has the right to use it.");
      if (duplicate) warnings.push("Identical file already in the library; reused it.");
      if (record.transparency === "none" && a.id && /png|webp/.test(lookupAsset(a.id).fileType ?? "")) warnings.push("This image has no alpha channel (opaque background). Use remove_background after importing if you need a cut-out.");
      const data: Record<string, unknown> = { asset: recordView(record), duplicate, attempts };
      if (a.then === "none") return { data, warnings, source: "server" };
      if (a.then === "open") {
        const o = await cmd(ctx, "doc.open", { path: record.file });
        return { data: { ...data, ...(o.data as object) }, warnings: [...warnings, ...(o.warnings ?? [])] };
      }
      data.layer = await placeOne(ctx, a.doc, record.file, record.name, a, warnings);
      return { data, warnings };
    },
  });
  tool({
    name: "download_multiple_images", module: M, description: "Download several images (search ids and/or URLs) into the asset library. Continues past failures and reports each one.",
    annotations: FETCH,
    input: {
      items: z.array(z.object({ id: source.id, url: source.url, name: z.string().max(80).optional() })).min(1).max(50),
      subfolder: z.string().max(40).optional(), minWidth: z.number().int().min(1).optional(), minHeight: z.number().int().min(1).optional(),
    },
    handler: async (a, ctx) => {
      const L = lib(ctx);
      const ok: unknown[] = [], failed: unknown[] = [];
      for (const it of a.items) {
        try {
          if (Boolean(it.id) === Boolean(it.url)) throw new PsMcpError("VALIDATION_ERROR", "Each item needs either id or url");
          const r = await L.download({ asset: it.id ? lookupAsset(it.id) : undefined, url: it.url }, { ...a, name: it.name });
          ok.push({ source: it.id ?? it.url, duplicate: r.duplicate, asset: recordView(r.record) });
        } catch (e) {
          failed.push({ source: it.id ?? it.url, error: (e as { code?: string }).code ?? "ERROR", message: (e as Error).message });
        }
      }
      return { data: { downloaded: ok.length, failed: failed.length, assets: ok, errors: failed }, warnings: [LICENSE_NOTE], source: "server" };
    },
  });
  tool({
    name: "import_image_to_photoshop", module: M,
    description: "Import one image into Photoshop from a downloaded asset, a search id (auto-downloaded), a URL or a local path: place it as a named smart-object layer (position, size, fit, fit-to-canvas, rotation, scale, opacity) or open it as a new document.",
    annotations: WRITE, commands: ["image.place", "doc.open", "doc.info", "layer.transform", "layer.props"],
    input: { ...source, mode: z.enum(["place", "open"]).default("place"), doc, ...placement },
    handler: async (a, ctx) => {
      const src = await resolveSource(ctx, a);
      const warnings: string[] = src.record?.attributionRequired ? [`Attribution required: ${src.record.attribution}`] : [];
      if (src.record?.licenseStatus === "unverified") warnings.push(`Licence UNVERIFIED: confirm usage rights on ${src.record.pageUrl ?? src.record.sourceUrl}.`);
      const asset = src.record ? recordView(src.record) : { file: src.path };
      if (a.mode === "open") {
        const o = await cmd(ctx, "doc.open", { path: src.path });
        return { data: { asset, downloaded: src.downloaded, ...(o.data as object) }, warnings: [...warnings, ...(o.warnings ?? [])] };
      }
      const layer = await placeOne(ctx, a.doc, src.path, src.name, a, warnings);
      return { data: { asset, downloaded: src.downloaded, layer }, warnings };
    },
  });
  tool({
    name: "import_multiple_images", module: M,
    description: "Import several images into one document, each as its own named layer. Optionally create the document first, arrange in a grid, stack them fitted to the canvas, or use per-image placement; optionally put them in a group.",
    annotations: WRITE, commands: ["doc.create", "doc.info", "image.place", "layer.transform", "layer.props", "layer.group"],
    input: {
      images: z.array(z.object({ ...source, ...placement })).min(1).max(50),
      newDocument: z.object({ name: z.string().max(255).default("Imported Assets"), width: z.number().int().min(1).max(300000), height: z.number().int().min(1).max(300000), resolution: z.number().min(1).max(10000).default(72), background: z.enum(["white", "black", "transparent"]).default("white") }).optional(),
      doc,
      layout: z.enum(["none", "grid", "stack"]).default("none").describe("none: per-image placement; grid: tile into a grid; stack: each fitted to the canvas"),
      columns: z.number().int().min(1).max(20).optional(), gap: z.number().min(0).max(2000).default(20),
      group: z.string().max(255).optional().describe("Put the imported layers into a group with this name"),
    },
    handler: async (a, ctx) => {
      const warnings: string[] = [];
      let d: unknown = a.doc;
      if (a.newDocument) {
        const c = await cmd(ctx, "doc.create", a.newDocument);
        d = { id: (c.data as { document: { id: number } }).document.id };
      }
      const size = a.layout === "grid" ? await canvasSize(ctx, d) : undefined;
      const cols = a.columns ?? Math.ceil(Math.sqrt(a.images.length));
      const rows = Math.ceil(a.images.length / cols);
      const layers: unknown[] = [], errors: unknown[] = [], credits = new Set<string>();
      for (let i = 0; i < a.images.length; i++) {
        const im = a.images[i]!;
        try {
          const src = await resolveSource(ctx, im);
          if (src.record?.attributionRequired) credits.add(src.record.attribution);
          let p: Placement = im;
          if (a.layout === "grid" && size) {
            const cw = (size.width - a.gap * (cols + 1)) / cols, ch = (size.height - a.gap * (rows + 1)) / rows;
            p = { ...im, fitToCanvas: false, x: a.gap + (i % cols) * (cw + a.gap), y: a.gap + Math.floor(i / cols) * (ch + a.gap), width: Math.max(1, cw), height: Math.max(1, ch) };
          } else if (a.layout === "stack") p = { ...im, fitToCanvas: true };
          const layer = await placeOne(ctx, d, src.path, im.layerName ?? src.name, p, warnings);
          layers.push({ ...layer, asset: src.record?.assetId ?? src.path });
        } catch (e) {
          errors.push({ index: i, error: (e as { code?: string }).code ?? "ERROR", message: (e as Error).message });
        }
      }
      let group: unknown;
      if (a.group && layers.length) {
        const g = await cmd(ctx, "layer.group", { doc: d, layers: layers.map((l) => ({ id: (l as { id: number }).id })), name: a.group });
        group = g.data;
      }
      if (credits.size) warnings.push(`Attribution required for: ${[...credits].join("; ")}`);
      if (errors.length) warnings.push(`${errors.length} image(s) could not be imported; see errors.`);
      return { data: { document: d, imported: layers.length, layers, errors, group }, warnings };
    },
  });
  tool({
    name: "get_downloaded_assets", module: M, description: "List images in the local asset library with file path, size, provider, creator and licence; filter by provider or text. includeCredits returns a ready-to-paste attribution block.",
    annotations: { readOnlyHint: true, openWorldHint: false },
    input: {
      provider: z.enum([...PROVIDER_IDS, "url"]).optional(), text: z.string().max(100).optional(),
      includeCredits: z.boolean().default(false), limit: z.number().int().min(1).max(1000).default(100),
    },
    handler: async (a, ctx) => {
      const L = lib(ctx);
      const t = a.text?.toLowerCase();
      const all = L.list().filter((r) => (!a.provider || r.provider === a.provider) && (!t || [r.title, r.name, ...r.tags, r.creator ?? ""].some((s) => s.toLowerCase().includes(t))));
      const list = all.slice(-a.limit).reverse();
      return { data: { directory: L.dir, count: all.length, assets: list.map(recordView), credits: a.includeCredits ? L.credits(list) : undefined }, source: "server" };
    },
  });
}

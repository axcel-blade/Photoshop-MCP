import { PsMcpError } from "../utils/errors.js";
import { DOWNLOAD_FORMATS } from "../utils/download.js";
import { PROVIDER_IDS, PROVIDERS, type AssetKind, type ImageAsset, type ProviderContext, type ProviderId, type SearchQuery } from "./providers.js";

export interface ImageFilter {
  orientation?: "landscape" | "portrait" | "square";
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
  fileTypes?: string[];
  transparent?: boolean;
  license?: "any" | "commercial" | "no-attribution";
  providers?: ProviderId[];
  text?: string;
}

/** Results seen this process, keyed by asset id, so later calls can refer to an image by id. */
const CACHE = new Map<string, ImageAsset>();
const CACHE_MAX = 5000;

export function remember(a: ImageAsset): void {
  CACHE.delete(a.id);
  CACHE.set(a.id, a);
  if (CACHE.size > CACHE_MAX) CACHE.delete(CACHE.keys().next().value!);
}

export function lookupAsset(id: string): ImageAsset {
  const a = CACHE.get(id);
  if (!a) throw new PsMcpError("OBJECT_NOT_FOUND", `Unknown image id ${id}. Search first (search_images); ids look like "openverse:abc".`);
  return a;
}

export function cachedAssets(): ImageAsset[] {
  return [...CACHE.values()];
}

export function normalizeType(t: string): string {
  const x = t.trim().toLowerCase().replace(/^\./, "");
  return x === "jpeg" ? "jpg" : x === "tif" ? "tiff" : x;
}

const TRANSPARENT_TYPES = ["png", "svg", "webp", "gif", "tiff"];

function orientationOf(a: ImageAsset): "landscape" | "portrait" | "square" | undefined {
  if (!a.width || !a.height) return undefined;
  const r = a.width / a.height;
  return r > 1.1 ? "landscape" : r < 0.9 ? "portrait" : "square";
}

export function matches(a: ImageAsset, f: ImageFilter): boolean {
  if (f.providers?.length && !f.providers.includes(a.provider)) return false;
  if (f.orientation) {
    const o = orientationOf(a);
    if (o && o !== f.orientation) return false;
  }
  if (f.minWidth && a.width && a.width < f.minWidth) return false;
  if (f.minHeight && a.height && a.height < f.minHeight) return false;
  if (f.maxWidth && a.width && a.width > f.maxWidth) return false;
  if (f.maxHeight && a.height && a.height > f.maxHeight) return false;
  const types = f.fileTypes?.map(normalizeType);
  if (types?.length && a.fileType && !types.includes(a.fileType)) return false;
  if (f.transparent && a.fileType && !TRANSPARENT_TYPES.includes(a.fileType)) return false;
  if (f.license === "commercial" && !a.commercialUse) return false;
  if (f.license === "no-attribution" && a.attributionRequired) return false;
  if (f.text) {
    const t = f.text.toLowerCase();
    if (![a.title, ...a.tags, a.creator ?? ""].some((s) => s.toLowerCase().includes(t))) return false;
  }
  return true;
}

/** Drop results the downloader would reject anyway (PDF/DjVu scans, audio, video…). */
function downloadable(a: ImageAsset): boolean {
  return !a.fileType || (DOWNLOAD_FORMATS as readonly string[]).includes(normalizeType(a.fileType));
}

export interface SearchRequest extends Omit<SearchQuery, "kind" | "perPage" | "page"> {
  kind?: AssetKind;
  providers?: ProviderId[];
  perPage?: number;
  page?: number;
  limit?: number;
}

export interface SearchResponse {
  query: string;
  results: ImageAsset[];
  providersSearched: ProviderId[];
  skipped: { provider: ProviderId; reason: string }[];
  warnings: string[];
}

/** Search the requested (or all suitable configured) providers in parallel, normalize, filter and interleave. */
export async function searchImages(req: SearchRequest, ctx: ProviderContext): Promise<SearchResponse> {
  const kind = req.kind ?? "any";
  const wanted = req.providers?.length ? req.providers : PROVIDER_IDS.filter((p) => PROVIDERS[p].kinds.includes(kind));
  const skipped: SearchResponse["skipped"] = [];
  const run: ProviderId[] = [];
  for (const id of wanted) {
    const p = PROVIDERS[id];
    const ok = p.configured ? p.configured(ctx.keys) : !p.needsKey || Boolean(ctx.keys[p.needsKey]);
    if (!ok) skipped.push({ provider: id, reason: `not configured (${p.keyHint ?? `set ${p.needsKey!.toUpperCase()}_${p.needsKey === "unsplash" ? "ACCESS_KEY" : "API_KEY"}`})` });
    else run.push(id);
  }
  if (!run.length) throw new PsMcpError("PROVIDER_NOT_CONFIGURED", "No image provider available for this search", { skipped });
  const q: SearchQuery = { ...req, kind, perPage: req.perPage ?? 20, page: req.page ?? 1 };
  const settled = await Promise.allSettled(run.map((id) => PROVIDERS[id].search(q, ctx)));
  const warnings: string[] = [];
  const lists: ImageAsset[][] = [];
  settled.forEach((s, i) => {
    if (s.status === "fulfilled") lists.push(s.value);
    else {
      skipped.push({ provider: run[i]!, reason: (s.reason as Error).message });
      warnings.push(`${run[i]}: ${(s.reason as Error).message}`);
    }
  });
  if (!lists.length) throw new PsMcpError("PROVIDER_ERROR", "All image providers failed", { skipped });
  const filter: ImageFilter = { orientation: req.orientation, minWidth: req.minWidth, minHeight: req.minHeight, fileTypes: req.fileType ? req.fileType.split(",") : undefined, transparent: req.transparent, license: req.license };
  // Round-robin so one provider does not dominate.
  const results: ImageAsset[] = [];
  const seen = new Set<string>();
  for (let i = 0; lists.some((l) => i < l.length); i++) {
    for (const l of lists) {
      const a = l[i];
      if (!a || seen.has(a.downloadUrl) || !matches(a, filter) || !downloadable(a)) continue;
      seen.add(a.downloadUrl);
      results.push(a);
    }
  }
  const limited = results.slice(0, req.limit ?? 30);
  limited.forEach(remember);
  return { query: req.query, results: limited, providersSearched: run, skipped, warnings };
}

/** Compact view for listing results to the model. */
export function summarize(a: ImageAsset): Record<string, unknown> {
  return {
    id: a.id, provider: a.provider, title: a.title, width: a.width, height: a.height, fileType: a.fileType, previewUrl: a.previewUrl, pageUrl: a.pageUrl,
    creator: a.creator, license: a.license, licenseStatus: a.licenseStatus ?? "provider", attributionRequired: a.attributionRequired, commercialUse: a.commercialUse, attribution: a.attribution,
  };
}

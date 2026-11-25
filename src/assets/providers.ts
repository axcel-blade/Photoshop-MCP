/* eslint-disable @typescript-eslint/no-explicit-any -- provider JSON is untyped; every field is normalized below */
import { createHash } from "node:crypto";
import { PsMcpError } from "../utils/errors.js";

/**
 * Image search providers. Each talks only to its fixed official API host and normalizes results
 * into ImageAsset. Providers that need a key are skipped (with a warning) when it is not configured.
 * Premium / paid results (e.g. Unsplash+) are excluded: this layer never bypasses paid content.
 */
export const PROVIDER_IDS = ["openverse", "wikimedia", "unsplash", "pexels", "pixabay", "google"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export type Orientation = "landscape" | "portrait" | "square";
export type AssetKind = "photo" | "illustration" | "vector" | "icon" | "texture" | "any";

export interface SearchQuery {
  query: string;
  kind: AssetKind;
  category?: string;
  orientation?: Orientation;
  minWidth?: number;
  minHeight?: number;
  fileType?: string;
  transparent?: boolean;
  license?: "any" | "commercial" | "no-attribution";
  color?: string;
  perPage: number;
  page: number;
}

export interface ImageAsset {
  /** Stable id: "<provider>:<provider id>". */
  id: string;
  provider: ProviderId;
  title: string;
  width?: number;
  height?: number;
  fileType?: string;
  mimeType?: string;
  thumbnailUrl?: string;
  previewUrl?: string;
  downloadUrl: string;
  pageUrl?: string;
  creator?: string;
  creatorUrl?: string;
  license: string;
  licenseUrl?: string;
  attributionRequired: boolean;
  /** "provider": licence stated by a licensed-content provider; "unverified": a web result whose licence must be checked on its source page. */
  licenseStatus?: "provider" | "unverified";
  attribution: string;
  commercialUse: boolean;
  tags: string[];
  /** Hosts the download URL (and its redirects) must stay on; undefined = any public, SSRF-checked host. */
  allowedHosts?: string[];
  /** Provider-specific hook the terms require on download (Unsplash download tracking). */
  trackDownloadUrl?: string;
}

export interface ProviderKeys { unsplash?: string; pexels?: string; pixabay?: string; serpapi?: string; googleCseKey?: string; googleCseId?: string }

export interface ProviderContext {
  keys: ProviderKeys;
  fetchImpl: typeof fetch;
  timeoutMs: number;
}

export interface Provider {
  id: ProviderId;
  name: string;
  needsKey?: keyof ProviderKeys;
  /** Custom configuration check (providers with several possible credentials). */
  configured?(keys: ProviderKeys): boolean;
  /** What to set when not configured. */
  keyHint?: string;
  /** Kinds this provider is good for (used when no provider list is given). */
  kinds: AssetKind[];
  homepage: string;
  terms: string;
  search(q: SearchQuery, ctx: ProviderContext): Promise<ImageAsset[]>;
}

// ---------------------------------------------------------------- helpers

/** Simple per-provider throttle and 429 back-off (respects Retry-After). */
const gate = new Map<ProviderId, { next: number; blockedUntil: number }>();
const MIN_INTERVAL: Record<ProviderId, number> = { openverse: 1000, wikimedia: 250, unsplash: 1000, pexels: 500, pixabay: 700, google: 500 };

export function resetRateLimits(): void {
  gate.clear();
}

async function throttle(id: ProviderId): Promise<void> {
  const g = gate.get(id) ?? { next: 0, blockedUntil: 0 };
  const now = Date.now();
  if (g.blockedUntil > now) throw new PsMcpError("LIMIT_EXCEEDED", `${id} rate limit reached; retry after ${new Date(g.blockedUntil).toISOString()}`);
  const wait = Math.max(0, g.next - now);
  g.next = Math.max(now, g.next) + MIN_INTERVAL[id];
  gate.set(id, g);
  if (wait) await new Promise((r) => setTimeout(r, Math.min(wait, 5000)));
}

async function getJson(id: ProviderId, url: string, ctx: ProviderContext, headers: Record<string, string> = {}): Promise<unknown> {
  await throttle(id);
  let res: Response;
  try {
    res = await ctx.fetchImpl(url, { headers: { accept: "application/json", "user-agent": "photoshop-ai-mcp (image search)", ...headers }, signal: AbortSignal.timeout(ctx.timeoutMs), redirect: "follow" });
  } catch (e) {
    throw new PsMcpError("PROVIDER_ERROR", `${id} search failed: ${(e as Error).message}`);
  }
  if (res.status === 429) {
    const after = Number(res.headers.get("retry-after"));
    const g = gate.get(id)!;
    g.blockedUntil = Date.now() + (Number.isFinite(after) && after > 0 ? after * 1000 : 60_000);
    throw new PsMcpError("LIMIT_EXCEEDED", `${id} rate limit reached (HTTP 429)`);
  }
  if (res.status === 401 || res.status === 403) throw new PsMcpError("PROVIDER_NOT_CONFIGURED", `${id} rejected the API key (HTTP ${res.status})`);
  if (!res.ok) throw new PsMcpError("PROVIDER_ERROR", `${id} returned HTTP ${res.status}`);
  return res.json();
}

const qs = (o: Record<string, string | number | boolean | undefined>) =>
  new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => [k, String(v)] as [string, string])).toString();

const extOf = (u?: string) => {
  if (!u) return undefined;
  try { return /\.([a-z0-9]{2,5})$/i.exec(new URL(u).pathname)?.[1]?.toLowerCase().replace("jpeg", "jpg"); } catch { return undefined; }
};
const stripHtml = (s?: string) => (s ?? "").replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();

function attributionText(a: Pick<ImageAsset, "title" | "creator" | "provider" | "license">, providerName: string): string {
  return `"${a.title}"${a.creator ? ` by ${a.creator}` : ""} via ${providerName} (${a.license})`;
}

// ---------------------------------------------------------------- Openverse (no key)

const openverse: Provider = {
  id: "openverse", name: "Openverse", kinds: ["photo", "illustration", "vector", "icon", "texture", "any"],
  homepage: "https://openverse.org", terms: "https://docs.openverse.org/terms_of_service.html",
  async search(q, ctx) {
    const ext = q.fileType ?? (q.transparent ? "png,svg" : undefined);
    const category = q.kind === "photo" || q.kind === "texture" ? "photograph" : q.kind === "illustration" || q.kind === "vector" || q.kind === "icon" ? "illustration,digitized_artwork" : undefined;
    const url = `https://api.openverse.org/v1/images/?${qs({
      q: q.query, page_size: Math.min(q.perPage, 20), page: q.page, extension: ext, category,
      aspect_ratio: q.orientation === "landscape" ? "wide" : q.orientation === "portrait" ? "tall" : q.orientation, size: Math.max(q.minWidth ?? 0, q.minHeight ?? 0) >= 1000 ? "large" : undefined,
      license_type: q.license === "commercial" ? "commercial" : undefined, license: q.license === "no-attribution" ? "cc0,pdm" : undefined, mature: false,
    })}`;
    const data = (await getJson("openverse", url, ctx)) as { results?: Record<string, unknown>[] };
    return (data.results ?? []).map((r) => {
      const lic = String(r.license ?? "").toLowerCase();
      const license = lic === "cc0" || lic === "pdm" ? (lic === "cc0" ? "CC0 1.0" : "Public Domain Mark") : `CC ${lic.toUpperCase()} ${r.license_version ?? ""}`.trim();
      const a: ImageAsset = {
        id: `openverse:${r.id}`, provider: "openverse", title: String(r.title || "Untitled"), width: num(r.width), height: num(r.height),
        fileType: (r.filetype as string | undefined)?.replace("jpeg", "jpg") ?? extOf(String(r.url)), thumbnailUrl: r.thumbnail as string, previewUrl: r.thumbnail as string,
        downloadUrl: String(r.url), pageUrl: r.foreign_landing_url as string, creator: r.creator as string | undefined, creatorUrl: r.creator_url as string | undefined,
        license, licenseUrl: r.license_url as string | undefined, attributionRequired: !(lic === "cc0" || lic === "pdm"), commercialUse: !lic.includes("nc"),
        tags: ((r.tags as { name: string }[] | undefined) ?? []).map((t) => t.name).slice(0, 20), attribution: "",
      };
      a.attribution = String(r.attribution ?? attributionText(a, `Openverse/${r.source ?? r.provider ?? "source"}`));
      return a;
    });
  },
};

// ---------------------------------------------------------------- Wikimedia Commons (no key)

const wikimedia: Provider = {
  id: "wikimedia", name: "Wikimedia Commons", kinds: ["photo", "illustration", "vector", "icon", "texture", "any"],
  homepage: "https://commons.wikimedia.org", terms: "https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use",
  async search(q, ctx) {
    let term = q.query;
    if (q.fileType === "svg" || q.kind === "vector" || q.kind === "icon") term += " filetype:drawing";
    else if (q.kind === "photo" || q.kind === "texture") term += " filetype:bitmap";
    else term += " -filemime:pdf -filemime:djvu"; // scanned books otherwise dominate full-text matches
    const url = `https://commons.wikimedia.org/w/api.php?${qs({
      action: "query", format: "json", formatversion: 2, generator: "search", gsrsearch: term, gsrnamespace: 6, gsrlimit: Math.min(q.perPage, 50), gsroffset: (q.page - 1) * q.perPage,
      prop: "imageinfo", iiprop: "url|size|mime|extmetadata", iiurlwidth: 640, origin: "*",
    })}`;
    const data = (await getJson("wikimedia", url, ctx)) as { query?: { pages?: { pageid: number; title: string; imageinfo?: Record<string, unknown>[] }[] } };
    const out: ImageAsset[] = [];
    for (const p of data.query?.pages ?? []) {
      const ii = p.imageinfo?.[0];
      if (!ii) continue;
      const meta = (ii.extmetadata ?? {}) as Record<string, { value?: string }>;
      const license = stripHtml(meta.LicenseShortName?.value) || "See file page";
      const l = license.toLowerCase();
      const free = /cc0|public domain|pd|cc by|cc-by|gfdl|attribution/.test(l);
      if (!free) continue; // unknown / non-free (fair use) files are skipped
      const a: ImageAsset = {
        id: `wikimedia:${p.pageid}`, provider: "wikimedia", title: stripHtml(meta.ObjectName?.value) || p.title.replace(/^File:/, "").replace(/\.[^.]+$/, ""),
        width: num(ii.width), height: num(ii.height), mimeType: ii.mime as string, fileType: mimeToType(ii.mime as string), thumbnailUrl: ii.thumburl as string, previewUrl: ii.thumburl as string,
        downloadUrl: String(ii.url), pageUrl: ii.descriptionurl as string, creator: stripHtml(meta.Artist?.value) || undefined, license, licenseUrl: meta.LicenseUrl?.value,
        attributionRequired: !/cc0|public domain/.test(l) || meta.AttributionRequired?.value === "true", commercialUse: !/\bnc\b|non-?commercial/.test(l),
        tags: stripHtml(meta.Categories?.value).split("|").filter(Boolean).slice(0, 20), attribution: "", allowedHosts: ["upload.wikimedia.org"],
      };
      a.attribution = attributionText(a, "Wikimedia Commons");
      out.push(a);
    }
    return out;
  },
};

// ---------------------------------------------------------------- Unsplash (UNSPLASH_ACCESS_KEY)

const unsplash: Provider = {
  id: "unsplash", name: "Unsplash", needsKey: "unsplash", kinds: ["photo", "texture", "any"],
  homepage: "https://unsplash.com", terms: "https://unsplash.com/api-terms",
  async search(q, ctx) {
    const url = `https://api.unsplash.com/search/photos?${qs({
      query: q.query, per_page: Math.min(q.perPage, 30), page: q.page, orientation: q.orientation === "square" ? "squarish" : q.orientation, color: q.color, content_filter: "high",
    })}`;
    const data = (await getJson("unsplash", url, ctx, { authorization: `Client-ID ${ctx.keys.unsplash}`, "accept-version": "v1" })) as { results?: Record<string, any>[] };
    return (data.results ?? []).filter((r) => !r.premium && !r.plus).map((r) => {
      const a: ImageAsset = {
        id: `unsplash:${r.id}`, provider: "unsplash", title: String(r.alt_description || r.description || "Unsplash photo"), width: r.width, height: r.height, fileType: "jpg",
        thumbnailUrl: r.urls?.thumb, previewUrl: r.urls?.small, downloadUrl: String(r.urls?.full ?? r.urls?.raw), pageUrl: r.links?.html,
        creator: r.user?.name, creatorUrl: r.user?.links?.html, license: "Unsplash License", licenseUrl: "https://unsplash.com/license",
        attributionRequired: false, commercialUse: true, tags: (r.tags ?? []).map((t: { title: string }) => t.title).slice(0, 20), attribution: "",
        allowedHosts: ["images.unsplash.com"], trackDownloadUrl: r.links?.download_location,
      };
      a.attribution = `Photo by ${a.creator ?? "unknown"} on Unsplash`;
      return a;
    });
  },
};

// ---------------------------------------------------------------- Pexels (PEXELS_API_KEY)

const pexels: Provider = {
  id: "pexels", name: "Pexels", needsKey: "pexels", kinds: ["photo", "texture", "any"],
  homepage: "https://www.pexels.com", terms: "https://www.pexels.com/api/documentation/#guidelines",
  async search(q, ctx) {
    const url = `https://api.pexels.com/v1/search?${qs({
      query: q.query, per_page: Math.min(q.perPage, 80), page: q.page, orientation: q.orientation,
      size: (q.minWidth ?? 0) >= 4000 ? "large" : (q.minWidth ?? 0) >= 1920 ? "medium" : undefined, color: q.color?.replace("#", ""),
    })}`;
    const data = (await getJson("pexels", url, ctx, { authorization: String(ctx.keys.pexels) })) as { photos?: Record<string, any>[] };
    return (data.photos ?? []).map((r) => {
      const a: ImageAsset = {
        id: `pexels:${r.id}`, provider: "pexels", title: String(r.alt || "Pexels photo"), width: r.width, height: r.height, fileType: extOf(r.src?.original) ?? "jpg",
        thumbnailUrl: r.src?.tiny, previewUrl: r.src?.medium, downloadUrl: String(r.src?.original), pageUrl: r.url, creator: r.photographer, creatorUrl: r.photographer_url,
        license: "Pexels License", licenseUrl: "https://www.pexels.com/license/", attributionRequired: false, commercialUse: true, tags: [], attribution: "",
        allowedHosts: ["images.pexels.com"],
      };
      a.attribution = `Photo by ${a.creator ?? "unknown"} on Pexels`;
      return a;
    });
  },
};

// ---------------------------------------------------------------- Pixabay (PIXABAY_API_KEY)

const PIXABAY_CATEGORIES = ["backgrounds", "fashion", "nature", "science", "education", "feelings", "health", "people", "religion", "places", "animals", "industry", "computer", "food", "sports", "transportation", "travel", "buildings", "business", "music"];

const pixabay: Provider = {
  id: "pixabay", name: "Pixabay", needsKey: "pixabay", kinds: ["photo", "illustration", "vector", "icon", "texture", "any"],
  homepage: "https://pixabay.com", terms: "https://pixabay.com/api/docs/",
  async search(q, ctx) {
    const type = q.kind === "photo" || q.kind === "texture" ? "photo" : q.kind === "illustration" ? "illustration" : q.kind === "vector" || q.kind === "icon" || q.transparent ? "vector" : "all";
    const cat = q.category && PIXABAY_CATEGORIES.includes(q.category) ? q.category : q.kind === "texture" ? "backgrounds" : undefined;
    const url = `https://pixabay.com/api/?${qs({
      key: ctx.keys.pixabay, q: q.query.slice(0, 100), image_type: type, category: cat, per_page: Math.max(3, Math.min(q.perPage, 200)), page: q.page, safesearch: true,
      orientation: q.orientation === "landscape" ? "horizontal" : q.orientation === "portrait" ? "vertical" : undefined, min_width: q.minWidth, min_height: q.minHeight, colors: q.transparent ? "transparent" : undefined,
    })}`;
    const data = (await getJson("pixabay", url, ctx)) as { hits?: Record<string, any>[] };
    return (data.hits ?? []).map((r) => {
      const a: ImageAsset = {
        id: `pixabay:${r.id}`, provider: "pixabay", title: String(r.tags || "Pixabay image").split(",")[0]!.trim(), width: r.imageWidth, height: r.imageHeight,
        fileType: extOf(r.largeImageURL) ?? "jpg", thumbnailUrl: r.previewURL, previewUrl: r.webformatURL, downloadUrl: String(r.largeImageURL), pageUrl: r.pageURL,
        creator: r.user, creatorUrl: r.user_id ? `https://pixabay.com/users/${r.user}-${r.user_id}/` : undefined, license: "Pixabay Content License", licenseUrl: "https://pixabay.com/service/license-summary/",
        attributionRequired: false, commercialUse: true, tags: String(r.tags ?? "").split(",").map((s) => s.trim()).filter(Boolean), attribution: "",
        allowedHosts: ["pixabay.com", "cdn.pixabay.com"],
      };
      a.attribution = `Image by ${a.creator ?? "unknown"} from Pixabay`;
      return a;
    });
  },
};

function num(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function mimeToType(m?: string): string | undefined {
  if (!m) return undefined;
  return ({ "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp", "image/tiff": "tiff", "image/svg+xml": "svg" } as Record<string, string>)[m] ?? m.split("/")[1];
}

// ---------------------------------------------------------------- Google Images (SERPAPI_API_KEY, or GOOGLE_CSE_API_KEY + GOOGLE_CSE_ID)

/**
 * Google Images through authorized APIs only (no scraping):
 *  - SerpApi google_images engine (SERPAPI_API_KEY), preferred; or
 *  - Google Programmable Search / Custom Search JSON API (GOOGLE_CSE_API_KEY + GOOGLE_CSE_ID, searchType=image).
 *    Google closed it to new customers and shuts it down on 2027-01-01.
 * Google results come from anywhere on the web, so their licence is NOT known: they are marked
 * licenseStatus "unverified" and attributionRequired; the usage-rights filter is only Google's label.
 */
const google: Provider = {
  id: "google", name: "Google Images", kinds: ["photo", "illustration", "vector", "icon", "texture", "any"],
  homepage: "https://images.google.com", terms: "https://policies.google.com/terms",
  keyHint: "set SERPAPI_API_KEY, or GOOGLE_CSE_API_KEY + GOOGLE_CSE_ID",
  configured: (k) => Boolean(k.serpapi || (k.googleCseKey && k.googleCseId)),
  async search(q, ctx) {
    const minSide = Math.max(q.minWidth ?? 0, q.minHeight ?? 0);
    const rightsLabel = q.license === "commercial" || q.license === "no-attribution" ? "labelled free to use or share, even commercially, by Google" : undefined;
    const type = q.kind === "photo" || q.kind === "texture" ? "photo" : q.kind === "illustration" || q.kind === "icon" ? "clipart" : q.kind === "vector" ? "lineart" : undefined;
    const color = q.color?.toLowerCase();
    const items: { url: string; title: string; width?: number; height?: number; thumb?: string; page?: string; site?: string; mime?: string }[] = [];
    if (ctx.keys.serpapi) {
      const colors = ["bw", "red", "orange", "yellow", "green", "teal", "blue", "purple", "pink", "white", "gray", "black", "brown"];
      const url = `https://serpapi.com/search.json?${qs({
        engine: "google_images", q: q.fileType && !q.fileType.includes(",") ? `${q.query} filetype:${q.fileType}` : q.query, api_key: ctx.keys.serpapi, ijn: q.page - 1, safe: "active",
        image_type: type, image_color: q.transparent ? "trans" : color && colors.includes(color) ? color : undefined,
        licenses: rightsLabel ? "fc" : undefined, imgar: q.orientation === "landscape" ? "w" : q.orientation === "portrait" ? "t" : q.orientation === "square" ? "s" : undefined,
        imgsz: minSide >= 3000 ? "6mp" : minSide >= 1920 ? "2mp" : minSide >= 1024 ? "xga" : minSide >= 800 ? "svga" : undefined,
      })}`;
      const data = (await getJson("google", url, ctx)) as { images_results?: Record<string, any>[]; error?: string };
      if (data.error && !data.images_results) throw new PsMcpError("PROVIDER_ERROR", `google (SerpApi): ${String(data.error).slice(0, 200)}`);
      for (const r of data.images_results ?? []) {
        if (r.is_product || !r.original) continue;
        items.push({ url: r.original, title: r.title, width: num(r.original_width), height: num(r.original_height), thumb: r.thumbnail, page: r.link, site: r.source });
      }
    } else {
      const colors = ["black", "blue", "brown", "gray", "green", "orange", "pink", "purple", "red", "teal", "white", "yellow"];
      const n = Math.min(q.perPage, 10);
      const url = `https://www.googleapis.com/customsearch/v1?${qs({
        key: ctx.keys.googleCseKey, cx: ctx.keys.googleCseId, q: q.query, searchType: "image", num: n, start: Math.min(91, (q.page - 1) * n + 1), safe: "active",
        imgType: type, imgColorType: q.transparent ? "trans" : undefined, imgDominantColor: color && colors.includes(color) ? color : undefined,
        imgSize: minSide >= 3000 ? "huge" : minSide >= 1500 ? "xlarge" : minSide >= 800 ? "large" : undefined,
        fileType: q.fileType && !q.fileType.includes(",") ? q.fileType.replace("jpeg", "jpg") : undefined,
        rights: rightsLabel ? "cc_publicdomain|cc_attribute|cc_sharealike" : undefined,
      })}`;
      const data = (await getJson("google", url, ctx)) as { items?: Record<string, any>[] };
      for (const r of data.items ?? []) {
        items.push({ url: r.link, title: r.title, width: num(r.image?.width), height: num(r.image?.height), thumb: r.image?.thumbnailLink, page: r.image?.contextLink, site: r.displayLink, mime: r.mime });
      }
    }
    return items.filter((i) => /^https?:\/\//i.test(i.url)).map((i) => {
      let host = i.site ?? "";
      try { host = new URL(i.page ?? i.url).hostname; } catch { /* keep */ }
      const a: ImageAsset = {
        id: `google:${createHash("sha1").update(i.url).digest("hex").slice(0, 16)}`, provider: "google", title: stripHtml(i.title) || "Google image result",
        width: i.width, height: i.height, fileType: mimeToType(i.mime) ?? extOf(i.url), mimeType: i.mime, thumbnailUrl: i.thumb, previewUrl: i.thumb,
        downloadUrl: i.url, pageUrl: i.page, creator: host || undefined,
        license: rightsLabel ? `Unverified: ${rightsLabel}; confirm on the source page` : "Unknown (Google Images web result); check the source page before use",
        licenseUrl: i.page, attributionRequired: true, commercialUse: Boolean(rightsLabel), licenseStatus: "unverified", tags: [],
        attribution: `Image from ${host || "the web"}${i.page ? ` (${i.page})` : ""}, found via Google Images; licence unverified`,
      };
      return a;
    });
  },
};

export const PROVIDERS: Record<ProviderId, Provider> = { openverse, wikimedia, unsplash, pexels, pixabay, google };

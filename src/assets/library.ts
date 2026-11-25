import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import type { AppConfig } from "../config/index.js";
import { PsMcpError } from "../utils/errors.js";
import { readImageMeta } from "../utils/image-meta.js";
import type { PathPolicy } from "../utils/paths.js";
import { DOWNLOAD_EXTENSIONS, downloadWithRetry, type DownloadFormat } from "../utils/download.js";
import type { ImageAsset, ProviderId } from "./providers.js";

/** A file in the local asset library, with its provenance and licence. */
export interface AssetRecord {
  assetId: string;
  file: string;
  name: string;
  provider: ProviderId | "url";
  sourceId?: string;
  title: string;
  sourceUrl: string;
  pageUrl?: string;
  creator?: string;
  creatorUrl?: string;
  license: string;
  licenseUrl?: string;
  attributionRequired: boolean;
  licenseStatus?: "provider" | "unverified";
  attribution: string;
  commercialUse?: boolean;
  format: DownloadFormat;
  /** alpha: the file has an alpha channel (PNG RGBA/LA, WebP with alpha, GIF, SVG); none: opaque format/colour type. */
  transparency: "alpha" | "none" | "unknown";
  width?: number;
  height?: number;
  bytes: number;
  sha256: string;
  tags: string[];
  downloadedAt: string;
}

export interface LibraryDeps {
  config: AppConfig;
  paths: PathPolicy;
  fetchImpl?: typeof fetch;
}

const MANIFEST = "manifest.json";

/** Lowercase, ASCII, dash-separated, no dots/slashes: safe on every OS and never a traversal. */
export function sanitizeName(s: string, max = 60): string {
  const out = s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, max).replace(/-+$/, "");
  return /^(con|prn|aux|nul|com\d|lpt\d)$/.test(out) ? `${out}-file` : out || "image";
}

export class AssetLibrary {
  constructor(private readonly deps: LibraryDeps) {}

  /** Library root, validated to be inside the sandbox. */
  get dir(): string {
    return this.deps.paths.resolveDir(this.deps.config.assets.dir, true);
  }

  list(): AssetRecord[] {
    const f = join(this.dir, MANIFEST);
    if (!existsSync(f)) return [];
    try {
      const all = JSON.parse(readFileSync(f, "utf8")) as AssetRecord[];
      return all.filter((r) => existsSync(r.file));
    } catch {
      return [];
    }
  }

  get(idOrFile: string): AssetRecord | undefined {
    return this.list().find((r) => r.assetId === idOrFile || r.sourceId === idOrFile || r.file === idOrFile || r.name === idOrFile);
  }

  private save(records: AssetRecord[]): void {
    const f = join(this.dir, MANIFEST);
    const tmp = `${f}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(records, null, 2));
    renameSync(tmp, f);
  }

  /**
   * Download a searched asset (provider host allowlist enforced) or a validated public URL into the library.
   * Duplicate content (same SHA-256) is not stored twice.
   */
  async download(src: { asset?: ImageAsset; url?: string }, opts: { name?: string; subfolder?: string; minWidth?: number; minHeight?: number } = {}): Promise<{ record: AssetRecord; duplicate: boolean; attempts: number }> {
    const { config } = this.deps;
    const asset = src.asset;
    const url = asset?.downloadUrl ?? src.url;
    if (!url) throw new PsMcpError("VALIDATION_ERROR", "Pass an image id from a search, or a url");
    const dl = await downloadWithRetry(url, { ...config.download, allowedHosts: asset?.allowedHosts, fetchImpl: this.deps.fetchImpl });

    const sha256 = createHash("sha256").update(dl.bytes).digest("hex");
    const existing = this.list().find((r) => r.sha256 === sha256);
    if (existing) {
      this.checkDims(existing.width, existing.height, opts);
      return { record: existing, duplicate: true, attempts: dl.attempts };
    }

    const sub = opts.subfolder ? sanitizeName(opts.subfolder, 40) : (asset?.provider ?? "web");
    const folder = this.deps.paths.resolveDir(join(this.dir, sub), true);
    const urlPath = (() => { try { return decodeURIComponent(new URL(dl.finalUrl).pathname); } catch { return new URL(dl.finalUrl).pathname; } })();
    const stem = sanitizeName(opts.name ?? asset?.title ?? basename(urlPath, extname(urlPath)));
    const ext = DOWNLOAD_EXTENSIONS[dl.format];
    let file = "";
    for (let i = 0; i < 20; i++) {
      const candidate = join(folder, `${stem}-${randomBytes(3).toString("hex")}${ext}`);
      if (!existsSync(candidate)) { file = candidate; break; }
    }
    file = this.deps.paths.resolveOutput(file, { extensions: [ext], overwrite: false });

    // Write to a temp name, validate dimensions, then move into place.
    const tmp = join(dirname(file), `.${basename(file)}.part`);
    writeFileSync(tmp, dl.bytes, { flag: "wx" });
    let meta;
    try {
      meta = readImageMeta(tmp);
      this.checkDims(meta.width, meta.height, opts);
      renameSync(tmp, file);
    } catch (e) {
      rmSync(tmp, { force: true });
      throw e;
    }

    if (asset?.trackDownloadUrl) {
      // Unsplash API terms: trigger the download endpoint when a photo is downloaded. Best effort.
      const key = config.assets.keys.unsplash;
      (this.deps.fetchImpl ?? fetch)(asset.trackDownloadUrl, { headers: key ? { authorization: `Client-ID ${key}` } : {}, signal: AbortSignal.timeout(5000) }).catch(() => undefined);
    }

    const record: AssetRecord = {
      assetId: `asset_${sha256.slice(0, 12)}`, file, name: stem, provider: asset?.provider ?? "url", sourceId: asset?.id, title: asset?.title ?? stem,
      sourceUrl: dl.finalUrl, pageUrl: asset?.pageUrl, creator: asset?.creator, creatorUrl: asset?.creatorUrl,
      license: asset?.license ?? "Unknown — verify before use", licenseUrl: asset?.licenseUrl, attributionRequired: asset?.attributionRequired ?? true, licenseStatus: asset ? (asset.licenseStatus ?? "provider") : "unverified",
      attribution: asset?.attribution ?? `Image from ${new URL(dl.finalUrl).hostname} (licence unknown)`, commercialUse: asset?.commercialUse,
      format: dl.format, transparency: transparencyOf(dl.format, dl.bytes), width: meta.width ?? asset?.width, height: meta.height ?? asset?.height, bytes: dl.bytes.length, sha256, tags: asset?.tags ?? [],
      downloadedAt: new Date().toISOString(),
    };
    writeFileSync(`${file}.json`, JSON.stringify(record, null, 2));
    this.save([...this.list(), record]);
    return { record, duplicate: false, attempts: dl.attempts };
  }

  private checkDims(w: number | undefined, h: number | undefined, opts: { minWidth?: number; minHeight?: number }): void {
    if (!w || !h) return;
    const { maxPixels, maxDimension } = this.deps.config.assets;
    if (w > maxDimension || h > maxDimension || w * h > maxPixels) {
      throw new PsMcpError("LIMIT_EXCEEDED", `Image is ${w}×${h}; limits are ${maxDimension}px per side and ${maxPixels / 1e6} MP (MAX_IMAGE_DIMENSION / MAX_IMAGE_MEGAPIXELS)`);
    }
    if ((opts.minWidth && w < opts.minWidth) || (opts.minHeight && h < opts.minHeight)) {
      throw new PsMcpError("VALIDATION_ERROR", `Image is ${w}×${h}, smaller than the requested minimum ${opts.minWidth ?? 0}×${opts.minHeight ?? 0}`);
    }
  }

  /** Plain-text credits for every asset that needs (or offers) attribution. */
  credits(records = this.list()): string {
    return records.map((r) => `- ${r.attribution}${r.pageUrl ? ` — ${r.pageUrl}` : ""}${r.licenseUrl ? ` (${r.licenseUrl})` : ""}`).join("\n");
  }
}

/** Whether the file can carry transparency, from its header (no decoding). */
export function transparencyOf(format: DownloadFormat, b: Buffer): AssetRecord["transparency"] {
  switch (format) {
    case "png": {
      const colorType = b[25];
      if (colorType === 4 || colorType === 6) return "alpha";
      return b.includes(Buffer.from("tRNS")) ? "alpha" : "none";
    }
    case "webp":
      return b.toString("ascii", 12, 16) === "VP8X" ? ((b[20]! & 0x10) ? "alpha" : "none") : b.toString("ascii", 12, 16) === "VP8L" ? "alpha" : "none";
    case "jpg": case "bmp": return "none";
    case "gif": case "svg": return "alpha";
    default: return "unknown";
  }
}

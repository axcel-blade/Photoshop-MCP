import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { PsMcpError } from "./errors.js";

/** Image formats accepted from the internet, detected from the file's bytes (never trusted from the URL or headers). */
export const DOWNLOAD_FORMATS = ["png", "jpg", "gif", "webp", "bmp", "tiff", "avif", "heic", "svg"] as const;
export type DownloadFormat = (typeof DOWNLOAD_FORMATS)[number];
export const DOWNLOAD_EXTENSIONS: Record<DownloadFormat, string> = {
  png: ".png", jpg: ".jpg", gif: ".gif", webp: ".webp", bmp: ".bmp", tiff: ".tif", avif: ".avif", heic: ".heic", svg: ".svg",
};

export interface DownloadOptions {
  maxBytes: number;
  timeoutMs: number;
  allowPrivate: boolean;
  maxRedirects?: number;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
  resolveHost?: (host: string) => Promise<string[]>;
}

export interface DownloadResult {
  bytes: Buffer;
  format: DownloadFormat;
  finalUrl: string;
  contentType?: string;
}

const PRIVATE = new BlockList();
for (const [net, bits] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) PRIVATE.addSubnet(net, bits, "ipv4");
for (const [net, bits] of [["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8]] as const) PRIVATE.addSubnet(net, bits, "ipv6");

/** True for loopback, private, link-local, CGNAT, multicast and reserved addresses (incl. IPv4-mapped IPv6). */
export function isPrivateAddress(ip: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return PRIVATE.check(mapped[1]!, "ipv4");
  const v = isIP(ip);
  if (v === 4) return PRIVATE.check(ip, "ipv4");
  if (v === 6) return PRIVATE.check(ip, "ipv6");
  return true;
}

/** Identify an image format from magic bytes. */
export function sniffImageFormat(b: Buffer): DownloadFormat | undefined {
  if (b.length >= 8 && b.readUInt32BE(0) === 0x89504e47) return "png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  const a = (s: number, e: number) => b.toString("ascii", s, e);
  if (a(0, 4) === "GIF8") return "gif";
  if (a(0, 4) === "RIFF" && a(8, 12) === "WEBP") return "webp";
  if (a(0, 2) === "BM") return "bmp";
  if (a(0, 4) === "II*\0" || a(0, 4) === "MM\0*") return "tiff";
  if (a(4, 8) === "ftyp") {
    const brand = a(8, 12);
    if (brand === "avif" || brand === "avis") return "avif";
    if (["heic", "heix", "hevc", "mif1", "msf1"].includes(brand)) return "heic";
  }
  const text = b.subarray(0, 1024).toString("utf8").replace(/^﻿/, "").trimStart();
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(text)) return "svg";
  return undefined;
}

async function defaultResolve(host: string): Promise<string[]> {
  return (await lookup(host, { all: true })).map((r) => r.address);
}

async function checkUrl(raw: string, opts: DownloadOptions): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new PsMcpError("VALIDATION_ERROR", `Invalid URL: ${raw}`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new PsMcpError("VALIDATION_ERROR", `Only http and https URLs can be downloaded, got ${url.protocol}`);
  if (url.username || url.password) throw new PsMcpError("VALIDATION_ERROR", "URLs with embedded credentials are not allowed");
  if (!opts.allowPrivate) {
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const addrs = isIP(host) ? [host] : await (opts.resolveHost ?? defaultResolve)(host).catch(() => {
      throw new PsMcpError("PROVIDER_ERROR", `Could not resolve host ${host}`);
    });
    if (!addrs.length || addrs.some(isPrivateAddress)) {
      throw new PsMcpError("PATH_NOT_ALLOWED", `Refusing to download from a local or private network address (${host}). Set ALLOW_PRIVATE_DOWNLOADS=true to permit it.`);
    }
  }
  return url;
}

/**
 * Download an image over http(s) with SSRF protection (every redirect hop is re-checked),
 * a byte cap enforced while streaming, a timeout, and content sniffing.
 */
export async function downloadImage(rawUrl: string, opts: DownloadOptions): Promise<DownloadResult> {
  const doFetch = opts.fetchImpl ?? fetch;
  const maxRedirects = opts.maxRedirects ?? 5;
  const signal = AbortSignal.timeout(opts.timeoutMs);
  let url = await checkUrl(rawUrl, opts);
  let res: Response;
  for (let hop = 0; ; hop++) {
    try {
      res = await doFetch(url, { redirect: "manual", signal, headers: { accept: "image/*,*/*;q=0.5", "user-agent": "photoshop-ai-mcp" } });
    } catch (e) {
      const timeout = (e as Error).name === "TimeoutError" || (e as Error).name === "AbortError";
      throw new PsMcpError("PROVIDER_ERROR", timeout ? `Download timed out after ${opts.timeoutMs} ms` : `Download failed: ${(e as Error).message}`);
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      if (hop >= maxRedirects) throw new PsMcpError("PROVIDER_ERROR", `Too many redirects (>${maxRedirects})`);
      url = await checkUrl(new URL(res.headers.get("location")!, url).toString(), opts);
      continue;
    }
    break;
  }
  if (!res.ok) throw new PsMcpError("PROVIDER_ERROR", `Download failed: HTTP ${res.status} ${res.statusText}`.trim());
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > opts.maxBytes) {
    throw new PsMcpError("LIMIT_EXCEEDED", `Image is ${declared} bytes; the limit is ${opts.maxBytes} (MAX_DOWNLOAD_MB)`);
  }
  const chunks: Buffer[] = [];
  let total = 0;
  if (res.body) {
    const reader = res.body.getReader();
    for (;;) {
      let r: Awaited<ReturnType<typeof reader.read>>;
      try {
        r = await reader.read();
      } catch (e) {
        throw new PsMcpError("PROVIDER_ERROR", `Download interrupted: ${(e as Error).message}`);
      }
      if (r.done) break;
      total += r.value.byteLength;
      if (total > opts.maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new PsMcpError("LIMIT_EXCEEDED", `Image exceeds the ${opts.maxBytes}-byte limit (MAX_DOWNLOAD_MB)`);
      }
      chunks.push(Buffer.from(r.value));
    }
  }
  const bytes = Buffer.concat(chunks);
  const format = sniffImageFormat(bytes);
  if (!format) {
    throw new PsMcpError("VALIDATION_ERROR", `The URL did not return a supported image (content-type: ${res.headers.get("content-type") ?? "none"}). Supported: ${DOWNLOAD_FORMATS.join(", ")}`);
  }
  return { bytes, format, finalUrl: url.toString(), contentType: res.headers.get("content-type") ?? undefined };
}

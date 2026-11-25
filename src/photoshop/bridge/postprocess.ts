import { readFileSync, rmSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { rgbToHex } from "../../utils/colors.js";
import { McpDesignError } from "../../utils/errors.js";

/**
 * ExtendScript has no in-memory imaging API, so preview/analysis ops render a small file to the temp folder.
 * The bridge converts it here (base64 preview, or pixel statistics) and deletes it.
 */

/** Decode an 8-bit RGB/RGBA/gray PNG (non-interlaced) into RGBA pixels. */
export function decodePng(buf: Buffer): { width: number; height: number; rgba: Uint8Array } {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new McpDesignError("PHOTOSHOP_SCRIPT_ERROR", "Analysis sample is not a PNG");
  let off = 8, width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
  const idat: Buffer[] = [];
  let palette: Buffer | undefined, trns: Buffer | undefined;
  while (off < buf.length) {
    const len = buf.readUInt32BE(off), type = buf.toString("ascii", off + 4, off + 8), data = buf.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") { width = data.readUInt32BE(0); height = data.readUInt32BE(4); bitDepth = data[8]!; colorType = data[9]!; interlace = data[12]!; }
    else if (type === "PLTE") palette = data;
    else if (type === "tRNS") trns = data;
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    off += 12 + len;
  }
  if (bitDepth !== 8 || interlace) throw new McpDesignError("PHOTOSHOP_SCRIPT_ERROR", `Unsupported PNG sample (bit depth ${bitDepth}, interlace ${interlace})`);
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[colorType];
  if (!channels) throw new McpDesignError("PHOTOSHOP_SCRIPT_ERROR", `Unsupported PNG color type ${colorType}`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const px = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)]!;
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? px[y * stride + x - channels]! : 0;
      const b = y > 0 ? px[(y - 1) * stride + x]! : 0;
      const c = x >= channels && y > 0 ? px[(y - 1) * stride + x - channels]! : 0;
      let v = line[x]!;
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[y * stride + x] = v & 255;
    }
  }
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const s = i * channels;
    if (colorType === 3) {
      const idx = px[s]!;
      rgba.set([palette![idx * 3]!, palette![idx * 3 + 1]!, palette![idx * 3 + 2]!, trns && idx < trns.length ? trns[idx]! : 255], i * 4);
    } else if (channels <= 2) rgba.set([px[s]!, px[s]!, px[s]!, channels === 2 ? px[s + 1]! : 255], i * 4);
    else rgba.set([px[s]!, px[s + 1]!, px[s + 2]!, channels === 4 ? px[s + 3]! : 255], i * 4);
  }
  return { width, height, rgba };
}

export interface PixelStats {
  width: number;
  height: number;
  /** Pixels counted (alpha > 0). */
  pixels: number;
  mean: { r: number; g: number; b: number };
  luminance: { mean: number; stdev: number; p1: number; p99: number };
  saturationMean: number;
  clipping: { shadows: number; highlights: number };
  palette: string[];
  paletteShares: { hex: string; share: number }[];
}

/** Statistics over non-transparent pixels (a layer rendered alone leaves the rest transparent). */
export function pixelStats(width: number, height: number, rgba: Uint8Array): PixelStats {
  let n = 0, r = 0, g = 0, b = 0, sat = 0, lo = 0, hi = 0;
  const hist = new Uint32Array(256);
  const bins = new Map<number, number>();
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    if (rgba[o + 3]! === 0) continue;
    const R = rgba[o]!, G = rgba[o + 1]!, B = rgba[o + 2]!;
    n++; r += R; g += G; b += B;
    const L = Math.round(0.2126 * R + 0.7152 * G + 0.0722 * B);
    hist[L]!++;
    if (L <= 2) lo++;
    if (L >= 253) hi++;
    const mx = Math.max(R, G, B), mn = Math.min(R, G, B);
    sat += mx === 0 ? 0 : (mx - mn) / mx;
    const key = ((R >> 4) << 8) | ((G >> 4) << 4) | (B >> 4);
    bins.set(key, (bins.get(key) ?? 0) + 1);
  }
  if (n === 0) throw new McpDesignError("VALIDATION_ERROR", "Nothing to analyze: the rendered sample is fully transparent.");
  let mean = 0, sq = 0;
  for (let v = 0; v < 256; v++) { mean += v * hist[v]!; sq += v * v * hist[v]!; }
  mean /= n;
  let acc = 0, p1 = 0, p99 = 255;
  for (let v = 0; v < 256; v++) { acc += hist[v]!; if (acc >= n * 0.01) { p1 = v; break; } }
  acc = 0;
  for (let v = 255; v >= 0; v--) { acc += hist[v]!; if (acc >= n * 0.01) { p99 = v; break; } }
  const paletteShares = [...bins.entries()].sort((x, y) => y[1] - x[1]).slice(0, 16)
    .map(([k, c]) => ({ hex: rgbToHex({ r: ((k >> 8) & 15) * 17, g: ((k >> 4) & 15) * 17, b: (k & 15) * 17 }), share: Math.round((c / n) * 10000) / 10000 }));
  const r4 = (v: number) => Math.round(v * 10000) / 10000;
  return {
    width, height, pixels: n, mean: { r: r4(r / n), g: r4(g / n), b: r4(b / n) },
    luminance: { mean: r4(mean / 255), stdev: r4(Math.sqrt(Math.max(0, sq / n - mean * mean)) / 255), p1: r4(p1 / 255), p99: r4(p99 / 255) },
    saturationMean: r4(sat / n), clipping: { shadows: r4(lo / n), highlights: r4(hi / n) }, palette: paletteShares.map((p) => p.hex), paletteShares,
  };
}

/** Replace previewFile / analyzeFile results with their content. Always deletes the temp file. */
export function postprocess(op: string, data: unknown): unknown {
  if (!data || typeof data !== "object") return data;
  const d = data as Record<string, unknown>;
  const file = (d.previewFile ?? d.analyzeFile) as string | undefined;
  if (!file) return data;
  try {
    const bytes = readFileSync(file);
    if (d.previewFile) {
      const { previewFile: _p, ...rest } = d;
      return { ...rest, base64: bytes.toString("base64"), bytes: bytes.length };
    }
    const png = decodePng(bytes);
    const stats = pixelStats(png.width, png.height, png.rgba);
    if (op === "doc.colors") return { colors: stats.paletteShares.slice(0, Number(d.colorsCount ?? 8)) };
    return stats;
  } finally {
    rmSync(file, { force: true });
  }
}

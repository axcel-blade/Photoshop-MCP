import { openSync, readSync, closeSync, statSync } from "node:fs";
import { extname } from "node:path";

export interface ImageMeta {
  path: string;
  format: string;
  bytes: number;
  modified: string;
  width?: number;
  height?: number;
  bitDepth?: number;
  channels?: number;
  colorMode?: string;
}

function head(path: string, n = 65536): Buffer {
  const fd = openSync(path, "r");
  try {
    const buf = Buffer.alloc(n);
    const read = readSync(fd, buf, 0, n, 0);
    return buf.subarray(0, read);
  } finally {
    closeSync(fd);
  }
}

const PSD_MODES: Record<number, string> = { 0: "bitmap", 1: "grayscale", 2: "indexed", 3: "rgb", 4: "cmyk", 7: "multichannel", 8: "duotone", 9: "lab" };

/** Read dimensions from file headers without decoding (PNG, JPEG, GIF, BMP, WebP, PSD/PSB, TIFF). */
export function readImageMeta(path: string): ImageMeta {
  const st = statSync(path);
  const b = head(path);
  const meta: ImageMeta = { path, format: extname(path).slice(1).toLowerCase() || "unknown", bytes: st.size, modified: st.mtime.toISOString() };
  if (b.length >= 24 && b.readUInt32BE(0) === 0x89504e47) {
    Object.assign(meta, { format: "png", width: b.readUInt32BE(16), height: b.readUInt32BE(20), bitDepth: b[24], channels: { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[b[25]!] });
  } else if (b[0] === 0xff && b[1] === 0xd8) {
    meta.format = "jpeg";
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const marker = b[i + 1]!;
      const len = b.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        Object.assign(meta, { bitDepth: b[i + 4], height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7), channels: b[i + 9] });
        break;
      }
      i += 2 + len;
    }
  } else if (b.toString("ascii", 0, 3) === "GIF") {
    Object.assign(meta, { format: "gif", width: b.readUInt16LE(6), height: b.readUInt16LE(8) });
  } else if (b.toString("ascii", 0, 2) === "BM") {
    Object.assign(meta, { format: "bmp", width: b.readInt32LE(18), height: Math.abs(b.readInt32LE(22)), bitDepth: b.readUInt16LE(28) });
  } else if (b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") {
    meta.format = "webp";
    const kind = b.toString("ascii", 12, 16);
    if (kind === "VP8X") Object.assign(meta, { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) });
    else if (kind === "VP8 ") Object.assign(meta, { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff });
    else if (kind === "VP8L") {
      const bits = b.readUInt32LE(21);
      Object.assign(meta, { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 });
    }
  } else if (b.toString("ascii", 0, 4) === "8BPS") {
    Object.assign(meta, { format: b.readUInt16BE(4) === 2 ? "psb" : "psd", channels: b.readUInt16BE(12), height: b.readUInt32BE(14), width: b.readUInt32BE(18), bitDepth: b.readUInt16BE(22), colorMode: PSD_MODES[b.readUInt16BE(24)] });
  } else if (b.toString("ascii", 0, 2) === "II" || b.toString("ascii", 0, 2) === "MM") {
    const le = b[0] === 0x49;
    const u16 = (o: number) => (le ? b.readUInt16LE(o) : b.readUInt16BE(o));
    const u32 = (o: number) => (le ? b.readUInt32LE(o) : b.readUInt32BE(o));
    if (u16(2) === 42) {
      meta.format = "tiff";
      const ifd = u32(4);
      if (ifd + 2 < b.length) {
        const n = u16(ifd);
        for (let k = 0; k < n && ifd + 2 + k * 12 + 12 <= b.length; k++) {
          const e = ifd + 2 + k * 12;
          const tag = u16(e), type = u16(e + 2);
          const val = type === 3 ? u16(e + 8) : u32(e + 8);
          if (tag === 256) meta.width = val;
          if (tag === 257) meta.height = val;
          if (tag === 258) meta.bitDepth = val;
        }
      }
    }
  }
  return meta;
}

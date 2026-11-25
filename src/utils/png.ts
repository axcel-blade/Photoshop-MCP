import { deflateSync } from "node:zlib";

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** Encode 8-bit grayscale (channels=1) or RGBA (channels=4) pixels as PNG. */
export function encodePng(width: number, height: number, pixels: Uint8Array, channels: 1 | 3 | 4): Buffer {
  const colorType = channels === 1 ? 0 : channels === 3 ? 2 : 6;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = colorType;
  const stride = width * channels;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(pixels.buffer, pixels.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** White-on-black mask PNG for a rectangle or ellipse region (used by generative fill providers). */
export function regionMaskPng(width: number, height: number, region: { left: number; top: number; right: number; bottom: number; shape?: "rect" | "ellipse" }): Buffer {
  const px = new Uint8Array(width * height);
  const cx = (region.left + region.right) / 2, cy = (region.top + region.bottom) / 2;
  const rx = (region.right - region.left) / 2, ry = (region.bottom - region.top) / 2;
  for (let y = Math.max(0, Math.floor(region.top)); y < Math.min(height, Math.ceil(region.bottom)); y++) {
    for (let x = Math.max(0, Math.floor(region.left)); x < Math.min(width, Math.ceil(region.right)); x++) {
      if (region.shape === "ellipse" && ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 > 1) continue;
      px[y * width + x] = 255;
    }
  }
  return encodePng(width, height, px, 1);
}

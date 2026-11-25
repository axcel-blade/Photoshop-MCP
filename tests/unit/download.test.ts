import { existsSync, readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { downloadImage, isPrivateAddress, sniffImageFormat } from "../../src/utils/download.js";
import { encodePng } from "../../src/utils/png.js";
import { setup } from "../helpers.js";

const png = Buffer.from(encodePng(4, 3, new Uint8Array(4 * 3 * 4).fill(200), 4));
const publicDns = async () => ["93.184.216.34"];

function fakeFetch(routes: Record<string, () => Response>): typeof fetch {
  return (async (input: URL | string) => {
    const r = routes[input.toString()];
    if (!r) return new Response("not found", { status: 404 });
    return r();
  }) as typeof fetch;
}

const opts = (f: typeof fetch, extra: object = {}) => ({ maxBytes: 1024 * 1024, timeoutMs: 5000, allowPrivate: false, fetchImpl: f, resolveHost: publicDns, ...extra });

describe("download helpers", () => {
  it("sniffs formats from bytes", () => {
    expect(sniffImageFormat(png)).toBe("png");
    expect(sniffImageFormat(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBe("jpg");
    expect(sniffImageFormat(Buffer.from("GIF89a......"))).toBe("gif");
    expect(sniffImageFormat(Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBe("svg");
    expect(sniffImageFormat(Buffer.from("<html><body>hi</body></html>"))).toBeUndefined();
  });

  it("classifies private addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "192.168.0.10", "169.254.169.254", "::1", "fd00::1", "::ffff:127.0.0.1", "0.0.0.0"]) expect(isPrivateAddress(ip), ip).toBe(true);
    for (const ip of ["93.184.216.34", "8.8.8.8", "2606:4700::1111"]) expect(isPrivateAddress(ip), ip).toBe(false);
  });

  it("downloads, follows redirects and re-checks each hop", async () => {
    const f = fakeFetch({
      "https://cdn.example.com/a.png": () => new Response(png, { headers: { "content-type": "image/png" } }),
      "https://example.com/r": () => new Response(null, { status: 302, headers: { location: "https://cdn.example.com/a.png" } }),
      "https://example.com/evil": () => new Response(null, { status: 302, headers: { location: "http://127.0.0.1/admin" } }),
    });
    const r = await downloadImage("https://example.com/r", opts(f));
    expect(r.format).toBe("png");
    expect(r.finalUrl).toBe("https://cdn.example.com/a.png");
    await expect(downloadImage("https://example.com/evil", opts(f))).rejects.toMatchObject({ code: "PATH_NOT_ALLOWED" });
  });

  it("rejects bad schemes, private hosts, oversize bodies and non-images", async () => {
    const f = fakeFetch({
      "https://example.com/big.png": () => new Response(Buffer.alloc(2048, 1)),
      "https://example.com/page": () => new Response("<html></html>", { headers: { "content-type": "text/html" } }),
    });
    await expect(downloadImage("file:///etc/passwd", opts(f))).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(downloadImage("http://localhost/x.png", opts(f, { resolveHost: async () => ["127.0.0.1"] }))).rejects.toMatchObject({ code: "PATH_NOT_ALLOWED" });
    await expect(downloadImage("http://169.254.169.254/latest", opts(f))).rejects.toMatchObject({ code: "PATH_NOT_ALLOWED" });
    await expect(downloadImage("https://example.com/big.png", opts(f, { maxBytes: 1000 }))).rejects.toMatchObject({ code: "LIMIT_EXCEEDED" });
    await expect(downloadImage("https://example.com/page", opts(f))).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

describe("url downloads via place_image / import_image (mock Photoshop)", () => {
  let t: Awaited<ReturnType<typeof setup>>;
  const realFetch = globalThis.fetch;
  const u = "https://img.example.com/photos/Sunset%20Beach.png";
  beforeAll(async () => {
    t = await setup({ ALLOW_PRIVATE_DOWNLOADS: "true" });
    globalThis.fetch = fakeFetch({ [u]: () => new Response(png, { headers: { "content-type": "image/png" } }) });
  });
  afterAll(async () => {
    globalThis.fetch = realFetch;
    await t.close();
  });

  it("place_image and import_image accept a url and store it in the asset library", async () => {
    await t.call("create_document", { width: 400, height: 300 });
    const p = await t.call("place_image", { url: u, x: 10, y: 10, width: 100, height: 100 });
    expect(p.ok).toBe(true);
    expect(p.warnings.join(" ")).toMatch(/Downloaded/);
    const d = await t.call("download_image", { url: u });
    expect(d.data.duplicate).toBe(true);
    expect(d.data.asset.file).toMatch(/assets[\\/]web[\\/]sunset-beach-[0-9a-f]{6}\.png$/);
    expect(readFileSync(d.data.asset.file).equals(png)).toBe(true);
    expect(existsSync(`${d.data.asset.file}.json`)).toBe(true);
    expect((await t.call("import_image", { url: u })).ok).toBe(true);
    expect((await t.call("place_image", {})).error.code).toBe("VALIDATION_ERROR");
    expect((await t.call("download_image", { url: "https://img.example.com/missing.png" })).error.code).toBe("PROVIDER_ERROR");
  });
});

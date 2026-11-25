import { existsSync, readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetRateLimits } from "../../src/assets/providers.js";
import { sanitizeName } from "../../src/assets/library.js";
import { assertSafeSvg } from "../../src/utils/download.js";
import { encodePng } from "../../src/utils/png.js";
import { setup } from "../helpers.js";

const png = (w = 64, h = 48) => Buffer.from(encodePng(w, h, new Uint8Array(w * h * 4).fill(120), 4));
const json = (o: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(o), { headers: { "content-type": "application/json" }, ...init });

const calls: string[] = [];
let flaky = 0;

function router(input: URL | string, init?: RequestInit): Response {
  const u = input.toString();
  calls.push(u);
  const h = new URL(u);
  if (h.hostname === "api.openverse.org") {
    return json({ results: [
      { id: "ov1", title: "Red Apple", url: "https://live.staticflickr.com/1/apple.png", foreign_landing_url: "https://flickr.com/p/1", creator: "Ann", license: "by", license_version: "4.0", license_url: "https://creativecommons.org/licenses/by/4.0/", width: 1200, height: 800, filetype: "png", thumbnail: "https://api.openverse.org/t/ov1", tags: [{ name: "fruit" }] },
      { id: "ov2", title: "NC Pear", url: "https://live.staticflickr.com/1/pear.jpg", license: "by-nc", license_version: "2.0", width: 300, height: 900, filetype: "jpg" },
    ] });
  }
  if (h.hostname === "commons.wikimedia.org") {
    return json({ query: { pages: [
      { pageid: 42, title: "File:Apple icon.svg", imageinfo: [{ url: "https://upload.wikimedia.org/a/apple.svg", width: 512, height: 512, mime: "image/svg+xml", descriptionurl: "https://commons.wikimedia.org/wiki/File:Apple_icon.svg", extmetadata: { LicenseShortName: { value: "CC0" }, Artist: { value: "<a>Bob</a>" } } }] },
      { pageid: 44, title: "File:Scan.pdf", imageinfo: [{ url: "https://upload.wikimedia.org/a/scan.pdf", width: 800, height: 1200, mime: "application/pdf", extmetadata: { LicenseShortName: { value: "Public domain" } } }] },
      { pageid: 43, title: "File:Logo.png", imageinfo: [{ url: "https://upload.wikimedia.org/a/logo.png", width: 10, height: 10, mime: "image/png", extmetadata: { LicenseShortName: { value: "Fair use" } } }] },
    ] } });
  }
  if (h.hostname === "api.pexels.com") {
    expect((init?.headers as Record<string, string>).authorization).toBe("pexels-key");
    return json({ photos: [{ id: 7, alt: "Mountain lake", width: 4000, height: 2500, url: "https://www.pexels.com/photo/7", photographer: "Cara", photographer_url: "https://www.pexels.com/@cara", src: { original: "https://images.pexels.com/photos/7/lake.png", medium: "https://images.pexels.com/m.png", tiny: "https://images.pexels.com/t.png" } }] });
  }
  if (h.hostname === "api.unsplash.com") {
    return json({ results: [
      { id: "u1", alt_description: "forest", width: 3000, height: 3000, urls: { full: "https://images.unsplash.com/u1.png", small: "s", thumb: "t" }, links: { html: "https://unsplash.com/photos/u1", download_location: "https://api.unsplash.com/photos/u1/download" }, user: { name: "Dee", links: { html: "https://unsplash.com/@dee" } } },
      { id: "u2", premium: true, alt_description: "paid", width: 3000, height: 2000, urls: { full: "https://images.unsplash.com/u2.png" }, links: {}, user: { name: "X" } },
    ] });
  }
  if (h.hostname === "pixabay.com" && h.pathname === "/api/") return json({ hits: [{ id: 9, tags: "wood, texture", imageWidth: 2000, imageHeight: 2000, largeImageURL: "https://evil.example.net/wood.png", pageURL: "https://pixabay.com/9", user: "Eve", user_id: 1 }] });
  if (u === "https://images.pexels.com/photos/7/lake.png") {
    if (flaky-- > 0) return new Response("busy", { status: 503 });
    return new Response(png(), { headers: { "content-type": "image/png" } });
  }
  if (u === "https://upload.wikimedia.org/a/apple.svg") return new Response('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>');
  if (u === "https://live.staticflickr.com/1/apple.png") return new Response(png(32, 32));
  if (u === "https://images.unsplash.com/u1.png") return new Response(png(16, 16));
  if (u === "https://api.unsplash.com/photos/u1/download") return json({});
  if (u === "https://files.example.com/setup.exe") return new Response(Buffer.from("MZ\x90\x00 executable"), { headers: { "content-type": "image/png" } });
  if (u === "https://files.example.com/huge.png") return new Response(png(64, 48));
  return new Response("nope", { status: 404 });
}

let t: Awaited<ReturnType<typeof setup>>;
const realFetch = globalThis.fetch;
beforeAll(async () => {
  t = await setup({ ALLOW_PRIVATE_DOWNLOADS: "true", PEXELS_API_KEY: "pexels-key", UNSPLASH_ACCESS_KEY: "unsplash-key", PIXABAY_API_KEY: "pixabay-key" });
  globalThis.fetch = (async (i: URL | string, init?: RequestInit) => router(i, init)) as typeof fetch;
});
afterAll(async () => {
  globalThis.fetch = realFetch;
  await t.close();
});
const call = (name: string, args: Record<string, unknown> = {}) => {
  resetRateLimits();
  return t.call(name, args);
};

describe("image search", () => {
  it("searches all providers, normalizes, excludes premium and non-free content", async () => {
    const r = await call("search_images", { query: "apple" });
    expect(r.ok).toBe(true);
    const ids = r.data.results.map((x: { id: string }) => x.id);
    expect(ids).toEqual(expect.arrayContaining(["openverse:ov1", "wikimedia:42", "pexels:7", "unsplash:u1", "pixabay:9"]));
    expect(ids).not.toContain("unsplash:u2");
    expect(ids).not.toContain("wikimedia:43");
    expect(ids).not.toContain("wikimedia:44");
    const ov = r.data.results.find((x: { id: string }) => x.id === "openverse:ov1");
    expect(ov).toMatchObject({ creator: "Ann", license: "CC BY 4.0", attributionRequired: true, commercialUse: true });
  });

  it("applies orientation, size, licence and file-type filters", async () => {
    const r = await call("search_images", { query: "fruit", providers: ["openverse"], orientation: "landscape", license: "commercial", minWidth: 1000 });
    expect(r.data.results.map((x: { id: string }) => x.id)).toEqual(["openverse:ov1"]);
    const ov = calls.filter((c) => c.includes("api.openverse.org")).at(-1)!;
    expect(ov).toContain("aspect_ratio=wide");
    expect(ov).toContain("license_type=commercial");
    const svg = await call("search_icons", { query: "apple", fileType: "svg" });
    expect(svg.data.results.every((x: { fileType: string }) => x.fileType === "svg")).toBe(true);
    expect(calls.at(-1)).toBeDefined();
  });

  it("specialized searches, details and filter_images", async () => {
    expect((await call("search_stock_photos", { query: "lake" })).data.providersSearched).toEqual(["unsplash", "pexels", "pixabay", "openverse"]);
    expect((await call("search_textures", { query: "wood" })).ok).toBe(true);
    expect(calls.some((c) => c.includes("pixabay.com/api/") && c.includes("category=backgrounds"))).toBe(true);
    expect((await call("search_transparent_images", { query: "apple" })).data.results.every((x: { fileType: string }) => ["png", "svg"].includes(x.fileType))).toBe(true);
    const d = await call("get_image_details", { id: "pexels:7" });
    expect(d.data).toMatchObject({ providerName: "Pexels", license: "Pexels License", downloaded: false });
    expect(d.data.allowedHosts).toBeUndefined();
    const f = await call("filter_images", { minWidth: 3000, sortBy: "resolution" });
    expect(f.data.results[0].id).toBe("pexels:7");
    expect((await call("get_image_details", { id: "nope:1" })).error.code).toBe("OBJECT_NOT_FOUND");
  });

  it("skips unconfigured providers and reports why", async () => {
    const t2 = await setup({});
    const r = await t2.call("search_images", { query: "x", providers: ["pexels", "openverse"] });
    expect(r.data.skipped[0]).toMatchObject({ provider: "pexels" });
    expect((await t2.call("search_images", { query: "x", providers: ["pexels"] })).error.code).toBe("PROVIDER_NOT_CONFIGURED");
    await t2.close();
  });
});

describe("downloads and asset library", () => {
  it("downloads by id with retries, metadata sidecar and manifest; dedupes", async () => {
    flaky = 1;
    const r = await call("download_image", { id: "pexels:7" });
    expect(r.ok).toBe(true);
    expect(r.data.attempts).toBe(2);
    expect(r.data.asset).toMatchObject({ provider: "pexels", creator: "Cara", license: "Pexels License", width: 64, height: 48, format: "png", transparency: "alpha" });
    expect(r.data.asset.file).toMatch(/assets[\\/]pexels[\\/]mountain-lake-[0-9a-f]{6}\.png$/);
    const side = JSON.parse(readFileSync(`${r.data.asset.file}.json`, "utf8"));
    expect(side.sourceUrl).toBe("https://images.pexels.com/photos/7/lake.png");
    expect((await call("download_image", { id: "pexels:7" })).data.duplicate).toBe(true);
    const list = await call("get_downloaded_assets", { includeCredits: true });
    expect(list.data.count).toBe(1);
    expect(list.data.credits).toContain("Photo by Cara on Pexels");
  });

  it("enforces provider host allowlist, rejects executables, unsafe SVG and oversize images", async () => {
    expect((await call("download_image", { id: "pixabay:9" })).error.code).toBe("PATH_NOT_ALLOWED");
    expect((await call("download_image", { url: "https://files.example.com/setup.exe" })).error.code).toBe("VALIDATION_ERROR");
    expect((await call("download_image", { url: "https://files.example.com/huge.png", minWidth: 1000 })).error.code).toBe("VALIDATION_ERROR");
    expect(() => assertSafeSvg(Buffer.from('<svg onload="alert(1)"></svg>'))).toThrow();
    expect(() => assertSafeSvg(Buffer.from("<svg><script>x</script></svg>"))).toThrow();
    expect(sanitizeName("../../Windows/System32")).toBe("windows-system32");
    expect(sanitizeName("CON")).toBe("con-file");
    const t2 = await setup({ ALLOW_PRIVATE_DOWNLOADS: "true", MAX_IMAGE_DIMENSION: "32" });
    expect((await t2.call("download_image", { url: "https://files.example.com/huge.png" })).error.code).toBe("LIMIT_EXCEEDED");
    await t2.close();
  });

  it("download_multiple_images continues past failures and triggers Unsplash download tracking", async () => {
    const r = await call("download_multiple_images", { items: [{ id: "wikimedia:42" }, { id: "unsplash:u1" }, { url: "https://files.example.com/missing.png" }, { id: "openverse:ov1", name: "My Apple" }] });
    expect(r.data).toMatchObject({ downloaded: 3, failed: 1 });
    expect(r.data.assets[0].asset).toMatchObject({ format: "svg", transparency: "alpha" });
    expect(r.data.assets[2].asset.file).toMatch(/my-apple-[0-9a-f]{6}\.png$/);
    expect(calls).toContain("https://api.unsplash.com/photos/u1/download");
  });
});

describe("Photoshop import (mock)", () => {
  it("import_image_to_photoshop places a named, transformed layer and fits to canvas", async () => {
    await call("create_document", { width: 1000, height: 800 });
    const a = await call("import_image_to_photoshop", { id: "pexels:7", fitToCanvas: true, rotation: 15, opacity: 80 });
    expect(a.ok).toBe(true);
    expect(a.data.layer.name).toMatch(/^mountain-lake/);
    expect(a.data.layer.bounds).toMatchObject({ left: 0, top: 0 });
    const lib = (await call("get_downloaded_assets")).data.assets;
    const b = await call("import_image_to_photoshop", { assetId: lib[0].assetId, layerName: "Hero", x: 10, y: 20, width: 300, height: 200 });
    expect(b.data.layer).toMatchObject({ name: "Hero", bounds: { left: 10, top: 20 } });
    expect((await call("import_image_to_photoshop", { id: "pexels:7", url: "https://x.example/a.png" })).error.code).toBe("VALIDATION_ERROR");
    const o = await call("import_image_to_photoshop", { id: "openverse:ov1", mode: "open" });
    expect(o.data.document).toBeDefined();
    expect(o.warnings.join(" ")).toMatch(/Attribution required/);
  });

  it("import_multiple_images creates a document, lays out a grid, groups and reports errors", async () => {
    const r = await call("import_multiple_images", {
      newDocument: { name: "Moodboard", width: 1200, height: 800 }, layout: "grid", columns: 2, gap: 20, group: "Assets",
      images: [{ id: "pexels:7" }, { id: "wikimedia:42", layerName: "Apple Icon" }, { id: "unsplash:u1" }, { url: "https://files.example.com/missing.png" }],
    });
    expect(r.ok).toBe(true);
    expect(r.data.imported).toBe(3);
    expect(r.data.errors).toHaveLength(1);
    expect(r.data.layers[1]).toMatchObject({ name: "Apple Icon", bounds: { left: 610, top: 20 } });
    expect(r.data.group).toBeDefined();
    const files = (await call("get_downloaded_assets")).data.assets.map((x: { file: string }) => x.file);
    expect(files.every((f: string) => existsSync(f))).toBe(true);
  });
});

describe("Google Images provider", () => {
  const seen: string[] = [];
  const gfetch = (async (input: URL | string) => {
    const u = new URL(input.toString());
    seen.push(u.toString());
    if (u.hostname === "serpapi.com") {
      return json({ images_results: [
        { position: 1, title: "Latte art cup", original: "https://cafe.example.org/img/latte.png", original_width: 2400, original_height: 1600, thumbnail: "https://encrypted-tbn0.gstatic.com/t1", link: "https://cafe.example.org/blog/latte", source: "Cafe Blog" },
        { position: 2, title: "Buy mug", original: "https://shop.example.com/mug.jpg", original_width: 800, original_height: 800, is_product: true },
      ] });
    }
    if (u.hostname === "www.googleapis.com") {
      return json({ items: [{ title: "Bean <b>icon</b>", link: "https://icons.example.net/bean.png", mime: "image/png", displayLink: "icons.example.net", image: { contextLink: "https://icons.example.net/p/bean", width: 512, height: 512, thumbnailLink: "https://tbn.example/t" } }] });
    }
    if (u.toString() === "https://cafe.example.org/img/latte.png") return new Response(png(40, 30));
    return new Response("nope", { status: 404 });
  }) as typeof fetch;

  it("SerpApi backend: maps filters, skips products, marks licences unverified, warns on download", async () => {
    const g = await setup({ SERPAPI_API_KEY: "serp-key", ALLOW_PRIVATE_DOWNLOADS: "true" });
    const prev = globalThis.fetch;
    globalThis.fetch = gfetch;
    try {
      resetRateLimits();
      const r = await g.call("search_images", { query: "latte", providers: ["google"], orientation: "landscape", minWidth: 2000, license: "commercial", color: "brown" });
      expect(r.ok).toBe(true);
      const q = new URL(seen.at(-1)!);
      expect(Object.fromEntries(q.searchParams)).toMatchObject({ engine: "google_images", q: "latte", imgar: "w", imgsz: "2mp", licenses: "fc", image_color: "brown", safe: "active" });
      expect(r.data.results).toHaveLength(1);
      expect(r.data.results[0]).toMatchObject({ provider: "google", licenseStatus: "unverified", attributionRequired: true, commercialUse: true, pageUrl: "https://cafe.example.org/blog/latte", fileType: "png" });
      expect(r.warnings.join(" ")).toMatch(/UNVERIFIED/);
      expect(JSON.stringify(r)).not.toContain("serp-key");
      const d = await g.call("download_image", { id: r.data.results[0].id });
      expect(d.data.asset).toMatchObject({ provider: "google", licenseStatus: "unverified" });
      expect(d.warnings.join(" ")).toMatch(/UNVERIFIED/);
      resetRateLimits();
      expect((await g.call("search_images", { query: "latte", providers: ["google"], license: "no-attribution" })).data.count).toBe(0);
    } finally {
      globalThis.fetch = prev;
      await g.close();
    }
  });

  it("Custom Search JSON API backend and not-configured message", async () => {
    const g = await setup({ GOOGLE_CSE_API_KEY: "cse-key", GOOGLE_CSE_ID: "cx-1" });
    const prev = globalThis.fetch;
    globalThis.fetch = gfetch;
    try {
      resetRateLimits();
      const r = await g.call("search_icons", { query: "coffee bean", transparent: true });
      const q = new URL(seen.at(-1)!);
      expect(Object.fromEntries(q.searchParams)).toMatchObject({ searchType: "image", cx: "cx-1", imgType: "clipart", num: "10", start: "1" });
      expect(r.data.results.find((x: { provider: string }) => x.provider === "google")).toMatchObject({ title: "Bean icon", width: 512, licenseStatus: "unverified" });
    } finally {
      globalThis.fetch = prev;
      await g.close();
    }
    const none = await setup({});
    const s = await none.call("search_images", { query: "x", providers: ["google", "openverse"] }).catch(() => undefined);
    expect(JSON.stringify(s)).toMatch(/SERPAPI_API_KEY/);
    await none.close();
  });
});

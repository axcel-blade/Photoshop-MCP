import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { contrastRatio, hexToRgb, readableOn, rgbToHex } from "../../src/shared.js";
import { FireflyProvider, ProviderRegistry, RemoveBgProvider } from "../../src/ai/providers.js";
import { readImageMeta } from "../../src/utils/image-meta.js";
import { encodePng, regionMaskPng } from "../../src/utils/png.js";
import { alignMoves, distributeMoves } from "../../src/utils/align.js";
import { sandbox } from "../helpers.js";

describe("colors", () => {
  it("converts and measures contrast", () => {
    expect(hexToRgb("#0f0")).toEqual({ r: 0, g: 255, b: 0 });
    expect(rgbToHex({ r: 255, g: 128, b: 0 })).toBe("#FF8000");
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 0);
    expect(readableOn("#FFFF00")).toBe("#111111");
  });
});

describe("image headers", () => {
  it("reads PNG, JPEG, GIF, BMP and PSD dimensions", () => {
    const d = sandbox();
    const png = join(d, "a.png");
    writeFileSync(png, encodePng(33, 17, new Uint8Array(33 * 17), 1));
    expect(readImageMeta(png)).toMatchObject({ format: "png", width: 33, height: 17 });
    const jpg = join(d, "a.jpg");
    writeFileSync(jpg, Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x40, 0x00, 0x80, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
    expect(readImageMeta(jpg)).toMatchObject({ format: "jpeg", width: 128, height: 64, channels: 3 });
    const psd = Buffer.alloc(26);
    psd.write("8BPS", 0, "ascii");
    psd.writeUInt16BE(1, 4);
    psd.writeUInt16BE(3, 12);
    psd.writeUInt32BE(200, 14);
    psd.writeUInt32BE(300, 18);
    psd.writeUInt16BE(8, 22);
    psd.writeUInt16BE(3, 24);
    writeFileSync(join(d, "a.psd"), psd);
    expect(readImageMeta(join(d, "a.psd"))).toMatchObject({ format: "psd", width: 300, height: 200, colorMode: "rgb" });
  });

  it("region masks are valid PNGs", () => {
    const m = regionMaskPng(20, 10, { left: 2, top: 2, right: 8, bottom: 8, shape: "ellipse" });
    expect(m.readUInt32BE(16)).toBe(20);
    expect(m.readUInt32BE(20)).toBe(10);
  });
});

describe("AI providers", () => {
  it("are inert until configured", () => {
    const reg = ProviderRegistry.fromEnv({});
    expect(reg.find("generate_image")).toBeUndefined();
    expect(() => reg.require("generative_fill")).toThrow(/FIREFLY|No configured provider/);
    expect(reg.status().every((s) => !s.configured)).toBe(true);
  });

  it("Firefly: authenticates then generates (mocked HTTP)", async () => {
    const calls: string[] = [];
    const http = (async (url: string | URL, init?: RequestInit) => {
      calls.push(String(url));
      if (String(url).includes("ims")) return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }));
      if (String(url).endsWith("/v3/images/generate")) {
        expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer tok");
        return new Response(JSON.stringify({ outputs: [{ seed: 1, image: { url: "https://cdn.example/x.jpg" } }] }));
      }
      return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/jpeg" } });
    }) as typeof fetch;
    const p = new FireflyProvider({ clientId: "id", clientSecret: "secret" }, http);
    const out = await p.generate({ prompt: "test", width: 1024, height: 1024 });
    expect(out[0]!.bytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(calls[0]).toContain("ims-na1.adobelogin.com");
  });

  it("remove.bg surfaces HTTP errors without leaking the key", async () => {
    const http = (async () => new Response("quota", { status: 402 })) as unknown as typeof fetch;
    const p = new RemoveBgProvider("k-123", http);
    await expect(p.removeBackground(new Uint8Array([1]), "image/png")).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
    await expect(p.removeBackground(new Uint8Array([1]), "image/png")).rejects.not.toThrow(/k-123/);
  });
});

describe("align / distribute geometry", () => {
  const box = (l: number, t: number, w: number, h: number) => ({ left: l, top: t, right: l + w, bottom: t + h });
  const items = [{ id: 1, bounds: box(10, 0, 100, 50) }, { id: 2, bounds: box(300, 40, 50, 20) }, { id: 3, bounds: box(120, 90, 60, 10) }];
  it("aligns edges and centers to a target", () => {
    const canvas = box(0, 0, 1000, 500);
    expect(alignMoves(items, "left", canvas, 20).map((m) => m.dx)).toEqual([10, -280, -100]);
    expect(alignMoves(items, "centerHorizontal", canvas).map((m) => m.dx)).toEqual([440, 175, 350]);
    expect(alignMoves(items, "bottom", canvas).map((m) => m.dy)).toEqual([450, 440, 400]);
    expect(alignMoves(items, "top", canvas).every((m) => m.dx === 0)).toBe(true);
  });
  it("distributes with equal gaps, equal centers or a fixed gap, keeping outer items in place", () => {
    const gaps = distributeMoves(items, "horizontal");
    const after = items.map((it) => { const m = gaps.find((g) => g.id === it.id)!; return { l: it.bounds.left + m.dx, r: it.bounds.right + m.dx }; });
    expect(after[0]!.l).toBe(10);
    expect(after[1]!.r).toBe(350);
    expect(after[2]!.l - after[0]!.r).toBe(after[1]!.l - after[2]!.r);
    const centers = distributeMoves(items, "horizontal", { by: "centers" });
    expect(centers.find((m) => m.id === 3)!.dx).toBe(Math.round((60 + 325) / 2 - 150));
    const fixed = distributeMoves(items, "vertical", { spacing: 10 });
    expect(fixed.map((m) => [m.id, m.dy])).toEqual([[1, 0], [2, 20], [3, 0]]);
  });
});

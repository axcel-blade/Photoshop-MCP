import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PhotoshopBridge, parseEnvelope } from "../../src/photoshop/bridge/bridge.js";
import { MockAdapter } from "../../src/photoshop/bridge/mock-adapter.js";
import { decodePng, pixelStats } from "../../src/photoshop/bridge/postprocess.js";
import { ALLOWED_OPS, buildScript, toJsxLiteral } from "../../src/photoshop/bridge/script-builder.js";
import type { BridgeAdapter, ExecuteRequest } from "../../src/photoshop/bridge/types.js";
import { encodePng } from "../../src/utils/png.js";

describe("PhotoshopBridge", () => {
  it("refuses ops that are not allowlisted (no arbitrary JSX)", async () => {
    const mock = new MockAdapter();
    const bridge = new PhotoshopBridge(mock, 1000);
    await expect(bridge.run("eval", { code: "app.quit()" })).rejects.toMatchObject({ code: "UNSUPPORTED_OPERATION" });
    expect(mock.calls).toHaveLength(0);
  });

  it("serialises ops in order and records history", async () => {
    const mock = new MockAdapter();
    const bridge = new PhotoshopBridge(mock, 1000);
    await Promise.all([bridge.run("doc.create", { name: "A" }), bridge.run("doc.create", { name: "B" }), bridge.run("doc.list")]);
    expect(mock.calls.map((c) => c.command)).toEqual(["doc.create", "doc.create", "doc.list"]);
    expect(bridge.recent(3).map((r) => r.ok)).toEqual([true, true, true]);
  });

  it("turns JSX error envelopes into typed errors", async () => {
    const mock = new MockAdapter();
    const bridge = new PhotoshopBridge(mock, 1000);
    await expect(bridge.run("doc.info")).rejects.toMatchObject({ code: "NO_ACTIVE_DOCUMENT" });
    mock.failNext = { command: "doc.list", code: "SOMETHING_ODD", message: "boom" };
    await expect(bridge.run("doc.list")).rejects.toMatchObject({ code: "PHOTOSHOP_SCRIPT_ERROR", message: "boom" });
  });

  it("times out a hung adapter without blocking the queue", async () => {
    const hung: BridgeAdapter = { name: "mock", detect: async () => ({ platform: "win32", installs: [], comRegistered: false, automationAvailable: false, running: false, notes: [] }), execute: () => new Promise(() => undefined) };
    const bridge = new PhotoshopBridge(hung, 50);
    await expect(bridge.run("doc.list")).rejects.toMatchObject({ code: "BRIDGE_TIMEOUT" });
  }, 10000);

  it("withTimeoutScope raises the minimum timeout for job calls", async () => {
    let seen = 0;
    const spy: BridgeAdapter = { name: "mock", detect: async () => ({ platform: "win32", installs: [], comRegistered: false, automationAvailable: true, running: true, notes: [] }), execute: async (r: ExecuteRequest) => { seen = r.timeoutMs; return JSON.stringify({ ok: true, data: {} }); } };
    const bridge = new PhotoshopBridge(spy, 1000);
    await bridge.withTimeoutScope(900000, () => bridge.run("doc.list"));
    expect(seen).toBe(900000);
  });

  it("can cancel queued work before it reaches Photoshop", async () => {
    const mock = new MockAdapter();
    mock.delayMs = 50;
    const bridge = new PhotoshopBridge(mock, 1000);
    const ac = new AbortController();
    const first = bridge.run("doc.create", {});
    const second = bridge.run("doc.list", {}, { signal: ac.signal });
    ac.abort();
    await first;
    await expect(second).rejects.toMatchObject({ code: "CANCELLED" });
  });
});

describe("envelope and script building", () => {
  it("rejects malformed output", () => {
    expect(() => parseEnvelope("not json")).toThrow(/malformed/);
    expect(() => parseEnvelope("{}")).toThrow(/envelope/);
    expect(parseEnvelope('{"ok":true,"data":1}').ok).toBe(true);
  });

  it("embeds the command as an ES3-safe literal after the JSX library", () => {
    const script = buildScript("doc.create", { name: "Café\u2028" }, "C:\\tmp\\r.json");
    expect(script).toContain("MCP.main(");
    expect(script).toContain("Caf\\u00e9\\u2028");
    expect(toJsxLiteral("é")).toBe('"\\u00e9"');
    for (const op of ALLOWED_OPS) expect(script.includes(`MCP.ops["${op}"]`), op).toBe(true);
  });

  it("every allowlisted op is implemented in photoshop-scripts", () => {
    const lib = ["bootstrap", "document", "layers", "drawing", "editing", "inspect", "design"].map((m) => readFileSync(`photoshop-scripts/${m}.jsx`, "utf8")).join("\n");
    const implemented = new Set([...lib.matchAll(/MCP\.ops\["([^"]+)"\]\s*=/g)].map((m) => m[1]));
    expect([...ALLOWED_OPS].filter((o) => !implemented.has(o))).toEqual([]);
    expect([...implemented].filter((o) => !ALLOWED_OPS.has(o!))).toEqual([]);
  });
});

describe("pixel post-processing", () => {
  it("decodes PNG samples and measures statistics over opaque pixels", () => {
    const px = new Uint8Array(4 * 4 * 4);
    for (let i = 0; i < 16; i++) px.set(i < 8 ? [255, 0, 0, 255] : [0, 0, 0, 0], i * 4);
    const png = decodePng(encodePng(4, 4, px, 4));
    expect(png.width).toBe(4);
    const s = pixelStats(png.width, png.height, png.rgba);
    expect(s.pixels).toBe(8);
    expect(s.mean).toEqual({ r: 255, g: 0, b: 0 });
    expect(s.palette[0]).toBe("#FF0000");
    expect(s.saturationMean).toBe(1);
  });
});

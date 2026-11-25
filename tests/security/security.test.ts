import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config/index.js";
import { PathPolicy } from "../../src/utils/paths.js";
import { authorize } from "../../src/transport/http.js";
import { redact } from "../../src/utils/logger.js";
import { sandbox, setup } from "../helpers.js";

describe("path policy", () => {
  const root = sandbox();
  const policy = new PathPolicy([root]);

  it("allows paths inside the root", () => {
    expect(policy.resolve("a/b.png")).toBe(join(root, "a", "b.png"));
  });
  it("blocks traversal, other drives, UNC and URLs", () => {
    for (const p of ["../escape.png", "a/../../escape.png", "C:\\Windows\\system32\\x.png", "\\\\server\\share\\x.png", "//server/share/x.png", "file:///C:/x.png", "a\0b"]) {
      expect(() => policy.resolve(p), p).toThrow();
    }
  });
  it("enforces extensions and existence", () => {
    expect(() => policy.resolve("x.exe", { extensions: [".png"] })).toThrow(/extension/);
    expect(() => policy.resolve("missing.png", { mustExist: true })).toThrow(/not found/);
  });
  it("never overwrites silently", () => {
    writeFileSync(join(root, "exists.png"), "x");
    expect(() => policy.resolveOutput("exists.png", { overwrite: false })).toThrow(/already exists/);
    expect(policy.resolveOutput("exists.png", { overwrite: true })).toBe(join(root, "exists.png"));
  });
  it("blocks symlink escapes", () => {
    const outside = sandbox();
    mkdirSync(join(outside, "secret"), { recursive: true });
    try {
      symlinkSync(join(outside, "secret"), join(root, "link"), "junction");
    } catch {
      return; // symlinks unavailable (permissions) — skip
    }
    expect(() => policy.resolve("link/file.png")).not.toThrow(); // path itself does not exist yet
    writeFileSync(join(outside, "secret", "file.png"), "x");
    expect(() => policy.resolve("link/file.png")).toThrow(/escapes/);
  });
});

describe("configuration security", () => {
  it("refuses an unknown adapter", () => {
    expect(() => loadConfig({ PHOTOSHOP_ADAPTER: "uxp", ALLOWED_PATHS: sandbox() }, [])).toThrow(/PHOTOSHOP_ADAPTER/);
  });
  it("requires an auth token for non-loopback HTTP", () => {
    expect(() => loadConfig({ PHOTOSHOP_ADAPTER: "mock", MCP_TRANSPORT: "http", MCP_HTTP_HOST: "0.0.0.0", ALLOWED_PATHS: sandbox() }, [])).toThrow(/MCP_AUTH_TOKEN/);
  });
  it("HTTP bearer auth", () => {
    const http = { host: "0.0.0.0", port: 1, authToken: "s3cret-token" };
    expect(authorize({ authorization: "Bearer s3cret-token" }, http)).toBe(true);
    expect(authorize({ authorization: "Bearer wrong" }, http)).toBe(false);
    expect(authorize({}, http)).toBe(false);
    expect(authorize({}, { host: "127.0.0.1", port: 1 })).toBe(true);
    expect(authorize({}, { host: "0.0.0.0", port: 1 })).toBe(false);
    const sp = { host: "0.0.0.0", port: 1, secretPath: "a".repeat(30) };
    expect(authorize({}, sp, "/mcp/" + "a".repeat(30))).toBe(true);
    expect(authorize({}, sp, "/mcp/" + "b".repeat(30))).toBe(false);
    expect(authorize({}, sp, "/mcp")).toBe(false);
  });
  it("redacts secrets from logs", () => {
    expect(redact({ token: "abc", apiKey: "k", Authorization: "b", fine: 1 })).toEqual({ token: "[redacted]", apiKey: "[redacted]", Authorization: "[redacted]", fine: 1 });
  });
});

describe("tool-level protections", () => {
  let t: Awaited<ReturnType<typeof setup>>;
  beforeAll(async () => { t = await setup(); });
  afterAll(async () => t.close());

  it("rejects paths outside allowed roots in every file tool", async () => {
    for (const [tool, args] of [
      ["open_document", { path: "../../etc/passwd.png" }],
      ["place_image", { path: "C:\\Windows\\win.ini" }],
      ["export_png", { path: "..\\..\\evil.png" }],
      ["get_image_metadata", { path: "\\\\host\\share\\a.png" }],
    ] as const) {
      const r = await t.call(tool, args);
      expect(r.isError, tool).toBe(true);
      expect(["PATH_NOT_ALLOWED", "VALIDATION_ERROR"]).toContain(r.error.code);
    }
  });

  it("destructive tools require confirmation", async () => {
    await t.call("create_document", { width: 10, height: 10 });
    for (const tool of ["flatten_document", "merge_visible_layers", "rasterize_layer", "apply_mask", "change_color_mode", "run_action"]) {
      const r = await t.call(tool, tool === "change_color_mode" ? { mode: "cmyk" } : tool === "run_action" ? { set: "Default Actions", action: "x" } : {});
      expect(r.error?.code, tool).toBe("CONFIRMATION_REQUIRED");
    }
  });

  it("validates inputs with Zod before reaching Photoshop", async () => {
    const before = t.mock.calls.length;
    const r = await t.call("create_document", { width: -5, height: "big" });
    expect(r.isError).toBe(true);
    expect(t.mock.calls.length).toBe(before);
  });
});

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { loadConfig } from "../src/config/index.js";
import { MockAdapter } from "../src/photoshop/bridge/mock-adapter.js";
import { createContext, createServer } from "../src/server.js";
import { encodePng } from "../src/utils/png.js";
import { configureLogger } from "../src/utils/logger.js";

configureLogger({ level: "error" });

export function sandbox(): string {
  return mkdtempSync(join(tmpdir(), "psmcp-test-"));
}

export function samplePng(dir: string, name = "sample.png", w = 8, h = 6): string {
  const p = join(dir, name);
  writeFileSync(p, encodePng(w, h, new Uint8Array(w * h * 4).fill(180), 4));
  return p;
}

export async function setup(env: Record<string, string> = {}) {
  const dir = sandbox();
  const config = loadConfig({ PHOTOSHOP_ADAPTER: "mock", ALLOWED_PATHS: dir, LOG_LEVEL: "error", ...env }, ["node", "x"]);
  const mock = new MockAdapter();
  const ctx = createContext(config, mock, {});
  const server = createServer(ctx);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const client = new Client({ name: "test", version: "1" });
  await client.connect(b);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await client.callTool({ name, arguments: args });
    const content = r.content as { type: string; text?: string; data?: string }[];
    let json;
    try {
      json = JSON.parse(content[0]!.text!);
    } catch {
      // SDK-level schema rejection (before the handler runs)
      json = { ok: false, error: { code: "VALIDATION_ERROR", message: content[0]!.text } };
    }
    return { ...json, isError: Boolean(r.isError), images: content.filter((c) => c.type === "image") };
  };
  return { dir, config, mock, ctx, server, client, call, close: async () => { await client.close(); await server.close(); } };
}

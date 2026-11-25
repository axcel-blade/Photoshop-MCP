import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

export const ROOT = resolve(import.meta.dirname, "../..");
export const OUT = resolve(ROOT, "test-output");
mkdirSync(OUT, { recursive: true });

/** Spawn the built server (dist/index.js) over stdio. PHOTOSHOP_ADAPTER defaults to mock; set E2E_ADAPTER=auto (or com/applescript) for real Photoshop. */
export async function connect(env = {}) {
  const t = new StdioClientTransport({
    command: process.execPath, args: [resolve(ROOT, "dist/index.js")], cwd: ROOT, stderr: "pipe",
    env: { ...process.env, PHOTOSHOP_ADAPTER: process.env.E2E_ADAPTER ?? "mock", ALLOWED_PATHS: OUT, LOG_LEVEL: "warn", ...env },
  });
  const c = new Client({ name: "e2e", version: "1" });
  await c.connect(t);
  const call = async (name, args = {}) => {
    const r = await c.callTool({ name, arguments: args }, undefined, { timeout: 300000 });
    const text = r.content?.[0]?.text ?? "";
    let body;
    try { body = JSON.parse(text); } catch { body = { ok: false, raw: text }; }
    return { isError: !!r.isError, body, images: (r.content ?? []).filter((x) => x.type === "image").length };
  };
  return { client: c, transport: t, call };
}

let failures = 0;
export function check(label, cond, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${!cond && detail ? `  — ${detail}` : ""}`);
  if (!cond) failures++;
}
export function finish() {
  console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
  process.exit(failures ? 1 : 0);
}

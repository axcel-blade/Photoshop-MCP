// Starts the built server with the HTTP transport (mock adapter) and exercises auth + MCP over HTTP.
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { check, finish, OUT, ROOT } from "./lib.mjs";

const port = 39500 + Math.floor(Math.random() * 400);
const token = "e2e-http-token-0123456789";
const secret = "e2esecretpath0123456789abcdef";
const proc = spawn(process.execPath, [resolve(ROOT, "dist/index.js"), "--transport", "http", "--mock"], {
  cwd: ROOT, stdio: ["ignore", "ignore", "pipe"],
  env: { ...process.env, MCP_HTTP_PORT: String(port), MCP_AUTH_TOKEN: token, MCP_SECRET_PATH: secret, ALLOWED_PATHS: OUT, LOG_LEVEL: "warn" },
});
const base = `http://127.0.0.1:${port}`;
for (let i = 0; i < 50; i++) {
  try { if ((await fetch(`${base}/healthz`)).ok) break; } catch { /* starting */ }
  await new Promise((r) => setTimeout(r, 100));
}
try {
  check("healthz", (await fetch(`${base}/healthz`)).ok);
  check("401 without token", (await fetch(`${base}/mcp`, { method: "POST", body: "{}" })).status === 401);
  check("401 with wrong secret path", (await fetch(`${base}/mcp/wrong`, { method: "POST", body: "{}" })).status === 401);
  for (const [label, url, headers] of [["bearer", `${base}/mcp`, { Authorization: `Bearer ${token}` }], ["secret path", `${base}/mcp/${secret}`, {}]]) {
    const c = new Client({ name: "e2e-http", version: "1" });
    await c.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers } }));
    const { tools } = await c.listTools();
    check(`${label}: lists tools`, tools.length >= 250);
    const r = await c.callTool({ name: "photoshop_status", arguments: {} });
    check(`${label}: calls a tool`, JSON.parse(r.content[0].text).ok === true);
    await c.close();
  }
} finally {
  proc.kill();
}
finish();

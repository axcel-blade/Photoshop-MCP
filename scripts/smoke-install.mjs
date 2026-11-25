#!/usr/bin/env node
/**
 * Smoke-test an installed copy (no Photoshop needed): start dist/index.js over stdio with the
 * mock adapter, list tools and run one tool call.
 *   node <install>/scripts/smoke-install.mjs
 * Exits non-zero on failure. Used by the installer CI workflow.
 */
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const ROOT = resolve(import.meta.dirname, "..");
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [resolve(ROOT, "dist/index.js")],
  cwd: ROOT,
  env: { ...process.env, PHOTOSHOP_ADAPTER: "mock", LOG_LEVEL: "error" },
  stderr: "pipe",
});
const client = new Client({ name: "smoke", version: "1" });
await client.connect(transport);
const info = client.getServerVersion();
const { tools } = await client.listTools();
const r = await client.callTool({ name: "create_document", arguments: { name: "Smoke", width: 1200, height: 800 } });
const body = JSON.parse(r.content[0].text);
await client.close();

const problems = [];
if (tools.length < 100) problems.push(`only ${tools.length} tools`);
if (!body.ok || body.source !== "mock") problems.push(`create_document failed: ${JSON.stringify(body).slice(0, 300)}`);
console.log(`${info.name} ${info.version}: ${tools.length} tools, create_document ${body.ok ? "ok" : "FAILED"}`);
if (problems.length) { console.error(problems.join("\n")); process.exit(1); }

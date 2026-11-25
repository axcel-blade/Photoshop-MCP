import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { loadConfig } from "../../src/config/index.js";
import { MockAdapter } from "../../src/photoshop/bridge/mock-adapter.js";
import { createContext } from "../../src/server.js";
import { startHttp } from "../../src/transport/http.js";
import { sandbox } from "../helpers.js";

describe("Streamable HTTP transport", () => {
  it("serves MCP with bearer auth and rejects unauthenticated requests", async () => {
    const port = 39000 + Math.floor(Math.random() * 1000);
    const config = loadConfig({ PHOTOSHOP_ADAPTER: "mock", MCP_TRANSPORT: "http", MCP_HTTP_PORT: String(port), MCP_AUTH_TOKEN: "test-token-123", ALLOWED_PATHS: sandbox() }, []);
    const http = await startHttp(config, createContext(config, new MockAdapter(), {}));
    try {
      const url = new URL(`http://127.0.0.1:${port}/mcp`);
      expect((await fetch(url, { method: "POST", body: "{}" })).status).toBe(401);
      expect((await fetch(`http://127.0.0.1:${port}/healthz`)).status).toBe(200);
      const client = new Client({ name: "http-test", version: "1" });
      await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: { Authorization: "Bearer test-token-123" } } }));
      const { tools } = await client.listTools();
      expect(tools.length).toBeGreaterThan(200);
      const r = await client.callTool({ name: "photoshop_status", arguments: {} });
      expect(JSON.parse((r.content as { text: string }[])[0]!.text).ok).toBe(true);
      await client.close();
    } finally {
      await new Promise((r) => http.close(() => r(undefined)));
    }
  });
});

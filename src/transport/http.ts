import { randomUUID, timingSafeEqual } from "node:crypto";
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { isLoopback, type AppConfig } from "../config/index.js";
import { createServer } from "../server.js";
import type { ToolContext } from "../mcp/tools/registry.js";
import { logger } from "../utils/logger.js";

const MAX_BODY = 4 * 1024 * 1024;

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Auth: Authorization: Bearer <MCP_AUTH_TOKEN>, or the unguessable path /mcp/<MCP_SECRET_PATH> for clients whose
 * connector UI cannot send headers (e.g. ChatGPT "No authentication" connectors behind an HTTPS tunnel).
 * Loopback deployments with neither configured accept local processes only.
 */
export function authorize(headers: IncomingMessage["headers"], http: AppConfig["http"], path = "/mcp"): boolean {
  if (http.secretPath && safeEqual(path, `/mcp/${http.secretPath}`)) return true;
  if (path !== "/mcp") return false;
  if (!http.authToken) return !http.secretPath && isLoopback(http.host);
  const token = /^Bearer\s+(.+)$/i.exec(headers.authorization ?? "")?.[1]?.trim();
  return Boolean(token && safeEqual(token, http.authToken));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_BODY) throw Object.assign(new Error("Request body too large"), { status: 413 });
    chunks.push(c as Buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : undefined;
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
}

/**
 * Streamable HTTP transport (for clients that cannot spawn a local stdio process, e.g. ChatGPT through an HTTPS tunnel).
 * One MCP session per client; all sessions share one Photoshop bridge.
 */
export function startHttp(config: AppConfig, ctx: ToolContext): Promise<Server> {
  const sessions = new Map<string, StreamableHTTPServerTransport>();
  const server = createHttpServer(async (req, res) => {
    try {
      const path = (req.url ?? "/").split("?")[0];
      if (path === "/healthz") return send(res, 200, { ok: true, name: "photoshop-mcp", adapter: ctx.bridge.adapterName });
      if (!path?.startsWith("/mcp")) return send(res, 404, { error: "Not found" });
      if (!authorize(req.headers, config.http, path)) return send(res, 401, { error: "Unauthorized" });
      const sid = req.headers["mcp-session-id"] as string | undefined;
      if (req.method === "POST") {
        const body = await readJson(req);
        let transport = sid ? sessions.get(sid) : undefined;
        if (!transport) {
          if (sid || !isInitializeRequest(body)) return send(res, 400, { jsonrpc: "2.0", error: { code: -32000, message: "No valid session; send initialize first" }, id: null });
          transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (id) => void sessions.set(id, transport!),
            enableDnsRebindingProtection: isLoopback(config.http.host),
            allowedHosts: isLoopback(config.http.host) ? [`127.0.0.1:${config.http.port}`, `localhost:${config.http.port}`] : undefined,
          });
          transport.onclose = () => transport!.sessionId && sessions.delete(transport!.sessionId);
          await createServer(ctx).connect(transport);
        }
        return transport.handleRequest(req, res, body);
      }
      if (req.method === "GET" || req.method === "DELETE") {
        const t = sid ? sessions.get(sid) : undefined;
        if (!t) return send(res, 400, { error: "Unknown session" });
        return t.handleRequest(req, res);
      }
      send(res, 405, { error: "Method not allowed" });
    } catch (err) {
      const status = (err as { status?: number }).status ?? 500;
      logger.warn("http error", { error: (err as Error).message });
      if (!res.headersSent) send(res, status, { error: status === 500 ? "Internal error" : (err as Error).message });
    }
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.http.port, config.http.host, () => {
      logger.info("http transport listening", { url: `http://${config.http.host}:${config.http.port}/mcp`, auth: Boolean(config.http.authToken) });
      resolve(server);
    });
  });
}

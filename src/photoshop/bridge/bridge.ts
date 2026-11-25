import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpDesignError, type ErrorCode } from "../../utils/errors.js";
import { logger } from "../../utils/logger.js";
import { postprocess } from "./postprocess.js";
import { OperationQueue } from "./queue.js";
import { ALLOWED_OPS, buildScript } from "./script-builder.js";
import type { BridgeAdapter, BridgeResult, DetectionResult, ScriptEnvelope } from "./types.js";

const KNOWN_CODES = new Set<string>([
  "VALIDATION_ERROR", "PHOTOSHOP_NOT_INSTALLED", "PHOTOSHOP_NOT_RUNNING", "PHOTOSHOP_SCRIPT_ERROR", "PHOTOSHOP_ERROR", "BRIDGE_TIMEOUT",
  "BRIDGE_UNAVAILABLE", "NO_ACTIVE_DOCUMENT", "LAYER_NOT_FOUND", "DOCUMENT_NOT_FOUND", "OBJECT_NOT_FOUND", "FILE_NOT_FOUND",
  "CONFIRMATION_REQUIRED", "UNSUPPORTED_OPERATION",
]);

/** Minimum timeout applied to every bridge call made inside withTimeoutScope (used by background jobs). */
const timeoutScope = new AsyncLocalStorage<number>();

export interface RunOptions {
  timeoutMs?: number;
  /** Abort before the op starts (queued work); an op already inside Photoshop runs to completion. */
  signal?: AbortSignal;
}

export interface OperationRecord {
  op: string;
  ok: boolean;
  durationMs: number;
  at: string;
  error?: string;
}

/**
 * The single gateway to Photoshop. Validates the op against the allowlist, serialises calls,
 * enforces timeouts, parses the JSX envelope and turns failures into typed errors.
 * Success is only reported when the JSX layer itself returned ok: true.
 */
export class PhotoshopBridge {
  private readonly queue = new OperationQueue();
  private readonly workDir: string;
  private readonly history: OperationRecord[] = [];
  private running?: { op: string; since: string };
  /** Name of the active document after the last op. */
  lastDocument: string | undefined;

  constructor(
    readonly adapter: BridgeAdapter,
    private readonly defaultTimeoutMs: number,
  ) {
    this.workDir = join(tmpdir(), "photoshop-ai-mcp");
    mkdirSync(this.workDir, { recursive: true });
  }

  get adapterName(): BridgeAdapter["name"] {
    return this.adapter.name;
  }

  get pending(): number {
    return this.queue.size;
  }

  /** Run `fn` so that every bridge call it makes waits at least `minTimeoutMs` for Photoshop. */
  withTimeoutScope<T>(minTimeoutMs: number, fn: () => Promise<T>): Promise<T> {
    return timeoutScope.run(minTimeoutMs, fn);
  }

  /** @deprecated alias of withTimeoutScope */
  withTimeout<T>(ms: number, fn: () => Promise<T>): Promise<T> {
    return this.withTimeoutScope(ms, fn);
  }

  detect(): Promise<DetectionResult> {
    return this.adapter.detect();
  }

  status(): { adapter: string; queue: number; running?: { op: string; since: string }; lastDocument?: string } {
    return { adapter: this.adapter.name, queue: this.queue.size, running: this.running, lastDocument: this.lastDocument };
  }

  recent(limit = 25): OperationRecord[] {
    return this.history.slice(-limit).reverse();
  }

  async run<T = unknown>(op: string, args: object = {}, opts: RunOptions = {}): Promise<BridgeResult<T>> {
    if (!ALLOWED_OPS.has(op)) throw new McpDesignError("UNSUPPORTED_OPERATION", `Operation is not allowlisted: ${op}`);
    return this.queue.run(async () => {
      if (opts.signal?.aborted) throw new McpDesignError("CANCELLED", "Cancelled before it started");
      const id = randomUUID();
      const resultPath = join(this.workDir, `${id}.json`);
      const started = Date.now();
      const timeoutMs = Math.max(opts.timeoutMs ?? this.defaultTimeoutMs, timeoutScope.getStore() ?? 0);
      this.running = { op, since: new Date().toISOString() };
      let ok = false, errMsg: string | undefined;
      try {
        const raw = await withTimeout(this.adapter.execute({ op, args, script: buildScript(op, args, resultPath), resultPath, timeoutMs }), timeoutMs + 2000);
        const envelope = parseEnvelope(raw);
        this.lastDocument = envelope.document;
        const durationMs = Date.now() - started;
        logger.info("bridge op", { op, ok: envelope.ok, durationMs, adapter: this.adapter.name });
        if (!envelope.ok) {
          const e = envelope.error ?? { code: "PHOTOSHOP_SCRIPT_ERROR", message: "Unknown script failure" };
          const code = (KNOWN_CODES.has(e.code) ? e.code : "PHOTOSHOP_SCRIPT_ERROR") as ErrorCode;
          errMsg = e.message;
          throw new McpDesignError(code, e.message, { op, line: e.line, details: e.details, warnings: envelope.warnings });
        }
        ok = true;
        return { data: postprocess(op, envelope.data) as T, warnings: envelope.warnings ?? [], adapter: this.adapter.name, durationMs };
      } catch (err) {
        if (!(err instanceof McpDesignError)) logger.error("bridge failure", { op, error: String(err) });
        errMsg ??= (err as Error).message;
        throw err;
      } finally {
        this.running = undefined;
        this.history.push({ op, ok, durationMs: Date.now() - started, at: new Date().toISOString(), error: ok ? undefined : errMsg });
        if (this.history.length > 200) this.history.shift();
        for (const ext of [".json", ".jsx"]) rmSync(resultPath.replace(/\.json$/, ext), { force: true });
      }
    });
  }
}

/** Bridge-level watchdog so a misbehaving adapter can never block the queue forever. */
export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const t = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new McpDesignError("BRIDGE_TIMEOUT", `Photoshop operation exceeded ${ms} ms. Inspect the document before retrying.`)), ms);
  });
  return Promise.race([p, t]).finally(() => clearTimeout(timer));
}

export function parseEnvelope(raw: string): ScriptEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new McpDesignError("PHOTOSHOP_SCRIPT_ERROR", "Photoshop returned malformed output.", { raw: raw.slice(0, 500) });
  }
  if (typeof parsed !== "object" || parsed === null || typeof (parsed as ScriptEnvelope).ok !== "boolean") {
    throw new McpDesignError("PHOTOSHOP_SCRIPT_ERROR", "Photoshop output is missing the result envelope.", { raw: raw.slice(0, 500) });
  }
  return parsed as ScriptEnvelope;
}

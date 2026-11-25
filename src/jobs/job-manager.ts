import { randomUUID } from "node:crypto";
import { McpDesignError, toMcpError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";

export type JobState = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface JobRecord<R = unknown> {
  id: string;
  tool: string;
  state: JobState;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  /** Wall-clock time spent running (so far, while running). */
  elapsedMs?: number;
  result?: R;
  error?: { code: string; message: string; details?: unknown };
}

interface Entry<R> {
  record: JobRecord<R>;
  done: Promise<void>;
  cancelRequested: boolean;
}

/**
 * Runs long tool calls in the background so the MCP request returns immediately with a job id.
 * Jobs are executed one at a time in submission order (Photoshop is single-threaded anyway, and the
 * bridge queue would serialise them regardless). Finished jobs are kept in memory, newest `keep` only.
 */
export class JobManager<R = unknown> {
  private readonly jobs = new Map<string, Entry<R>>();
  private tail: Promise<void> = Promise.resolve();

  constructor(private readonly keep = 50, private readonly now: () => number = Date.now) {}

  start(tool: string, task: () => Promise<R>): JobRecord<R> {
    const record: JobRecord<R> = { id: randomUUID().slice(0, 8), tool, state: "queued", createdAt: new Date(this.now()).toISOString() };
    const entry: Entry<R> = { record, cancelRequested: false, done: Promise.resolve() };
    entry.done = this.tail.then(() => this.execute(entry, task));
    this.tail = entry.done;
    this.jobs.set(record.id, entry);
    this.prune();
    return this.snapshot(record);
  }

  private async execute(entry: Entry<R>, task: () => Promise<R>): Promise<void> {
    const r = entry.record;
    if (entry.cancelRequested) {
      r.state = "cancelled";
      r.finishedAt = new Date(this.now()).toISOString();
      return;
    }
    const started = this.now();
    r.state = "running";
    r.startedAt = new Date(started).toISOString();
    try {
      r.result = await task();
      r.state = "succeeded";
    } catch (err) {
      const e = toMcpError(err);
      r.error = { code: e.code, message: e.message, details: e.details };
      r.state = "failed";
    } finally {
      r.finishedAt = new Date(this.now()).toISOString();
      r.elapsedMs = this.now() - started;
      logger.info("job finished", { id: r.id, tool: r.tool, state: r.state, ms: r.elapsedMs });
    }
  }

  get(id: string): JobRecord<R> {
    const e = this.jobs.get(id);
    if (!e) throw new McpDesignError("OBJECT_NOT_FOUND", `No job with id ${id} (finished jobs are kept for the last ${this.keep} only).`);
    return this.snapshot(e.record);
  }

  list(): JobRecord<R>[] {
    return [...this.jobs.values()].map((e) => this.snapshot(e.record, false)).reverse();
  }

  /** Wait until the job finishes or `timeoutMs` passes; returns the latest snapshot either way. */
  async wait(id: string, timeoutMs: number): Promise<JobRecord<R>> {
    const e = this.jobs.get(id);
    if (!e) return this.get(id);
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([e.done, new Promise<void>((res) => { timer = setTimeout(res, timeoutMs); })]);
    clearTimeout(timer);
    return this.snapshot(e.record);
  }

  /**
   * Only queued jobs can be cancelled. A running job is already executing inside Photoshop,
   * which offers no way to interrupt a script, so it is reported rather than pretended away.
   */
  cancel(id: string): { cancelled: boolean; state: JobState; reason?: string } {
    const e = this.jobs.get(id);
    if (!e) throw new McpDesignError("OBJECT_NOT_FOUND", `No job with id ${id}.`);
    if (e.record.state === "queued") {
      e.cancelRequested = true;
      e.record.state = "cancelled";
      return { cancelled: true, state: "cancelled" };
    }
    return {
      cancelled: false,
      state: e.record.state,
      reason: e.record.state === "running" ? "The job is already running inside Photoshop, which cannot interrupt a script. Wait for it to finish, then undo if needed." : "The job has already finished.",
    };
  }

  get active(): number {
    return [...this.jobs.values()].filter((e) => e.record.state === "queued" || e.record.state === "running").length;
  }

  private snapshot(r: JobRecord<R>, withResult = true): JobRecord<R> {
    const s: JobRecord<R> = { ...r };
    if (r.state === "running" && r.startedAt) s.elapsedMs = this.now() - Date.parse(r.startedAt);
    if (!withResult) delete s.result;
    return s;
  }

  private prune(): void {
    const finished = [...this.jobs.values()].filter((e) => !["queued", "running"].includes(e.record.state));
    for (const e of finished.slice(0, Math.max(0, this.jobs.size - this.keep))) this.jobs.delete(e.record.id);
  }
}

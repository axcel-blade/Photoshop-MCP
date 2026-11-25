import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PsMcpError } from "../shared.js";
import { Workflow, type Workflow as WorkflowT } from "../schemas/index.js";
import type { ExecutionStatus } from "../workflow-engine/index.js";

const MAX_KEPT = 200;
const MAX_CONCURRENT = 4;

/**
 * Tracks workflow / batch executions (in memory) and stores user-defined workflows as JSON files.
 * Cancellation is cooperative: the runner checks the flag between steps and the bridge drops queued commands.
 */
export class ExecutionStore {
  private runs = new Map<string, ExecutionStatus & { cancel?: boolean; abort: AbortController; result?: unknown }>();

  constructor(private readonly workflowDir: string) {}

  get active(): number {
    return [...this.runs.values()].filter((r) => r.state === "queued" || r.state === "running").length;
  }

  create(workflow: string): ExecutionStatus & { abort: AbortController } {
    if (this.active >= MAX_CONCURRENT) throw new PsMcpError("LIMIT_EXCEEDED", `At most ${MAX_CONCURRENT} executions may run at once.`);
    const rec = { id: randomUUID(), workflow, state: "queued" as const, createdAt: new Date().toISOString(), steps: [], abort: new AbortController() };
    this.runs.set(rec.id, rec);
    if (this.runs.size > MAX_KEPT) {
      const oldest = [...this.runs.values()].find((r) => r.state !== "running" && r.state !== "queued");
      if (oldest) this.runs.delete(oldest.id);
    }
    return rec;
  }

  get(id: string): (ExecutionStatus & { cancel?: boolean; result?: unknown }) | undefined {
    return this.runs.get(id);
  }

  setResult(id: string, result: unknown): void {
    const r = this.runs.get(id);
    if (r) r.result = result;
  }

  list(): ExecutionStatus[] {
    return [...this.runs.values()].map(({ abort: _a, ...r }) => r).reverse();
  }

  isCancelled(id: string): boolean {
    return this.runs.get(id)?.cancel === true;
  }

  cancel(id: string): boolean {
    const r = this.runs.get(id);
    if (!r) throw new PsMcpError("VALIDATION_ERROR", `Unknown execution id ${id}`);
    if (r.state !== "running" && r.state !== "queued") return false;
    r.cancel = true;
    r.abort.abort();
    return true;
  }

  /* ---- stored workflows ---- */

  saveWorkflow(wf: WorkflowT, overwrite: boolean): string {
    const name = wf.name.replace(/[^\w-]+/g, "_");
    mkdirSync(this.workflowDir, { recursive: true });
    const file = join(this.workflowDir, `${name}.json`);
    if (existsSync(file) && !overwrite) throw new PsMcpError("FILE_EXISTS", `Workflow "${name}" exists. Pass overwrite: true to replace it.`);
    writeFileSync(file, JSON.stringify(wf, null, 2));
    return file;
  }

  loadWorkflow(name: string): WorkflowT {
    const file = join(this.workflowDir, `${name.replace(/[^\w-]+/g, "_")}.json`);
    if (!existsSync(file)) throw new PsMcpError("FILE_NOT_FOUND", `No stored workflow named "${name}"`);
    const parsed = Workflow.safeParse(JSON.parse(readFileSync(file, "utf8")));
    if (!parsed.success) throw new PsMcpError("VALIDATION_ERROR", `Stored workflow "${name}" is invalid: ${parsed.error.message}`);
    return parsed.data;
  }

  listWorkflows(): string[] {
    if (!existsSync(this.workflowDir)) return [];
    return readdirSync(this.workflowDir).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5));
  }
}

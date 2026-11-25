import { PsMcpError, toPsError, type ErrorPayload } from "../shared.js";
import type { WorkflowStep } from "../schemas/index.js";

export interface StepResult {
  index: number;
  id?: string;
  tool: string;
  description?: string;
  state: "pending" | "running" | "ok" | "failed" | "skipped" | "cancelled";
  startedAt?: string;
  finishedAt?: string;
  data?: unknown;
  warnings?: string[];
  error?: ErrorPayload;
}

export interface ExecutionStatus {
  id: string;
  workflow: string;
  state: "queued" | "running" | "succeeded" | "failed" | "cancelled" | "partial";
  createdAt: string;
  finishedAt?: string;
  currentStep?: number;
  steps: StepResult[];
}

export type ToolExecutor = (tool: string, args: Record<string, unknown>) => Promise<{ data: unknown; warnings?: string[] }>;

const PLACEHOLDER = /\{\{\s*(steps|vars)\.([\w-]+)((?:\.[\w-]+)*)\s*\}\}/g;

function dig(v: unknown, path: string[]): unknown {
  return path.reduce<unknown>((acc, k) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[k] : undefined), v);
}

/**
 * Replace {{steps.<id>.data.x}} / {{vars.name}} placeholders. A string that is exactly one placeholder
 * keeps the referenced value's type (e.g. a numeric layer id).
 */
export function resolvePlaceholders(value: unknown, steps: Map<string, StepResult>, vars: Record<string, unknown>): unknown {
  if (typeof value === "string") {
    const lookup = (scope: string, key: string, rest: string): unknown => {
      const path = rest.split(".").filter(Boolean);
      if (scope === "vars") return dig(vars[key], path);
      const s = steps.get(key);
      if (!s) throw new PsMcpError("WORKFLOW_FAILED", `Placeholder references unknown or not-yet-run step "${key}"`);
      return dig(s, path);
    };
    const whole = /^\{\{\s*(steps|vars)\.([\w-]+)((?:\.[\w-]+)*)\s*\}\}$/.exec(value);
    if (whole) return lookup(whole[1]!, whole[2]!, whole[3]!);
    return value.replace(PLACEHOLDER, (_m, scope: string, key: string, rest: string) => String(lookup(scope, key, rest) ?? ""));
  }
  if (Array.isArray(value)) return value.map((v) => resolvePlaceholders(v, steps, vars));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolvePlaceholders(v, steps, vars)]));
  }
  return value;
}

export interface RunOptions {
  vars?: Record<string, unknown>;
  isCancelled?: () => boolean;
  onUpdate?: (status: ExecutionStatus) => void;
  /** Optional post-step verification; throw to fail the step. */
  verify?: (step: WorkflowStep, result: { data: unknown }) => Promise<void> | void;
}

/** Execute steps strictly in order. Stops on the first failure unless the step allows continueOnError. */
export async function runWorkflow(
  status: ExecutionStatus,
  steps: WorkflowStep[],
  exec: ToolExecutor,
  opts: RunOptions = {},
): Promise<ExecutionStatus> {
  const byId = new Map<string, StepResult>();
  status.state = "running";
  status.steps = steps.map((s, index) => ({ index, id: s.id, tool: s.tool, description: s.description, state: "pending" }));
  opts.onUpdate?.(status);
  let failures = 0;
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    const rec = status.steps[i]!;
    if (opts.isCancelled?.()) {
      for (const s of status.steps.slice(i)) s.state = "cancelled";
      status.state = "cancelled";
      break;
    }
    status.currentStep = i;
    rec.state = "running";
    rec.startedAt = new Date().toISOString();
    opts.onUpdate?.(status);
    try {
      const args = resolvePlaceholders(step.args ?? {}, byId, opts.vars ?? {}) as Record<string, unknown>;
      const out = await exec(step.tool, args);
      await opts.verify?.(step, out);
      rec.state = "ok";
      rec.data = out.data;
      rec.warnings = out.warnings;
    } catch (err) {
      const e = toPsError(err);
      rec.state = "failed";
      rec.error = e.toJSON();
      failures++;
      if (!step.continueOnError) {
        for (const s of status.steps.slice(i + 1)) s.state = "skipped";
        rec.finishedAt = new Date().toISOString();
        if (step.id) byId.set(step.id, rec);
        status.state = "failed";
        break;
      }
    }
    rec.finishedAt = new Date().toISOString();
    if (step.id) byId.set(step.id, rec);
    opts.onUpdate?.(status);
  }
  if (status.state === "running") status.state = failures > 0 ? "partial" : "succeeded";
  status.finishedAt = new Date().toISOString();
  status.currentStep = undefined;
  opts.onUpdate?.(status);
  return status;
}

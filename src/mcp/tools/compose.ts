import type { WorkflowStep } from "../../schemas/index.js";
import { runWorkflow, type ExecutionStatus } from "../../workflow-engine/index.js";
import { PsMcpError } from "../../shared.js";
import { callTool, type ToolContext, type ToolOutput } from "./registry.js";

/**
 * Run a compiled step list synchronously (inside one tool call) and report every step.
 * Fails the tool if any non-optional step fails, listing what was completed so the caller can undo.
 */
export async function runSteps(ctx: ToolContext, steps: WorkflowStep[], vars: Record<string, unknown> = {}): Promise<ToolOutput> {
  const status: ExecutionStatus = { id: "inline", workflow: "inline", state: "queued", createdAt: new Date().toISOString(), steps: [] };
  const images: ToolOutput["images"] = [];
  await runWorkflow(status, steps, async (t, args) => {
    const out = await callTool(t, args, ctx);
    images.push(...(out.images ?? []));
    return out;
  }, { vars });
  const summary = status.steps.map((s) => ({ step: s.index, tool: s.tool, description: s.description, state: s.state, ...(s.error ? { error: s.error } : {}), ...(s.state === "ok" ? { result: s.data } : {}) }));
  if (status.state === "failed") {
    const failed = status.steps.find((s) => s.state === "failed");
    throw new PsMcpError("WORKFLOW_FAILED", `Step ${failed?.index} (${failed?.tool}) failed: ${failed?.error?.message}. Completed steps can be reverted with undo.`, { steps: summary });
  }
  return { data: { state: status.state, steps: summary }, warnings: status.steps.flatMap((s) => s.warnings ?? []), images };
}

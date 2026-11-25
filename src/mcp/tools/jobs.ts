import { z } from "zod";
import type { JobRecord } from "../../jobs/job-manager.js";
import { tool, READ_ONLY, WRITE, type ToolOutput } from "./registry.js";

const jobIdArg = z.string().min(1).max(64).describe("Id returned by a tool called with background: true");

/** A finished job's result is shown exactly as the original tool would have returned it, images included. */
function jobOutput(job: JobRecord<ToolOutput>): ToolOutput {
  const { result, ...meta } = job;
  if (job.state !== "succeeded" || !result) return { data: { job: meta }, source: "server" };
  return { data: { job: meta, result: result.data }, warnings: result.warnings, images: result.images, source: result.source };
}

export function registerJobTools(): void {
  tool({
    module: "jobs",
    name: "get_job",
    description: "Status of a background job (queued | running | succeeded | failed | cancelled). When it has succeeded, also returns the tool's full result, including any preview image.",
    input: { jobId: jobIdArg },
    annotations: READ_ONLY,
    handler: async ({ jobId }, ctx) => jobOutput(ctx.jobs.get(jobId)),
  });

  tool({
    module: "jobs",
    name: "wait_for_job",
    description: "Wait up to timeoutSeconds for a background job to finish, then return it as get_job does. If it is still running, call again; the job keeps going either way.",
    input: { jobId: jobIdArg, timeoutSeconds: z.number().int().min(1).max(55).default(30) },
    annotations: READ_ONLY,
    handler: async ({ jobId, timeoutSeconds }, ctx) => jobOutput(await ctx.jobs.wait(jobId, timeoutSeconds * 1000)),
  });

  tool({
    module: "jobs",
    name: "list_jobs",
    description: "List recent background jobs, newest first (results omitted; use get_job).",
    input: {},
    annotations: READ_ONLY,
    handler: async (_a, ctx) => ({ data: { active: ctx.jobs.active, jobs: ctx.jobs.list() }, source: "server" }),
  });

  tool({
    module: "jobs",
    name: "cancel_job",
    description: "Cancel a queued background job. A job already running inside Photoshop cannot be interrupted; the result says so.",
    input: { jobId: jobIdArg },
    annotations: WRITE,
    handler: async ({ jobId }, ctx) => ({ data: ctx.jobs.cancel(jobId), source: "server" }),
  });
}

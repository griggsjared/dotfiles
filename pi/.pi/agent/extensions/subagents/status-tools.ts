import type { ChildProcess } from "node:child_process";
import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { capOutput, formatUsageStats, toolCallLabel } from "./format.ts";
import type { JobRegistry, Job } from "./registry.ts";
import { killProcess } from "./runner.ts";

const StatusParams = Type.Object({ jobId: Type.Optional(Type.Integer({ minimum: 1 })) });
const EmptyParams = Type.Object({});

const MAX_STATUS_OUTPUT = 4000;
const MAX_STATUS_TOOL_CALLS = 8;

type StatusJob = Job;

function formatJob(job: StatusJob, now: number): string {
  if (job.status === "running") {
    const elapsed = ((now - job.startTime) / 1000).toFixed(1);
    const progress = job.progress ? ` — ${job.progress}` : "";
    const metadata = formatUsageStats(undefined, job.model, job.thinkingLevel);
    return `- ◐ #${job.id} ${job.agent} (${elapsed}s${metadata ? ` ${metadata}` : ""}): ${job.title ?? job.task}${progress}`;
  }
  const duration = job.endTime ? ((job.endTime - job.startTime) / 1000).toFixed(1) : "?";
  const icon = job.status === "completed" ? "✓" : "✗";
  const usage = formatUsageStats(job.usage, job.model, job.thinkingLevel);
  return `- ${icon} #${job.id} ${job.agent} (${duration}s${usage ? ` ${usage}` : ""}): ${job.title ?? job.task}`;
}

function formatDetailedStatus(job: Job, now: number): string {
  const duration = ((job.endTime ?? now) - job.startTime) / 1000;
  const metadata = formatUsageStats(job.usage, job.model, job.thinkingLevel);
  const lines = [
    `**Subagent #${job.id}**`,
    `State: ${job.status}`,
    `Agent: ${job.agent}`,
    `Task: ${job.title ?? job.task}`,
    `Elapsed: ${duration.toFixed(1)}s`,
  ];
  if (metadata) lines.push(`Usage: ${metadata}`);
  if (job.progress) lines.push(`Progress: ${job.progress}`);
  if (job.toolCalls.length > 0) {
    lines.push(`Tool calls (${job.toolCalls.length}):`);
    for (const call of job.toolCalls.slice(-MAX_STATUS_TOOL_CALLS)) {
      lines.push(`- ${toolCallLabel(call.name, call.args)}`);
    }
  }
  if (job.text) lines.push(`Latest output:\n${capOutput(job.text, MAX_STATUS_OUTPUT)}`);
  if (job.error) lines.push(`Error:\n${capOutput(job.error, MAX_STATUS_OUTPUT)}`);
  return lines.join("\n");
}

export function formatStatus(registry: JobRegistry, jobId?: number, now = Date.now()): string {
  if (jobId !== undefined) {
    const job = registry.get(jobId);
    return job ? formatDetailedStatus(job, now) : `Unknown subagent job ID: ${jobId}`;
  }
  const running = registry.running();
  const recent = registry.recent(20).filter((j) => j.endTime && now - j.endTime < 60000);
  const lines = running.length > 0
    ? [`**Running (${running.length}):**`, ...running.map((job) => formatJob(job, now))]
    : ["**Running:** none"];
  if (recent.length > 0) lines.push(`\n**Recent (${recent.length}):**`, ...recent.map((job) => formatJob(job, now)));
  return lines.join("\n");
}

function cancelAll(procs: Set<ChildProcess>): number {
  const count = procs.size;
  for (const proc of procs) killProcess(proc);
  return count;
}

export function createStatusTool(deps: { registry: JobRegistry }): ToolDefinition<typeof StatusParams, Record<string, never>> {
  return {
    name: "subagent_status",
    label: "Subagent Status",
    description: "Inspect running and recently completed subagents when needed. Async jobs deliver results automatically; do not poll for normal completion.",
    parameters: StatusParams,
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      return { content: [{ type: "text", text: formatStatus(deps.registry, params.jobId) }], details: {} };
    },
  };
}

export function createCancelTool(deps: { registry: JobRegistry; activeProcs: Set<ChildProcess> }): ToolDefinition<typeof EmptyParams, Record<string, never>> {
  return {
    name: "subagent_cancel",
    label: "Cancel Subagents",
    description: "Cancel all running subagents. Use this to abort long-running or stalled subagents.",
    parameters: EmptyParams,
    async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
      const running = deps.registry.running();
      if (running.length === 0) {
        return { content: [{ type: "text", text: "No subagents are running." }], details: {} };
      }
      const count = cancelAll(deps.activeProcs);
      return { content: [{ type: "text", text: `Cancelling ${count} subagent${count > 1 ? "s" : ""}.` }], details: {} };
    },
  };
}

export function registerStatusCommands(pi: ExtensionAPI, deps: { registry: JobRegistry; activeProcs: Set<ChildProcess> }): void {
  pi.registerCommand("subagent-status", {
    description: "Show running and recent subagent status or inspect a job by ID",
    handler: async (args, ctx) => {
      if (!ctx.hasUI) return;
      const trimmed = args.trim();
      if (!trimmed || trimmed.toLowerCase() === "all") {
        ctx.ui.notify(formatStatus(deps.registry), "info");
        return;
      }
      const jobId = Number(trimmed);
      if (!Number.isInteger(jobId) || jobId < 1) {
        ctx.ui.notify("Usage: /subagent-status [numeric-job-id|all]", "error");
        return;
      }
      ctx.ui.notify(formatStatus(deps.registry, jobId), "info");
    },
  });

  pi.registerCommand("cancel-subagents", {
    description: "Cancel all running subagents",
    handler: async (_args, ctx) => {
      const running = deps.registry.running();
      if (running.length === 0) {
        ctx.ui.notify("No subagents are running", "info");
        return;
      }
      const count = cancelAll(deps.activeProcs);
      ctx.ui.notify(`Cancelling ${count} subagent${count > 1 ? "s" : ""}`, "info");
    },
  });
}

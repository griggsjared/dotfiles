import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { capOutput, formatDuration, formatUsageStats, toolCallLabel } from "./format.ts";
import type { JobRegistry, Job } from "./registry.ts";

const StatusParams = Type.Object({ jobId: Type.Optional(Type.Integer({ minimum: 1 })) });
const CancelParams = Type.Object({ jobId: Type.Optional(Type.Integer({ minimum: 1 })), all: Type.Optional(Type.Boolean()) });

const MAX_STATUS_OUTPUT = 4000;
const MAX_STATUS_TOOL_CALLS = 8;

type StatusJob = Job;

function formatJob(job: StatusJob, now: number): string {
  if (job.status === "running") {
    const elapsed = formatDuration(now - job.startTime);
    const progress = job.progress ? ` — ${job.progress}` : "";
    const metadata = formatUsageStats(undefined, job.model, job.thinkingLevel);
    return `- ◐ #${job.id} ${job.agent} (${elapsed}${metadata ? ` ${metadata}` : ""}): ${job.title ?? job.task}${progress}`;
  }
  const duration = job.endTime ? formatDuration(job.endTime - job.startTime) : "?";
  const icon = job.status === "completed" ? "✓" : job.status === "cancelled" ? "⊘" : "✗";
  const usage = formatUsageStats(job.usage, job.model, job.thinkingLevel);
  return `- ${icon} #${job.id} ${job.agent} (${duration}${usage ? ` ${usage}` : ""}): ${job.title ?? job.task}`;
}

function formatDetailedStatus(job: Job, now: number): string {
  const duration = formatDuration((job.endTime ?? now) - job.startTime);
  const metadata = formatUsageStats(job.usage, job.model, job.thinkingLevel);
  const lines = [
    `**Subagent #${job.id}**`,
    `State: ${job.status}`,
    `Agent: ${job.agent}`,
    `Task: ${job.title ?? job.task}`,
    `Elapsed: ${duration}`,
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
  if (job.cancellationReason) lines.push(`Cancellation: ${job.cancellationReason}`);
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

export function createCancelTool(deps: { registry: JobRegistry; activeProcs?: unknown }): ToolDefinition<typeof CancelParams, Record<string, never>> {
  return {
    name: "subagent_cancel",
    label: "Cancel Subagents",
    description: "Cancel one subagent by jobId, or all running subagents.",
    parameters: CancelParams,
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      if (params.all && params.jobId !== undefined) throw new Error("Specify either jobId or all, not both.");
      const count = params.all || params.jobId === undefined ? deps.registry.cancelAll() : (deps.registry.cancel(params.jobId) ? 1 : 0);
      if (count === 0) return { content: [{ type: "text", text: params.jobId ? `No running subagent #${params.jobId}.` : "No subagents are running." }], details: {} };
      return { content: [{ type: "text", text: `Cancelling ${count} subagent${count > 1 ? "s" : ""}.` }], details: {} };
    },
  };
}

export function registerStatusCommands(pi: ExtensionAPI, deps: { registry: JobRegistry; activeProcs?: unknown }): void {
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

  pi.registerCommand("subagent-cancel", {
    description: "Cancel one subagent by ID, or all running subagents",
    handler: async (args, ctx) => {
      const value = args.trim().toLowerCase();
      if (!value || (value !== "all" && (!/^\d+$/.test(value) || Number(value) < 1))) {
        ctx.ui.notify("Usage: /subagent-cancel <numeric-job-id|all>", "error"); return;
      }
      const count = value === "all" ? deps.registry.cancelAll() : (deps.registry.cancel(Number(value)) ? 1 : 0);
      ctx.ui.notify(count ? `Cancelling ${count} subagent${count > 1 ? "s" : ""}` : "No matching running subagent", "info");
    },
  });
}

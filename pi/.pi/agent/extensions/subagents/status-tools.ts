import { Text } from "@earendil-works/pi-tui";
import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { capOutput, formatDuration, formatUsageStats, normalizeTitle, shortLabel, toolCallLabel } from "./format.ts";
import type { JobRegistry, Job } from "./registry.ts";

const StatusParams = Type.Object({ jobId: Type.Optional(Type.Integer({ minimum: 1 })) });
const CancelParams = Type.Object({ jobId: Type.Optional(Type.Integer({ minimum: 1 })), all: Type.Optional(Type.Boolean()) });
const SendParams = Type.Object({
  jobId: Type.Integer({ minimum: 1 }),
  message: Type.String({ minLength: 1 }),
  deliverAs: Type.Union([Type.Literal("steer"), Type.Literal("followUp")]),
});
const ReplyParams = Type.Object({
  jobId: Type.Integer({ minimum: 1 }),
  questionId: Type.String({ minLength: 1 }),
  answer: Type.String({ minLength: 1 }),
});

const MAX_STATUS_OUTPUT = 4000;
const MAX_STATUS_TOOL_CALLS = 8;

type StatusJob = Job;
interface ReplyToolDetails { jobId: number; questionId: string; question: string; answer: string; }

function formatJob(job: StatusJob, now: number): string {
  if (job.status === "running") {
    const elapsed = formatDuration(now - job.startTime);
    const progress = job.pendingQuestions.length > 0
      ? " — waiting for parent"
      : job.progress ? ` — ${job.progress}` : "";
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
  if (job.pendingQuestions.length > 0) {
    lines.push(`Waiting for parent (${job.pendingQuestions.length}):`);
    for (const question of job.pendingQuestions) lines.push(`- ${question.id}: ${question.question}`);
  } else if (job.progress) lines.push(`Progress: ${job.progress}`);
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

export function createSendTool(deps: { registry: JobRegistry }): ToolDefinition<typeof SendParams, Record<string, never>> {
  return {
    name: "subagent_send",
    label: "Message Subagent",
    description: "Send a steering or follow-up message to a running subagent.",
    promptGuidelines: [
      "Use subagent_send only for running jobs. steer adjusts the current run; followUp queues another child turn.",
      "subagent_send does not answer ask_parent questions; use subagent_reply for those.",
    ],
    parameters: SendParams,
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      if (!params.message.trim()) throw new Error("Subagent message cannot be empty.");
      await deps.registry.send(params.jobId, params.message, params.deliverAs);
      return {
        content: [{ type: "text", text: `Sent ${params.deliverAs} message to subagent #${params.jobId}.` }],
        details: {},
      };
    },
  };
}

export function createReplyTool(deps: { registry: JobRegistry }): ToolDefinition<typeof ReplyParams, ReplyToolDetails> {
  return {
    name: "subagent_reply",
    label: "Reply to Subagent",
    description: "Answer one pending question from a running subagent.",
    promptGuidelines: [
      "When a subagent question arrives, answer it with subagent_reply. If user direction is needed, call ask_user first and relay the answer.",
    ],
    parameters: ReplyParams,
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      if (!params.answer.trim()) throw new Error("Subagent reply cannot be empty.");
      const question = deps.registry.get(params.jobId)?.pendingQuestions.find((item) => item.id === params.questionId);
      await deps.registry.reply(params.jobId, params.questionId, params.answer);
      return {
        content: [{ type: "text", text: `Answered subagent #${params.jobId}.` }],
        details: {
          jobId: params.jobId,
          questionId: params.questionId,
          question: question?.question ?? "(question unavailable)",
          answer: params.answer,
        },
      };
    },
    renderCall(args, theme, _context) {
      return new Text(
        theme.fg("toolTitle", theme.bold("reply ")) + theme.fg("accent", `#${args.jobId}`),
        0,
        0,
      );
    },
    renderResult(result, _options, theme, _context) {
      const details = result.details;
      if (!details) {
        const text = result.content[0];
        return new Text(text?.type === "text" ? text.text : "", 0, 0);
      }
      const question = shortLabel(undefined, normalizeTitle(details.question) ?? "(question unavailable)", 72);
      const answer = shortLabel(undefined, normalizeTitle(details.answer) ?? "(empty)", 72);
      return new Text(
        theme.fg("success", "✓ ") + theme.fg("muted", `reply delivered to #${details.jobId}`) +
          `\n  ${theme.fg("muted", "Q: ")}${theme.fg("dim", question)}` +
          `\n  ${theme.fg("muted", "A: ")}${theme.fg("dim", answer)}`,
        0,
        0,
      );
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

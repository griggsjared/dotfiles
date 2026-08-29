import { Text } from "@earendil-works/pi-tui";
import type { ExtensionAPI, Theme, ToolDefinition } from "@earendil-works/pi-coding-agent";
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
interface StatusToolDetails { text: string; jobId?: number; outputLines?: number; errorLines?: number; }
interface CancelTarget { jobId: number; agent: string; label: string; }
interface CancelToolDetails { count: number; targets: CancelTarget[]; }
interface SendToolDetails { jobId: number; agent: string; label: string; message: string; deliverAs: "steer" | "followUp"; }
interface ReplyToolDetails { jobId: number; questionId: string; question: string; answer: string; }

function jobLabel(job: Pick<Job, "title" | "task">, max = 80): string {
  return shortLabel(normalizeTitle(job.title), normalizeTitle(job.task), max);
}

function renderStatusText(
  text: string,
  theme: Theme,
  sections: Pick<StatusToolDetails, "outputLines" | "errorLines"> = {},
): Text {
  let bodyColor: "toolOutput" | "error" | undefined;
  let bodyLines = 0;
  let waitingForParent = false;
  const lines = text.split("\n").map((line) => {
    if (bodyLines > 0 && bodyColor) {
      bodyLines -= 1;
      return theme.fg(bodyColor, line);
    }

    const heading = line.match(/^\*\*(.+)\*\*:?$/);
    if (heading?.[1]) {
      bodyColor = undefined;
      waitingForParent = false;
      return theme.fg("toolTitle", theme.bold(heading[1]));
    }

    const job = line.match(/^- ([◐✓⊘✗]) (#\d+) (\S+)(.*)$/);
    if (job?.[1] && job[2] && job[3] !== undefined && job[4] !== undefined) {
      bodyColor = undefined;
      waitingForParent = false;
      const color = job[1] === "✓" ? "success" : job[1] === "⊘" ? "warning" : job[1] === "✗" ? "error" : "accent";
      const suffix = job[4].match(/^( \([^)]*\)):\s*(.*?)(\s+—\s+.*)?$/);
      return theme.fg(color, `${job[1]} `) +
        theme.fg("accent", `${job[2]} ${job[3]}`) +
        (suffix
          ? theme.fg("muted", suffix[1] ?? "") +
            theme.fg("dim", `: ${suffix[2] ?? ""}`) +
            theme.fg("muted", suffix[3] ?? "")
          : theme.fg("muted", job[4]));
    }

    if (waitingForParent && line.startsWith("- ")) {
      const question = line.match(/^- [^:]+:\s*(.*)$/);
      return theme.fg("dim", question?.[1] ? `- ${question[1]}` : line);
    }

    const field = line.match(/^([^:]+):(.*)$/);
    if (field?.[1] && field[2] !== undefined) {
      const label = field[1];
      const value = field[2];
      waitingForParent = label.startsWith("Waiting for parent");
      bodyColor = label === "Latest output" ? "toolOutput" : label === "Error" ? "error" : undefined;
      bodyLines = label === "Latest output" ? sections.outputLines ?? 0 : label === "Error" ? sections.errorLines ?? 0 : 0;
      const valueColor = label === "State"
        ? value.includes("completed") ? "success" : value.includes("cancelled") ? "warning" : value.includes("failed") ? "error" : "accent"
        : label === "Agent" ? "accent"
        : label === "Cancellation" ? "warning"
        : label === "Error" ? "error"
        : label === "Usage" || label === "Elapsed" || label === "Task" || label === "Progress" ? "dim"
        : "muted";
      return theme.fg("muted", `${label}:`) + theme.fg(valueColor, value);
    }

    if (line.startsWith("- ")) return theme.fg("dim", line);
    if (!line) return "";
    return theme.fg(bodyColor ?? "muted", line);
  });
  return new Text(lines.join("\n"), 0, 0);
}

function formatJob(job: StatusJob, now: number): string {
  if (job.status === "running") {
    const elapsed = formatDuration(now - job.startTime);
    const progress = job.pendingQuestions.length > 0
      ? " — waiting for parent"
      : job.progress ? ` — ${job.progress}` : "";
    const metadata = formatUsageStats(undefined, job.model, job.thinkingLevel);
    return `- ◐ #${job.id} ${job.agent} (${elapsed}${metadata ? ` ${metadata}` : ""}): ${jobLabel(job)}${progress}`;
  }
  const duration = job.endTime ? formatDuration(job.endTime - job.startTime) : "?";
  const icon = job.status === "completed" ? "✓" : job.status === "cancelled" ? "⊘" : "✗";
  const usage = formatUsageStats(job.usage, job.model, job.thinkingLevel);
  return `- ${icon} #${job.id} ${job.agent} (${duration}${usage ? ` ${usage}` : ""}): ${jobLabel(job)}`;
}

function formatDetailedStatus(job: Job, now: number): string {
  const duration = formatDuration((job.endTime ?? now) - job.startTime);
  const metadata = formatUsageStats(job.usage, job.model, job.thinkingLevel);
  const lines = [
    `**Subagent #${job.id}**`,
    `State: ${job.status}`,
    `Agent: ${job.agent}`,
    `Task: ${jobLabel(job, 160)}`,
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

function formatStatusForDisplay(registry: JobRegistry, jobId: number): string {
  let waitingForParent = false;
  return formatStatus(registry, jobId).split("\n").map((line) => {
    if (line.startsWith("Waiting for parent")) {
      waitingForParent = true;
      return line;
    }
    if (waitingForParent && line.startsWith("- ")) {
      const question = line.match(/^- [^:]+:\s*(.*)$/);
      return question?.[1] ? `- ${question[1]}` : line;
    }
    waitingForParent = false;
    return line;
  }).join("\n");
}

export function createStatusTool(deps: { registry: JobRegistry }): ToolDefinition<typeof StatusParams, StatusToolDetails> {
  return {
    name: "subagent_status",
    label: "Subagent Status",
    description: "Inspect running and recently completed subagents when needed. Async jobs deliver results automatically; do not poll for normal completion.",
    parameters: StatusParams,
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const text = formatStatus(deps.registry, params.jobId);
      const job = params.jobId === undefined ? undefined : deps.registry.get(params.jobId);
      const output = job?.text ? capOutput(job.text, MAX_STATUS_OUTPUT) : undefined;
      const error = job?.error ? capOutput(job.error, MAX_STATUS_OUTPUT) : undefined;
      return {
        content: [{ type: "text", text }],
        details: {
          text,
          jobId: params.jobId,
          outputLines: output?.split("\n").length,
          errorLines: error?.split("\n").length,
        },
      };
    },
    renderCall(args, theme, _context) {
      return new Text(
        theme.fg("toolTitle", theme.bold("status ")) + theme.fg("accent", args.jobId ? `#${args.jobId}` : "all"),
        0,
        0,
      );
    },
    renderResult(result, _options, theme, _context) {
      const details = result.details;
      const text = typeof details?.text === "string"
        ? details.text
        : result.content[0]?.type === "text" ? result.content[0].text : "";
      return renderStatusText(text, theme, details ?? {});
    },
  };
}

export function createCancelTool(deps: { registry: JobRegistry; activeProcs?: unknown }): ToolDefinition<typeof CancelParams, CancelToolDetails> {
  return {
    name: "subagent_cancel",
    label: "Cancel Subagents",
    description: "Cancel one subagent by jobId, or all running subagents.",
    parameters: CancelParams,
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      if (params.all && params.jobId !== undefined) throw new Error("Specify either jobId or all, not both.");
      const jobs = params.all || params.jobId === undefined
        ? deps.registry.running()
        : [deps.registry.get(params.jobId)].filter((job): job is Job => job?.status === "running");
      const targets = jobs.map((job) => ({ jobId: job.id, agent: job.agent, label: jobLabel(job) }));
      const count = params.all || params.jobId === undefined ? deps.registry.cancelAll() : (deps.registry.cancel(params.jobId) ? 1 : 0);
      if (count === 0) {
        return {
          content: [{ type: "text", text: params.jobId ? `No running subagent #${params.jobId}.` : "No subagents are running." }],
          details: { count, targets },
        };
      }
      return {
        content: [{ type: "text", text: `Cancelling ${count} subagent${count > 1 ? "s" : ""}.` }],
        details: { count, targets },
      };
    },
    renderCall(args, theme, _context) {
      const target = args.all || args.jobId === undefined ? "all" : `#${args.jobId}`;
      return new Text(theme.fg("toolTitle", theme.bold("cancel ")) + theme.fg("accent", target), 0, 0);
    },
    renderResult(result, _options, theme, context) {
      const details = result.details;
      if (
        context.isError ||
        !details ||
        typeof details.count !== "number" ||
        !Array.isArray(details.targets) ||
        details.count === 0
      ) {
        const text = result.content[0];
        return new Text(theme.fg("muted", text?.type === "text" ? text.text : "No matching subagents."), 0, 0);
      }
      const firstTarget = details.targets[0];
      if (details.targets.length === 1 && firstTarget) {
        return new Text(
          theme.fg("warning", "⊘ ") +
            theme.fg("muted", "cancelling ") +
            theme.fg("accent", `#${firstTarget.jobId} ${firstTarget.agent}`) +
            theme.fg("dim", `: ${firstTarget.label}`),
          0,
          0,
        );
      }
      return new Text(
        theme.fg("warning", "⊘ ") + theme.fg("muted", `cancelling ${details.count} subagents`),
        0,
        0,
      );
    },
  };
}

export function createSendTool(deps: { registry: JobRegistry }): ToolDefinition<typeof SendParams, SendToolDetails> {
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
      const job = deps.registry.get(params.jobId);
      await deps.registry.send(params.jobId, params.message, params.deliverAs);
      return {
        content: [{ type: "text", text: `Sent ${params.deliverAs} message to subagent #${params.jobId}.` }],
        details: {
          jobId: params.jobId,
          agent: job?.agent ?? "subagent",
          label: job ? jobLabel(job) : "(task unavailable)",
          message: params.message,
          deliverAs: params.deliverAs,
        },
      };
    },
    renderCall(args, theme, _context) {
      const mode = args.deliverAs === "followUp" ? "follow-up" : "steer";
      return new Text(
        theme.fg("toolTitle", theme.bold("send ")) +
          theme.fg("accent", `#${args.jobId}`) +
          theme.fg("muted", ` ${mode}`) +
          `\n  ${theme.fg("dim", shortLabel(undefined, normalizeTitle(args.message), 80))}`,
        0,
        0,
      );
    },
    renderResult(result, _options, theme, context) {
      const details = result.details;
      if (
        context.isError ||
        !details ||
        typeof details.jobId !== "number" ||
        typeof details.agent !== "string" ||
        typeof details.label !== "string" ||
        (details.deliverAs !== "steer" && details.deliverAs !== "followUp")
      ) {
        const text = result.content[0];
        return new Text(text?.type === "text" ? text.text : "", 0, 0);
      }
      const mode = details.deliverAs === "followUp" ? "follow-up" : "steering";
      return new Text(
        theme.fg("success", "✓ ") +
          theme.fg("muted", `${mode} delivered to `) +
          theme.fg("accent", `#${details.jobId} ${details.agent}`) +
          `\n  ${theme.fg("dim", details.label)}`,
        0,
        0,
      );
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
    renderResult(result, _options, theme, context) {
      const details = result.details;
      if (
        context.isError ||
        !details ||
        typeof details.jobId !== "number" ||
        typeof details.question !== "string" ||
        typeof details.answer !== "string"
      ) {
        const text = result.content[0];
        return new Text(text?.type === "text" ? text.text : "", 0, 0);
      }
      const question = shortLabel(undefined, normalizeTitle(details.question) ?? "(question unavailable)", 72);
      const answer = shortLabel(undefined, normalizeTitle(details.answer) ?? "(empty)", 72);
      return new Text(
        theme.fg("success", "✓ ") +
          theme.fg("muted", "reply delivered to ") +
          theme.fg("accent", `#${details.jobId}`) +
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
      ctx.ui.notify(formatStatusForDisplay(deps.registry, jobId), "info");
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

  pi.registerCommand("subagent-send", {
    description: "Send a steering or follow-up message to a running subagent",
    handler: async (args, ctx) => {
      if (!ctx.hasUI) return;
      const match = args.trim().match(/^(\d+)\s+(\S+)(?:\s+([\s\S]*))?$/);
      const mode = match?.[2]?.toLowerCase();
      const message = match?.[3]?.trim();
      if (!match || !message || (mode !== "steer" && mode !== "followup")) {
        ctx.ui.notify("Usage: /subagent-send <numeric-job-id> <steer|followup> <message>", "error");
        return;
      }
      const jobId = Number(match[1]);
      if (!Number.isInteger(jobId) || jobId < 1) {
        ctx.ui.notify("Usage: /subagent-send <numeric-job-id> <steer|followup> <message>", "error");
        return;
      }
      const deliverAs = mode === "steer" ? "steer" : "followUp";
      try {
        await deps.registry.send(jobId, message, deliverAs);
        ctx.ui.notify(`Sent ${mode === "steer" ? "steering" : "follow-up"} message to subagent #${jobId}.`, "info");
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
      }
    },
  });
}

import { Container, Text, type Component } from "@earendil-works/pi-tui";
import type { ExtensionAPI, ExtensionContext, Theme, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { SubagentSettings } from "./agents.ts";
import { capOutput, formatDuration, formatUsageStats, normalizeTitle, shortLabel, toolCallLabel } from "./format.ts";
import type { JobRegistry, Job } from "./registry.ts";
import { openSubagentTail, TruncatedText } from "./render.ts";
import { eventColor, eventKindLabel, formatEventSummary } from "./tail.ts";
import { PROFILE_ENTRY_TYPE, type JobEvent, type ToolCallInfo } from "./types.ts";

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
const PeekParams = Type.Object({
  jobId: Type.Integer({ minimum: 1 }),
  since: Type.Optional(Type.Integer({ minimum: 0 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  maxChars: Type.Optional(Type.Integer({ minimum: 1, maximum: 2000 })),
});

const JobStatus = Type.Union([
  Type.Literal("running"), Type.Literal("completed"), Type.Literal("failed"), Type.Literal("cancelled"),
]);
const StatusOutput = Type.Object({
  text: Type.String(),
  jobId: Type.Optional(Type.Integer({ minimum: 1 })),
  jobs: Type.Array(Type.Object({
    jobId: Type.Integer({ minimum: 1 }),
    agent: Type.String(),
    status: JobStatus,
    label: Type.String(),
  })),
  error: Type.Optional(Type.String()),
});
const PeekOutput = Type.Object({
  jobId: Type.Integer({ minimum: 1 }),
  agent: Type.String(),
  task: Type.Optional(Type.String()),
  title: Type.Optional(Type.String()),
  status: JobStatus,
  events: Type.Array(Type.Object({
    seq: Type.Integer({ minimum: 1 }),
    timestamp: Type.Number(),
    kind: Type.Union([
      Type.Literal("assistant"), Type.Literal("tool-start"), Type.Literal("tool-end"),
      Type.Literal("question"), Type.Literal("state"),
    ]),
    summary: Type.String(),
  }), { maxItems: 100 }),
  nextCursor: Type.Integer({ minimum: 0 }),
  droppedBefore: Type.Optional(Type.Integer({ minimum: 1 })),
});

const MAX_STATUS_OUTPUT = 4000;
const DEFAULT_PEEK_LIMIT = 20;
const DEFAULT_PEEK_CHARS = 2000;
const MAX_STATUS_TOOL_CALLS = 8;

type StatusJob = Job;
interface StatusToolDetails { text: string; jobId?: number; outputLines?: number; errorLines?: number; toolCalls?: ToolCallInfo[]; }
interface CancelTarget { jobId: number; agent: string; label: string; }
interface CancelToolDetails { count: number; targets: CancelTarget[]; }
interface SendToolDetails {
  jobId: number; agent: string; task?: string; title?: string; label: string;
  message: string; deliverAs: "steer" | "followUp";
}
interface ReplyToolDetails {
  jobId: number; agent?: string; task?: string; title?: string;
  questionId: string; question: string; answer: string;
}
interface PeekToolDetails {
  jobId: number;
  agent: string;
  task?: string;
  title?: string;
  status: Job["status"];
  events: JobEvent[];
  nextCursor: number;
  droppedBefore?: number;
}

function jobLabel(job: Pick<Job, "title" | "task">, max = 80): string {
  return shortLabel(normalizeTitle(job.title), normalizeTitle(job.task), max);
}

function jobTarget(job: Pick<Job, "id" | "agent" | "title" | "task">): string {
  return `#${job.id} ${job.agent} · ${shortLabel(normalizeTitle(job.title), normalizeTitle(job.task), Infinity)}`;
}

function resultText(result: { content: Array<{ type: string; text?: string }> }): string {
  const text = result.content[0];
  return text?.type === "text" ? text.text ?? "" : "";
}

function renderStatusText(
  text: string,
  theme: Theme,
  sections: Pick<StatusToolDetails, "outputLines" | "errorLines" | "toolCalls"> = {},
): Component {
  let bodyColor: "toolOutput" | "error" | undefined;
  let bodyLines = 0;
  let waitingForParent = false;
  let readingToolCalls = false;
  let toolCallIndex = 0;
  const toolCallRows = new Map<number, ToolCallInfo>();
  const lines = text.split("\n").map((line, index) => {
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

    const job = line.match(/^- ([⊙✓⊘✗]) (#\d+) (\S+)(.*)$/);
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

    if (readingToolCalls && line.startsWith("- ")) {
      const call = sections.toolCalls?.[toolCallIndex++];
      if (call) toolCallRows.set(index, call);
      return theme.fg("dim", line);
    }

    const field = line.match(/^([^:]+):(.*)$/);
    if (field?.[1] && field[2] !== undefined) {
      const label = field[1];
      const value = field[2];
      waitingForParent = label.startsWith("Waiting for parent");
      readingToolCalls = label.startsWith("Tool calls (");
      bodyColor = label === "Latest output" ? "toolOutput" : label === "Error" ? "error" : undefined;
      bodyLines = label === "Latest output" ? sections.outputLines ?? 0 : label === "Error" ? sections.errorLines ?? 0 : 0;
      const valueColor = label === "State"
        ? value.includes("completed") ? "success" : value.includes("cancelled") ? "warning" : value.includes("failed") ? "error" : "accent"
        : label === "Agent" || label === "Profile" ? "accent"
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
  return {
    render(width: number) {
      const displayLines = lines.map((line, index) => {
        const call = toolCallRows.get(index);
        return call ? theme.fg("dim", `- ${toolCallLabel(call.name, call.args, Math.max(0, width - 2))}`) : line;
      });
      return new Text(displayLines.join("\n"), 0, 0).render(width);
    },
    invalidate() {},
  };
}

function formatJob(job: StatusJob, now: number): string {
  if (job.status === "running") {
    const elapsed = formatDuration(now - job.startTime);
    const progress = job.pendingQuestions.length > 0
      ? " — waiting for parent"
      : job.progress ? ` — ${job.progress}` : "";
    const metadata = formatUsageStats(undefined, job.model, job.thinkingLevel);
    return `- ⊙ #${job.id} ${job.agent} (${elapsed}${metadata ? ` ${metadata}` : ""}): ${jobLabel(job)}${progress}`;
  }
  const duration = job.endTime ? formatDuration(job.endTime - job.startTime) : "?";
  const icon = job.status === "completed" ? "✓" : job.status === "cancelled" ? "⊘" : "✗";
  const metadata = formatUsageStats(job.usage, job.model, job.thinkingLevel);
  return `- ${icon} #${job.id} ${job.agent} (${duration}${metadata ? ` ${metadata}` : ""}): ${jobLabel(job)}`;
}

function formatDetailedStatus(job: Job, now: number): string {
  const duration = formatDuration((job.endTime ?? now) - job.startTime);
  const metadata = formatUsageStats(job.usage, job.model, job.thinkingLevel);
  const lines = [
    `**Subagent #${job.id}**`,
    `State: ${job.status}`,
    `Agent: ${job.agent}`,
    `Task: ${normalizeTitle(job.task) ?? "..."}`,
    ...(normalizeTitle(job.title) ? [`Title: ${normalizeTitle(job.title)}`] : []),
    `Elapsed: ${duration}`,
  ];
  if (job.profile) lines.push(`Profile: ${job.profile}`);
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
    return job ? formatDetailedStatus(job, now) : `subagent status #${jobId}: Unknown subagent job ID: ${jobId}`;
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
    outputSchema: StatusOutput,
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const now = Date.now();
      const text = formatStatus(deps.registry, params.jobId, now);
      const job = params.jobId === undefined ? undefined : deps.registry.get(params.jobId);
      const output = job?.text ? capOutput(job.text, MAX_STATUS_OUTPUT) : undefined;
      const error = job?.error ? capOutput(job.error, MAX_STATUS_OUTPUT) : undefined;
      const jobs = params.jobId !== undefined
        ? job ? [job] : []
        : [...deps.registry.running(), ...deps.registry.recent(20).filter((item) => item.endTime && now - item.endTime < 60000)];
      return {
        content: [{ type: "text", text }],
        structuredContent: {
          text,
          ...(params.jobId !== undefined ? { jobId: params.jobId } : {}),
          jobs: jobs.map((item) => ({ jobId: item.id, agent: item.agent, status: item.status, label: jobLabel(item, params.jobId !== undefined ? 160 : 80) })),
          ...(params.jobId !== undefined && !job ? { error: text } : {}),
        },
        details: {
          text,
          jobId: params.jobId,
          outputLines: output?.split("\n").length,
          errorLines: error?.split("\n").length,
          ...(job ? { toolCalls: job.toolCalls.slice(-MAX_STATUS_TOOL_CALLS) } : {}),
        },
      };
    },
    renderCall(args, theme, _context) {
      const job = args.jobId === undefined ? undefined : deps.registry.get(args.jobId);
      const target = job ? jobTarget(job) : args.jobId === undefined ? "all" : `#${args.jobId}`;
      return new TruncatedText(
        theme.fg("toolTitle", theme.bold("subagent status ")) + theme.fg("accent", target),
        0,
        0,
      );
    },
    renderResult(result, _options, theme, context) {
      const details = result.details;
      const args = context.args ?? {};
      const job = args.jobId === undefined ? undefined : deps.registry.get(args.jobId);
      const target = job ? jobTarget(job) : args.jobId === undefined ? "all" : `#${args.jobId}`;
      const rawText = typeof details?.text === "string" ? details.text : resultText(result);
      const prefix = `subagent status ${target}: `;
      const text = context.args && rawText.startsWith(prefix) ? rawText.slice(prefix.length) : rawText;
      if (context.isError || !details || typeof details.text !== "string") {
        const box = new Container();
        if (!context.args) {
          box.addChild(new TruncatedText(
            theme.fg("toolTitle", theme.bold("subagent status ")) + theme.fg("accent", target),
            0,
            0,
          ));
        }
        box.addChild(new TruncatedText(theme.fg("muted", normalizeTitle(text) ?? "(no status)"), 2, 0));
        return box;
      }
      const duplicateLines = job && details.jobId === job.id && text.startsWith(`**Subagent #${job.id}**\n`)
        ? [`**Subagent #${job.id}**`, `Agent: ${job.agent}`, `Task: ${jobLabel(job, Infinity)}`, `Title: ${jobLabel(job, Infinity)}`]
        : [];
      const displayText = text.split("\n").filter((line, index) => index >= 5 || !duplicateLines.includes(line)).join("\n");
      return renderStatusText(displayText, theme, details);
    },
  };
}

export function createPeekTool(deps: { registry: JobRegistry }): ToolDefinition<typeof PeekParams, PeekToolDetails> {
  return {
    name: "subagent_peek",
    label: "Subagent Peek",
    description: "Inspect concise semantic events from a running or retained subagent job.",
    promptGuidelines: [
      "Use subagent_peek for an explicit bounded look at a job; pass nextCursor as since for incremental reads and do not poll for normal completion.",
    ],
    parameters: PeekParams,
    outputSchema: PeekOutput,
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const job = deps.registry.get(params.jobId);
      if (!job) throw new Error(`Unknown subagent job ID: ${params.jobId}`);
      const read = deps.registry.readEvents(params.jobId, {
        since: params.since,
        limit: params.limit ?? DEFAULT_PEEK_LIMIT,
      });
      if (!read) throw new Error(`Unknown subagent job ID: ${params.jobId}`);
      const maxChars = params.maxChars ?? DEFAULT_PEEK_CHARS;
      const events: JobEvent[] = [];
      const structuredEvents: JobEvent[] = [];
      const eventLines: string[] = [];
      const droppedNotice = read.droppedBefore === undefined ? undefined : `[history dropped before ${read.droppedBefore}]`;
      if (droppedNotice && droppedNotice.length <= maxChars) eventLines.push(droppedNotice);
      for (const event of read.events) {
        const summary = formatEventSummary(event);
        const line = `[${event.seq}] ${summary}`;
        const body = eventLines.length > 0 ? `${eventLines.join("\n")}\n${line}` : line;
        if (body.length > maxChars) break;
        events.push({ ...event });
        structuredEvents.push({ ...event, summary });
        eventLines.push(line);
      }
      const nextCursor = events.at(-1)?.seq ?? (params.since ?? 0);
      const cursor = `nextCursor: ${nextCursor}`;
      const compactCursor = `cursor:${nextCursor}`;
      const eventBody = eventLines.join("\n");
      const bodyWithCursor = (body: string): string => !body
        ? cursor.length <= maxChars ? cursor : compactCursor.length <= maxChars ? compactCursor : ""
        : body.length + cursor.length + 1 <= maxChars
          ? `${body}\n${cursor}`
          : body.length + compactCursor.length + 1 <= maxChars
            ? `${body}\n${compactCursor}`
            : body;
      const conciseContext = `subagent peek #${job.id} ${job.agent} · ${jobLabel(job, 80)}`;
      const eventText = bodyWithCursor(eventBody);
      const withContext = eventText && `${conciseContext}\n${eventText}`.length <= maxChars
        ? `${conciseContext}\n${eventText}`
        : conciseContext.length <= maxChars && !eventText
          ? conciseContext
          : eventText;
      const text = withContext;
      const details = {
        jobId: job.id,
        agent: job.agent,
        task: job.task,
        ...(job.title ? { title: job.title } : {}),
        status: job.status,
        events,
        nextCursor,
        ...(read.droppedBefore !== undefined ? { droppedBefore: read.droppedBefore } : {}),
      };
      return {
        content: [{ type: "text", text }],
        structuredContent: { ...details, events: structuredEvents.map((event) => ({ ...event })) },
        details,
      };
    },
    renderCall(args, theme, _context) {
      const job = deps.registry.get(args.jobId);
      const target = job ? jobTarget(job) : `#${args.jobId}`;
      return new TruncatedText(
        theme.fg("toolTitle", theme.bold("subagent peek ")) + theme.fg("accent", target),
        0,
        0,
      );
    },
    renderResult(result, _options, theme, context) {
      const details = result.details;
      const args = context.args ?? {};
      const fallbackJob = args.jobId === undefined ? undefined : deps.registry.get(args.jobId);
      const fallbackTarget = fallbackJob ? jobTarget(fallbackJob) : `#${args.jobId ?? "?"}`;
      if (!context.isError && details && Array.isArray(details.events) && typeof details.nextCursor === "number") {
        const target = jobTarget({
          id: details.jobId,
          agent: details.agent,
          task: details.task ?? "...",
          title: details.title,
        });
        const shownInCall = Boolean(context.args) && target === fallbackTarget;
        const label = shortLabel(normalizeTitle(details.title), normalizeTitle(details.task), Infinity);
        const lines: string[] = [];
        if (!shownInCall) {
          lines.push(theme.fg("toolTitle", theme.bold("subagent peek ")) + theme.fg("accent", target));
        }
        if (details.task && (!shownInCall || normalizeTitle(details.task) !== label)) lines.push(theme.fg("dim", `Task: ${details.task}`));
        if (details.title && (!shownInCall || normalizeTitle(details.title) !== label)) lines.push(theme.fg("dim", `Title: ${details.title}`));
        if (details.droppedBefore !== undefined) {
          lines.push(theme.fg("warning", `history dropped before event ${details.droppedBefore}`));
        }
        if (details.events.length === 0) {
          lines.push(theme.fg("dim", "no new events"));
        } else {
          for (const event of details.events) {
            const label = eventKindLabel(event.kind).padEnd(9);
            lines.push(
              `${theme.fg("dim", `[${event.seq}]`)} ${theme.fg(eventColor(event.kind), label)} ${theme.fg("muted", formatEventSummary(event) || "(empty)")}`,
            );
          }
        }
        lines.push(theme.fg("dim", `cursor: ${details.nextCursor}`));
        return new Text(lines.join("\n"), 0, 0);
      }
      const text = resultText(result);
      const box = new Container();
      if (!context.args) {
        box.addChild(new TruncatedText(
          theme.fg("toolTitle", theme.bold("subagent peek ")) + theme.fg("accent", fallbackTarget),
          0,
          0,
        ));
      }
      box.addChild(new TruncatedText(theme.fg("muted", normalizeTitle(text) ?? "(no result)"), 2, 0));
      return box;
    },
  };
}

export function createCancelTool(deps: { registry: JobRegistry; activeProcs?: unknown }): ToolDefinition<typeof CancelParams, CancelToolDetails> {
  return {
    name: "subagent_cancel",
    label: "Subagent Cancel",
    description: "Cancel one subagent by jobId, or all running subagents.",
    parameters: CancelParams,
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      if (params.all && params.jobId !== undefined) throw new Error("Specify either jobId or all, not both.");
      const requestedJob = params.jobId === undefined ? undefined : deps.registry.get(params.jobId);
      const jobs = params.all || params.jobId === undefined
        ? deps.registry.running()
        : requestedJob ? [requestedJob] : [];
      const targets = jobs.map((job) => ({ jobId: job.id, agent: job.agent, label: jobLabel(job, Infinity) }));
      const targetText = targets.length > 0
        ? targets.map((target) => `#${target.jobId} ${target.agent} · ${target.label}`).join(", ")
        : params.all || params.jobId === undefined ? "none" : `#${params.jobId}`;
      const count = params.all || params.jobId === undefined ? deps.registry.cancelAll() : (deps.registry.cancel(params.jobId) ? 1 : 0);
      if (count === 0) {
        return {
          content: [{ type: "text", text: `subagent cancel ${targetText}: ${params.jobId === undefined ? "no subagents are running" : "no running subagent"}.` }],
          details: { count, targets },
        };
      }
      return {
        content: [{ type: "text", text: `Cancelling ${count} subagent${count > 1 ? "s" : ""}: ${targetText}.` }],
        details: { count, targets },
      };
    },
    renderCall(args, theme, _context) {
      const job = args.jobId === undefined ? undefined : deps.registry.get(args.jobId);
      const target = args.all || args.jobId === undefined ? "all" : job ? jobTarget(job) : `#${args.jobId}`;
      return new TruncatedText(theme.fg("toolTitle", theme.bold("subagent cancel ")) + theme.fg("accent", target), 0, 0);
    },
    renderResult(result, _options, theme, context) {
      const details = result.details;
      const args = context.args ?? {};
      const targetJob = args.jobId === undefined ? undefined : deps.registry.get(args.jobId);
      const target = args.all || args.jobId === undefined ? "all" : targetJob ? jobTarget(targetJob) : `#${args.jobId}`;
      if (
        context.isError ||
        !details ||
        typeof details.count !== "number" ||
        !Array.isArray(details.targets)
      ) {
        const box = new Container();
        if (!context.args) {
          box.addChild(new TruncatedText(
            theme.fg("toolTitle", theme.bold("subagent cancel ")) + theme.fg("accent", target),
            0,
            0,
          ));
        }
        box.addChild(new TruncatedText(theme.fg("muted", normalizeTitle(resultText(result)) ?? "No matching subagents."), 2, 0));
        return box;
      }
      if (details.count === 0) {
        if (context.args) {
          return new Text(theme.fg("muted", args.jobId === undefined ? "no subagents are running" : "no running subagent"), 0, 0);
        }
        const box = new Container();
        box.addChild(new TruncatedText(
          theme.fg("toolTitle", theme.bold("subagent cancel ")) + theme.fg("accent", target),
          0,
          0,
        ));
        box.addChild(new TruncatedText(theme.fg("muted", normalizeTitle(resultText(result)) ?? "no running subagents"), 2, 0));
        return box;
      }
      const box = new Container();
      box.addChild(new Text(
        theme.fg("warning", "⊘ ") + theme.fg("muted", `cancelling ${details.count} subagent${details.count > 1 ? "s" : ""}`),
        0,
        0,
      ));
      for (const item of details.targets) {
        if (details.count === 1 && details.targets.length === 1 && !args.all && targetJob && args.jobId === item.jobId && target === `#${item.jobId} ${item.agent} · ${item.label}`) continue;
        box.addChild(new TruncatedText(theme.fg("accent", `#${item.jobId} ${item.agent}`) + theme.fg("dim", ` · ${item.label}`), 2, 0));
      }
      return box;
    },
  };
}

export function createSendTool(deps: { registry: JobRegistry }): ToolDefinition<typeof SendParams, SendToolDetails> {
  return {
    name: "subagent_send",
    label: "Subagent Send",
    description: "Send a steering or follow-up message to a running subagent.",
    promptGuidelines: [
      "Use subagent_send only for running jobs. deliverAs must be \"steer\" to adjust the current run or \"followUp\" to queue another child turn.",
      "subagent_send does not answer ask_parent questions; use subagent_reply for those.",
    ],
    parameters: SendParams,
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      if (!params.message.trim()) throw new Error("Subagent message cannot be empty.");
      const job = deps.registry.get(params.jobId);
      await deps.registry.send(params.jobId, params.message, params.deliverAs);
      const mode = params.deliverAs === "followUp" ? "follow-up" : "steering";
      const target = job ? jobTarget(job) : `#${params.jobId}`;
      return {
        content: [{ type: "text", text: `Sent ${mode} message to subagent ${target}.` }],
        details: {
          jobId: params.jobId,
          agent: job?.agent ?? "subagent",
          task: job?.task,
          title: job?.title,
          label: job ? jobLabel(job, Infinity) : "(task unavailable)",
          message: params.message,
          deliverAs: params.deliverAs,
        },
      };
    },
    renderCall(args, theme, _context) {
      const job = deps.registry.get(args.jobId);
      const mode = args.deliverAs === "followUp" ? "follow-up" : "steering";
      const target = job ? jobTarget(job) : `#${args.jobId}`;
      const box = new Container();
      box.addChild(new TruncatedText(
        theme.fg("toolTitle", theme.bold("subagent send ")) +
          theme.fg("accent", target) +
          theme.fg("muted", ` · ${mode}`),
        0,
        0,
      ));
      box.addChild(new TruncatedText(theme.fg("dim", normalizeTitle(args.message) ?? ""), 2, 0));
      return box;
    },
    renderResult(result, _options, theme, context) {
      const details = result.details;
      const args = context.args ?? {};
      const job = args.jobId === undefined ? undefined : deps.registry.get(args.jobId);
      const targetInCall = job ? jobTarget(job) : `#${args.jobId ?? "?"}`;
      const target = details && typeof details.jobId === "number"
        ? `#${details.jobId} ${details.agent ?? job?.agent ?? "subagent"} · ${details.label ?? jobLabel(job ?? { title: undefined, task: "..." }, Infinity)}`
        : targetInCall;
      if (
        context.isError ||
        !details ||
        typeof details.jobId !== "number" ||
        typeof details.agent !== "string" ||
        typeof details.label !== "string" ||
        (details.deliverAs !== "steer" && details.deliverAs !== "followUp")
      ) {
        const box = new Container();
        if (!context.args || target !== targetInCall) {
          box.addChild(new TruncatedText(
            theme.fg("toolTitle", theme.bold("subagent send ")) + theme.fg("accent", target),
            0,
            0,
          ));
        }
        box.addChild(new TruncatedText(theme.fg("muted", normalizeTitle(resultText(result)) ?? "(no result)"), 2, 0));
        return box;
      }
      return new TruncatedText(
        theme.fg("success", "✓ ") +
          theme.fg("muted", target === targetInCall ? "delivered" : "delivered to ") +
          (target === targetInCall ? "" : theme.fg("accent", target)),
        0,
        0,
      );
    },
  };
}

export function createReplyTool(deps: { registry: JobRegistry }): ToolDefinition<typeof ReplyParams, ReplyToolDetails> {
  return {
    name: "subagent_reply",
    label: "Subagent Reply",
    description: "Answer one pending question from a running subagent.",
    promptGuidelines: [
      "When a subagent question arrives, answer it with subagent_reply. If user direction is needed, call ask_user first and relay the answer.",
    ],
    parameters: ReplyParams,
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      if (!params.answer.trim()) throw new Error("Subagent reply cannot be empty.");
      const question = deps.registry.get(params.jobId)?.pendingQuestions.find((item) => item.id === params.questionId);
      await deps.registry.reply(params.jobId, params.questionId, params.answer);
      const targetJob = deps.registry.get(params.jobId);
      const target = targetJob ? jobTarget(targetJob) : `#${params.jobId}`;
      return {
        content: [{ type: "text", text: `Answered subagent ${target}.` }],
        details: {
          jobId: params.jobId,
          agent: targetJob?.agent,
          task: targetJob?.task,
          title: targetJob?.title,
          questionId: params.questionId,
          question: question?.question ?? "(question unavailable)",
          answer: params.answer,
        },
      };
    },
    renderCall(args, theme, _context) {
      const job = deps.registry.get(args.jobId);
      const target = job ? jobTarget(job) : `#${args.jobId}`;
      return new TruncatedText(
        theme.fg("toolTitle", theme.bold("subagent reply ")) + theme.fg("accent", target),
        0,
        0,
      );
    },
    renderResult(result, _options, theme, context) {
      const details = result.details;
      const args = context.args ?? {};
      const job = args.jobId === undefined ? undefined : deps.registry.get(args.jobId);
      const targetInCall = job ? jobTarget(job) : `#${args.jobId ?? "?"}`;
      const target = details && typeof details.jobId === "number"
        ? `#${details.jobId} ${details.agent ?? job?.agent ?? "subagent"}${details.title || details.task ? ` · ${shortLabel(normalizeTitle(details.title), normalizeTitle(details.task), Infinity)}` : ""}`
        : targetInCall;
      if (
        context.isError ||
        !details ||
        typeof details.jobId !== "number" ||
        typeof details.question !== "string" ||
        typeof details.answer !== "string"
      ) {
        const box = new Container();
        if (!context.args || target !== targetInCall) {
          box.addChild(new TruncatedText(
            theme.fg("toolTitle", theme.bold("subagent reply ")) + theme.fg("accent", target),
            0,
            0,
          ));
        }
        box.addChild(new TruncatedText(theme.fg("muted", normalizeTitle(resultText(result)) ?? "(no result)"), 2, 0));
        return box;
      }
      const question = normalizeTitle(details.question) ?? "(question unavailable)";
      const answer = normalizeTitle(details.answer) ?? "(empty)";
      const box = new Container();
      box.addChild(new TruncatedText(
        theme.fg("success", "✓ ") + theme.fg("muted", "answered") +
          (target === targetInCall ? "" : theme.fg("muted", " · ") + theme.fg("accent", target)),
        0,
        0,
      ));
      box.addChild(new TruncatedText(theme.fg("muted", "Q: ") + theme.fg("dim", question), 2, 0));
      box.addChild(new TruncatedText(theme.fg("muted", "A: ") + theme.fg("dim", answer), 2, 0));
      return box;
    },
  };
}

interface ProfileCommandDeps {
  settings: SubagentSettings;
  getActiveProfile: () => string | undefined;
  setActiveProfile: (name: string) => void;
  /** True while the session still needs a profile choice before subagents run. */
  needsConfirmation?: () => boolean;
}

async function chooseProfile(
  pi: ExtensionAPI,
  profiles: ProfileCommandDeps,
  ctx: ExtensionContext,
): Promise<string | undefined> {
  const names = Object.keys(profiles.settings.profiles);
  const current = profiles.getActiveProfile() ?? "none";
  const options = [...names];
  const selected = await ctx.ui.select(`Subagent profile (active: ${current})`, options);
  if (!selected) return undefined;
  const name = names[options.indexOf(selected)] ?? "";
  if (!profiles.settings.profiles[name]) {
    if (ctx.hasUI) ctx.ui.notify(`Unknown subagent profile "${name}". Available: ${names.join(", ")}`, "error");
    return undefined;
  }
  profiles.setActiveProfile(name);
  pi.appendEntry(PROFILE_ENTRY_TYPE, { name });
  if (ctx.hasUI) ctx.ui.notify(`Subagent profile switched to ${name}. New jobs will use it.`, "info");
  return name;
}

/**
 * Pauses the first subagent launch of a session for a profile choice when more
 * than one profile is configured. Returns false when the user cancels.
 */
export async function confirmSubagentProfile(
  pi: ExtensionAPI,
  profiles: ProfileCommandDeps,
  ctx: ExtensionContext,
  onPause?: (message: string) => void,
): Promise<boolean> {
  const names = Object.keys(profiles.settings.profiles);
  if (names.length <= 1 || !profiles.needsConfirmation?.()) return true;
  if (ctx.mode !== "tui" || !ctx.hasUI) return true;
  onPause?.("Paused: waiting for subagent profile selection");
  return (await chooseProfile(pi, profiles, ctx)) !== undefined;
}

function pickerLabel(job: Job): string {
  const label = `#${job.id} ${job.agent} [${job.status}] · ${shortLabel(job.title, job.task, Infinity)}`;
  return shortLabel(undefined, label, Math.max(1, (process.stdout.columns ?? 80) - 4));
}

async function pickJob(
  ctx: ExtensionContext,
  jobs: Job[],
  prompt: string,
  emptyMessage: string,
): Promise<Job | undefined> {
  if (jobs.length === 0) {
    ctx.ui.notify(emptyMessage, "info");
    return undefined;
  }
  const options = jobs.map(pickerLabel);
  const selected = await ctx.ui.select(prompt, options);
  if (!selected) return undefined;
  return jobs[options.indexOf(selected)];
}

export function registerStatusCommands(
  pi: ExtensionAPI,
  deps: { registry: JobRegistry; activeProcs?: unknown; profiles?: ProfileCommandDeps },
): void {
  const switchProfile = async (requested: string, ctx: ExtensionContext): Promise<void> => {
    const profiles = deps.profiles;
    if (!profiles) return;
    const names = Object.keys(profiles.settings.profiles);
    const current = profiles.getActiveProfile() ?? "none";
    const name = requested.trim();
    if (!name) {
      if (ctx.mode !== "tui" || names.length <= 1) {
        if (ctx.hasUI) ctx.ui.notify(`Active subagent profile: ${current}. Available: ${names.join(", ") || "none"}`, "info");
        return;
      }
      await chooseProfile(pi, profiles, ctx);
      return;
    }
    if (!profiles.settings.profiles[name]) {
      if (ctx.hasUI) ctx.ui.notify(`Unknown subagent profile "${name}". Available: ${names.join(", ")}`, "error");
      return;
    }
    profiles.setActiveProfile(name);
    pi.appendEntry(PROFILE_ENTRY_TYPE, { name });
    if (ctx.hasUI) ctx.ui.notify(`Subagent profile switched to ${name}. New jobs will use it.`, "info");
  };

  pi.registerCommand("subagent-profile", {
    description: "Show or switch the active subagent profile",
    handler: (args, ctx) => switchProfile(args, ctx),
  });

  if (deps.profiles) {
    pi.registerShortcut("ctrl+shift+l", {
      description: "Open the subagent profile picker",
      handler: (ctx) => switchProfile("", ctx),
    });
  }

  pi.registerCommand("subagent-tail", {
    description: "Open a live event tail for a subagent by ID",
    handler: async (args, ctx) => {
      if (ctx.mode !== "tui" || !ctx.hasUI) {
        if (ctx.hasUI) ctx.ui.notify("/subagent-tail requires interactive mode", "error");
        return;
      }
      const value = args.trim();
      let jobId: number;
      if (!value) {
        const job = await pickJob(ctx, [...deps.registry.running(), ...deps.registry.recent(20)], "Tail subagent", "No subagents are available.");
        if (!job) return;
        jobId = job.id;
      } else {
        jobId = Number(value);
        if (!/^\d+$/.test(value) || !Number.isSafeInteger(jobId) || jobId < 1) {
          ctx.ui.notify("Usage: /subagent-tail <numeric-job-id>", "error");
          return;
        }
        if (!deps.registry.get(jobId)) {
          ctx.ui.notify(`Unknown subagent job ID: ${jobId}`, "error");
          return;
        }
      }
      await openSubagentTail(ctx.ui, deps.registry, jobId);
    },
  });

  pi.registerCommand("subagent-status", {
    description: "Show running and recent subagent status or inspect a job by ID",
    handler: async (args, ctx) => {
      if (!ctx.hasUI) return;
      const trimmed = args.trim();
      if (!trimmed) {
        if (ctx.mode !== "tui") {
          ctx.ui.notify(formatStatus(deps.registry), "info");
          return;
        }
        const job = await pickJob(ctx, [...deps.registry.running(), ...deps.registry.recent(20)], "Inspect subagent status", "No subagents are available.");
        if (!job) return;
        ctx.ui.notify(formatStatusForDisplay(deps.registry, job.id), "info");
        return;
      }
      if (trimmed.toLowerCase() === "all") {
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
      if (!value) {
        if (ctx.mode !== "tui" || !ctx.hasUI) {
          if (ctx.hasUI) ctx.ui.notify("Usage: /subagent-cancel <numeric-job-id|all>", "error");
          return;
        }
        const job = await pickJob(ctx, deps.registry.running(), "Cancel subagent", "No running subagents are available.");
        if (!job) return;
        const count = deps.registry.cancel(job.id);
        ctx.ui.notify(count ? `Cancelling subagent #${job.id} ${job.agent}.` : "No matching running subagent", "info");
        return;
      }
      if (value !== "all" && (!/^\d+$/.test(value) || Number(value) < 1)) {
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
      const raw = args.trim();
      let jobId: number;
      let mode: string | undefined;
      let message: string | undefined;
      if (!raw) {
        if (ctx.mode !== "tui") {
          ctx.ui.notify("Usage: /subagent-send <numeric-job-id> <steer|followup> <message>", "error");
          return;
        }
        const job = await pickJob(ctx, deps.registry.running(), "Send to subagent", "No running subagents are available.");
        if (!job) return;
        jobId = job.id;
        const selectedMode = await ctx.ui.select("Message mode", ["steering", "follow-up"]);
        if (!selectedMode) return;
        mode = selectedMode === "steering" ? "steer" : "followup";
        message = (await ctx.ui.input(
          `${selectedMode} message for #${job.id} ${job.agent}`,
          "Enter a message",
        ))?.trim();
        if (!message) return;
      } else {
        const match = raw.match(/^(\d+)\s+(\S+)(?:\s+([\s\S]*))?$/);
        mode = match?.[2]?.toLowerCase();
        message = match?.[3]?.trim();
        if (!match || !message || (mode !== "steer" && mode !== "followup")) {
          ctx.ui.notify("Usage: /subagent-send <numeric-job-id> <steer|followup> <message>", "error");
          return;
        }
        jobId = Number(match[1]);
      }
      if (!Number.isInteger(jobId) || jobId < 1) {
        ctx.ui.notify("Usage: /subagent-send <numeric-job-id> <steer|followup> <message>", "error");
        return;
      }
      const deliverAs = mode === "steer" ? "steer" : "followUp";
      try {
        await deps.registry.send(jobId, message, deliverAs);
        ctx.ui.notify(`Sent ${mode === "steer" ? "steering" : "follow-up"} message to subagent #${jobId}.`, "info");
      } catch (error) {
        const job = deps.registry.get(jobId);
        const target = job ? jobTarget(job) : `#${jobId}`;
        const reason = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`subagent send ${target}: ${reason}`, "error");
      }
    },
  });
}

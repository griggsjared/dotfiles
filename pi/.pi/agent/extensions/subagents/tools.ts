import { spawn, type ChildProcess } from "node:child_process";
import { Text } from "@earendil-works/pi-tui";
import type {
  ExtensionAPI,
  ExtensionContext,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import { resolveAgentSettings, type AgentConfig, type SubagentSettings } from "./agents.ts";
import { capOutput, formatDuration, formatResultOutput, normalizeTitle, shortLabel } from "./format.ts";
import type { Job, JobRegistry } from "./registry.ts";
import { formatModel, runSubagent, runWithConcurrencyLimit } from "./runner.ts";
import {
  ENTRY_TYPE,
  QUESTION_ENTRY_TYPE,
  type SubagentMessageDetails,
  type SubagentQuestion,
  type SubagentQuestionMessageDetails,
  type SubagentResult,
  type SubagentToolDetails,
} from "./types.ts";

const MAX_PARALLEL = 8;
const DEFAULT_CONCURRENCY = 3;
const MAX_QUESTION_SUMMARY = 500;

function questionSummary(question: SubagentQuestion): string {
  const flattened = question.question.replace(/\s+/g, " ").trim();
  return flattened.length > MAX_QUESTION_SUMMARY
    ? `${flattened.slice(0, MAX_QUESTION_SUMMARY - 1)}…`
    : flattened;
}

const TaskItem = Type.Object({
  agent: Type.String({ description: "Agent name to invoke" }),
  task: Type.String({ description: "Task to delegate to the agent" }),
  title: Type.Optional(Type.String({ description: "Short display title for results and history" })),
});

const SubagentParams = Type.Object({
  agent: Type.Optional(Type.String({
    description: "Agent name to invoke (single mode)",
  })),
  task: Type.Optional(Type.String({
    description: "Task to delegate (single mode)",
  })),
  title: Type.Optional(Type.String({
    description: "Short display title for results and history (single mode)",
  })),
  tasks: Type.Optional(Type.Array(TaskItem, {
    description: "Array of tasks to run in parallel",
    minItems: 1,
  })),
  concurrency: Type.Optional(Type.Integer({
    minimum: 1,
    maximum: MAX_PARALLEL,
    default: DEFAULT_CONCURRENCY,
    description: "Maximum number of parallel tasks",
  })),
});

type SubagentParamsType = Static<typeof SubagentParams>;
type TaskItemType = Static<typeof TaskItem>;

interface SingleRequest {
  agent: string;
  task: string;
  title?: string;
}

type Mode =
  | { single: SingleRequest; tasks?: never }
  | { single?: never; tasks: TaskItemType[] };

export function resolveMode(params: SubagentParamsType): Mode {
  const single = params.agent && params.task
    ? { agent: params.agent, task: params.task, title: params.title }
    : undefined;
  const tasks = params.tasks;
  if (tasks && tasks.length === 0) {
    throw new Error("tasks[] must contain at least one task");
  }
  if (single && tasks) {
    throw new Error("Provide exactly one mode: either agent+task (single) or tasks[] (parallel).");
  }
  if (single) return { single };
  if (tasks) return { tasks };
  throw new Error("Provide exactly one mode: either agent+task (single) or tasks[] (parallel).");
}

function failedResult(
  agent: string,
  task: string,
  title: string | undefined,
  err: unknown,
  metadata?: Pick<AgentConfig, "model" | "thinkingLevel">,
): SubagentResult {
  return {
    agent,
    task,
    title,
    text: "",
    exitCode: 1,
    error: String(err),
    model: metadata?.model,
    thinkingLevel: metadata?.thinkingLevel,
  };
}

function cancelledResult(
  agent: string,
  task: string,
  title: string | undefined,
  reason: NonNullable<Job["cancellationReason"]>,
  metadata?: Pick<AgentConfig, "model" | "thinkingLevel">,
): SubagentResult {
  return {
    agent,
    task,
    title,
    text: "",
    exitCode: 130,
    error: `Cancelled (${reason}).`,
    cancelled: true,
    cancellationReason: reason,
    model: metadata?.model,
    thinkingLevel: metadata?.thinkingLevel,
  };
}

function normalizeCancellation(result: SubagentResult, job: Job | undefined): SubagentResult {
  const reason = job?.cancellationReason;
  if (!reason) return result;
  return { ...result, exitCode: 130, error: `Cancelled (${reason}).`, cancelled: true, cancellationReason: reason };
}

function startTicker(tickers: Set<ReturnType<typeof setInterval>>, fn: () => void): () => void {
  const id = setInterval(fn, 1000);
  tickers.add(id);
  return () => {
    clearInterval(id);
    tickers.delete(id);
  };
}

function buildGuidelines(agents: AgentConfig[]): string[] {
  const agentGuidance = agents.length > 0
    ? `Use the subagent tool with these available agents: ${agents.map((agent) => `${agent.name} (${agent.description || "no description"})`).join("; ")}.`
    : "Use the subagent tool with an available agent discovered from the agents directory.";
  return [
    agentGuidance,
    "Launch results include job IDs; use those IDs with subagent_peek, subagent_send, subagent_cancel, and subagent_reply instead of calling subagent_status just to discover them.",
    "Use the reviewer agent only for explicit user requests to review code or changes, or for clearly broad/high-risk changes where independent verification is warranted; do not use it merely because implementation finished or a commit was requested. Tell the reviewer to use the peer-review skill when available; use scout for general exploration or investigation.",
    "For broad/high-risk reviews, use parallel read-only reviewers with separate lenses (for example lifecycle/races, API/UX, and tests/regressions) only when the scope justifies it; otherwise use one reviewer and synthesize its findings.",
    "For tasks spanning multiple independent concerns or more than three files, split the work into parallel, non-overlapping subagent tasks; assign explicit file ownership and use an integration pass for shared APIs.",
    "Do not split tightly coupled changes or small tasks; avoid having multiple workers edit the same files.",
    "For substantial or broad exploration across multiple files or directories, use the scout agent; handle routine small investigations directly.",
    "Subagent jobs are always asynchronous: launch them, then end your turn or continue with independent work; results arrive as follow-up messages.",
    "The subagent tool returns immediately; do not block or poll for normal completion.",
    "After launching subagents, the parent does not need to keep working for the sake of working. It may end its turn and wait for their follow-up results; continue only when there is useful independent work, and never sleep or poll for results.",
    "Use subagent_status only when you need a snapshot of running or recent subagents; completion is automatic, so do not poll for it.",
    "Use subagent_cancel with a jobId or all, or /subagent-cancel <id|all>, when running subagents are stalled or no longer needed; cancellation stops the selected jobs.",
    "When a subagent asks a question, answer it with subagent_reply. Call ask_user first when the decision belongs to the user, then relay that answer to the child.",
    "Use subagent_send to steer a running child or queue a follow-up. It cannot answer a pending ask_parent question; use subagent_reply for that.",
    "Messages work only while a child is running; completed subagents are not resumable.",
    "Give each subagent a clear, self-contained task. Keep tasks scoped so they finish quickly.",
    "Pass a short display title for each task; it is used in results, the widget, and history.",
    "For delegated research or exploration, act as the orchestrator: do not duplicate an async subagent's investigation. If you continue working while it runs, do only independent, non-overlapping work; otherwise end the turn and use its result when it arrives to decide the next step.",
  ];
}

interface BatchDeps {
  pi: ExtensionAPI;
  registry: JobRegistry;
  refresh: () => void;
}

/**
 * Per-invocation bookkeeping for a subagent batch: which job ids belong to it,
 * which completed, and when the last one finishes, a summary message that
 * triggers a new turn. Scoped per batch so overlapping invocations can't
 * suppress each other's summary.
 */
export class Batch {
  private readonly jobIds = new Set<number>();
  private readonly completed: Job[] = [];
  private pending = 0;
  private readonly deps: BatchDeps;

  constructor(deps: BatchDeps) {
    this.deps = deps;
  }

  addJob(jobId: number): void {
    this.jobIds.add(jobId);
    this.pending += 1;
  }

  recordCompletion(jobId: number): void {
    const job = this.deps.registry.jobs.get(jobId);
    if (job) this.completed.push({ ...job });
  }

  deliverResult(jobId: number, result: SubagentResult): void {
    const job = this.deps.registry.jobs.get(jobId);
    result = normalizeCancellation(result, job);
    const capped = capOutput(formatResultOutput(result), 20000);
    const duration = job?.endTime ? formatDuration(job.endTime - job.startTime) : "?";
    const status = result.cancelled ? "cancelled" : result.exitCode === 0 ? "completed" : "failed";
    const icon = status === "completed" ? "✓" : status === "cancelled" ? "⊘" : "✗";
    const details: SubagentMessageDetails = {
      jobId,
      agent: result.agent,
      task: result.task,
      title: result.title,
      status,
      duration,
      icon,
      usage: result.usage,
      toolCalls: result.toolCalls,
      model: result.model,
      thinkingLevel: result.thinkingLevel,
      cancellationReason: result.cancellationReason,
    };
    try {
      this.deps.pi.sendMessage(
        { customType: ENTRY_TYPE, content: capped, display: true, details },
        { deliverAs: "steer" },
      );
    } catch (err) {
      console.error("subagents: failed to deliver result message", err);
    }
  }

  deliverQuestion(jobId: number, question: SubagentQuestion): void {
    const job = this.deps.registry.get(jobId);
    if (!job) return;
    const details: SubagentQuestionMessageDetails = {
      jobId,
      agent: job.agent,
      questionId: question.id,
      question: question.question,
      context: question.context,
    };
    const lines = [
      `Subagent #${jobId} ${job.agent} asks:`,
      question.question,
      ...(question.context ? [`Context: ${question.context}`] : []),
      `Reply with subagent_reply using jobId ${jobId} and questionId "${question.id}". If the decision belongs to the user, call ask_user first and relay the answer.`,
    ];
    try {
      this.deps.pi.sendMessage(
        { customType: QUESTION_ENTRY_TYPE, content: lines.join("\n\n"), display: true, details },
        { deliverAs: "steer", triggerTurn: true },
      );
    } catch (err) {
      console.error("subagents: failed to deliver parent question", err);
    }
  }

  sendError(
    agent: string,
    task: string,
    title: string | undefined,
    err: unknown,
    metadata?: Pick<AgentConfig, "model" | "thinkingLevel">,
    jobId?: number,
  ): void {
    const details: SubagentMessageDetails = {
      jobId,
      agent,
      task,
      title,
      status: "failed",
      duration: "?",
      icon: "✗",
      model: metadata?.model,
      thinkingLevel: metadata?.thinkingLevel,
    };
    try {
      this.deps.pi.sendMessage(
        { customType: ENTRY_TYPE, content: `Error: ${String(err)}`, display: true, details },
        { deliverAs: "steer" },
      );
    } catch (sendErr) {
      console.error("subagents: failed to deliver error message", sendErr);
    }
  }

  /** Fires once when this batch's last job finishes, and triggers a turn. */
  summary(): void {
    this.pending -= 1;
    if (this.pending !== 0) return;
    if (this.completed.length === 0) return;
    const lines = this.completed.map((j) => {
      const duration = j.endTime ? formatDuration(j.endTime - j.startTime) : "?";
      const icon = j.status === "completed" ? "✓" : j.status === "cancelled" ? "⊘" : "✗";
      const cancellation = j.status === "cancelled" && j.cancellationReason
        ? ` — cancelled (${j.cancellationReason})`
        : "";
      return `${icon} #${j.id} ${j.agent} (${duration}): ${j.title ?? j.task}${cancellation}`;
    });
    lines.unshift("**Subagents complete:**");
    this.deps.registry.markCleared(this.jobIds);
    this.deps.refresh();
    try {
      this.deps.pi.sendMessage(
        { customType: ENTRY_TYPE, content: lines.join("\n"), display: false },
        { triggerTurn: true, deliverAs: "steer" },
      );
    } catch (err) {
      console.error("subagents: failed to send batch summary", err);
    }
  }
}

export interface SubagentToolDeps {
  pi: ExtensionAPI;
  /** Agents discovered at load time; used for the prompt guidelines roster. */
  agents: AgentConfig[];
  /** Machine-local settings loaded when the extension initializes. */
  settings: SubagentSettings;
  /** Re-discovered on every execute so agent file edits take effect immediately. */
  discover: () => Promise<AgentConfig[]>;
  registry: JobRegistry;
  activeProcs?: Set<ChildProcess>; // retained for dependency compatibility; cancellation is registry-scoped
  activeTickers: Set<ReturnType<typeof setInterval>>;
  onUiContext: (ctx: ExtensionContext) => void;
  refresh: (ctx: ExtensionContext) => void;
  bridgeExtensionPath: string;
  /** Test seam: replaces the real child-process spawner. */
  spawnFn?: typeof spawn;
}

export function createSubagentTool(deps: SubagentToolDeps): ToolDefinition<typeof SubagentParams, SubagentToolDetails> {
  return {
    name: "subagent",
    label: "Subagent",
    description: "Delegate work to specialized subagents. Jobs always run asynchronously and deliver their results as follow-up messages.",
    parameters: SubagentParams,
    promptGuidelines: buildGuidelines(deps.agents),

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const defaultModel = formatModel(ctx.model);
      const parentThinkingLevel = ctx.thinkingLevel;
      const agents = (await deps.discover()).map((agent) => {
        const resolved = resolveAgentSettings(agent, deps.settings);
        return {
          ...resolved,
          model: resolved.model ?? defaultModel,
          thinkingLevel: resolved.thinkingLevel ?? parentThinkingLevel,
        };
      });
      const { registry, activeTickers } = deps;
      const agentByName = new Map(agents.map((a) => [a.name, a]));
      const available = agents.map((a) => a.name).join(", ") || "none";
      const mode = resolveMode(params);
      deps.onUiContext(ctx);
      const refresh = () => deps.refresh(ctx);
      const batch = new Batch({ pi: deps.pi, registry, refresh });
      const notifyTerminal = (
        jobId: number,
        agent: string,
        task: string,
        title: string | undefined,
        result: SubagentResult,
      ): void => {
        if (!result.cancelled && result.exitCode === 0) return;
        const label = shortLabel(normalizeTitle(title), normalizeTitle(task), 60);
        const reason = result.cancelled && result.cancellationReason
          ? `cancelled (${result.cancellationReason})`
          : `failed: ${shortLabel(undefined, normalizeTitle(result.error), 80)}`;
        try {
          if (!ctx.hasUI) return;
          ctx.ui.notify(
            `#${jobId} ${agent}: ${label} — ${reason}`,
            result.cancelled ? "warning" : "error",
          );
        } catch { /* session torn down mid-run */ }
      };

      // Launch one job: stream updates into the registry, then complete it.
      // Failures are returned as failed results, except spawn-level failures
      // which reject and are recorded here.
      const launchOne = async (agent: AgentConfig, task: string, jobId: number, title?: string): Promise<SubagentResult> => {
        try {
          // A cancelled job may have been waiting for a concurrency slot. Do
          // not spawn it just to discover the cancellation after launch.
          const cancellationReason = registry.get(jobId)?.cancellationReason;
          if (cancellationReason) {
            const result = cancelledResult(agent.name, task, title, cancellationReason, agent);
            registry.complete(jobId, result);
            batch.recordCompletion(jobId);
            notifyTerminal(jobId, agent.name, task, title, result);
            return result;
          }
          const launched = await runSubagent(agent, task, ctx.cwd, defaultModel, {
            thinkingLevel: agent.thinkingLevel,
            title,
            bridgeExtensionPath: deps.bridgeExtensionPath,
            spawnFn: deps.spawnFn,
            onEvent: (event) => {
              registry.appendEvent(jobId, event);
            },
            onQuestion: (question) => {
              if (!registry.recordQuestion(jobId, question)) return;
              registry.appendEvent(jobId, { kind: "question", summary: `question: ${questionSummary(question)}` });
              batch.deliverQuestion(jobId, question);
              refresh();
            },
            onUpdate: (update) => {
              registry.updateLive(jobId, {
                text: update.text || undefined,
                progress: update.progress,
                usage: update.usage,
                toolCalls: update.toolCalls,
                model: update.model,
                thinkingLevel: update.thinkingLevel,
              });
              refresh();
            },
          });
          registry.registerControl(jobId, launched);
          let subagentResult = await launched.result;
          registry.complete(jobId, subagentResult);
          subagentResult = normalizeCancellation(subagentResult, registry.jobs.get(jobId));
          // Cancellation may race the child's final close/update. The registry
          // reason is authoritative for every downstream representation.
          refresh();
          notifyTerminal(jobId, agent.name, task, title, subagentResult);
          batch.recordCompletion(jobId);
          return subagentResult;
        } catch (err) {
          const cancellationReason = registry.get(jobId)?.cancellationReason;
          if (cancellationReason) {
            const result = cancelledResult(agent.name, task, title, cancellationReason, agent);
            registry.complete(jobId, result);
            batch.recordCompletion(jobId);
            refresh();
            notifyTerminal(jobId, agent.name, task, title, result);
            return result;
          }
          const result = failedResult(agent.name, task, title, err, agent);
          registry.complete(jobId, result);
          batch.recordCompletion(jobId);
          refresh();
          notifyTerminal(jobId, agent.name, task, title, result);
          throw err;
        }
      };

      if (mode.single) {
        const { single } = mode;
        const agent = agentByName.get(single.agent);
        if (!agent) {
          throw new Error(`Unknown agent "${single.agent}". Available agents: ${available}`);
        }

        const jobId = registry.add(agent.name, single.task, single.title, agent);
        batch.addJob(jobId);
        refresh();
        const stopTicker = startTicker(activeTickers, refresh);
        launchOne(agent, single.task, jobId, single.title)
          .then((r) => {
            stopTicker();
            batch.deliverResult(jobId, r);
            batch.summary();
          })
          .catch((err) => {
            stopTicker();
            const cancellationReason = registry.get(jobId)?.cancellationReason;
            if (cancellationReason) {
              const result = cancelledResult(agent.name, single.task, single.title, cancellationReason, agent);
              registry.complete(jobId, result);
              batch.recordCompletion(jobId);
              batch.deliverResult(jobId, result);
            } else {
              batch.sendError(agent.name, single.task, single.title, err, agent, jobId);
            }
            batch.summary();
          });

        // Results are delivered later via sendMessage with the custom renderer.
        return {
          content: [{ type: "text", text: `Launched **${agent.name}** subagent #${jobId}: "${single.title ?? single.task}"` }],
          details: { agent: agent.name, status: "launched", jobIds: [jobId], jobScope: registry.scope },
        };
      }

      const tasks = mode.tasks;
      const unknownCount = tasks.filter((t) => !agentByName.has(t.agent)).length;
      if (unknownCount === tasks.length) {
        throw new Error(`Unknown agent(s): ${[...new Set(tasks.map((t) => t.agent))].join(", ")}`);
      }
      const concurrency = Math.min(
        Math.max(1, params.concurrency ?? DEFAULT_CONCURRENCY),
        MAX_PARALLEL,
      );

      const jobIds = tasks.map((t) => {
        const id = registry.add(t.agent, t.task, t.title, agentByName.get(t.agent));
        batch.addJob(id);
        return id;
      });
      refresh();
      const stopTicker = startTicker(activeTickers, refresh);

      const runWithAgent = async (task: TaskItemType, index: number): Promise<void> => {
        const jobId = jobIds[index];
        if (jobId === undefined) return; // unreachable: index is bounded by the concurrency loop
        const agent = agentByName.get(task.agent);
        if (!agent) {
          const cancellationReason = registry.get(jobId)?.cancellationReason;
          const result = cancellationReason
            ? cancelledResult(task.agent, task.task, task.title, cancellationReason)
            : failedResult(
              task.agent,
              task.task,
              task.title,
              `Unknown agent "${task.agent}". Available: ${available}`,
            );
          registry.complete(jobId, result);
          batch.recordCompletion(jobId);
          refresh();
          batch.deliverResult(jobId, result);
          batch.summary();
          return;
        }
        try {
          const result = await launchOne(agent, task.task, jobId, task.title);
          batch.deliverResult(jobId, result);
          batch.summary();
        } catch (err) {
          const cancellationReason = registry.get(jobId)?.cancellationReason;
          const result = cancellationReason
            ? cancelledResult(task.agent, task.task, task.title, cancellationReason, agent)
            : failedResult(task.agent, task.task, task.title, err, agent);
          if (cancellationReason) {
            registry.complete(jobId, result);
            batch.recordCompletion(jobId);
            batch.deliverResult(jobId, result);
          } else {
            batch.sendError(task.agent, task.task, task.title, err, agent, jobId);
          }
          batch.summary();
        }
      };

      runWithConcurrencyLimit(tasks, concurrency, runWithAgent)
        .finally(stopTicker)
        .catch((err) => console.error("subagents: batch execution failed", err));

      const skipped = unknownCount > 0 ? `, ${unknownCount} skipped (unknown agent)` : "";
      const launchedLines = tasks.map((task, index) => `- #${jobIds[index]} ${task.agent}: "${task.title ?? task.task}"`);
      return {
        content: [{ type: "text", text: `Launched ${tasks.length - unknownCount} subagents in parallel${skipped}:\n${launchedLines.join("\n")}` }],
        details: {
          count: tasks.length - unknownCount,
          skipped: unknownCount,
          status: "launched",
          jobIds,
          jobScope: registry.scope,
        },
      };
    },

    renderCall(args, theme, _context) {
      if (args.tasks && args.tasks.length > 0) {
        let text =
          theme.fg("toolTitle", theme.bold("subagent ")) +
          theme.fg("accent", `parallel (${args.tasks.length} tasks)`) +
          theme.fg("muted", ` [concurrency ${args.concurrency ?? DEFAULT_CONCURRENCY}]`);
        for (const task of args.tasks.slice(0, 8)) {
          const title = normalizeTitle(task.title);
          const preview = title ? title : shortLabel(undefined, task.task, 60);
          text += `\n  ${theme.fg("accent", task.agent)}${theme.fg("dim", ` · ${preview}`)}`;
        }
        if (args.tasks.length > 8) text += `\n  ${theme.fg("muted", `… +${args.tasks.length - 8} more`)}`;
        return new Text(text, 0, 0);
      }
      const agentName = args.agent || "...";
      const preview = normalizeTitle(args.title) || shortLabel(undefined, args.task, 60);
      return new Text(
        theme.fg("toolTitle", theme.bold("subagent ")) +
          theme.fg("accent", agentName) +
          `\n  ${theme.fg("dim", preview)}`,
        0,
        0,
      );
    },

    renderResult(result, _options, theme, _context) {
      const rawSummary = result.content[0]?.type === "text" ? result.content[0].text : "(no output)";
      const summary = capOutput(rawSummary ?? "(no output)", 500);
      const status = result.details?.status;
      if (status === "launched" || result.details?.jobIds?.length) return new Text("", 0, 0);
      const failed = status === "failed";
      const cancelled = status === "cancelled";
      return new Text(
        theme.fg("toolTitle", theme.bold("subagent ")) +
          theme.fg(cancelled ? "warning" : failed ? "error" : "success", `${cancelled ? "⊘" : failed ? "✗" : "✓"} ${summary}`),
        0,
        0,
      );
    },
  };
}

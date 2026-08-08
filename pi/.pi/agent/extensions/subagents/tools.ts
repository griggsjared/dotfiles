import { spawn, type ChildProcess } from "node:child_process";
import { Text } from "@earendil-works/pi-tui";
import { StringEnum } from "@earendil-works/pi-ai";
import type {
  ExtensionAPI,
  ExtensionContext,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import { resolveAgentSettings, type AgentConfig, type SubagentSettings } from "./agents.ts";
import { capOutput, formatResultOutput, normalizeTitle, shortLabel } from "./format.ts";
import type { Job, JobRegistry } from "./registry.ts";
import { formatModel, runSubagent, runWithConcurrencyLimit } from "./runner.ts";
import {
  ENTRY_TYPE,
  type ExecutionMode,
  type SubagentMessageDetails,
  type SubagentResult,
  type SubagentToolDetails,
} from "./types.ts";

const MAX_PARALLEL = 8;
const DEFAULT_CONCURRENCY = 3;

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
  execution: Type.Optional(StringEnum(["async", "sync"] as const, {
    default: "async",
    description: "Async (default, preferred): return immediately; results arrive as follow-up messages. Sync: wait for the result before continuing",
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
    "For code reviews, tell the reviewer to use the peer-review skill when available.",
    "For ANY task requiring reading or exploring multiple files or directories — use a subagent. Do not do broad exploration yourself.",
    "Prefer execution:'async' (the default) for every subagent call: launch it, then end your turn or continue with independent work; results arrive as follow-up messages. Use execution:'sync' only when the very next step in this turn cannot be produced without the subagent's result — never to avoid ending the turn or because waiting inline feels more reliable.",
    "The subagent tool's async jobs return immediately and deliver results via follow-up messages; do not block or poll for them.",
    "After launching async subagents, the parent does not need to keep working for the sake of working. It may end its turn and wait for their follow-up results; continue only when there is useful independent work, and never sleep or poll for results.",
    "Use subagent_status only when you need a snapshot of running or recent subagents; async completion is automatic, so do not poll for normal completion.",
    "Use subagent_cancel or /cancel-subagents when running subagents are stalled or no longer needed; cancellation stops all running subagents.",
    "With the subagent tool, execution:'sync' on tasks[] waits for the whole batch; concurrency still controls how many children run at once.",
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
    const capped = capOutput(formatResultOutput(result), 20000);
    const job = this.deps.registry.jobs.get(jobId);
    const duration = job?.endTime ? `${((job.endTime - job.startTime) / 1000).toFixed(1)}s` : "?";
    const status = result.exitCode === 0 ? "completed" : "failed";
    const icon = status === "completed" ? "✓" : "✗";
    const details: SubagentMessageDetails = {
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

  sendError(
    agent: string,
    task: string,
    title: string | undefined,
    err: unknown,
    metadata?: Pick<AgentConfig, "model" | "thinkingLevel">,
  ): void {
    const details: SubagentMessageDetails = {
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
      const duration = j.endTime ? ((j.endTime - j.startTime) / 1000).toFixed(1) : "?";
      const icon = j.status === "completed" ? "✓" : "✗";
      return `${icon} ${j.agent} (${duration}s): ${j.title ?? j.task}`;
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

  markCleared(): void {
    this.deps.registry.markCleared(this.jobIds);
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
  activeProcs: Set<ChildProcess>;
  activeTickers: Set<ReturnType<typeof setInterval>>;
  onUiContext: (ctx: ExtensionContext) => void;
  refresh: (ctx: ExtensionContext) => void;
  /** Test seam: replaces the real child-process spawner. */
  spawnFn?: typeof spawn;
}

export function createSubagentTool(deps: SubagentToolDeps): ToolDefinition<typeof SubagentParams, SubagentToolDetails> {
  return {
    name: "subagent",
    label: "Subagent",
    description: "Delegate work to specialized subagents; prefer async (default), sync only when the result is needed before continuing.",
    parameters: SubagentParams,
    promptGuidelines: buildGuidelines(deps.agents),

    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
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
      const { registry, activeProcs, activeTickers } = deps;
      const agentByName = new Map(agents.map((a) => [a.name, a]));
      const available = agents.map((a) => a.name).join(", ") || "none";
      const execution: ExecutionMode = params.execution ?? "async";
      const mode = resolveMode(params);
      deps.onUiContext(ctx);
      const refresh = () => deps.refresh(ctx);
      const batch = new Batch({ pi: deps.pi, registry, refresh });

      // Launch one job: stream updates into the registry, then complete it.
      // Failures are returned as failed results, except spawn-level failures
      // which reject and are recorded here.
      const launchOne = async (agent: AgentConfig, task: string, jobId: number, title?: string): Promise<SubagentResult> => {
        let proc: ChildProcess | undefined;
        try {
          const launched = await runSubagent(agent, task, ctx.cwd, defaultModel, {
            signal,
            thinkingLevel: agent.thinkingLevel,
            title,
            spawnFn: deps.spawnFn,
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
          proc = launched.proc;
          activeProcs.add(proc);
          const subagentResult = await launched.result;
          activeProcs.delete(proc);
          registry.complete(jobId, subagentResult);
          refresh();
          try {
            if (ctx.hasUI) {
              const status = subagentResult.exitCode === 0 ? "completed" : "failed";
              ctx.ui.notify(`${agent.name} subagent ${status}`, status === "completed" ? "info" : "error");
            }
          } catch { /* session torn down mid-run */ }
          batch.recordCompletion(jobId);
          return subagentResult;
        } catch (err) {
          if (proc) activeProcs.delete(proc);
          registry.complete(jobId, failedResult(agent.name, task, title, err, agent));
          batch.recordCompletion(jobId);
          refresh();
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
        if (execution === "sync") {
          let result: SubagentResult;
          try {
            result = await launchOne(agent, single.task, jobId, single.title);
          } catch (err) {
            result = failedResult(agent.name, single.task, single.title, err, agent);
          }
          stopTicker();
          batch.deliverResult(jobId, result);
          batch.markCleared();
          refresh();
          const status = result.exitCode === 0 ? "completed" : "failed";
          return {
            content: [{ type: "text", text: capOutput(formatResultOutput(result), 20000) }],
            details: { agent: agent.name, status, execution, jobIds: [jobId], jobScope: registry.scope },
          };
        }

        launchOne(agent, single.task, jobId, single.title)
          .then((r) => {
            stopTicker();
            batch.deliverResult(jobId, r);
            batch.summary();
          })
          .catch((err) => {
            stopTicker();
            batch.sendError(agent.name, single.task, single.title, err, agent);
            batch.summary();
          });

        // Return before the child finishes only for async execution; results
        // are delivered via sendMessage with the custom renderer.
        return {
          content: [{ type: "text", text: `Launched **${agent.name}** subagent: "${single.title ?? single.task}"` }],
          details: { agent: agent.name, status: "launched", execution, jobIds: [jobId], jobScope: registry.scope },
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

      const results: Array<SubagentResult | undefined> = new Array(tasks.length);
      const runWithAgent = async (task: TaskItemType, index: number): Promise<void> => {
        const jobId = jobIds[index];
        if (jobId === undefined) return; // unreachable: index is bounded by the concurrency loop
        const agent = agentByName.get(task.agent);
        if (!agent) {
          const result = failedResult(
            task.agent,
            task.task,
            task.title,
            `Unknown agent "${task.agent}". Available: ${available}`,
          );
          results[index] = result;
          registry.complete(jobId, result);
          batch.recordCompletion(jobId);
          refresh();
          if (execution === "async") {
            batch.deliverResult(jobId, result);
            batch.summary();
          }
          return;
        }
        try {
          const result = await launchOne(agent, task.task, jobId, task.title);
          results[index] = result;
          if (execution === "async") {
            batch.deliverResult(jobId, result);
            batch.summary();
          }
        } catch (err) {
          const result = failedResult(task.agent, task.task, task.title, err, agent);
          results[index] = result;
          if (execution === "async") {
            batch.sendError(task.agent, task.task, task.title, err, agent);
            batch.summary();
          }
        }
      };

      if (execution === "sync") {
        try {
          await runWithConcurrencyLimit(tasks, concurrency, runWithAgent);
        } finally {
          stopTicker();
        }
        for (const [index, result] of results.entries()) {
          const jobId = jobIds[index];
          if (jobId !== undefined && result) batch.deliverResult(jobId, result);
        }
        registry.markCleared(jobIds);
        refresh();
        const output = results.map((result, index) => {
          const task = tasks[index];
          if (!task) return "";
          const title = normalizeTitle(task.title);
          const label = title ? `${task.agent}: ${title}` : `${task.agent}: ${shortLabel(undefined, task.task, 120)}`;
          return `### ${label}\n${result ? formatResultOutput(result) : "(no output)"}`;
        }).join("\n\n");
        const failed = results.some((result) => !result || result.exitCode !== 0);
        return {
          content: [{ type: "text", text: capOutput(output, 50000) }],
          details: {
            count: tasks.length - unknownCount,
            skipped: unknownCount,
            status: failed ? "failed" : "completed",
            execution,
            jobIds,
            jobScope: registry.scope,
          },
        };
      }

      runWithConcurrencyLimit(tasks, concurrency, runWithAgent)
        .finally(stopTicker)
        .catch((err) => console.error("subagents: batch execution failed", err));

      const skipped = unknownCount > 0 ? `, ${unknownCount} skipped (unknown agent)` : "";
      return {
        content: [{ type: "text", text: `Launched ${tasks.length - unknownCount} subagents in parallel${skipped}.` }],
        details: {
          count: tasks.length - unknownCount,
          skipped: unknownCount,
          status: "launched",
          execution,
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
          theme.fg("muted", ` [${args.execution ?? "async"}, concurrency ${args.concurrency ?? DEFAULT_CONCURRENCY}]`);
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
          theme.fg("muted", ` [${args.execution ?? "async"}]`) +
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
      return new Text(
        theme.fg("toolTitle", theme.bold("subagent ")) +
          theme.fg(failed ? "error" : "success", `${failed ? "✗" : "✓"} ${summary}`),
        0,
        0,
      );
    },
  };
}

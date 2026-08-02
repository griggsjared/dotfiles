import { spawn, type ChildProcess } from "node:child_process";
import {
  mkdtemp,
  readFile,
  readdir,
  rmdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import { join, parse } from "node:path";
import { tmpdir } from "node:os";
import { Box, Text } from "@earendil-works/pi-tui";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

interface AgentConfig {
  name: string;
  description: string;
  model?: string;
  tools?: string[];
  systemPrompt: string;
  source: string;
  maxRuntimeMs?: number;
}

interface SubagentResult {
  agent: string;
  task: string;
  text: string;
  exitCode: number;
  error: string;
}

interface Job {
  id: number;
  agent: string;
  task: string;
  startTime: number;
  status: "running" | "completed" | "failed";
  endTime?: number;
  text?: string;
  error?: string;
}

const DEFAULT_TOOLS = ["read", "grep", "find", "ls", "bash"];
const MAX_PARALLEL = 8;
const DEFAULT_CONCURRENCY = 3;
const DEFAULT_TIMEOUT_MS = 600_000; // 10 minutes
const MAX_CHILD_OUTPUT = 4 * 1024 * 1024; // keep only the tail of child stdout
const MAX_CHILD_ERROR = 1024 * 1024; // keep only the tail of child stderr
const WIDGET_KEY = "subagents";
const STATUS_KEY = "subagents";
const ENTRY_TYPE = "subagents";

const TaskItem = Type.Object({
  agent: Type.String({ description: "Agent name to invoke" }),
  task: Type.String({ description: "Task to delegate to the agent" }),
});

const SubagentParams = Type.Object({
  agent: Type.Optional(Type.String({
    description: "Agent name to invoke (single mode)",
  })),
  task: Type.Optional(Type.String({
    description: "Task to delegate (single mode)",
  })),
  tasks: Type.Optional(Type.Array(TaskItem, {
    description: "Array of tasks to run in parallel",
  })),
  concurrency: Type.Optional(Type.Integer({
    minimum: 1,
    maximum: MAX_PARALLEL,
    default: DEFAULT_CONCURRENCY,
    description: "Maximum number of parallel tasks",
  })),
});

function parseFrontmatter(text: string): { meta: Record<string, string>; body: string } {
  const match = text.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: text.trim() };

  const meta: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx > 0) {
      meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    }
  }
  return { meta, body: match[2].trim() };
}

async function loadAgentFile(path: string, source: string): Promise<AgentConfig | undefined> {
  try {
    const text = await readFile(path, "utf8");
    const { meta, body } = parseFrontmatter(text);
    const name = meta.name || parse(path).name;
    if (!name) return undefined;

    const maxRuntime = parseInt(meta.maxRuntimeMs ?? "", 10);

    return {
      name,
      description: meta.description || "",
      model: meta.model,
      tools: meta.tools?.split(",").map((s) => s.trim()).filter(Boolean),
      systemPrompt: body,
      source,
      maxRuntimeMs: Number.isFinite(maxRuntime) && maxRuntime > 0 ? maxRuntime : undefined,
    };
  } catch {
    return undefined;
  }
}

async function discoverAgents(extensionDir: string): Promise<AgentConfig[]> {
  const agents: AgentConfig[] = [];
  const agentsDir = join(extensionDir, "agents");

  try {
    const files = await readdir(agentsDir);
    for (const file of files) {
      if (!file.endsWith(".md")) continue;
      const agent = await loadAgentFile(join(agentsDir, file), `subagents/${file}`);
      if (agent) agents.push(agent);
    }
  } catch {
    // agents directory may not exist yet
  }

  return agents;
}

function getPiCommand(): { cmd: string; args: string[] } {
  const entryScript = process.argv[1];
  const isBunVirtual = entryScript?.startsWith("/$bunfs/root/");
  const executable = process.argv[0] || process.execPath;
  if (entryScript && !isBunVirtual && entryScript !== executable) {
    return { cmd: executable, args: [entryScript] };
  }
  if (!/^(node|bun)(\.exe)?$/.test(executable)) {
    // Compiled single-binary (bun) or direct invocation: run the binary itself.
    return { cmd: executable, args: [] };
  }
  // Bare node/bun with no usable entry script (e.g. bun virtual bundle);
  // fall back to the pi on PATH.
  return { cmd: "pi", args: [] };
}

function formatModel(model: { provider: string; id: string } | undefined): string {
  if (!model) return "claude-haiku-4-5";
  return `${model.provider}/${model.id}`;
}

function extractFinalText(output: string): string {
  let finalText = "";
  let finalThinking = "";
  let streamedText = "";
  for (const line of output.split("\n").filter(Boolean)) {
    try {
      const event = JSON.parse(line);
      const message = event.message;
      if (!message || message.role !== "assistant") continue;
      const content = message.content;
      if (event.type === "message_end") {
        if (typeof content === "string") {
          finalText = content;
        } else if (Array.isArray(content)) {
          const texts = content
            .filter((p: any) => p.type === "text")
            .map((p: any) => p.text)
            .join("\n");
          const thinkings = content
            .filter((p: any) => p.type === "thinking")
            .map((p: any) => p.thinking || p.text || "")
            .join("\n");
          if (texts) finalText = texts;
          if (thinkings) finalThinking = thinkings;
        }
      } else if (event.type === "message_update") {
        // Incremental stream text; keep the longest chunk as a fallback for
        // children that end without a final text block.
        const text = typeof content === "string"
          ? content
          : Array.isArray(content)
            ? content.filter((p: any) => p.type === "text").map((p: any) => p.text).join("\n")
            : "";
        if (text.length > streamedText.length) streamedText = text;
      }
    } catch {
      // ignore malformed lines
    }
  }
  return finalText || streamedText || finalThinking || "";
}

async function runSubagent(
  agent: AgentConfig,
  task: string,
  cwd: string,
  defaultModel: string,
  options: {
    signal?: AbortSignal;
    onUpdate?: (text: string) => void;
    maxRuntimeMs?: number;
    thinkingLevel?: string;
  } = {},
): Promise<{ proc: ChildProcess; result: Promise<SubagentResult> }> {
  const tmpDir = await mkdtemp(join(tmpdir(), "subagents-"));
  const promptFile = join(tmpDir, "agent.md");
  try {
    await writeFile(promptFile, agent.systemPrompt, "utf8");
  } catch (err) {
    await rmdir(tmpDir).catch(() => {});
    throw err;
  }

  const base = getPiCommand();
  const model = agent.model || defaultModel;
  const tools = (agent.tools ?? DEFAULT_TOOLS).join(",");
  const args = [
    ...base.args,
    "--mode",
    "json",
    "-p",
    "--no-session",
    "--no-extensions",
    "--no-context-files",
    "--model",
    model,
    ...(options.thinkingLevel ? ["--thinking", options.thinkingLevel] : []),
    "--tools",
    tools,
    "--append-system-prompt",
    promptFile,
    `Task: ${task}`,
  ];

  let proc: ChildProcess;
  try {
    // Children are node scripts; deep sessions (high-effort thinking) can
    // exceed node's default 4GB heap. Raise the cap, preserving any existing
    // NODE_OPTIONS.
    const nodeOptions = process.env.NODE_OPTIONS
      ? `${process.env.NODE_OPTIONS} --max-old-space-size=8192`
      : "--max-old-space-size=8192";
    proc = spawn(base.cmd, args, {
      cwd,
      shell: false,
      env: { ...process.env, NODE_OPTIONS: nodeOptions },
    });
    proc.stdin?.end(); // close stdin so child doesn't wait for pipe input
  } catch (err) {
    await unlink(promptFile).catch(() => {});
    await rmdir(tmpDir).catch(() => {});
    throw err;
  }

  const result = new Promise<SubagentResult>((resolve) => {
    let stdout = "";
    let stderr = "";

    const cleanup = () => {
      unlink(promptFile).catch(() => {});
      rmdir(tmpDir).catch(() => {});
    };

    proc.stdout?.on("data", (data) => {
      // Append only, capped to the tail. No per-chunk parsing: re-parsing the
      // whole buffer on every chunk (and streaming the text through onUpdate)
      // stalls the parent TUI while children stream. The final parse happens
      // on close; the last message_end always lands in the tail.
      stdout += data.toString();
      if (stdout.length > MAX_CHILD_OUTPUT) {
        // Slice to the last line boundary before the cap so the tail never
        // starts mid-line (a cut JSONL event would fail to parse).
        const excess = stdout.length - MAX_CHILD_OUTPUT;
        const nl = stdout.indexOf("\n", excess);
        stdout = stdout.slice(nl === -1 ? excess : nl + 1);
      }
    });
    proc.stderr?.on("data", (data) => {
      stderr += data.toString();
      if (stderr.length > MAX_CHILD_ERROR) stderr = stderr.slice(-MAX_CHILD_ERROR);
    });

    const timeoutMs = options.maxRuntimeMs ?? agent.maxRuntimeMs ?? DEFAULT_TIMEOUT_MS;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    const onTimeout = () => {
      timedOut = true;
      proc.kill("SIGTERM");
      // A child stuck in a long GC cycle can ignore SIGTERM and never emit
      // 'close'; escalate so a timed-out job can't run on forever.
      setTimeout(() => {
        try { if (proc.exitCode === null && proc.signalCode === null) proc.kill("SIGKILL"); } catch { /* already dead */ }
      }, 5000);
    };
    const onAbort = () => {
      proc.kill("SIGTERM");
      setTimeout(() => {
        try { if (proc.exitCode === null && proc.signalCode === null) proc.kill("SIGKILL"); } catch { /* already dead */ }
      }, 5000);
    };
    const removeAbortListener = () => options.signal?.removeEventListener("abort", onAbort);

    if (timeoutMs > 0) {
      timeoutId = setTimeout(onTimeout, timeoutMs);
    }

    if (options.signal) {
      if (options.signal.aborted) {
        onAbort();
      } else {
        options.signal.addEventListener("abort", onAbort, { once: true });
      }
    }

    proc.on("close", (code, signal) => {
      removeAbortListener();
      if (timeoutId) clearTimeout(timeoutId);
      cleanup();
      const text = extractFinalText(stdout);
      options.onUpdate?.(text);
      if (!text && stdout.length > 0) {
        const snippet = stdout.length > 2000
          ? `...(truncated)\n${stdout.slice(-2000)}`
          : stdout;
        stderr += `\n[subagents] No text extracted from ${stdout.split("\n").length} JSONL lines. Last lines:\n${snippet}`;
      }
      if (timedOut) {
        stderr += `\n[subagents] Timed out after ${timeoutMs / 1000}s`;
      } else if (signal) {
        stderr += `\n[subagents] Killed by ${signal}`;
      } else if (code != null && code >= 128) {
        stderr += `\n[subagents] Killed by signal ${code - 128}`;
      }
      resolve({
        agent: agent.name,
        task,
        text,
        exitCode: timedOut ? 124 : (signal || (code != null && code >= 128) ? 1 : (code ?? 0)),
        error: stderr,
      });
    });

    proc.on("error", () => {
      removeAbortListener();
      if (timeoutId) clearTimeout(timeoutId);
      cleanup();
      resolve({
        agent: agent.name,
        task,
        text: "",
        exitCode: 1,
        error: stderr || "failed to spawn subagent",
      });
    });
  });

  return { proc, result };
}

async function runWithConcurrencyLimit<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const results: R[] = new Array(items.length);
  let next = 0;

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  });

  await Promise.all(workers);
  return results;
}

function createJobRegistry() {
  let nextId = 1;
  const jobs = new Map<number, Job>();

  const add = (agent: string, task: string): number => {
    const id = nextId++;
    jobs.set(id, {
      id,
      agent,
      task,
      startTime: Date.now(),
      status: "running",
    });
    return id;
  };

  const updateText = (id: number, text: string): void => {
    const job = jobs.get(id);
    if (job) job.text = text;
  };

  const complete = (id: number, result: SubagentResult): void => {
    const job = jobs.get(id);
    if (!job) return;
    job.status = result.exitCode === 0 ? "completed" : "failed";
    job.endTime = Date.now();
    job.text = result.text;
    job.error = result.error;
    // Prune jobs older than 5 minutes
    const cutoff = Date.now() - 300_000;
    for (const [jid, j] of jobs) {
      if (j.status !== "running" && (j.endTime ?? 0) < cutoff) jobs.delete(jid);
    }
  };

  const running = (): Job[] =>
    Array.from(jobs.values()).filter((j) => j.status === "running");

  const recent = (limit = 5): Job[] =>
    Array.from(jobs.values())
      .filter((j) => j.status !== "running")
      .sort((a, b) => (b.endTime ?? 0) - (a.endTime ?? 0))
      .slice(0, limit);

  return { jobs, add, updateText, complete, running, recent };
}

function renderFullWidget(registry: ReturnType<typeof createJobRegistry>): string[] {
  const now = Date.now();
  const running = registry.running();
  const completed = registry.recent(50).filter(j => j.endTime && now - j.endTime < 10000);

  // Merge into single list: running first, then recent completed
  const lines: string[] = [];
  for (const job of running) {
    const elapsed = ((now - job.startTime) / 1000).toFixed(1);
    const preview = job.task.length > 40 ? `${job.task.slice(0, 40)}…` : job.task;
    lines.push(`◐ ${job.agent} (${elapsed}s): ${preview}`);
  }
  for (const job of completed) {
    const duration = job.endTime ? ((job.endTime - job.startTime) / 1000).toFixed(1) : "?";
    const icon = job.status === "completed" ? "✓" : "✗";
    const preview = job.task.length > 40 ? `${job.task.slice(0, 40)}…` : job.task;
    lines.push(`${icon} ${job.agent} (${duration}s): ${preview}`);
  }
  return lines;
}

// Structural subset of ExtensionContext used by refreshUi, which runs from
// tickers and after the tool call returns, when the captured ctx may be stale.
interface UiContext {
  hasUI: boolean;
  ui: {
    setWidget: (key: string, lines: string[]) => void;
    setStatus: (key: string, status?: string) => void;
    notify: (message: string, type: "info" | "warning" | "error") => void;
  };
}

function refreshUi(
  ctx: UiContext,
  registry: ReturnType<typeof createJobRegistry>,
): void {
  try {
    if (!ctx.hasUI) return;
    const running = registry.running();
    if (running.length > 0) {
      ctx.ui.setWidget(WIDGET_KEY, renderFullWidget(registry));
    } else {
      ctx.ui.setWidget(WIDGET_KEY, []);
    }
  } catch { /* ctx stale after session change */ }
}

function appendCompletionEntry(
  pi: ExtensionAPI,
  job: Job,
): void {
  const output = job.text || job.error || "(no output)";
  const capped = output.length > 20000 ? `${output.slice(0, 20000)}\n…` : output;
  pi.appendEntry(ENTRY_TYPE, {
    id: job.id,
    agent: job.agent,
    task: job.task,
    status: job.status,
    startTime: job.startTime,
    endTime: job.endTime,
    durationMs: job.endTime ? job.endTime - job.startTime : undefined,
    output: capped,
  });
}

export default async function (pi: ExtensionAPI) {
  const extensionDir = __dirname;
  const discoveredAgents = await discoverAgents(extensionDir);
  const agentGuidance = discoveredAgents.length > 0
    ? `Use the subagent tool with these available agents: ${discoveredAgents.map((agent) => `${agent.name} (${agent.description || "no description"})`).join("; ")}.`
    : "Use the subagent tool with an available agent discovered from the agents directory.";
  const activeProcs = new Set<ChildProcess>();
  const activeTickers = new Set<ReturnType<typeof setInterval>>();
  const registry = createJobRegistry();
  let lastUiContext: UiContext | undefined;

  // Register custom message renderer for subagent results
  pi.registerMessageRenderer(ENTRY_TYPE, (message, { expanded, outputPad }, theme) => {
    const details = message.details as {
      agent: string; task: string; status: string;
      duration: string; icon: string;
    } | undefined;
    if (!details) return new Text(message.content, 0, 0);

    const color = details.status === "completed" ? "success" : "error";
    const prefix = theme.fg(color, details.icon + " " + details.agent);
    const meta = theme.fg("muted", ` (${details.duration})`);

    if (expanded) {
      const box = new Box(outputPad, 1, (t) => theme.bg("customMessageBg", t));
      box.addChild(new Text(`${prefix}${meta}`, 0, 0));
      box.addChild(new Text(theme.fg("dim", details.task), 1, 0));
      if (message.content) {
        box.addChild(new Text(theme.fg("muted", "───"), 2, 0));
        box.addChild(new Text(message.content, 3, 0));
      }
      return box;
    }

    // Collapsed: one line with task preview
    const taskPreview = details.task.length > 60 ? `${details.task.slice(0, 60)}…` : details.task;
    const box = new Box(outputPad, 1, (t) => theme.bg("customMessageBg", t));
    box.addChild(new Text(`${prefix}${meta}: ${theme.fg("dim", taskPreview)}`, 0, 0));
    return box;
  });

  pi.registerEntryRenderer(ENTRY_TYPE, (entry, _options, theme) => {
    const data = entry.data as {
      agent: string;
      status: string;
      durationMs?: number;
      output: string;
    };
    const icon = data.status === "completed" ? "✓" : "✗";
    const color = data.status === "completed" ? "success" : "error";
    const duration = data.durationMs ? ` (${(data.durationMs / 1000).toFixed(1)}s)` : "";
    let text = theme.fg(color, `${icon} ${data.agent}${duration}`);
    if (data.output && data.output !== "(no output)") {
      const output = data.output.length > 2000 ? `${data.output.slice(0, 2000)}…` : data.output;
      text += `\n${theme.fg("dim", output)}`;
    }
    return new Text(text, 0, 0);
  });

  pi.registerTool({
    name: "subagent",
    label: "Subagent",
    description:
      "Delegate work to specialized subagents asynchronously.",
    parameters: SubagentParams,
    promptGuidelines: [
      agentGuidance,
      "For code reviews, tell the reviewer to use the peer-review skill when available.",
      "For ANY task requiring reading or exploring multiple files or directories — use a subagent. Do not do broad exploration yourself.",
      "Subagents run in parallel and return results asynchronously. Use tasks[] to explore multiple areas simultaneously.",
      "Give each subagent a clear, self-contained task. Keep tasks scoped so they finish quickly.",
      "Do NOT sleep, wait, or poll for subagent results. Results arrive as followUp messages in the conversation when each subagent completes. Continue working on other things in the meantime.",
    ],

    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const agents = await discoverAgents(extensionDir);
      const agentByName = new Map(agents.map((a) => [a.name, a]));
      const defaultModel = formatModel(ctx.model);
      lastUiContext = ctx;
      const hasSingle = Boolean(params.agent && params.task);
      const hasTasks = (params.tasks?.length ?? 0) > 0;

      if (params.tasks && params.tasks.length === 0) {
        throw new Error("tasks[] must contain at least one task");
      }

      if (hasSingle === hasTasks) {
        throw new Error(
          "Provide exactly one mode: either agent+task (single) or tasks[] (parallel).",
        );
      }

      const safeRefresh = () => {
        try { refreshUi(ctx, registry); } catch { /* ctx stale after session change */ }
      };

      const launchOne = async (agent: AgentConfig, task: string, jobId: number): Promise<SubagentResult> => {
        let proc: ChildProcess | undefined;
        try {
          const launched = await runSubagent(agent, task, ctx.cwd, defaultModel, {
            signal,
            thinkingLevel: ctx.thinkingLevel,
            onUpdate: (text) => {
              registry.updateText(jobId, text);
              safeRefresh();
              try {
                onUpdate?.({
                  content: [{ type: "text", text: text || "(running...)" }],
                  details: { agent: agent.name, task, status: "running" },
                });
              } catch { /* stale ctx */ }
            },
          });
          proc = launched.proc;
          activeProcs.add(proc);
          const subagentResult = await launched.result;
          activeProcs.delete(proc);
          registry.complete(jobId, subagentResult);
          safeRefresh();
          try {
            const job = registry.jobs.get(jobId);
            if (job) appendCompletionEntry(pi, job);
            if (ctx.hasUI) {
              const status = subagentResult.exitCode === 0 ? "completed" : "failed";
              ctx.ui.notify(`${agent.name} subagent ${status}`, status === "completed" ? "info" : "error");
            }
          } catch { /* stale ctx */ }
          recordCompletion(jobId);
          return subagentResult;
        } catch (err) {
          if (proc) activeProcs.delete(proc);
          registry.complete(jobId, {
            agent: agent.name, task, text: "", exitCode: 1, error: String(err),
          });
          try {
            const job = registry.jobs.get(jobId);
            if (job) appendCompletionEntry(pi, job);
          } catch { /* stale ctx */ }
          recordCompletion(jobId);
          safeRefresh();
          throw err;
        }
      };

      const batchJobIds = new Set<number>();
      let pendingCount = 0;
      // Snapshot of this batch's completed jobs, taken at completion time so
      // the summary can't lose entries to the registry's 5-min pruning.
      const batchCompleted: Job[] = [];
      const recordCompletion = (jobId: number) => {
        const job = registry.jobs.get(jobId);
        if (job) batchCompleted.push({ ...job });
      };

      const deliverResult = (jobId: number, result: SubagentResult) => {
        const parts: string[] = [];
        if (result.text) parts.push(result.text);
        if (result.error) parts.push(result.error);
        const output = parts.join("\n") || "(no output)";
        const capped = output.length > 20000 ? `${output.slice(0, 20000)}\n…` : output;
        const job = registry.jobs.get(jobId);
        const duration = job?.endTime ? `${((job.endTime - job.startTime) / 1000).toFixed(1)}s` : "?";
        const status = result.exitCode === 0 ? "completed" : "failed";
        const icon = status === "completed" ? "✓" : "✗";
        try {
          pi.sendMessage({
            customType: ENTRY_TYPE,
            content: capped,
            display: true,
            details: { agent: result.agent, task: result.task, status, duration, icon },
          }, { deliverAs: "steer" });
        } catch { /* stale session */ }
      };

      // Fires once per batch when THIS batch's last job finishes, and triggers
      // a turn. Scoped by pendingCount, not global registry state, so
      // overlapping batches can't suppress each other's summary.
      const maybeBatchSummary = () => {
        pendingCount -= 1;
        if (pendingCount > 0) return;
        if (batchCompleted.length === 0) return;
        const lines = batchCompleted.map(j => {
          const duration = j.endTime ? ((j.endTime - j.startTime) / 1000).toFixed(1) : "?";
          const icon = j.status === "completed" ? "✓" : "✗";
          return `${icon} ${j.agent} (${duration}s): ${j.task}`;
        });
        lines.unshift("**Subagents complete:**");
        try {
          pi.sendUserMessage(lines.join("\n"), { deliverAs: "steer", triggerTurn: true });
        } catch { /* stale session */ }
      };

      if (hasSingle) {
        const agent = agentByName.get(params.agent!);
        if (!agent) {
          const available = agents.map((a) => a.name).join(", ") || "none";
          throw new Error(`Unknown agent "${params.agent}". Available agents: ${available}`);
        }

        const jobId = registry.add(agent.name, params.task!);
        batchJobIds.add(jobId);
        pendingCount = 1;
        safeRefresh();
        const ticker = setInterval(safeRefresh, 1000);
        activeTickers.add(ticker);

        try {
          onUpdate?.({
            content: [{ type: "text", text: `⏳ Launched **${agent.name}** subagent — waiting for result...` }],
            details: { agent: agent.name, status: "launched" },
          });
        } catch { /* stale ctx */ }

        launchOne(agent, params.task!, jobId)
          .then((r) => { clearInterval(ticker); activeTickers.delete(ticker); deliverResult(jobId, r); maybeBatchSummary(); })
          .catch((err) => { clearInterval(ticker); activeTickers.delete(ticker); try { pi.sendMessage({ customType: ENTRY_TYPE, content: `Error: ${String(err)}`, display: true, details: { agent: agent.name, task: params.task!, status: "failed", duration: "?", icon: "✗" } }, { deliverAs: "steer" }); } catch { /* stale */ } maybeBatchSummary(); });

        // Return before the child finishes so the parent model is not blocked;
        // results are delivered via sendMessage with custom renderer
        return {
          content: [{ type: "text", text: `Launched **${agent.name}** subagent: "${params.task!}"` }],
          details: { agent: agent.name, status: "launched" },
        };
      }

      const tasks = params.tasks!;
      const unknownCount = tasks.filter((t) => !agentByName.has(t.agent)).length;
      if (unknownCount === tasks.length) {
        throw new Error(`Unknown agent(s): ${[...new Set(tasks.map((t) => t.agent))].join(", ")}`);
      }
      const concurrency = Math.min(
        Math.max(1, params.concurrency ?? DEFAULT_CONCURRENCY),
        MAX_PARALLEL,
      );

      const jobIds = tasks.map((t) => {
        const id = registry.add(t.agent, t.task);
        batchJobIds.add(id);
        return id;
      });
      pendingCount = jobIds.length;
      safeRefresh();
      const ticker = setInterval(safeRefresh, 1000);
      activeTickers.add(ticker);

      const runWithAgent = async (task: typeof tasks[0], index: number): Promise<void> => {
        const agent = agentByName.get(task.agent);
        if (!agent) {
          try {
            const result: SubagentResult = {
              agent: task.agent, task: task.task, text: "", exitCode: 1,
              error: `Unknown agent "${task.agent}". Available: ${agents.map((a) => a.name).join(", ") || "none"}`,
            };
            registry.complete(jobIds[index], result);
            try {
              const job = registry.jobs.get(jobIds[index]);
              if (job) appendCompletionEntry(pi, job);
            } catch { /* stale ctx */ }
            recordCompletion(jobIds[index]);
            safeRefresh();
            deliverResult(jobIds[index], result);
            maybeBatchSummary();
          } catch { /* absorbed by the chain's .catch */ }
          return;
        }
        try {
          const result = await launchOne(agent, task.task, jobIds[index]);
          deliverResult(jobIds[index], result);
          maybeBatchSummary();
        } catch (err) {
          try { pi.sendMessage({ customType: ENTRY_TYPE, content: `Error: ${String(err)}`, display: true, details: { agent: task.agent, task: task.task, status: "failed", duration: "?", icon: "✗" } }, { deliverAs: "steer" }); } catch { /* stale */ }
          maybeBatchSummary();
        }
      };

      runWithConcurrencyLimit(tasks, concurrency, runWithAgent)
        .finally(() => { clearInterval(ticker); activeTickers.delete(ticker); })
        .catch(() => {});

      const skipped = unknownCount > 0 ? `, ${unknownCount} skipped (unknown agent)` : "";
      return {
        content: [{ type: "text", text: `Launched ${tasks.length - unknownCount} subagents in parallel${skipped}.` }],
        details: { count: tasks.length - unknownCount, skipped: unknownCount, status: "launched" },
      };
    },
  });

  pi.registerTool({
    name: "subagent_status",
    label: "Subagent Status",
    description: "Check the status of running and recently completed subagents. Use this to poll for progress without blocking.",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
      const now = Date.now();
      const running = registry.running();
      const recent = registry.recent(20).filter(j => j.endTime && now - j.endTime < 60000);

      const lines: string[] = [];
      if (running.length > 0) {
        lines.push(`**Running (${running.length}):**`);
        for (const j of running) {
          const elapsed = ((now - j.startTime) / 1000).toFixed(1);
          lines.push(`- ◐ ${j.agent} (${elapsed}s): ${j.task}`);
        }
      } else {
        lines.push("**Running:** none");
      }
      if (recent.length > 0) {
        lines.push(`\n**Recent (${recent.length}):**`);
        for (const j of recent) {
          const duration = j.endTime ? ((j.endTime - j.startTime) / 1000).toFixed(1) : "?";
          const icon = j.status === "completed" ? "✓" : "✗";
          lines.push(`- ${icon} ${j.agent} (${duration}s): ${j.task}`);
        }
      }
      return { content: [{ type: "text", text: lines.join("\n") }] };
    },
  });

  pi.registerCommand("subagents", {
    description: "Browse completed subagent history",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) return;
      const recent = registry.recent(30);
      if (recent.length === 0) {
        ctx.ui.notify("No subagents have completed yet", "info");
        return;
      }
      const items = recent.map((job) => {
        const duration = job.endTime ? ((job.endTime - job.startTime) / 1000).toFixed(1) : "?";
        const icon = job.status === "completed" ? "✓" : "✗";
        const maxLen = 40;
        const preview = job.task.length > maxLen ? `${job.task.slice(0, maxLen)}…` : job.task;
        return `${icon} ${job.agent} (${duration}s) — ${preview}`;
      });
      await ctx.ui.select("Subagent History", items);
    },
  });

  pi.registerCommand("cancel-subagents", {
    description: "Cancel all running subagents",
    handler: async (_args, ctx) => {
      const running = registry.running();
      if (running.length === 0) {
        ctx.ui.notify("No subagents are running", "info");
        return;
      }
      const count = activeProcs.size;
      for (const proc of activeProcs) {
        try { proc.kill("SIGTERM"); } catch { /* already dead */ }
        setTimeout(() => { try { if (proc.exitCode === null && proc.signalCode === null) proc.kill("SIGKILL"); } catch { /* already dead */ } }, 5000);
      }
      ctx.ui.notify(`Cancelling ${count} subagent${count > 1 ? "s" : ""}`, "info");
    },
  });

  pi.registerTool({
    name: "subagent_cancel",
    label: "Cancel Subagents",
    description: "Cancel all running subagents. Use this to abort long-running or stalled subagents.",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
      const running = registry.running();
      if (running.length === 0) {
        return { content: [{ type: "text", text: "No subagents are running." }] };
      }
      const count = activeProcs.size;
      for (const proc of activeProcs) {
        try { proc.kill("SIGTERM"); } catch { /* already dead */ }
        setTimeout(() => { try { if (proc.exitCode === null && proc.signalCode === null) proc.kill("SIGKILL"); } catch { /* already dead */ } }, 5000);
      }
      return { content: [{ type: "text", text: `Cancelling ${count} subagent${count > 1 ? "s" : ""}.` }] };
    },
  });

  pi.on("session_shutdown", () => {
    for (const id of activeTickers) clearInterval(id);
    activeTickers.clear();
    for (const proc of activeProcs) {
      proc.kill("SIGTERM");
    }
    activeProcs.clear();
    if (lastUiContext?.hasUI) {
      try {
        lastUiContext.ui.setWidget(WIDGET_KEY, []);
        lastUiContext.ui.setStatus(STATUS_KEY, undefined);
      } catch { /* stale ctx after session change */ }
    }
  });
}

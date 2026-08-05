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
import { homedir, tmpdir } from "node:os";
import { Box, Container, Markdown, Spacer, Text } from "@earendil-works/pi-tui";
import { getMarkdownTheme, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
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
  title?: string;
  text: string;
  exitCode: number;
  error: string;
  usage?: SubagentUsage;
  toolCalls?: ToolCallInfo[];
  model?: string;
}

interface SubagentUsage {
  turns: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  contextTokens: number;
}

interface ToolCallInfo {
  name: string;
  args: Record<string, unknown>;
}

interface SubagentUpdate {
  text: string;
  progress?: string;
  usage: SubagentUsage;
  toolCalls: ToolCallInfo[];
  model?: string;
}

type ExecutionMode = "async" | "sync";

const EMPTY_USAGE: SubagentUsage = {
  turns: 0,
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  cost: 0,
  contextTokens: 0,
};

interface Job {
  id: number;
  agent: string;
  task: string;
  title?: string;
  startTime: number;
  status: "running" | "completed" | "failed";
  endTime?: number;
  text?: string;
  error?: string;
  progress?: string;
  usage: SubagentUsage;
  toolCalls: ToolCallInfo[];
  model?: string;
}

const DEFAULT_TOOLS = ["read", "grep", "find", "ls", "bash"];
const MAX_PARALLEL = 8;
const DEFAULT_CONCURRENCY = 3;
const DEFAULT_TIMEOUT_MS = 600_000; // 10 minutes
const MAX_CHILD_OUTPUT = 4 * 1024 * 1024; // keep only the tail of child stdout
const MAX_CHILD_ERROR = 1024 * 1024; // keep only the tail of child stderr
const MAX_TOOL_CALLS = 20; // per subagent, for the tool-call trail
const STREAM_INTERVAL_MS = 2000; // throttle live progress updates to the model
const WIDGET_KEY = "subagents";
const STATUS_KEY = "subagents";
const ENTRY_TYPE = "subagents";

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
  })),
  execution: Type.Optional(StringEnum(["async", "sync"] as const, {
    default: "async",
    description: "Return immediately (async) or wait for results (sync)",
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

function assistantText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((p) => p?.type === "text")
      .map((p) => p.text ?? "")
      .join("\n");
  }
  return "";
}

function normalizeToolArgs(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
    } catch { /* not JSON */ }
  }
  return {};
}

// Drop write/edit content bodies (kept as a line count) and truncate long
// string values so tool-call trails stay small in memory and in history.
function sanitizeToolCallArgs(name: string, args: Record<string, unknown>): Record<string, unknown> {
  if ((name === "write" || name === "edit") && typeof args.content === "string") {
    return { ...args, content: undefined, contentLines: args.content.split("\n").length };
  }
  return args;
}

function truncateStrings(value: unknown, max = 120): unknown {
  if (typeof value === "string") return value.length > max ? `${value.slice(0, max)}…` : value;
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => truncateStrings(v, max));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value).slice(0, 50)) out[k] = truncateStrings(v, max);
    return out;
  }
  return value;
}

// Coerce empty/whitespace-only/newline-containing titles to undefined so the
// `??` fallbacks at every display site behave uniformly.
function normalizeTitle(title: string | undefined): string | undefined {
  if (!title) return undefined;
  const cleaned = title.replace(/[\r\n]+/g, " ").trim();
  return cleaned.length > 0 ? cleaned : undefined;
}

function shortLabel(title: string | undefined, task: string | undefined, max: number): string {
  if (title) return title;
  if (!task) return "...";
  return task.length > max ? `${task.slice(0, max)}…` : task;
}

function formatTokens(count: number): string {
  if (count < 1000) return count.toString();
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1000000) return `${Math.round(count / 1000)}k`;
  return `${(count / 1000000).toFixed(1)}M`;
}

function formatUsageStats(usage: SubagentUsage | undefined, model?: string): string {
  if (!usage) return "";
  const parts: string[] = [];
  if (usage.turns > 0) parts.push(`${usage.turns} turn${usage.turns > 1 ? "s" : ""}`);
  if (usage.input > 0) parts.push(`↑${formatTokens(usage.input)}`);
  if (usage.output > 0) parts.push(`↓${formatTokens(usage.output)}`);
  if (usage.cacheRead > 0) parts.push(`R${formatTokens(usage.cacheRead)}`);
  if (usage.cacheWrite > 0) parts.push(`W${formatTokens(usage.cacheWrite)}`);
  if (usage.cost > 0) parts.push(`$${usage.cost < 0.0001 ? usage.cost.toFixed(6) : usage.cost.toFixed(4)}`);
  if (usage.contextTokens > 0) parts.push(`ctx:${formatTokens(usage.contextTokens)}`);
  if (model) parts.push(model);
  return parts.join(" ");
}

function formatResultOutput(result: SubagentResult): string {
  const parts: string[] = [];
  if (result.text) parts.push(result.text);
  if (result.error) parts.push(result.error);
  return parts.join("\n") || "(no output)";
}

function capOutput(output: string, max: number): string {
  return output.length > max ? `${output.slice(0, max)}\n…` : output;
}

// Plain, short label of a tool call, used for live progress in the widget.
function toolCallLabel(name: string, args: Record<string, unknown>): string {
  const str = (v: unknown, max = 60): string => {
    const s = typeof v === "string" ? v : JSON.stringify(v);
    if (!s) return "";
    return s.length > max ? `${s.slice(0, max)}…` : s;
  };
  const pathOf = () => str(args.file_path ?? args.path ?? "…");
  switch (name) {
    case "bash": return `$ ${str(args.command ?? "…")}`;
    case "read": {
      const offset = Number(args.offset);
      const limit = Number(args.limit);
      const hasOffset = Number.isFinite(offset);
      const hasLimit = Number.isFinite(limit) && limit > 0;
      if (hasOffset || hasLimit) {
        const start = hasOffset ? offset : 1;
        const end = hasLimit ? start + limit - 1 : "";
        return `read ${pathOf()}:${start}${end ? `-${end}` : ""}`;
      }
      return `read ${pathOf()}`;
    }
    case "write": {
      const lines = typeof args.contentLines === "number" ? args.contentLines : 1;
      return `write ${pathOf()}${lines > 1 ? ` (${lines} lines)` : ""}`;
    }
    case "edit": return `edit ${pathOf()}`;
    case "ls": return `ls ${str(args.path ?? ".")}`;
    case "find": return `find ${str(args.pattern ?? "*")} in ${str(args.path ?? ".")}`;
    case "grep": return `grep /${str(args.pattern ?? "")}/ in ${str(args.path ?? ".")}`;
    default: return `${name} ${str(args)}`;
  }
}

// Themed tool-call line for message/entry rendering.
function formatToolCall(
  name: string,
  args: Record<string, unknown>,
  fg: (color: any, text: string) => string,
): string {
  const shortenPath = (p: string) => {
    const home = homedir();
    return p.startsWith(home) ? `~${p.slice(home.length)}` : p;
  };
  const pathOf = () => shortenPath(String(args.file_path ?? args.path ?? "..."));
  switch (name) {
    case "bash": {
      const command = String(args.command ?? "...");
      const preview = command.length > 60 ? `${command.slice(0, 60)}...` : command;
      return fg("muted", "$ ") + fg("toolOutput", preview);
    }
    case "read": {
      const offset = Number(args.offset);
      const limit = Number(args.limit);
      const hasOffset = Number.isFinite(offset);
      const hasLimit = Number.isFinite(limit) && limit > 0;
      let text = fg("accent", pathOf());
      if (hasOffset || hasLimit) {
        const start = hasOffset ? offset : 1;
        const end = hasLimit ? start + limit - 1 : "";
        text += fg("warning", `:${start}${end ? `-${end}` : ""}`);
      }
      return fg("muted", "read ") + text;
    }
    case "write": {
      const lines = typeof args.contentLines === "number" ? args.contentLines : 1;
      let text = fg("muted", "write ") + fg("accent", pathOf());
      if (lines > 1) text += fg("dim", ` (${lines} lines)`);
      return text;
    }
    case "edit": return fg("muted", "edit ") + fg("accent", pathOf());
    case "ls": return fg("muted", "ls ") + fg("accent", shortenPath(String(args.path ?? ".")));
    case "find": {
      const pattern = String(args.pattern ?? "*");
      const rawPath = String(args.path ?? ".");
      return fg("muted", "find ") + fg("accent", pattern) + fg("dim", ` in ${shortenPath(rawPath)}`);
    }
    case "grep": {
      const pattern = String(args.pattern ?? "");
      const rawPath = String(args.path ?? ".");
      return fg("muted", "grep ") + fg("accent", `/${pattern}/`) + fg("dim", ` in ${shortenPath(rawPath)}`);
    }
    default: {
      const argsStr = JSON.stringify(args);
      const preview = argsStr.length > 50 ? `${argsStr.slice(0, 50)}...` : argsStr;
      return fg("accent", name) + fg("dim", ` ${preview}`);
    }
  }
}

async function runSubagent(
  agent: AgentConfig,
  task: string,
  cwd: string,
  defaultModel: string,
  options: {
    signal?: AbortSignal;
    onUpdate?: (update: SubagentUpdate) => void;
    maxRuntimeMs?: number;
    thinkingLevel?: string;
    title?: string;
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
  const title = normalizeTitle(options.title);
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
    ...(title ? [`Title: ${title}`] : []),
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
    let pending = "";
    let lastStreamAt = 0;
    let finalText = "";
    let streamedText = "";
    let model: string = agent.model || defaultModel;
    const usage: SubagentUsage = { ...EMPTY_USAGE };
    const toolCalls: ToolCallInfo[] = [];

    const cleanup = () => {
      unlink(promptFile).catch(() => {});
      rmdir(tmpDir).catch(() => {});
    };

    let lastEmitKey = "";
    const maybeStream = () => {
      const now = Date.now();
      if (now - lastStreamAt < STREAM_INTERVAL_MS) return;
      const last = toolCalls[toolCalls.length - 1];
      const key = `${finalText.length}|${streamedText.length}|${toolCalls.length}|${last ? toolCallLabel(last.name, last.args) : ""}`;
      if (key === lastEmitKey) return;
      lastEmitKey = key;
      lastStreamAt = now;
      options.onUpdate?.({
        text: finalText || streamedText || "",
        progress: last ? toolCallLabel(last.name, last.args) : undefined,
        usage: { ...usage },
        toolCalls: [...toolCalls],
        model,
      });
    };

    const handleLine = (line: string) => {
      if (!line.trim()) return;
      let event: any;
      try {
        event = JSON.parse(line);
      } catch {
        return;
      }
      const message = event.message;
      if (!message || message.role !== "assistant") return;
      const content = message.content;

      if (event.type === "message_end") {
        const text = assistantText(content);
        if (text) finalText = text;
        const info = message.usage;
        if (info) {
          usage.turns += 1;
          usage.input += info.input || 0;
          usage.output += info.output || 0;
          usage.cacheRead += info.cacheRead || 0;
          usage.cacheWrite += info.cacheWrite || 0;
          usage.cost += typeof info.cost === "number" ? info.cost : (info.cost?.total || 0);
          usage.contextTokens = info.totalTokens || usage.contextTokens;
        }
        const servedModel = message.model || message.responseModel;
        if (servedModel) model = servedModel;
        if (Array.isArray(content)) {
          for (const part of content) {
            if (!part || (part.type !== "toolCall" && part.type !== "tool_use")) continue;
            const name = String(part.name ?? part.toolName ?? "tool");
            const args = truncateStrings(
              sanitizeToolCallArgs(name, normalizeToolArgs(part.arguments ?? part.input)),
            ) as Record<string, unknown>;
            toolCalls.push({ name, args });
          }
          // Keep the most recent calls; a long-running agent can accumulate many.
          if (toolCalls.length > MAX_TOOL_CALLS) {
            toolCalls.splice(0, toolCalls.length - MAX_TOOL_CALLS);
          }
        }
      } else if (event.type === "message_update") {
        const text = assistantText(content);
        if (text.length > streamedText.length) streamedText = text;
      }
      maybeStream();
    };

    proc.stdout?.on("data", (data) => {
      // The capped stdout buffer is only a parse fallback for close; live
      // state (final text, tool calls, usage) is parsed incrementally from
      // complete JSONL lines, so the cap never affects it.
      stdout += data.toString();
      if (stdout.length > MAX_CHILD_OUTPUT) {
        // Slice to the last line boundary before the cap so the tail never
        // starts mid-line (a cut JSONL event would fail to parse).
        const excess = stdout.length - MAX_CHILD_OUTPUT;
        const nl = stdout.indexOf("\n", excess);
        stdout = stdout.slice(nl === -1 ? excess : nl + 1);
      }
      pending += data.toString();
      // An unterminated line (e.g. an agent echoing a huge file) can outgrow
      // the stdout cap; keep the tail so memory stays bounded.
      if (pending.length > MAX_CHILD_OUTPUT) {
        const excess = pending.length - MAX_CHILD_OUTPUT;
        const nl = pending.indexOf("\n", excess);
        pending = pending.slice(nl === -1 ? excess : nl + 1);
      }
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) handleLine(line);
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
      // Flush any final line that arrived without a trailing newline.
      if (pending.trim()) handleLine(pending);
      cleanup();
      const text = finalText || streamedText || extractFinalText(stdout);
      options.onUpdate?.({
        text,
        usage: { ...usage },
        toolCalls: [...toolCalls],
        model,
      });
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
        title,
        text,
        exitCode: timedOut ? 124 : (signal || (code != null && code >= 128) ? 1 : (code ?? 0)),
        error: stderr,
        usage: { ...usage },
        toolCalls,
        model,
      });
    });

    proc.on("error", () => {
      removeAbortListener();
      if (timeoutId) clearTimeout(timeoutId);
      cleanup();
      resolve({
        agent: agent.name,
        task,
        title,
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
  const clearedIds = new Set<number>();

  const add = (agent: string, task: string, title?: string): number => {
    const id = nextId++;
    jobs.set(id, {
      id,
      agent,
      task,
      title: normalizeTitle(title),
      startTime: Date.now(),
      status: "running",
      usage: { ...EMPTY_USAGE },
      toolCalls: [],
    });
    return id;
  };

  const updateLive = (id: number, live: {
    text?: string;
    progress?: string;
    usage?: SubagentUsage;
    toolCalls?: ToolCallInfo[];
    model?: string;
  }): void => {
    const job = jobs.get(id);
    if (!job) return;
    if (live.text !== undefined) job.text = live.text;
    if (live.progress !== undefined) job.progress = live.progress;
    if (live.usage) job.usage = live.usage;
    if (live.toolCalls) job.toolCalls = live.toolCalls;
    if (live.model !== undefined) job.model = live.model;
  };

  const complete = (id: number, result: SubagentResult): void => {
    const job = jobs.get(id);
    if (!job) return;
    job.status = result.exitCode === 0 ? "completed" : "failed";
    job.endTime = Date.now();
    job.text = result.text;
    job.error = result.error;
    job.progress = undefined;
    job.usage = result.usage ?? job.usage;
    job.toolCalls = result.toolCalls ?? job.toolCalls;
    job.model = result.model ?? job.model;
    // Prune only completed jobs whose batch summary already cleared them;
    // anything still on display stays until its batch finishes.
    const cutoff = Date.now() - 300_000;
    for (const [jid, j] of jobs) {
      if (j.status !== "running" && clearedIds.has(jid) && (j.endTime ?? 0) < cutoff) jobs.delete(jid);
    }
  };

  // Completed jobs still on display; cleared once their batch summary is sent.
  const markCleared = (ids: Iterable<number>): void => {
    for (const id of ids) clearedIds.add(id);
  };

  const pendingCompleted = (): Job[] =>
    Array.from(jobs.values())
      .filter((j) => j.status !== "running" && !clearedIds.has(j.id))
      .sort((a, b) => (b.endTime ?? 0) - (a.endTime ?? 0));

  const running = (): Job[] =>
    Array.from(jobs.values()).filter((j) => j.status === "running");

  const recent = (limit = 5): Job[] =>
    Array.from(jobs.values())
      .filter((j) => j.status !== "running")
      .sort((a, b) => (b.endTime ?? 0) - (a.endTime ?? 0))
      .slice(0, limit);

  return { jobs, add, updateLive, complete, markCleared, pendingCompleted, running, recent };
}

const MAX_WIDGET_LINES = 10; // pi caps string-array widgets at 10 lines; keep the same cap for the factory form

function renderFullWidget(
  registry: ReturnType<typeof createJobRegistry>,
  fg: (color: any, text: string) => string,
): string[] {
  const now = Date.now();
  const running = registry.running();
  const completed = registry.pendingCompleted();

  const lines: string[] = [];
  for (const job of running) {
    const elapsed = ((now - job.startTime) / 1000).toFixed(1);
    const title = job.title ? `: ${job.title}` : "";
    lines.push(
      fg("accent", `◐ ${job.agent}`) +
        fg("muted", ` (${elapsed}s)`) +
        (title ? fg("dim", title) : ""),
    );
    lines.push(fg("muted", `  ${shortLabel(undefined, job.progress ?? job.task, 40)}`));
  }
  for (const job of completed) {
    const duration = job.endTime ? ((job.endTime - job.startTime) / 1000).toFixed(1) : "?";
    const icon = job.status === "completed" ? "✓" : "✗";
    const color = job.status === "completed" ? "success" : "error";
    const label = job.title ? `: ${job.title}` : `: ${shortLabel(undefined, job.task, 40)}`;
    lines.push(
      fg(color, `${icon} ${job.agent}`) +
        fg("muted", ` (${duration}s)`) +
        fg("dim", label),
    );
  }
  if (lines.length > MAX_WIDGET_LINES) {
    lines.length = MAX_WIDGET_LINES;
    lines.push(fg("muted", "... (widget truncated)"));
  }
  return lines;
}

// Structural subset of ExtensionContext used by refreshUi, which runs from
// tickers and after the tool call returns, when the captured ctx may be stale.
interface UiContext {
  hasUI: boolean;
  ui: {
    setWidget: (key: string, content: any) => void;
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
    if (running.length > 0 || registry.pendingCompleted().length > 0) {
      // Factory form so lines can use theme colors; re-set on every tick,
      // so the factory re-runs with the current theme.
      ctx.ui.setWidget(WIDGET_KEY, (_tui: unknown, theme: { fg: (color: string, text: string) => string }) => ({
        render: () => renderFullWidget(registry, (color, text) => theme.fg(color, text)),
        invalidate: () => {},
      }));
    } else {
      ctx.ui.setWidget(WIDGET_KEY, []);
    }
  } catch { /* ctx stale after session change */ }
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
      agent: string; task: string; title?: string; status: string;
      duration: string; icon: string;
      usage?: SubagentUsage; toolCalls?: ToolCallInfo[]; model?: string;
    } | undefined;
    if (!details) return new Text(message.content, 0, 0);

    const color = details.status === "completed" ? "success" : "error";
    const prefix = theme.fg(color, details.icon + " " + details.agent);
    const usageStr = formatUsageStats(details.usage, details.model);
    const title = details.title ? theme.fg("dim", `: ${details.title}`) : "";
    const taskFallback = details.title ? "" : `: ${theme.fg("dim", shortLabel(undefined, details.task, 60))}`;
    const headLine = `${prefix}${theme.fg("muted", ` (${details.duration})`)}${title}${taskFallback}`;
    const statsLine = usageStr ? theme.fg("dim", usageStr) : undefined;
    const mdTheme = getMarkdownTheme();
    const output = typeof message.content === "string" ? message.content : "";

    if (expanded) {
      const container = new Container();
      container.addChild(new Text(headLine, 0, 0));
      if (statsLine) container.addChild(new Text(`  ${statsLine}`, 0, 0));
      if (output) {
        container.addChild(new Spacer(1));
        container.addChild(new Markdown(output, 0, 0, mdTheme));
      }
      return container;
    }

    // Collapsed: title line, stats, first output line, expand hint
    const box = new Box(outputPad, 1, (t) => theme.bg("customMessageBg", t));
    box.addChild(new Text(headLine, 0, 0));
    if (statsLine) box.addChild(new Text(statsLine, 1, 0));
    if (output) {
      const firstLine = output.split("\n")[0].trim();
      const capped = firstLine.length > 80 ? `${firstLine.slice(0, 80)}…` : firstLine;
      if (firstLine) box.addChild(new Text(theme.fg("dim", capped), 1, 0));
      box.addChild(new Text(theme.fg("muted", "(Ctrl+O to expand)"), firstLine ? 2 : 1, 0));
    }
    return box;
  });

  pi.registerEntryRenderer(ENTRY_TYPE, (entry, _options, theme) => {
    const data = entry.data as {
      agent: string;
      status: string;
      durationMs?: number;
      output: string;
      usage?: SubagentUsage;
      toolCalls?: ToolCallInfo[];
      model?: string;
    };
    const icon = data.status === "completed" ? "✓" : "✗";
    const color = data.status === "completed" ? "success" : "error";
    const duration = data.durationMs ? ` (${(data.durationMs / 1000).toFixed(1)}s)` : "";
    const usageStr = formatUsageStats(data.usage, data.model);
    let text = theme.fg(color, `${icon} ${data.agent}${duration}${usageStr ? ` ${usageStr}` : ""}`);
    const fg = theme.fg.bind(theme);
    for (const tc of data.toolCalls ?? []) {
      text += `\n${theme.fg("muted", "→ ")}${formatToolCall(tc.name, tc.args, fg)}`;
    }
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
      "Delegate work to specialized subagents; choose async or sync execution.",
    parameters: SubagentParams,
    promptGuidelines: [
      agentGuidance,
      "For code reviews, tell the reviewer to use the peer-review skill when available.",
      "For ANY task requiring reading or exploring multiple files or directories — use a subagent. Do not do broad exploration yourself.",
      "Use the subagent tool with execution:'sync' when you need results before continuing; use execution:'async' for independent work that can finish later. Async is the default.",
      "The subagent tool's async jobs return immediately and deliver results via follow-up messages; do not block or poll for them.",
      "After launching async subagents, the parent does not need to keep working for the sake of working. It may end its turn and wait for their follow-up results; continue only when there is useful independent work, and never sleep or poll for results.",
      "Use subagent_status only when you need a snapshot of running or recent subagents; async completion is automatic, so do not poll for normal completion.",
      "Use subagent_cancel or /cancel-subagents when running subagents are stalled or no longer needed; cancellation stops all running subagents.",
      "With the subagent tool, execution:'sync' on tasks[] waits for the whole batch; concurrency still controls how many children run at once.",
      "Give each subagent a clear, self-contained task. Keep tasks scoped so they finish quickly.",
      "Pass a short display title for each task; it is used in results, the widget, and history.",
      "For delegated research or exploration, act as the orchestrator: do not duplicate an async subagent's investigation. If you continue working while it runs, do only independent, non-overlapping work; otherwise end the turn and use its result when it arrives to decide the next step.",
    ],

    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const agents = await discoverAgents(extensionDir);
      const agentByName = new Map(agents.map((a) => [a.name, a]));
      const defaultModel = formatModel(ctx.model);
      const execution: ExecutionMode = params.execution ?? "async";
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

      const launchOne = async (agent: AgentConfig, task: string, jobId: number, title?: string): Promise<SubagentResult> => {
        let proc: ChildProcess | undefined;
        try {
          const launched = await runSubagent(agent, task, ctx.cwd, defaultModel, {
            signal,
            thinkingLevel: ctx.thinkingLevel,
            title,
            onUpdate: (update) => {
              registry.updateLive(jobId, {
                text: update.text || undefined,
                progress: update.progress,
                usage: update.usage,
                toolCalls: update.toolCalls,
                model: update.model,
              });
              safeRefresh();
              try {
                const live = update.text || (update.progress ? `working on ${update.progress}…` : "");
                onUpdate?.({
                  content: [{ type: "text", text: live || "(running...)" }],
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
            agent: agent.name, task, title, text: "", exitCode: 1, error: String(err),
          });
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
        const capped = capOutput(formatResultOutput(result), 20000);
        const job = registry.jobs.get(jobId);
        const duration = job?.endTime ? `${((job.endTime - job.startTime) / 1000).toFixed(1)}s` : "?";
        const status = result.exitCode === 0 ? "completed" : "failed";
        const icon = status === "completed" ? "✓" : "✗";
        try {
          pi.sendMessage({
            customType: ENTRY_TYPE,
            content: capped,
            display: true,
            details: {
              agent: result.agent,
              task: result.task,
              title: result.title,
              status,
              duration,
              icon,
              usage: result.usage,
              toolCalls: result.toolCalls,
              model: result.model,
            },
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
          return `${icon} ${j.agent} (${duration}s): ${j.title ?? j.task}`;
        });
        lines.unshift("**Subagents complete:**");
        registry.markCleared(batchJobIds);
        safeRefresh();
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

        const jobId = registry.add(agent.name, params.task!, params.title);
        batchJobIds.add(jobId);
        pendingCount = 1;
        safeRefresh();
        const ticker = setInterval(safeRefresh, 1000);
        activeTickers.add(ticker);

        try {
          onUpdate?.({
            content: [{ type: "text", text: `${execution === "sync" ? "◐ Running" : "◐ Launched"} **${agent.name}** subagent — waiting for result...` }],
            details: { agent: agent.name, status: execution === "sync" ? "running" : "launched" },
          });
        } catch { /* stale ctx */ }

        if (execution === "sync") {
          let result: SubagentResult;
          try {
            result = await launchOne(agent, params.task!, jobId, params.title);
          } catch (err) {
            result = {
              agent: agent.name,
              task: params.task!,
              title: params.title,
              text: "",
              exitCode: 1,
              error: String(err),
            };
          }
          clearInterval(ticker);
          activeTickers.delete(ticker);
          registry.markCleared(batchJobIds);
          safeRefresh();
          const status = result.exitCode === 0 ? "completed" : "failed";
          return {
            content: [{ type: "text", text: capOutput(formatResultOutput(result), 20000) }],
            details: { agent: agent.name, status, execution },
          };
        }

        launchOne(agent, params.task!, jobId, params.title)
          .then((r) => { clearInterval(ticker); activeTickers.delete(ticker); deliverResult(jobId, r); maybeBatchSummary(); })
          .catch((err) => { clearInterval(ticker); activeTickers.delete(ticker); try { pi.sendMessage({ customType: ENTRY_TYPE, content: `Error: ${String(err)}`, display: true, details: { agent: agent.name, task: params.task!, title: params.title, status: "failed", duration: "?", icon: "✗" } }, { deliverAs: "steer" }); } catch { /* stale */ } maybeBatchSummary(); });

        // Return before the child finishes only for async execution; results
        // are delivered via sendMessage with custom renderer.
        return {
          content: [{ type: "text", text: `Launched **${agent.name}** subagent: "${params.title ?? params.task!}"` }],
          details: { agent: agent.name, status: "launched", execution },
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
        const id = registry.add(t.agent, t.task, t.title);
        batchJobIds.add(id);
        return id;
      });
      pendingCount = jobIds.length;
      safeRefresh();
      const ticker = setInterval(safeRefresh, 1000);
      activeTickers.add(ticker);

      const results: Array<SubagentResult | undefined> = new Array(tasks.length);
      const runWithAgent = async (task: typeof tasks[0], index: number): Promise<void> => {
        const agent = agentByName.get(task.agent);
        if (!agent) {
          try {
            const result: SubagentResult = {
              agent: task.agent, task: task.task, title: task.title, text: "", exitCode: 1,
              error: `Unknown agent "${task.agent}". Available: ${agents.map((a) => a.name).join(", ") || "none"}`,
            };
            results[index] = result;
            registry.complete(jobIds[index], result);
            recordCompletion(jobIds[index]);
            safeRefresh();
            if (execution === "async") {
              deliverResult(jobIds[index], result);
              maybeBatchSummary();
            }
          } catch { /* absorbed by the chain's .catch */ }
          return;
        }
        try {
          const result = await launchOne(agent, task.task, jobIds[index], task.title);
          results[index] = result;
          if (execution === "async") {
            deliverResult(jobIds[index], result);
            maybeBatchSummary();
          }
        } catch (err) {
          const result: SubagentResult = {
            agent: task.agent,
            task: task.task,
            title: task.title,
            text: "",
            exitCode: 1,
            error: String(err),
          };
          results[index] = result;
          if (execution === "async") {
            try { pi.sendMessage({ customType: ENTRY_TYPE, content: `Error: ${String(err)}`, display: true, details: { agent: task.agent, task: task.task, title: task.title, status: "failed", duration: "?", icon: "✗" } }, { deliverAs: "steer" }); } catch { /* stale */ }
            maybeBatchSummary();
          }
        }
      };

      if (execution === "sync") {
        try {
          await runWithConcurrencyLimit(tasks, concurrency, runWithAgent);
        } finally {
          clearInterval(ticker);
          activeTickers.delete(ticker);
        }
        registry.markCleared(jobIds);
        safeRefresh();
        const output = results.map((result, index) => {
          const task = tasks[index];
          const title = normalizeTitle(task.title);
          const label = title ? `${task.agent}: ${title}` : `${task.agent}: ${shortLabel(undefined, task.task, 120)}`;
          return `### ${label}\n${result ? formatResultOutput(result) : "(no output)"}`;
        }).join("\n\n");
        const failed = results.some((result) => !result || result.exitCode !== 0);
        const skipped = unknownCount > 0 ? `, ${unknownCount} skipped (unknown agent)` : "";
        return {
          content: [{ type: "text", text: capOutput(output, 50000) }],
          details: {
            count: tasks.length - unknownCount,
            skipped: unknownCount,
            status: failed ? "failed" : "completed",
            execution,
          },
        };
      }

      runWithConcurrencyLimit(tasks, concurrency, runWithAgent)
        .finally(() => { clearInterval(ticker); activeTickers.delete(ticker); })
        .catch(() => {});

      const skipped = unknownCount > 0 ? `, ${unknownCount} skipped (unknown agent)` : "";
      return {
        content: [{ type: "text", text: `Launched ${tasks.length - unknownCount} subagents in parallel${skipped}.` }],
        details: { count: tasks.length - unknownCount, skipped: unknownCount, status: "launched", execution },
      };
    },

    renderCall(args, theme, _context) {
      if (args.tasks && args.tasks.length > 0) {
        let text =
          theme.fg("toolTitle", theme.bold("subagent ")) +
          theme.fg("accent", `parallel (${args.tasks.length} tasks)`) +
          theme.fg("muted", ` [${args.execution ?? "async"}, concurrency ${args.concurrency ?? DEFAULT_CONCURRENCY}]`);
        for (const t of args.tasks.slice(0, 3)) {
          const preview = shortLabel(t.title, t.task, 40);
          text += `\n  ${theme.fg("accent", t.agent)}${theme.fg("dim", ` ${preview}`)}`;
        }
        if (args.tasks.length > 3) text += `\n  ${theme.fg("muted", `… +${args.tasks.length - 3} more`)}`;
        return new Text(text, 0, 0);
      }
      const agentName = args.agent || "...";
      const preview = shortLabel(args.title, args.task, 60);
      return new Text(
        theme.fg("toolTitle", theme.bold("subagent ")) +
          theme.fg("accent", agentName) +
          theme.fg("muted", ` [${args.execution ?? "async"}]`) +
          `\n  ${theme.fg("dim", preview)}`,
        0, 0,
      );
    },

    renderResult(result, _options, theme, _context) {
      const details = result.details as { status?: string } | undefined;
      const rawSummary = result.content?.[0]?.type === "text" ? result.content[0].text : "(no output)";
      const summary = capOutput(rawSummary, 500);
      const launched = details?.status === "launched";
      const failed = details?.status === "failed";
      return new Text(
        theme.fg("toolTitle", theme.bold("subagent ")) +
          theme.fg(launched ? "warning" : failed ? "error" : "success", `${launched ? "◐" : failed ? "✗" : "✓"} ${summary}`),
        0, 0,
      );
    },
  });

  pi.registerTool({
    name: "subagent_status",
    label: "Subagent Status",
    description: "Inspect running and recently completed subagents when needed. Async jobs deliver results automatically; do not poll for normal completion.",
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
          const progress = j.progress ? ` — ${j.progress}` : "";
          lines.push(`- ◐ ${j.agent} (${elapsed}s): ${j.title ?? j.task}${progress}`);
        }
      } else {
        lines.push("**Running:** none");
      }
      if (recent.length > 0) {
        lines.push(`\n**Recent (${recent.length}):**`);
        for (const j of recent) {
          const duration = j.endTime ? ((j.endTime - j.startTime) / 1000).toFixed(1) : "?";
          const icon = j.status === "completed" ? "✓" : "✗";
          const usageStr = formatUsageStats(j.usage, j.model);
          lines.push(`- ${icon} ${j.agent} (${duration}s${usageStr ? ` ${usageStr}` : ""}): ${j.title ?? j.task}`);
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
        const preview = shortLabel(job.title, job.task, maxLen);
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

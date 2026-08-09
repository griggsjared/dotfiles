import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rmdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AgentConfig } from "./agents.ts";
import { normalizeTitle, toolCallLabel } from "./format.ts";
import { accumulateEvent, createStreamState, extractFinalText } from "./jsonl.ts";
import type { CancellationReason, SubagentResult, SubagentUpdate } from "./types.ts";

const DEFAULT_TOOLS = ["read", "grep", "find", "ls", "bash"];
const MAX_CHILD_OUTPUT = 4 * 1024 * 1024; // keep only the tail of child stdout
const MAX_CHILD_ERROR = 1024 * 1024; // keep only the tail of child stderr
const STREAM_INTERVAL_MS = 2000; // throttle live progress updates to the model

/**
 * Resolve how to invoke pi from this (extension) process. Children are spawned
 * the same way the current process was started, with a PATH fallback.
 */
export function getPiCommand(
  argv: string[] = process.argv,
  execPath: string = process.execPath,
): { cmd: string; args: string[] } {
  const entryScript = argv[1];
  const isBunVirtual = entryScript?.startsWith("/$bunfs/root/");
  const executable = argv[0] || execPath;
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

export function formatModel(model: { provider: string; id: string } | undefined): string | undefined {
  if (!model) return undefined;
  return `${model.provider}/${model.id}`;
}

/** SIGTERM, escalating to SIGKILL if the process ignores it. */
export function killProcess(proc: ChildProcess, delayMs = 5000): void {
  try {
    proc.kill("SIGTERM");
  } catch { /* already dead */ }
  setTimeout(() => {
    try {
      if (proc.exitCode === null && proc.signalCode === null) proc.kill("SIGKILL");
    } catch { /* already dead */ }
  }, delayMs);
}

export interface RunSubagentOptions {
  signal?: AbortSignal;
  onUpdate?: (update: SubagentUpdate) => void;
  maxRuntimeMs?: number;
  thinkingLevel?: string;
  title?: string;
  spawnFn?: typeof spawn;
  killDelayMs?: number;
}

/**
 * Spawn a child pi process to run one agent, streaming its JSONL output into
 * live updates and a final result. The child's stdout is parsed incrementally;
 * the capped buffer is only a close-time fallback for text extraction.
 */
export async function runSubagent(
  agent: AgentConfig,
  task: string,
  cwd: string,
  defaultModel: string | undefined,
  options: RunSubagentOptions = {},
 ): Promise<{ proc: ChildProcess; result: Promise<SubagentResult>; cancel: (reason: CancellationReason) => void }> {
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
    ...(model ? ["--model", model] : []),
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
    proc = (options.spawnFn ?? spawn)(base.cmd, args, {
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

  let cancelJob: (reason: CancellationReason) => void = () => {};
  const result = new Promise<SubagentResult>((resolve) => {
    let stdout = "";
    let stderr = "";
    let pending = "";
    let lastStreamAt = 0;
    const state = createStreamState(model ?? "");
    let settled = false;
    const cleanup = () => {
      unlink(promptFile).catch(() => {});
      rmdir(tmpDir).catch(() => {});
    };

    let lastEmitKey = "";
    // Caller callbacks must never escape into the stream pipeline: an exception
    // here would propagate out of the data/close handler and kill the process.
    const safeUpdate = (update: SubagentUpdate) => {
      try {
        options.onUpdate?.(update);
      } catch (err) {
        console.error("subagents: update callback failed", err);
      }
    };
    const maybeStream = () => {
      const nowMs = Date.now();
      if (nowMs - lastStreamAt < STREAM_INTERVAL_MS) return;
      const last = state.toolCalls[state.toolCalls.length - 1];
      const key = `${state.finalText.length}|${state.streamedText.length}|${state.toolCalls.length}|${last ? toolCallLabel(last.name, last.args) : ""}`;
      if (key === lastEmitKey) return;
      lastEmitKey = key;
      lastStreamAt = nowMs;
      safeUpdate({
        text: state.finalText || state.streamedText || "",
        progress: last ? toolCallLabel(last.name, last.args) : undefined,
        usage: { ...state.usage },
        toolCalls: [...state.toolCalls],
        model: state.model,
        thinkingLevel: options.thinkingLevel,
      });
    };

    const handleLine = (line: string) => {
      accumulateEvent(state, line);
      maybeStream();
    };

    const finalize = (code: number | null, signal: NodeJS.Signals | null, processError = false) => {
      if (settled) return;
      settled = true;
      removeAbortListener();
      if (timeoutId) clearTimeout(timeoutId);
      // Flush any final line that arrived without a trailing newline.
      if (pending.trim()) handleLine(pending);
      const text = state.finalText || state.streamedText || state.finalThinking || extractFinalText(stdout);
      cleanup();
      safeUpdate({
        text,
        usage: { ...state.usage },
        toolCalls: [...state.toolCalls],
        model: state.model,
        thinkingLevel: options.thinkingLevel,
      });
      if (!text && stdout.length > 0 && !processError) {
        const snippet = stdout.length > 2000
          ? `...(truncated)\n${stdout.slice(-2000)}`
          : stdout;
        stderr += `\n[subagents] No text extracted from ${stdout.split("\n").length} JSONL lines. Last lines:\n${snippet}`;
      }
      if (cancelled) {
        stderr = stderr ? `${stderr}\n` : "";
        stderr += `Cancelled (${cancellationReason ?? "manual"}).`;
      } else if (!processError && signal) {
        stderr += `\n[subagents] Killed by ${signal}`;
      } else if (!processError && code != null && code >= 128) {
        stderr += `\n[subagents] Killed by signal ${code - 128}`;
      }
      resolve({
        agent: agent.name,
        task,
        title,
        text,
        exitCode: cancelled ? 130 : processError ? 1 : (signal || (code != null && code >= 128) ? 1 : (code ?? 0)),
        error: processError ? stderr || "failed to spawn subagent" : stderr,
        cancelled,
        cancellationReason,
        usage: { ...state.usage },
        toolCalls: state.toolCalls,
        model: state.model,
        thinkingLevel: options.thinkingLevel,
      });
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

    const timeoutMs = options.maxRuntimeMs ?? agent.maxRuntimeMs ?? 0;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let cancellationReason: CancellationReason | undefined;
    let cancelled = false;
    cancelJob = (reason) => {
      if (settled || cancelled) return;
      cancelled = true;
      cancellationReason = reason;
      killProcess(proc, options.killDelayMs);
    };
    const onAbort = () => cancelJob("parent-abort");
    const onTimeout = () => cancelJob("timeout");
    const removeAbortListener = () => options.signal?.removeEventListener("abort", onAbort);

    if (timeoutMs > 0) {
      timeoutId = setTimeout(onTimeout, timeoutMs);
    }

    if (options.signal) {
      if (options.signal.aborted) {
        cancelJob("parent-abort");
      } else {
        options.signal.addEventListener("abort", onAbort, { once: true });
      }
    }

    proc.on("close", (code, signal) => finalize(code, signal));
    proc.on("error", () => finalize(null, null, true));
  });

  return { proc, result, cancel: cancelJob };
}

export async function runWithConcurrencyLimit<T, R>(
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
      const item = items[index];
      if (item === undefined) throw new Error("runWithConcurrencyLimit: item index out of bounds");
      results[index] = await fn(item, index);
    }
  });

  await Promise.all(workers);
  return results;
}

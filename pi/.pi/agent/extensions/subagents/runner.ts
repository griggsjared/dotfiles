import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rmdir, unlink, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { tmpdir } from "node:os";
import type { AgentConfig } from "./agents.ts";
import { normalizeTitle, toolCallLabel } from "./format.ts";
import {
  accumulateEvent,
  assistantText,
  createStreamState,
  extractFinalText,
  normalizeToolArgs,
  parseParentQuestion,
  sanitizeToolCallArgs,
  truncateStrings,
} from "./jsonl.ts";
import type {
  CancellationReason,
  JobEventInput,
  SubagentDelivery,
  SubagentQuestion,
  SubagentResult,
  SubagentUpdate,
} from "./types.ts";

const DEFAULT_TOOLS = ["read", "grep", "find", "ls", "bash"];
const MAX_CHILD_OUTPUT = 4 * 1024 * 1024; // keep only the tail of child stdout
const MAX_CHILD_ERROR = 1024 * 1024; // keep only the tail of child stderr
const STREAM_INTERVAL_MS = 2000; // throttle live progress updates to the model
const SHUTDOWN_GRACE_MS = 10000;
const MAX_EVENT_SUMMARY = 500;

function flattenSummary(value: string): string {
  const flattened = value.replace(/\s+/g, " ").trim();
  return flattened.length > MAX_EVENT_SUMMARY
    ? `${flattened.slice(0, MAX_EVENT_SUMMARY - 1)}…`
    : flattened;
}

function valueSummary(value: unknown): string {
  if (typeof value === "string") return flattenSummary(String(truncateStrings(value)));
  let serialized: string;
  try {
    serialized = JSON.stringify(truncateStrings(value)) ?? String(value);
  } catch {
    serialized = String(value);
  }
  return flattenSummary(serialized);
}

function toolName(event: Record<string, unknown>): string {
  const nested = event.toolCall;
  const call = nested && typeof nested === "object" ? nested as Record<string, unknown> : undefined;
  return String(event.toolName ?? event.name ?? call?.toolName ?? call?.name ?? "tool");
}

function toolArgs(event: Record<string, unknown>): Record<string, unknown> {
  const nested = event.toolCall;
  const call = nested && typeof nested === "object" ? nested as Record<string, unknown> : undefined;
  return normalizeToolArgs(event.args ?? event.arguments ?? event.input ?? call?.args ?? call?.arguments);
}

function toolStartSummary(event: Record<string, unknown>): string {
  const name = toolName(event);
  const args = truncateStrings(sanitizeToolCallArgs(name, toolArgs(event))) as Record<string, unknown>;
  return flattenSummary(toolCallLabel(name, args));
}

function toolEndSummary(event: Record<string, unknown>): string {
  const name = toolName(event);
  const isError = event.isError === true || event.success === false || event.error !== undefined;
  const status = isError ? "error" : "success";
  if (name === "write" || name === "edit") return flattenSummary(`${name} ${status}`);
  const detail = isError ? event.error ?? event.result : event.result;
  return flattenSummary(detail === undefined
    ? `${name} ${status}`
    : `${name} ${status}: ${valueSummary(detail)}`);
}

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
  onEvent?: (event: JobEventInput) => void;
  onQuestion?: (question: SubagentQuestion) => void;
  maxRuntimeMs?: number;
  thinkingLevel?: string;
  title?: string;
  bridgeExtensionPath?: string;
  spawnFn?: typeof spawn;
  killDelayMs?: number;
  shutdownGraceMs?: number;
}

export interface SubagentRun {
  proc: ChildProcess;
  result: Promise<SubagentResult>;
  cancel(reason: CancellationReason): void;
  send(message: string, deliverAs: SubagentDelivery): Promise<void>;
  reply(questionId: string, answer: string): Promise<void>;
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
 ): Promise<SubagentRun> {
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
  const title = normalizeTitle(options.title);
  const bridgeExtension = options.bridgeExtensionPath;
  const hasBridgeExtension = !!bridgeExtension && isAbsolute(bridgeExtension);
  const tools = [...new Set([
    ...(agent.tools ?? DEFAULT_TOOLS),
    ...(hasBridgeExtension ? ["ask_parent"] : []),
  ])].join(",");
  const guardExtension = process.env.PI_WORKSPACE_GUARD_EXTENSION;
  const hasGuardExtension = !!guardExtension && isAbsolute(guardExtension);
  const args = [
    ...base.args,
    "--mode",
    "rpc",
    "--no-session",
    "--no-extensions",
    ...(hasBridgeExtension ? ["--extension", bridgeExtension] : []),
    ...(hasGuardExtension ? ["--extension", guardExtension] : []),
    "--no-context-files",
    ...(model ? ["--model", model] : []),
    ...(options.thinkingLevel ? ["--thinking", options.thinkingLevel] : []),
    "--tools",
    tools,
    "--append-system-prompt",
    promptFile,
  ];

  let proc: ChildProcess;
  try {
    // Children are node scripts; deep sessions (high-effort thinking) can
    // exceed node's default 4GB heap. Raise the cap, preserving any existing
    // NODE_OPTIONS.
    const nodeOptions = process.env.NODE_OPTIONS
      ? `${process.env.NODE_OPTIONS} --max-old-space-size=8192`
      : "--max-old-space-size=8192";
    const childEnv: NodeJS.ProcessEnv = { ...process.env, NODE_OPTIONS: nodeOptions };
    delete childEnv.PI_WORKSPACE_GUARD_CHILD;
    if (hasGuardExtension) childEnv.PI_WORKSPACE_GUARD_CHILD = "1";
    proc = (options.spawnFn ?? spawn)(base.cmd, args, {
      cwd,
      shell: false,
      env: childEnv,
    });
    if (!proc.stdin) {
      killProcess(proc, options.killDelayMs);
      throw new Error("Subagent RPC child has no stdin pipe");
    }
  } catch (err) {
    await unlink(promptFile).catch(() => {});
    await rmdir(tmpDir).catch(() => {});
    throw err;
  }

  const stdin = proc.stdin!;
  let cancelJob: (reason: CancellationReason) => void = () => {};
  let sendMessage: (message: string, deliverAs: SubagentDelivery) => Promise<void> = async () => {
    throw new Error("Subagent transport is not ready");
  };
  let replyToQuestion: (questionId: string, answer: string) => Promise<void> = async () => {
    throw new Error("Subagent transport is not ready");
  };
  const result = new Promise<SubagentResult>((resolve) => {
    interface PendingCommand {
      command: "prompt";
      continuation: boolean;
      resolve: () => void;
      reject: (error: Error) => void;
    }

    let stdout = "";
    let stderr = "";
    let pending = "";
    let lastStreamAt = 0;
    const state = createStreamState(model ?? "");
    const commands = new Map<string, PendingCommand>();
    const questions = new Map<string, SubagentQuestion>();
    const answeringQuestions = new Set<string>();
    let nextCommandId = 1;
    let settled = false;
    let settling = false;
    let accepting = true;
    let inputEnded = false;
    let cancelled = false;
    let cancellationReason: CancellationReason | undefined;
    let transportError: string | undefined;
    let completionWatchdogFired = false;
    let shutdownTimer: ReturnType<typeof setTimeout> | undefined;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      unlink(promptFile).catch(() => {});
      rmdir(tmpDir).catch(() => {});
    };
    const startShutdownWatchdog = () => {
      if (shutdownTimer || settled) return;
      shutdownTimer = setTimeout(() => {
        completionWatchdogFired = true;
        killProcess(proc, options.killDelayMs);
      }, options.shutdownGraceMs ?? SHUTDOWN_GRACE_MS);
    };
    const rejectCommands = (error: Error) => {
      for (const command of commands.values()) command.reject(error);
      commands.clear();
    };
    const endInput = () => {
      if (inputEnded) return;
      inputEnded = true;
      accepting = false;
      try {
        stdin.end();
      } catch { /* child already closed */ }
      startShutdownWatchdog();
    };
    const finishSettling = () => {
      if (!settling || commands.size > 0 || questions.size > 0) return;
      endInput();
    };
    const writePayload = (payload: Record<string, unknown>): Promise<void> => {
      if (!accepting || settled || cancelled) {
        return Promise.reject(new Error("Subagent is no longer accepting messages"));
      }
      return new Promise<void>((resolveWrite, rejectWrite) => {
        try {
          stdin.write(`${JSON.stringify(payload)}\n`, (error) => {
            if (error) rejectWrite(error);
            else resolveWrite();
          });
        } catch (err) {
          rejectWrite(err instanceof Error ? err : new Error(String(err)));
        }
      });
    };
    const sendCommand = (
      message: string,
      continuation: boolean,
      streamingBehavior?: SubagentDelivery,
    ): Promise<void> => {
      if (!accepting || settled || cancelled) {
        return Promise.reject(new Error("Subagent is no longer accepting messages"));
      }
      const id = `subagent-${nextCommandId++}`;
      return new Promise<void>((resolveCommand, rejectCommand) => {
        commands.set(id, { command: "prompt", continuation, resolve: resolveCommand, reject: rejectCommand });
        try {
          stdin.write(`${JSON.stringify({ id, type: "prompt", message, ...(streamingBehavior ? { streamingBehavior } : {}) })}\n`, (error) => {
            if (!error || !commands.delete(id)) return;
            rejectCommand(error);
            finishSettling();
          });
        } catch (err) {
          commands.delete(id);
          rejectCommand(err instanceof Error ? err : new Error(String(err)));
          finishSettling();
        }
      });
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
    const safeQuestion = (question: SubagentQuestion) => {
      try {
        options.onQuestion?.(question);
      } catch (err) {
        console.error("subagents: question callback failed", err);
      }
    };
    const safeEvent = (event: JobEventInput) => {
      try {
        options.onEvent?.(event);
      } catch (err) {
        console.error("subagents: event callback failed", err);
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

    const handleResponse = (event: Record<string, unknown>): boolean => {
      if (event.type !== "response" || typeof event.id !== "string") return false;
      const command = commands.get(event.id);
      if (!command) return true;
      commands.delete(event.id);
      if (event.success === true) {
        command.resolve();
        if (settling && command.continuation) settling = false;
      } else {
        command.reject(new Error(typeof event.error === "string" ? event.error : `${command.command} was rejected`));
      }
      finishSettling();
      return true;
    };
    const handleLine = (line: string) => {
      let event: Record<string, unknown> | undefined;
      try {
        const parsed = JSON.parse(line) as unknown;
        if (parsed && typeof parsed === "object") event = parsed as Record<string, unknown>;
      } catch { /* accumulateEvent ignores malformed lines */ }
      if (event && handleResponse(event)) return;

      if (!settled && accepting) {
        const question = parseParentQuestion(line);
        if (question && !questions.has(question.id)) {
          questions.set(question.id, question);
          safeQuestion(question);
        }
      }

      accumulateEvent(state, line);
      maybeStream();
      if (!event || settled) return;
      switch (event.type) {
        case "tool_execution_start":
          safeEvent({ kind: "tool-start", summary: toolStartSummary(event) });
          break;
        case "tool_execution_end":
          safeEvent({ kind: "tool-end", summary: toolEndSummary(event) });
          break;
        case "message_end": {
          const message = event.message;
          if (message && typeof message === "object" && (message as { role?: unknown }).role === "assistant") {
            const text = assistantText((message as { content?: unknown }).content);
            if (text) safeEvent({ kind: "assistant", summary: flattenSummary(text) });
          }
          break;
        }
        case "agent_start":
          safeEvent({ kind: "state", summary: "started" });
          settling = false;
          break;
        case "agent_settled":
          safeEvent({ kind: "state", summary: "settled" });
          settling = true;
          finishSettling();
          break;
      }
    };

    const finalize = (code: number | null, signal: NodeJS.Signals | null, processError = false) => {
      if (settled) return;
      // Flush any final line that arrived without a trailing newline before
      // closing the transport state.
      if (pending.trim()) handleLine(pending);
      settled = true;
      accepting = false;
      removeAbortListener();
      if (timeoutId) clearTimeout(timeoutId);
      if (shutdownTimer) clearTimeout(shutdownTimer);
      rejectCommands(new Error("Subagent process closed"));
      questions.clear();
      const text = state.finalText || state.streamedText || state.finalThinking || extractFinalText(stdout);
      cleanup();
      safeUpdate({
        text,
        usage: { ...state.usage },
        toolCalls: [...state.toolCalls],
        model: state.model,
        thinkingLevel: options.thinkingLevel,
      });
      const failedTransport = processError || transportError !== undefined;
      if (!text && stdout.length > 0 && !failedTransport) {
        const snippet = stdout.length > 2000
          ? `...(truncated)\n${stdout.slice(-2000)}`
          : stdout;
        stderr += `\n[subagents] No text extracted from ${stdout.split("\n").length} JSONL lines. Last lines:\n${snippet}`;
      }
      if (transportError) stderr += `${stderr ? "\n" : ""}[subagents] ${transportError}`;
      if (cancelled) {
        stderr = stderr ? `${stderr}\n` : "";
        stderr += `Cancelled (${cancellationReason ?? "manual"}).`;
      } else if (!completionWatchdogFired && !failedTransport && signal) {
        stderr += `\n[subagents] Killed by ${signal}`;
      } else if (!completionWatchdogFired && !failedTransport && code != null && code >= 128) {
        stderr += `\n[subagents] Killed by signal ${code - 128}`;
      }
      resolve({
        agent: agent.name,
        task,
        title,
        text,
        exitCode: cancelled ? 130 : failedTransport ? 1 : completionWatchdogFired ? 0 : (signal || (code != null && code >= 128) ? 1 : (code ?? 0)),
        error: failedTransport ? stderr || "failed to run subagent RPC transport" : stderr,
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

    cancelJob = (reason) => {
      if (settled || cancelled) return;
      cancelled = true;
      accepting = false;
      cancellationReason = reason;
      rejectCommands(new Error(`Subagent cancelled (${reason})`));
      questions.clear();
      killProcess(proc, options.killDelayMs);
    };
    sendMessage = (message, deliverAs) => sendCommand(message, true, deliverAs);
    replyToQuestion = async (questionId, answer) => {
      if (!questions.has(questionId)) throw new Error(`Unknown or answered subagent question: ${questionId}`);
      if (answeringQuestions.has(questionId)) throw new Error(`Subagent question is already being answered: ${questionId}`);
      answeringQuestions.add(questionId);
      try {
        await writePayload({ type: "extension_ui_response", id: questionId, value: answer });
        questions.delete(questionId);
        finishSettling();
      } finally {
        answeringQuestions.delete(questionId);
      }
    };

    const timeoutMs = options.maxRuntimeMs ?? agent.maxRuntimeMs ?? 0;
    const onAbort = () => cancelJob("parent-abort");
    const onTimeout = () => cancelJob("timeout");
    const removeAbortListener = () => options.signal?.removeEventListener("abort", onAbort);

    if (timeoutMs > 0) timeoutId = setTimeout(onTimeout, timeoutMs);
    if (options.signal) {
      if (options.signal.aborted) cancelJob("parent-abort");
      else options.signal.addEventListener("abort", onAbort, { once: true });
    }

    proc.on("close", (code, signal) => finalize(code, signal));
    proc.on("error", () => finalize(null, null, true));

    const initialPrompt = `${title ? `Title: ${title}\n` : ""}Task: ${task}`;
    void sendCommand(initialPrompt, false).catch((err) => {
      if (cancelled || settled) return;
      transportError = `Initial RPC prompt failed: ${String(err)}`;
      endInput();
    });
  });

  return { proc, result, cancel: cancelJob, send: sendMessage, reply: replyToQuestion };
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

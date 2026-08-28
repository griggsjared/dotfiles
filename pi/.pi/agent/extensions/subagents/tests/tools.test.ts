import { test } from "node:test";
import assert from "node:assert/strict";
import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AgentConfig } from "../agents.ts";
import { createJobRegistry } from "../registry.ts";
import { registerRenderers, renderFullWidget } from "../render.ts";
import { Batch, createSubagentTool, resolveMode } from "../tools.ts";
import {
  createReplyTool,
  createSendTool,
  createStatusTool,
  registerStatusCommands,
} from "../status-tools.ts";
import { EMPTY_USAGE, ENTRY_TYPE, QUESTION_ENTRY_TYPE } from "../types.ts";
import {
  FakeChild,
  fakeSpawn,
  fakeSpawnChildren,
  endEvent,
  questionEvent,
  responseEvent,
  type SpawnCall,
} from "./fake-child.ts";

const AGENT: AgentConfig = {
  name: "scout",
  description: "test scout",
  systemPrompt: "You are a scout.",
};

function spy() {
  const calls: unknown[][] = [];
  const fn = (...args: unknown[]) => {
    calls.push(args);
  };
  return { calls, fn };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// --- resolveMode -------------------------------------------------------------

test("resolveMode: single, batch, and validation", () => {
  assert.deepEqual(resolveMode({ agent: "a", task: "t", title: "x" }), {
    single: { agent: "a", task: "t", title: "x" },
  });
  assert.deepEqual(resolveMode({ tasks: [{ agent: "a", task: "t" }] }), {
    tasks: [{ agent: "a", task: "t" }],
  });
  assert.throws(() => resolveMode({}), /exactly one mode/);
  assert.throws(() => resolveMode({ agent: "a" }), /exactly one mode/); // agent without task is not a single
  assert.throws(
    () => resolveMode({ agent: "a", task: "t", tasks: [{ agent: "a", task: "t" }] }),
    /exactly one mode/,
  );
  assert.throws(() => resolveMode({ tasks: [] }), /at least one task/);
});

// --- Batch -------------------------------------------------------------------

function makeBatch() {
  const registry = createJobRegistry();
  const sendMessage = spy();
  const sendUserMessage = spy();
  const pi = { sendMessage: sendMessage.fn, sendUserMessage: sendUserMessage.fn } as unknown as ExtensionAPI;
  let refreshes = 0;
  const batch = new Batch({ pi, registry, refresh: () => { refreshes += 1; } });
  return { registry, batch, sendMessage, sendUserMessage, refreshes: () => refreshes };
}

function complete(registry: ReturnType<typeof createJobRegistry>, id: number, exitCode = 0) {
  registry.complete(id, {
    agent: `agent-${id}`,
    task: `task-${id}`,
    title: `title-${id}`,
    text: "done",
    exitCode,
    error: exitCode === 0 ? "" : "boom",
  });
}

test("Batch: summary fires exactly once when the last job completes", () => {
  const { registry, batch, sendMessage } = makeBatch();
  const id1 = registry.add("a", "t1");
  const id2 = registry.add("b", "t2");
  batch.addJob(id1);
  batch.addJob(id2);

  complete(registry, id1);
  batch.recordCompletion(id1);
  batch.summary();
  assert.equal(sendMessage.calls.length, 0, "pending > 0, no summary yet");

  complete(registry, id2, 1);
  batch.recordCompletion(id2);
  batch.summary();
  assert.equal(sendMessage.calls.length, 1);
  const [message, options] = sendMessage.calls[0] as [{ content: string; display: boolean }, { triggerTurn: boolean; deliverAs: string }];
  assert.equal(message.display, false);
  assert.equal(options.triggerTurn, true);
  assert.equal(options.deliverAs, "steer");
  const lines = message.content;
  assert.equal(lines.split("\n")[0], "**Subagents complete:**");
  assert.match(lines, /✓ #1 a \(.*\): t1/);
  assert.match(lines, /✗ #2 b \(.*\): t2/);
  // markCleared ran: nothing pending for display anymore
  assert.equal(registry.pendingCompleted().length, 0);
});

test("Batch: an extra summary call never re-fires", () => {
  const { registry, batch, sendMessage } = makeBatch();
  const id = registry.add("a", "t");
  batch.addJob(id);
  complete(registry, id);
  batch.recordCompletion(id);
  batch.summary();
  batch.summary(); // would decrement to -1 under a naive guard
  assert.equal(sendMessage.calls.length, 1);
});

test("Batch: summary with no completed jobs sends nothing", () => {
  const { registry, batch, sendMessage } = makeBatch();
  const id = registry.add("a", "t");
  batch.addJob(id);
  batch.summary();
  assert.equal(sendMessage.calls.length, 0);
});

test("Batch: overlapping batches don't cross-suppress and clear only their own ids", () => {
  const registry = createJobRegistry();
  const sendMessage = spy();
  const sendUserMessage = spy();
  const pi = { sendMessage: sendMessage.fn, sendUserMessage: sendUserMessage.fn } as unknown as ExtensionAPI;
  const b1 = new Batch({ pi, registry, refresh: () => {} });
  const b2 = new Batch({ pi, registry, refresh: () => {} });

  const id1 = registry.add("a", "t1");
  const id2 = registry.add("b", "t2");
  b1.addJob(id1);
  b2.addJob(id2);

  complete(registry, id1);
  b1.recordCompletion(id1);
  b1.summary();
  assert.equal(sendMessage.calls.length, 1, "b1 completes independently");

  complete(registry, id2);
  b2.recordCompletion(id2);
  b2.summary();
  assert.equal(sendMessage.calls.length, 2, "b2 completes independently");

  // b1 cleared id1 but not id2; b2's own summary then cleared id2 as well
  assert.equal(registry.pendingCompleted().length, 0);
});

test("Batch: deliverResult sends a capped ENTRY_TYPE message with typed details", () => {
  const { registry, batch, sendMessage } = makeBatch();
  const id = registry.add("a", "t");
  batch.addJob(id);
  complete(registry, id);
  const longText = "x".repeat(25000);
  batch.deliverResult(id, {
    agent: "a",
    task: "t",
    text: longText,
    exitCode: 0,
    error: "",
    model: "openai-codex/gpt-5.6-luna",
    thinkingLevel: "high",
  });
  assert.equal(sendMessage.calls.length, 1);
  const [message, options] = sendMessage.calls[0] as [
    { customType: string; content: string; details: { status: string; icon: string; jobId?: number; agent: string; model?: string; thinkingLevel?: string } },
    { deliverAs: string },
  ];
  assert.equal(message.customType, ENTRY_TYPE);
  assert.equal(message.content.length, 20002); // 20000 + "\n…"
  assert.equal(message.details.status, "completed");
  assert.equal(message.details.icon, "✓");
  assert.equal(message.details.jobId, id);
  assert.equal(message.details.model, "openai-codex/gpt-5.6-luna");
  assert.equal(message.details.thinkingLevel, "high");
  assert.equal(options.deliverAs, "steer");
  // Complete the first batch member before adding the second one so the
  // summary bookkeeping represents both jobs.
  batch.summary();

  const cancelledId = registry.add("b", "cancelled");
  batch.addJob(cancelledId);
  registry.cancel(cancelledId, "timeout");
  registry.complete(cancelledId, {
    agent: "b", task: "cancelled", title: "cancelled", text: "", exitCode: 130,
    error: "Cancelled (timeout).", cancelled: true, cancellationReason: "timeout",
  });
  batch.recordCompletion(cancelledId);
  batch.deliverResult(cancelledId, {
    agent: "b", task: "cancelled", text: "", exitCode: 130, error: "Cancelled (timeout).",
    cancelled: true, cancellationReason: "timeout",
  });
  const cancelledMessage = sendMessage.calls[1]?.[0] as { details: { status: string; icon: string; cancellationReason?: string } };
  assert.equal(cancelledMessage.details.status, "cancelled");
  assert.equal(cancelledMessage.details.icon, "⊘");
  assert.equal(cancelledMessage.details.cancellationReason, "timeout");
  batch.summary();
  assert.match((sendMessage.calls[2]?.[0] as { content: string }).content, /cancelled \(timeout\)/);
});

test("subagent status includes compact model and effort", async () => {
  const registry = createJobRegistry();
  registry.add("scout", "running task", undefined, {
    model: "openai-codex/gpt-5.6-luna",
    thinkingLevel: "minimal",
  });
  const id = registry.add("worker", "task");
  registry.complete(id, {
    agent: "worker",
    task: "task",
    text: "done",
    exitCode: 0,
    error: "",
    usage: { ...EMPTY_USAGE, turns: 1 },
    model: "openai-codex/gpt-5.6-luna",
    thinkingLevel: "high",
  });
  const tool = createStatusTool({ registry });
  const result = await tool.execute("call1", {}, undefined, undefined, {} as never);
  const text = (result.content[0] as { text: string }).text;
  assert.match(text, /◐ #1 scout .*openai-codex\/gpt-5\.6-luna:minimal/);
  assert.match(text, /openai-codex\/gpt-5\.6-luna:high/);
});

test("subagent status supports individual and unknown job IDs", async () => {
  const registry = createJobRegistry();
  const runningId = registry.add("scout", "running task");
  registry.updateLive(runningId, {
    text: "latest output",
    progress: "reading files",
    usage: { ...EMPTY_USAGE, turns: 1 },
    toolCalls: [{ name: "read", args: { path: "src/index.ts" } }],
    model: "p/m",
    thinkingLevel: "minimal",
  });
  const completedId = registry.add("worker", "completed task");
  registry.complete(completedId, {
    agent: "worker",
    task: "completed task",
    text: "done",
    exitCode: 0,
    error: "",
  });
  const tool = createStatusTool({ registry });

  const individual = await tool.execute("call1", { jobId: runningId }, undefined, undefined, {} as never);
  const individualText = (individual.content[0] as { text: string }).text;
  assert.match(individualText, new RegExp(`Subagent #${runningId}`));
  assert.match(individualText, /State: running/);
  assert.match(individualText, /Progress: reading files/);
  assert.match(individualText, /Usage: 1 turn p\/m:minimal/);
  assert.match(individualText, /Tool calls \(1\):\n- read src\/index\.ts/);
  assert.match(individualText, /Latest output:\nlatest output/);
  assert.doesNotMatch(individualText, new RegExp(`#${completedId} worker`));

  registry.recordQuestion(runningId, { id: "question-1", question: "Which API?" });
  const waiting = await tool.execute("call2", { jobId: runningId }, undefined, undefined, {} as never);
  assert.match((waiting.content[0] as { text: string }).text, /Waiting for parent \(1\):\n- question-1: Which API\?/);

  const unknown = await tool.execute("call3", { jobId: 999 }, undefined, undefined, {} as never);
  assert.equal((unknown.content[0] as { text: string }).text, "Unknown subagent job ID: 999");
});

test("/subagent-status shares the status formatter", async () => {
  const registry = createJobRegistry();
  const id = registry.add("scout", "running task");
  const notices: string[] = [];
  const commands = new Map<string, { handler: (args: string, ctx: unknown) => Promise<void> }>();
  const pi = {
    registerCommand(name: string, command: { handler: (args: string, ctx: unknown) => Promise<void> }) {
      commands.set(name, command);
    },
  } as unknown as ExtensionAPI;
  registerStatusCommands(pi, { registry, activeProcs: new Set() });
  const command = commands.get("subagent-status");
  assert.ok(command);
  const ctx = {
    hasUI: true,
    ui: { notify: (text: string) => notices.push(text) },
  };

  await command.handler("", ctx);
  assert.match(notices.at(-1) ?? "", new RegExp(`#${id} scout`));
  await command.handler(String(id), ctx);
  assert.match(notices.at(-1) ?? "", new RegExp(`Subagent #${id}`));
  await command.handler("nope", ctx);
  assert.match(notices.at(-1) ?? "", /Usage: \/subagent-status/);
});

test("/subagent-cancel validates and targets numeric job IDs", async () => {
  const registry = createJobRegistry();
  const id = registry.add("scout", "task");
  let cancelled = 0;
  registry.registerControl(id, {
    cancel: () => { cancelled += 1; },
    send: async () => {},
    reply: async () => {},
  });
  const notices: string[] = [];
  const commands = new Map<string, { handler: (args: string, ctx: unknown) => Promise<void> }>();
  const pi = { registerCommand: (name: string, command: { handler: (args: string, ctx: unknown) => Promise<void> }) => commands.set(name, command) } as unknown as ExtensionAPI;
  registerStatusCommands(pi, { registry });
  const command = commands.get("subagent-cancel")!;
  const ctx = { ui: { notify: (text: string) => notices.push(text) } };
  await command.handler("abc", ctx);
  assert.match(notices.at(-1) ?? "", /Usage: \/subagent-cancel/);
  await command.handler("\\\\1", ctx);
  assert.match(notices.at(-1) ?? "", /Usage: \/subagent-cancel/);
  await command.handler(String(id), ctx);
  assert.match(notices.at(-1) ?? "", /Cancelling 1/);
  assert.equal(cancelled, 1);
});

test("/subagent-send parses steering and follow-up messages", async () => {
  const registry = createJobRegistry();
  const id = registry.add("scout", "task");
  const sent: Array<{ message: string; deliverAs: string }> = [];
  registry.registerControl(id, {
    cancel: () => {},
    send: async (message, deliverAs) => { sent.push({ message, deliverAs }); },
    reply: async () => {},
  });
  const notices: Array<{ text: string; level: string }> = [];
  const commands = new Map<string, { handler: (args: string, ctx: unknown) => Promise<void> }>();
  const pi = {
    registerCommand: (name: string, command: { handler: (args: string, ctx: unknown) => Promise<void> }) => commands.set(name, command),
  } as unknown as ExtensionAPI;
  registerStatusCommands(pi, { registry });
  const command = commands.get("subagent-send");
  assert.ok(command);
  const ctx = {
    hasUI: true,
    ui: { notify: (text: string, level: string) => notices.push({ text, level }) },
  };

  await command.handler(`${id} steer Narrow the scope`, ctx);
  await command.handler(`${id} followup Queue a second pass`, ctx);
  assert.deepEqual(sent, [
    { message: "Narrow the scope", deliverAs: "steer" },
    { message: "Queue a second pass", deliverAs: "followUp" },
  ]);
  assert.deepEqual(notices, [
    { text: "Sent steering message to subagent #1.", level: "info" },
    { text: "Sent follow-up message to subagent #1.", level: "info" },
  ]);

  await command.handler("bad steer message", ctx);
  assert.match(notices.at(-1)?.text ?? "", /Usage: \/subagent-send/);
  assert.equal(notices.at(-1)?.level, "error");
});

test("/subagent-send reports rejected messages", async () => {
  const registry = createJobRegistry();
  const id = registry.add("scout", "task");
  registry.registerControl(id, {
    cancel: () => {},
    send: async () => { throw new Error("RPC prompt rejected"); },
    reply: async () => {},
  });
  const notices: Array<{ text: string; level: string }> = [];
  const commands = new Map<string, { handler: (args: string, ctx: unknown) => Promise<void> }>();
  const pi = {
    registerCommand: (name: string, command: { handler: (args: string, ctx: unknown) => Promise<void> }) => commands.set(name, command),
  } as unknown as ExtensionAPI;
  registerStatusCommands(pi, { registry });
  const command = commands.get("subagent-send");
  assert.ok(command);

  await command.handler(`${id} steer This will fail`, {
    hasUI: true,
    ui: { notify: (text: string, level: string) => notices.push({ text, level }) },
  });
  assert.deepEqual(notices, [{ text: "RPC prompt rejected", level: "error" }]);
});

// --- createSubagentTool.execute ----------------------------------------------

function makeTool(
  spawnOverride?: { spawnFn: typeof spawn },
  settings = { defaults: {}, agents: {} },
) {
  const registry = createJobRegistry();
  const sendMessage = spy();
  const sendUserMessage = spy();
  const pi = { sendMessage: sendMessage.fn, sendUserMessage: sendUserMessage.fn } as unknown as ExtensionAPI;
  const activeTickers = new Set<ReturnType<typeof setInterval>>();
  const activeProcs = new Set<ChildProcess>();
  const child = new FakeChild();
  const tool = createSubagentTool({
    pi,
    agents: [AGENT],
    settings,
    discover: async () => [AGENT],
    registry,
    activeProcs,
    activeTickers,
    bridgeExtensionPath: "/extensions/child-bridge.ts",
    onUiContext: () => {},
    refresh: () => {},
    spawnFn: spawnOverride?.spawnFn ?? fakeSpawn(child),
  });
  const ctx = {
    cwd: "/tmp",
    model: { provider: "p", id: "m" },
    thinkingLevel: undefined,
    hasUI: false,
  } as unknown as ExtensionContext;
  return { tool, registry, sendMessage, sendUserMessage, activeTickers, activeProcs, child, ctx };
}

test("execute: local settings set child model and thinking level", async () => {
  const child = new FakeChild();
  const calls: SpawnCall[] = [];
  const spawnFn = ((cmd: string, args: string[], options?: Record<string, unknown>) => {
    calls.push({ cmd, args, options: options ?? {} });
    return child;
  }) as unknown as typeof spawn;
  const { tool, ctx } = makeTool(
    { spawnFn },
    { defaults: { model: "default-model", thinkingLevel: "low" }, agents: { scout: { model: "local-model", thinkingLevel: "high" } } },
  );
  await tool.execute("call1", { agent: "scout", task: "t" }, undefined, undefined, ctx);

  await sleep(10);
  child.stdout.emit("data", Buffer.from(endEvent("done")));
  child.finish(0);
  await sleep(20);

  const args = calls[0]?.args ?? [];
  assert.equal(args[args.indexOf("--model") + 1], "local-model");
  assert.equal(args[args.indexOf("--thinking") + 1], "high");
});

test("execute: default settings set child model and thinking level", async () => {
  const child = new FakeChild();
  const calls: SpawnCall[] = [];
  const spawnFn = ((cmd: string, args: string[], options?: Record<string, unknown>) => {
    calls.push({ cmd, args, options: options ?? {} });
    return child;
  }) as unknown as typeof spawn;
  const { tool, ctx } = makeTool(
    { spawnFn },
    { defaults: { model: "default-model", thinkingLevel: "low" }, agents: {} },
  );
  await tool.execute("call1", { agent: "scout", task: "t" }, undefined, undefined, ctx);

  await sleep(10);
  child.stdout.emit("data", Buffer.from(endEvent("done")));
  child.finish(0);
  await sleep(20);

  const args = calls[0]?.args ?? [];
  assert.equal(args[args.indexOf("--model") + 1], "default-model");
  assert.equal(args[args.indexOf("--thinking") + 1], "low");
});

test("execute: setup failures preserve inherited model and effort", async () => {
  const spawnFn = (() => {
    throw new Error("spawn failed");
  }) as typeof spawn;
  const { tool, registry, sendMessage, ctx } = makeTool({ spawnFn });
  (ctx as unknown as { thinkingLevel?: string }).thinkingLevel = "medium";

  const result = await tool.execute("call1", { agent: "scout", task: "t" }, undefined, undefined, ctx);
  assert.equal(result.details.status, "launched");
  await sleep(20);
  assert.equal(registry.get(1)?.status, "failed");
  const [message] = sendMessage.calls[0] as [{ details: { model?: string; thinkingLevel?: string } }];
  assert.equal(message.details.model, "p/m");
  assert.equal(message.details.thinkingLevel, "medium");
});

test("subagent schema has no execution mode", () => {
  const { tool } = makeTool();
  const properties = (tool.parameters as { properties: Record<string, unknown> }).properties;
  assert.equal("execution" in properties, false);
});

test("execute: legacy sync input cannot make a single job block", async () => {
  const { tool, registry, sendMessage, activeTickers, activeProcs, child, ctx } = makeTool();
  const result = await tool.execute(
    "call1",
    { agent: "scout", task: "t", execution: "sync" } as never,
    undefined,
    undefined,
    ctx,
  );

  assert.equal(result.details.status, "launched");
  assert.equal(registry.running().length, 1);
  assert.deepEqual(result.details, {
    agent: "scout",
    status: "launched",
    jobIds: [1],
    jobScope: registry.scope,
  });

  await sleep(10); // let runSubagent attach stream listeners
  child.stdout.emit("data", Buffer.from(endEvent("scouted")));
  child.finish(0);
  await sleep(20);

  assert.equal(sendMessage.calls.length, 2, "completion sends the result and hidden summary");
  assert.equal(registry.running().length, 0);
  assert.equal(activeTickers.size, 0);
  assert.equal(activeProcs.size, 0);
});

test("execute: single returns launched, then delivers result + summary", async () => {
  const { tool, registry, sendMessage, child, ctx } = makeTool();
  const result = await tool.execute("call1", { agent: "scout", task: "t" }, undefined, undefined, ctx);
  assert.equal(result.details.status, "launched");
  assert.equal(result.details.jobScope, registry.scope);
  assert.deepEqual(result.details.jobIds, [1]);

  await sleep(10);
  child.stdout.emit("data", Buffer.from(endEvent("scouted")));
  child.finish(0);
  await sleep(20); // let the .then chain run

  assert.equal(sendMessage.calls.length, 2, "result and hidden batch summary sent");
  assert.equal((sendMessage.calls[0]?.[0] as { details: { status: string } }).details.status, "completed");
  const [summary, options] = sendMessage.calls[1] as [{ content: string; display: boolean }, { triggerTurn: boolean }];
  assert.equal(summary.display, false);
  assert.equal(options.triggerTurn, true);
  assert.match(summary.content, /\*\*Subagents complete:\*\*/);
});

test("subagent_send delivers a correlated steering command to a running child", async () => {
  const { tool, registry, child, ctx } = makeTool();
  await tool.execute("call1", { agent: "scout", task: "t" }, undefined, undefined, ctx);
  await sleep(10);
  const initial = child.stdin.commands()[0];
  assert.ok(initial);
  child.stdout.emit("data", Buffer.from(responseEvent(initial)));

  const sendTool = createSendTool({ registry });
  const pending = sendTool.execute(
    "call2",
    { jobId: 1, message: "Check the error path", deliverAs: "steer" },
    undefined,
    undefined,
    ctx,
  );
  const command = child.stdin.commands()[1];
  assert.deepEqual(command, {
    id: "subagent-2",
    type: "prompt",
    message: "Check the error path",
    streamingBehavior: "steer",
  });
  child.stdout.emit("data", Buffer.from(responseEvent(command!)));
  const sent = await pending;
  assert.match((sent.content[0] as { text: string }).text, /Sent steer message to subagent #1/);

  child.finish(0);
  await sleep(20);
});

test("child questions trigger a parent turn and subagent_reply resolves them", async () => {
  const { tool, registry, sendMessage, child, ctx } = makeTool();
  await tool.execute("call1", { agent: "scout", task: "t" }, undefined, undefined, ctx);
  await sleep(10);
  const initial = child.stdin.commands()[0];
  assert.ok(initial);
  child.stdout.emit("data", Buffer.from(responseEvent(initial)));
  child.stdout.emit("data", Buffer.from(questionEvent("question-1", "Which API?", "Two choices")));

  assert.deepEqual(registry.get(1)?.pendingQuestions.map((question) => question.id), ["question-1"]);
  const [message, options] = sendMessage.calls[0] as [
    { customType: string; content: string; display: boolean; details: { jobId: number; questionId: string } },
    { deliverAs: string; triggerTurn: boolean },
  ];
  assert.equal(message.customType, QUESTION_ENTRY_TYPE);
  assert.equal(message.display, true);
  assert.equal(message.details.jobId, 1);
  assert.equal(message.details.questionId, "question-1");
  assert.match(message.content, /call ask_user first/);
  assert.deepEqual(options, { deliverAs: "steer", triggerTurn: true });

  const replyTool = createReplyTool({ registry });
  const replied = await replyTool.execute(
    "call2",
    { jobId: 1, questionId: "question-1", answer: "Use the existing API." },
    undefined,
    undefined,
    ctx,
  );
  assert.equal((replied.content[0] as { text: string }).text, "Answered subagent #1.");
  assert.deepEqual(child.stdin.commands()[1], {
    type: "extension_ui_response",
    id: "question-1",
    value: "Use the existing API.",
  });
  assert.deepEqual(registry.get(1)?.pendingQuestions, []);

  child.stdout.emit("data", Buffer.from(endEvent("done")));
  child.finish(0);
  await sleep(20);
  assert.equal(sendMessage.calls.length, 3, "question, result, and hidden summary sent once each");
});

test("cancelling a child waiting on the parent invalidates its question", async () => {
  const { tool, registry, sendMessage, child, ctx } = makeTool();
  await tool.execute("call1", { agent: "scout", task: "t" }, undefined, undefined, ctx);
  await sleep(10);
  const initial = child.stdin.commands()[0];
  assert.ok(initial);
  child.stdout.emit("data", Buffer.from(responseEvent(initial)));
  child.stdout.emit("data", Buffer.from(questionEvent("question-1", "Continue?")));
  assert.deepEqual(registry.get(1)?.pendingQuestions.map((question) => question.id), ["question-1"]);

  assert.equal(registry.cancel(1, "manual"), true);
  assert.deepEqual(registry.get(1)?.pendingQuestions, []);
  await sleep(20);
  assert.equal(registry.get(1)?.status, "cancelled");
  const resultMessage = sendMessage.calls.find((call) =>
    (call[0] as { details?: { status?: string } }).details?.status === "cancelled");
  assert.ok(resultMessage, "cancelled result delivered after the child closes");
});

test("subagent_reply renders a compact call and result", async () => {
  const registry = createJobRegistry();
  const jobId = registry.add("scout", "task");
  registry.registerControl(jobId, {
    cancel: () => {},
    send: async () => {},
    reply: async () => {},
  });
  registry.recordQuestion(jobId, { id: "f7455070-1bdd-4bf8-9806-2647a04b1eba", question: "Continue?" });
  const tool = createReplyTool({ registry });
  const theme = fakeTheme() as never;

  const call = tool.renderCall!(
    { jobId, questionId: "f7455070-1bdd-4bf8-9806-2647a04b1eba", answer: "yes" },
    theme,
    {} as never,
  );
  assert.equal(renderText(call).trim(), "reply #1");
  assert.doesNotMatch(renderText(call), /f7455070/);

  const result = await tool.execute(
    "call1",
    { jobId, questionId: "f7455070-1bdd-4bf8-9806-2647a04b1eba", answer: "yes" },
    undefined,
    undefined,
    {} as never,
  );
  const renderedResult = renderText(tool.renderResult!(result, { expanded: false, isPartial: false }, theme, {} as never))
    .split("\n").map((line) => line.trimEnd()).join("\n").trim();
  assert.equal(renderedResult, "✓ reply delivered to #1\n  Q: Continue?\n  A: yes");
});

test("subagent messaging tools reject queued, stale, and empty inputs", async () => {
  const registry = createJobRegistry();
  const id = registry.add("scout", "task");
  const sendTool = createSendTool({ registry });
  const replyTool = createReplyTool({ registry });

  await assert.rejects(
    sendTool.execute("call1", { jobId: id, message: "message", deliverAs: "followUp" }, undefined, undefined, {} as never),
    /has not started yet/,
  );
  await assert.rejects(
    sendTool.execute("call2", { jobId: id, message: "   ", deliverAs: "steer" }, undefined, undefined, {} as never),
    /cannot be empty/,
  );
  registry.registerControl(id, {
    cancel: () => {},
    send: async () => {},
    reply: async () => {},
  });
  await assert.rejects(
    replyTool.execute("call3", { jobId: id, questionId: "stale", answer: "answer" }, undefined, undefined, {} as never),
    /Unknown or answered question stale/,
  );
  await assert.rejects(
    replyTool.execute("call4", { jobId: id, questionId: "stale", answer: " " }, undefined, undefined, {} as never),
    /cannot be empty/,
  );
});

test("execute: all-unknown batch throws", async () => {
  const { tool, ctx } = makeTool();
  await assert.rejects(
    tool.execute(
      "call1",
      { tasks: [{ agent: "ghost", task: "t" }] },
      undefined,
      undefined,
      ctx,
    ),
    /Unknown agent\(s\): ghost/,
  );
});

test("execute: partial-unknown batch launches known jobs and reports skipped count", async () => {
  const { tool, registry, sendMessage, child, ctx } = makeTool();
  const result = await tool.execute(
    "call1",
    { tasks: [{ agent: "ghost", task: "t" }, { agent: "scout", task: "t2" }] },
    undefined,
    undefined,
    ctx,
  );
  assert.equal(result.details.status, "launched");
  assert.equal(result.details.skipped, 1);
  assert.equal(result.details.count, 1);

  await sleep(10);
  child.stdout.emit("data", Buffer.from(endEvent("scouted")));
  child.finish(0);
  await sleep(20);

  assert.equal(registry.get(1)?.status, "failed");
  assert.equal(registry.get(2)?.status, "completed");
  const text = sendMessage.calls.map((call) => (call[0] as { content: string }).content).join("\n");
  assert.match(text, /Unknown agent "ghost"/);
  assert.match(text, /scouted/);
});

test("execute: queued cancellation does not spawn and reports its reason", async () => {
  const children = [new FakeChild(), new FakeChild()];
  const { spawnFn, calls } = fakeSpawnChildren(children);
  const { tool, registry, sendMessage, ctx } = makeTool({ spawnFn });
  const notices: string[] = [];
  (ctx as unknown as { hasUI: boolean; ui: { notify: (text: string) => void } }).hasUI = true;
  (ctx as unknown as { ui: { notify: (text: string) => void } }).ui = { notify: (text) => notices.push(text) };
  await tool.execute("call1", {
    tasks: [{ agent: "scout", task: "one" }, { agent: "scout", task: "two" }],
    concurrency: 1,
  }, undefined, undefined, ctx);
  assert.equal(registry.cancel(2, "timeout"), true);
  // Let the first launch finish setup and attach its close listener.
  await sleep(10);
  children[0]!.finish(0);
  await sleep(30);
  assert.equal(calls.length, 1, "the queued cancelled job must not spawn");
  const resultMessage = sendMessage.calls.find((call) => (call[0] as { details?: { jobId?: number } }).details?.jobId === 2);
  assert.equal((resultMessage?.[0] as { details: { status: string; cancellationReason?: string } }).details.status, "cancelled");
  assert.equal((resultMessage?.[0] as { details: { cancellationReason?: string } }).details.cancellationReason, "timeout");
  assert.ok(notices.some((notice) => notice.includes("cancelled (timeout)")));
  assert.match((sendMessage.calls.at(-1)?.[0] as { content: string }).content, /cancelled \(timeout\)/);
});

test("execute: parent abort does not cancel running or queued jobs", async () => {
  const children = [new FakeChild(), new FakeChild()];
  const { spawnFn, calls } = fakeSpawnChildren(children);
  const { tool, registry, ctx } = makeTool({ spawnFn });
  const controller = new AbortController();
  const result = await tool.execute("call1", {
    tasks: [{ agent: "scout", task: "one" }, { agent: "scout", task: "two" }],
    concurrency: 1,
  }, controller.signal, undefined, ctx);
  assert.equal(result.details.status, "launched");

  await sleep(10);
  controller.abort();
  assert.equal(calls.length, 1);
  assert.equal(registry.get(1)?.cancellationReason, undefined);
  assert.equal(registry.get(2)?.cancellationReason, undefined);

  children[0]!.finish(0);
  await sleep(20);
  assert.equal(calls.length, 2);
  children[1]!.finish(0);
  await sleep(20);
  assert.equal(registry.get(1)?.status, "completed");
  assert.equal(registry.get(2)?.status, "completed");
});

test("execute: registry cancellation reason wins over child completion", async () => {
  const { tool, registry, sendMessage, child, ctx } = makeTool();
  const result = await tool.execute("call1", { agent: "scout", task: "t" }, undefined, undefined, ctx);
  assert.equal(result.details.status, "launched");
  await sleep(10);
  assert.equal(registry.cancel(1, "manual"), true);
  child.finish(143);
  await sleep(20);

  assert.equal(registry.get(1)?.cancellationReason, "manual");
  const details = (sendMessage.calls[0]?.[0] as { details: { status: string; cancellationReason?: string } }).details;
  assert.equal(details.status, "cancelled");
  assert.equal(details.cancellationReason, "manual");
});

test("execute: setup cancellation reports cancellation instead of failure", async () => {
  let registry: ReturnType<typeof createJobRegistry> | undefined;
  const spawnFn = (() => {
    assert.ok(registry);
    registry.cancel(1, "session-shutdown");
    throw new Error("setup failed");
  }) as typeof spawn;
  const made = makeTool({ spawnFn });
  registry = made.registry;
  const result = await made.tool.execute("call1", { agent: "scout", task: "t" }, undefined, undefined, made.ctx);
  assert.equal(result.details.status, "launched");
  await sleep(20);
  const details = (made.sendMessage.calls[0]?.[0] as { details: { status: string; cancellationReason?: string } }).details;
  assert.equal(details.status, "cancelled");
  assert.equal(details.cancellationReason, "session-shutdown");
});

test("execute: jobs outlive the tool-call abort signal", async () => {
  const controller = new AbortController();
  const { tool, child, ctx } = makeTool();
  const result = await tool.execute("call1", { agent: "scout", task: "t" }, controller.signal, undefined, ctx);
  assert.equal(result.details.status, "launched");

  controller.abort();
  await sleep(10);
  assert.equal(child.killed, null, "the caller's abort signal must not cancel the job");

  child.stdout.emit("data", Buffer.from(endEvent("scouted")));
  child.finish(0);
  await sleep(20);
});

test("execute: parallel batch delivers per-job results and one summary", async () => {
  const children = [new FakeChild(), new FakeChild()];
  const { spawnFn, calls } = fakeSpawnChildren(children);
  const { tool, sendMessage, sendUserMessage, activeTickers, activeProcs, ctx } = makeTool({ spawnFn });
  const result = await tool.execute(
    "call1",
    { tasks: [{ agent: "scout", task: "t1" }, { agent: "scout", task: "t2" }] },
    undefined,
    undefined,
    ctx,
  );
  assert.equal(result.details.status, "launched");
  assert.equal(result.details.count, 2);

  await sleep(10);
  assert.equal(calls.length, 2, "one child spawned per task");
  children[0]!.stdout.emit("data", Buffer.from(endEvent("one")));
  children[0]!.finish(0);
  children[1]!.stdout.emit("data", Buffer.from(endEvent("two")));
  children[1]!.finish(0);
  await sleep(30); // let the .then chains run

  assert.equal(sendMessage.calls.length, 3, "deliverResult per job plus hidden batch summary");
  assert.equal(sendUserMessage.calls.length, 0, "summary is not displayed as a user message");
  assert.equal((sendMessage.calls[2]?.[0] as { display: boolean }).display, false);
  assert.equal(activeTickers.size, 0, "ticker stopped via finally");
  assert.equal(activeProcs.size, 0);
});

test("execute: validation errors reject", async () => {
  const { tool, ctx } = makeTool();
  await assert.rejects(
    tool.execute("call1", { tasks: [] }, undefined, undefined, ctx),
    /at least one task/,
  );
  await assert.rejects(
    tool.execute("call1", { agent: "scout" }, undefined, undefined, ctx),
    /exactly one mode/,
  );
});

// --- renderers ---------------------------------------------------------------

function fakeTheme() {
  return {
    fg: (_color: string, text: string) => text,
    bg: (_color: string, text: string) => text,
    bold: (text: string) => text,
  };
}

function renderable(value: unknown): boolean {
  return !!value && typeof (value as { render?: unknown }).render === "function";
}

function renderText(value: unknown): string {
  return (value as { render: (width: number) => string[] }).render(120).join("\n");
}

test("renderFullWidget: shows progress when no tool call is active", () => {
  const registry = createJobRegistry();
  const id = registry.add("scout", "task", "a".repeat(60), {
    model: "openai-codex/gpt-5.6-luna",
    thinkingLevel: "high",
  });
  registry.updateLive(id, { progress: "reading files", text: "live agent output" });
  const lines = renderFullWidget(registry, (_color, text) => text, 80);
  const output = lines.join("\n");
  assert.ok(lines.every((line) => visibleWidth(line) <= 80));
  assert.match(output, new RegExp(`◐ #${id} scout`));
  assert.match(output, /reading files/);
  assert.doesNotMatch(output, /openai-codex\/gpt-5\.6-luna:high/);
  assert.doesNotMatch(output, /live agent output/);

  registry.recordQuestion(id, { id: "question-1", question: "Which API?" });
  assert.match(renderFullWidget(registry, (_color, text) => text, 80).join("\n"), /waiting for parent/);
});

test("renderResult: tolerates missing details (error results omit it)", () => {
  const { tool } = makeTool();
  const theme = fakeTheme() as never;
  // SDK runtime omits `details` on validation-failure/abort results.
  const out = tool.renderResult!(
    { content: [{ type: "text", text: "boom" }], details: undefined } as never,
    {} as never,
    theme,
    {} as never,
  );
  assert.ok(renderable(out), "renderer must not throw on missing details");
});

test("renderResult: renders launched/failed/completed summaries", () => {
  const { tool } = makeTool();
  const theme = fakeTheme() as never;
  const render = (details: { status: string }) =>
    tool.renderResult!(
      { content: [{ type: "text", text: "s" }], details } as never,
      {} as never,
      theme,
      {} as never,
    );
  const launched = render({ status: "launched" });
  assert.ok(renderable(launched));
  assert.equal(renderText(launched).trim(), "");
  assert.ok(renderable(render({ status: "failed" })));
  assert.ok(renderable(render({ status: "completed" })));
  const completedWithJob = tool.renderResult!(
    { content: [{ type: "text", text: "done" }], details: { status: "completed", jobIds: [1] } } as never,
    {} as never,
    theme,
    {} as never,
  );
  assert.equal(renderText(completedWithJob).trim(), "");
});

test("renderCall: shows concurrency and every agent title", () => {
  const { tool } = makeTool();
  const theme = fakeTheme() as never;
  const rendered = tool.renderCall!(
    {
      tasks: [
        { agent: "scout", task: "task one", title: "First task" },
        { agent: "worker", task: "task two", title: "Second task" },
      ],
    } as never,
    theme,
    {} as never,
  );
  assert.ok(renderable(rendered));
  const text = renderText(rendered);
  assert.match(text, /parallel \(2 tasks\)/);
  assert.match(text, /\[concurrency 3\]/);
  assert.match(text, /scout.*First task/);
  assert.match(text, /worker.*Second task/);
});

test("message renderer: renders results and parent questions", () => {
  const renderers = new Map<string, (message: unknown, options: unknown, theme: unknown) => unknown>();
  const pi = {
    registerMessageRenderer: (type: string, fn: unknown) => {
      renderers.set(type, fn as never);
    },
  } as unknown as ExtensionAPI;
  registerRenderers(pi);
  const captured = renderers.get(ENTRY_TYPE);
  const questionRenderer = renderers.get(QUESTION_ENTRY_TYPE);
  assert.ok(captured, "result renderer registered");
  assert.ok(questionRenderer, "question renderer registered");

  const theme = fakeTheme() as never;
  const options = { expanded: false, outputPad: 2 };
  const withDetails = captured!(
    {
      content: "out",
      details: {
        jobId: 7,
        agent: "a",
        task: "t",
        status: "completed",
        duration: "1s",
        icon: "✓",
        usage: { ...EMPTY_USAGE, turns: 1 },
        model: "openai-codex/gpt-5.6-luna",
        thinkingLevel: "high",
      },
    },
    options,
    theme,
  );
  assert.ok(renderable(withDetails));
  const compactText = renderText(withDetails);
  assert.match(compactText, /✓ #7 a/);
  assert.match(compactText, /openai-codex\/gpt-5\.6-luna:high/);
  assert.doesNotMatch(compactText, /\bout\b/);
  assert.match(compactText, /Ctrl\+O to expand/);
  assert.equal(compactText.split("\n").filter((line) => line.trim()).length, 3);

  const withoutDetails = captured!({ content: "plain", details: undefined }, options, theme);
  assert.ok(renderable(withoutDetails));

  const backgroundCalls: string[] = [];
  const expandedTheme = {
    ...fakeTheme(),
    bg: (color: string, text: string) => {
      backgroundCalls.push(color);
      return text;
    },
  } as never;
  const expanded = captured!(
    {
      content: "out",
      details: {
        agent: "a",
        task: "t",
        status: "failed",
        duration: "1s",
        icon: "✗",
        toolCalls: [
          { name: "read", args: { path: "src/index.ts", offset: 1, limit: 2 } },
          { name: "bash", args: { command: "npm test" } },
        ],
      },
    },
    { ...options, expanded: true },
    expandedTheme,
  );
  assert.ok(renderable(expanded));
  assert.match(renderText(expanded), /Tool calls/);
  assert.match(renderText(expanded), /read src\/index\.ts:1-2/);
  assert.match(renderText(expanded), /\$ npm test/);
  assert.ok(backgroundCalls.includes("customMessageBg"));

  const question = questionRenderer!(
    {
      content: "model-facing instructions",
      details: {
        jobId: 12,
        agent: "worker",
        questionId: "question-1",
        question: "Which API should I use?",
        context: "The code has two patterns.",
      },
    },
    { ...options, expanded: true },
    theme,
  );
  const questionText = renderText(question);
  assert.match(questionText, /\? #12 worker: Which API should I use\?/);
  assert.match(questionText, /Context:.*The code has two patterns/);
  assert.match(questionText, /Question ID: question-1/);
  assert.doesNotMatch(questionText, /model-facing instructions/);
});

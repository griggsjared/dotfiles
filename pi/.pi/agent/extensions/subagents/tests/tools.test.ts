import { test } from "node:test";
import assert from "node:assert/strict";
import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AgentConfig } from "../agents.ts";
import { createJobRegistry } from "../registry.ts";
import { refreshUi, registerRenderers, renderFullWidget } from "../render.ts";
import { Batch, createSubagentTool, resolveMode } from "../tools.ts";
import {
  createCancelTool,
  createPeekTool,
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

test("subagent peek returns bounded incremental semantic events", async () => {
  const registry = createJobRegistry();
  const runningId = registry.add("scout", "running task");
  registry.appendEvent(runningId, { kind: "state", summary: "started" });
  registry.appendEvent(runningId, { kind: "tool-start", summary: "read src/auth.ts" });
  registry.appendEvent(runningId, { kind: "assistant", summary: "Found the auth module." });
  const tool = createPeekTool({ registry });

  const first = await tool.execute("peek1", { jobId: runningId, limit: 2 }, undefined, undefined, {} as never);
  assert.deepEqual(first.details.events, [
    { seq: 2, timestamp: first.details.events[0]!.timestamp, kind: "tool-start", summary: "read src/auth.ts" },
    { seq: 3, timestamp: first.details.events[1]!.timestamp, kind: "assistant", summary: "Found the auth module." },
  ]);
  assert.equal(first.details.nextCursor, 3);
  assert.equal((first.content[0] as { text: string }).text, "[2] read src/auth.ts\n[3] Found the auth module.\nnextCursor: 3");

  const next = await tool.execute("peek2", { jobId: runningId, since: first.details.nextCursor }, undefined, undefined, {} as never);
  assert.deepEqual(next.details.events, []);
  assert.equal(next.details.nextCursor, 3);

  const fromStart = await tool.execute("peek3", { jobId: runningId, since: 0, limit: 2 }, undefined, undefined, {} as never);
  assert.deepEqual(fromStart.details.events.map((event) => event.seq), [1, 2]);
  assert.equal(fromStart.details.nextCursor, 2);

  const capped = await tool.execute("peek4", { jobId: runningId, since: 0, maxChars: 12 }, undefined, undefined, {} as never);
  assert.deepEqual(capped.details.events.map((event) => event.seq), [1]);
  assert.equal(capped.details.nextCursor, 1);
  assert.ok((capped.content[0] as { text: string }).text.length <= 12);
  await assert.rejects(tool.execute("peek5", { jobId: runningId, since: 99 }, undefined, undefined, {} as never), /ahead of current sequence/);
  await assert.rejects(tool.execute("peek6", { jobId: 999 }, undefined, undefined, {} as never), /Unknown subagent job ID: 999/);

  registry.complete(runningId, { agent: "scout", task: "running task", text: "done", exitCode: 0, error: "" });
  const terminal = await tool.execute("peek7", { jobId: runningId }, undefined, undefined, {} as never);
  assert.equal(terminal.details.status, "completed");
  assert.deepEqual(terminal.details.events.map((event) => event.seq), [1, 2, 3]);

  const ringId = registry.add("worker", "ring task");
  for (let i = 0; i < 101; i++) registry.appendEvent(ringId, { kind: "state", summary: String(i) });
  const dropped = await tool.execute("peek8", { jobId: ringId, since: 0, limit: 100 }, undefined, undefined, {} as never);
  assert.equal(dropped.details.droppedBefore, 2);
  assert.equal(dropped.details.events[0]?.seq, 2);

  const rawId = registry.add("worker", "structured result");
  registry.appendEvent(rawId, {
    kind: "tool-end",
    summary: 'read success: {"content":[{"type":"text","text":"\\u001b]52;c;cHduZWQ=\\u0007\\u001b[31mone\\u001b[0m\\ntwo"}]}',
  });
  const raw = await tool.execute("peek9", { jobId: rawId }, undefined, undefined, {} as never);
  assert.equal((raw.content[0] as { text: string }).text, "[1] read success: one · 2 lines\nnextCursor: 1");
});

test("subagent peek renderer labels events and compacts structured results", () => {
  const { renderResult } = createPeekTool({ registry: createJobRegistry() });
  const theme = {
    ...fakeTheme(),
    fg: (color: string, text: string) => `[${color}]${text}[/${color}]`,
  } as never;
  const rendered = renderText(renderResult!({
    content: [{ type: "text", text: "legacy peek text" }],
    details: {
      jobId: 1,
      agent: "scout",
      status: "running",
      events: [
        {
          seq: 1,
          timestamp: Date.now(),
          kind: "tool-end",
          summary: 'read success: {"content":[{"type":"text","text":"one\\ntwo"}]}',
        },
        { seq: 2, timestamp: Date.now(), kind: "assistant", summary: "\u001b]2;pwned\u0007Found \u001b[31mit\u001b[0m." },
      ],
      nextCursor: 2,
    },
  } as never, {} as never, theme, {} as never));
  assert.match(rendered, /\[success\]result/);
  assert.match(rendered, /read success: one · 2 lines/);
  assert.match(rendered, /\[text\]assistant/);
  assert.match(rendered, /Found it\./);
  assert.doesNotMatch(rendered, /pwned|content|\u001b/);
  assert.match(rendered, /\[dim\]cursor: 2/);
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

test("status, cancel, and send tools render job-aware output", async () => {
  const registry = createJobRegistry();
  const jobId = registry.add("scout", "Inspect the error path");
  registry.registerControl(jobId, {
    cancel: () => {},
    send: async () => {},
    reply: async () => {},
  });
  registry.updateLive(jobId, { text: "Error: output text\n- output item\n**output heading**" });
  registry.recordQuestion(jobId, {
    id: "f7455070-1bdd-4bf8-9806-2647a04b1eba",
    question: "Which path?",
  });
  const theme = fakeTheme() as never;

  const statusTool = createStatusTool({ registry });
  assert.equal(renderText(statusTool.renderCall!({ jobId }, theme, {} as never)).trim(), "status #1");
  const statusResult = await statusTool.execute("status", { jobId }, undefined, undefined, {} as never);
  assert.match(statusResult.details.text, /Subagent #1/);
  const statusColors: string[] = [];
  const statusTheme = {
    ...fakeTheme(),
    fg: (color: string, text: string) => { statusColors.push(color); return text; },
  } as never;
  const renderedStatus = renderText(
    statusTool.renderResult!(statusResult, { expanded: false, isPartial: false }, statusTheme, {} as never),
  );
  assert.match(renderedStatus, /Subagent #1/);
  assert.doesNotMatch(renderedStatus, /\*\*Subagent #1\*\*/);
  assert.doesNotMatch(renderedStatus, /f7455070/);
  assert.ok(["toolTitle", "accent", "muted", "dim", "toolOutput"].every((color) => statusColors.includes(color)));

  const taggedStatusTheme = {
    ...fakeTheme(),
    fg: (color: string, text: string) => `[${color}]${text}[/${color}]`,
  } as never;
  const taggedStatus = renderText(
    statusTool.renderResult!(statusResult, { expanded: false, isPartial: false }, taggedStatusTheme, {} as never),
  );
  assert.match(taggedStatus, /\[dim\] Inspect the error path/);
  assert.match(taggedStatus, /\[dim\]- Which path\?/);
  assert.match(taggedStatus, /\[toolOutput\]Error: output text/);
  assert.match(taggedStatus, /\[toolOutput\]- output item/);
  assert.match(taggedStatus, /\[toolOutput\]\*\*output heading\*\*/);
  assert.doesNotMatch(taggedStatus, /f7455070/);

  const aggregateResult = await statusTool.execute("status-all", {}, undefined, undefined, {} as never);
  const taggedAggregate = renderText(
    statusTool.renderResult!(aggregateResult, { expanded: false, isPartial: false }, taggedStatusTheme, {} as never),
  );
  assert.match(taggedAggregate, /\[accent\]#1 scout/);
  assert.match(taggedAggregate, /\[muted\] \([^)]*\)/);
  assert.match(taggedAggregate, /\[dim\]: Inspect the error path/);

  const malformedStatus = statusTool.renderResult!(
    { content: [{ type: "text", text: "legacy status" }], details: { text: 123 } } as never,
    { expanded: false, isPartial: false },
    theme,
    {} as never,
  );
  assert.equal(renderText(malformedStatus).trim(), "legacy status");

  const sendTool = createSendTool({ registry });
  const sendArgs = { jobId, message: "Check the failure path", deliverAs: "steer" as const };
  const sendCall = renderText(sendTool.renderCall!(sendArgs, theme, {} as never))
    .split("\n").map((line) => line.trimEnd()).join("\n").trim();
  assert.equal(sendCall, "send #1 steer\n  Check the failure path");
  const sendResult = await sendTool.execute("send", sendArgs, undefined, undefined, {} as never);
  const renderedSendResult = renderText(
    sendTool.renderResult!(sendResult, { expanded: false, isPartial: false }, theme, {} as never),
  ).split("\n").map((line) => line.trimEnd()).join("\n").trim();
  assert.equal(renderedSendResult, "✓ steering delivered to #1 scout\n  Inspect the error path");
  const taggedTheme = {
    ...fakeTheme(),
    fg: (color: string, text: string) => `[${color}]${text}[/${color}]`,
  } as never;
  const taggedSendResult = renderText(
    sendTool.renderResult!(sendResult, { expanded: false, isPartial: false }, taggedTheme, {} as never),
  );
  assert.match(taggedSendResult, /\[success\]✓ /);
  assert.match(taggedSendResult, /\[muted\]steering delivered to /);
  assert.match(taggedSendResult, /\[accent\]#1 scout/);
  assert.match(taggedSendResult, /\[dim\]Inspect the error path/);
  const sendError = sendTool.renderResult!(
    { content: [{ type: "text", text: "transport failed" }], details: {} } as never,
    { expanded: false, isPartial: false },
    theme,
    { isError: true } as never,
  );
  assert.equal(renderText(sendError).trim(), "transport failed");
  const legacySend = sendTool.renderResult!(
    { content: [{ type: "text", text: "legacy send result" }], details: {} } as never,
    { expanded: false, isPartial: false },
    theme,
    {} as never,
  );
  assert.equal(renderText(legacySend).trim(), "legacy send result");

  const cancelTool = createCancelTool({ registry });
  assert.equal(renderText(cancelTool.renderCall!({ jobId }, theme, {} as never)).trim(), "cancel #1");
  const cancelResult = await cancelTool.execute("cancel", { jobId }, undefined, undefined, {} as never);
  assert.equal(
    renderText(cancelTool.renderResult!(cancelResult, { expanded: false, isPartial: false }, theme, {} as never)).trim(),
    "⊘ cancelling #1 scout: Inspect the error path",
  );
  const taggedCancelResult = renderText(
    cancelTool.renderResult!(cancelResult, { expanded: false, isPartial: false }, taggedTheme, {} as never),
  );
  assert.match(taggedCancelResult, /\[warning\]⊘ /);
  assert.match(taggedCancelResult, /\[muted\]cancelling /);
  assert.match(taggedCancelResult, /\[accent\]#1 scout/);
  assert.match(taggedCancelResult, /\[dim\]: Inspect the error path/);
  const cancelError = cancelTool.renderResult!(
    { content: [{ type: "text", text: "cancel failed" }], details: {} } as never,
    { expanded: false, isPartial: false },
    theme,
    { isError: true } as never,
  );
  assert.equal(renderText(cancelError).trim(), "cancel failed");
  const legacyCancel = cancelTool.renderResult!(
    { content: [{ type: "text", text: "legacy cancel result" }], details: {} } as never,
    { expanded: false, isPartial: false },
    theme,
    {} as never,
  );
  assert.equal(renderText(legacyCancel).trim(), "legacy cancel result");
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
  registry.recordQuestion(id, {
    id: "f7455070-1bdd-4bf8-9806-2647a04b1eba",
    question: "Which API?",
  });
  await command.handler(String(id), ctx);
  assert.match(notices.at(-1) ?? "", new RegExp(`Subagent #${id}`));
  assert.match(notices.at(-1) ?? "", /- Which API\?/);
  assert.doesNotMatch(notices.at(-1) ?? "", /f7455070/);
  await command.handler("nope", ctx);
  assert.match(notices.at(-1) ?? "", /Usage: \/subagent-status/);
});

test("/subagent-tail opens a live overlay and follows new events", async () => {
  const registry = createJobRegistry();
  const id = registry.add("scout", "running task");
  registry.appendEvent(id, { kind: "state", summary: "started" });
  registry.appendEvent(id, {
    kind: "tool-end",
    summary: 'read success: {"content":[{"type":"text","text":"one\\ntwo"}]}',
  });
  const notices: Array<{ text: string; level: string }> = [];
  const commands = new Map<string, { handler: (args: string, ctx: unknown) => Promise<void> }>();
  const pi = {
    registerCommand: (name: string, command: { handler: (args: string, ctx: unknown) => Promise<void> }) => commands.set(name, command),
  } as unknown as ExtensionAPI;
  registerStatusCommands(pi, { registry });
  const command = commands.get("subagent-tail");
  assert.ok(command);

  type TailComponent = { render(width: number): string[]; handleInput?(data: string): void };
  let component: TailComponent | undefined;
  let overlayOptions: unknown;
  let renderRequests = 0;
  const custom = (
    factory: (tui: { requestRender: () => void }, theme: ReturnType<typeof fakeTheme>, keybindings: unknown, done: (result: void) => void) => TailComponent,
    options: unknown,
  ) => new Promise<void>((resolve) => {
    overlayOptions = options;
    component = factory({ requestRender: () => { renderRequests += 1; } }, fakeTheme(), {}, () => resolve());
  });
  const ctx = {
    mode: "tui",
    hasUI: true,
    ui: { custom, notify: (text: string, level: string) => notices.push({ text, level }) },
  };

  const pending = command.handler(String(id), ctx);
  assert.ok(component);
  assert.deepEqual(overlayOptions, {
    overlay: true,
    overlayOptions: {
      anchor: "center",
      width: "100%",
      minWidth: 60,
      maxHeight: "100%",
      margin: 1,
    },
  });
  assert.match(renderText(component), /Subagent #1 scout/);
  assert.match(renderText(component), /started/);
  assert.match(renderText(component), /read success: one · 2 lines/);
  assert.doesNotMatch(renderText(component), /content/);

  registry.appendEvent(id, { kind: "assistant", summary: "new event" });
  await sleep(300);
  assert.match(renderText(component), /new event/);
  assert.ok(renderRequests > 0);

  component.handleInput!("q");
  await pending;
  await command.handler("bad", ctx);
  assert.match(notices.at(-1)?.text ?? "", /Usage: \/subagent-tail/);
  await command.handler("999", ctx);
  assert.match(notices.at(-1)?.text ?? "", /Unknown subagent job ID: 999/);
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
  const notices: string[] = [];
  (ctx as unknown as { thinkingLevel?: string }).thinkingLevel = "medium";
  (ctx as unknown as { hasUI: boolean; ui: { notify: (text: string) => void } }).hasUI = true;
  (ctx as unknown as { ui: { notify: (text: string) => void } }).ui = { notify: (text) => notices.push(text) };

  const result = await tool.execute("call1", { agent: "scout", task: "t" }, undefined, undefined, ctx);
  assert.equal(result.details.status, "launched");
  await sleep(20);
  assert.equal(registry.get(1)?.status, "failed");
  const [message] = sendMessage.calls[0] as [{ details: { model?: string; thinkingLevel?: string } }];
  assert.equal(message.details.model, "p/m");
  assert.equal(message.details.thinkingLevel, "medium");
  assert.deepEqual(notices, ["#1 scout: t — failed: Error: spawn failed"]);
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
  assert.equal((result.content[0] as { text: string }).text, 'Launched **scout** subagent #1: "t"');

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

test("execute: child semantic events are available through peek", async () => {
  const { tool, registry, child, ctx } = makeTool();
  await tool.execute("call1", { agent: "scout", task: "t" }, undefined, undefined, ctx);
  await sleep(10);
  const emit = (event: Record<string, unknown>) => {
    child.stdout.emit("data", Buffer.from(`${JSON.stringify(event)}\n`));
  };
  emit({ type: "agent_start" });
  emit({ type: "tool_execution_start", toolName: "read", args: { path: "src/auth.ts" } });
  emit({ type: "tool_execution_end", toolName: "read", isError: false, result: "ok" });
  child.stdout.emit("data", Buffer.from(endEvent("scouted")));
  child.finish(0);
  await sleep(20);

  const peek = await createPeekTool({ registry }).execute(
    "peek",
    { jobId: 1 },
    undefined,
    undefined,
    {} as never,
  );
  assert.deepEqual(peek.details.events.map((event) => `${event.kind}:${event.summary}`), [
    "state:started",
    "tool-start:read src/auth.ts",
    "tool-end:read success: ok",
    "assistant:scouted",
  ]);
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
  assert.deepEqual(registry.readEvents(1)?.events.map((event) => `${event.kind}:${event.summary}`), [
    "question:question: Which API?",
  ]);
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

test("stale UI context does not duplicate cancellation completion", async () => {
  const { tool, registry, sendMessage, child, ctx } = makeTool();
  await tool.execute("call1", { agent: "scout", task: "t" }, undefined, undefined, ctx);
  await sleep(10);
  Object.defineProperty(ctx, "hasUI", {
    configurable: true,
    get: () => { throw new Error("stale context"); },
  });

  assert.equal(registry.cancel(1, "manual"), true);
  await sleep(30);

  assert.equal(registry.get(1)?.status, "cancelled");
  const summaries = sendMessage.calls.filter((call) => (call[0] as { display?: boolean }).display === false);
  assert.equal(summaries.length, 1);
  const summary = (summaries[0]?.[0] as { content: string }).content;
  assert.equal(summary.match(/#1 scout/g)?.length, 1);
  assert.equal(child.killed, "SIGTERM");
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
  const taggedTheme = {
    ...fakeTheme(),
    fg: (color: string, text: string) => `[${color}]${text}[/${color}]`,
  } as never;
  const taggedResult = renderText(
    tool.renderResult!(result, { expanded: false, isPartial: false }, taggedTheme, {} as never),
  );
  assert.match(taggedResult, /\[success\]✓ /);
  assert.match(taggedResult, /\[muted\]reply delivered to /);
  assert.match(taggedResult, /\[accent\]#1/);
  assert.match(taggedResult, /\[muted\]Q: /);
  assert.match(taggedResult, /\[dim\]Continue\?/);
  assert.match(taggedResult, /\[muted\]A: /);
  assert.match(taggedResult, /\[dim\]yes/);
  assert.doesNotMatch(taggedResult, /f7455070/);

  const errorResult = tool.renderResult!(
    { content: [{ type: "text", text: "reply failed" }], details: {} } as never,
    { expanded: false, isPartial: false },
    theme,
    { isError: true } as never,
  );
  assert.equal(renderText(errorResult).trim(), "reply failed");
  const legacyResult = tool.renderResult!(
    { content: [{ type: "text", text: "legacy reply result" }], details: {} } as never,
    { expanded: false, isPartial: false },
    theme,
    {} as never,
  );
  assert.equal(renderText(legacyResult).trim(), "legacy reply result");
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
  assert.deepEqual(notices, ["#2 scout: two — cancelled (timeout)"]);
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
  assert.equal(
    (result.content[0] as { text: string }).text,
    'Launched 2 subagents in parallel:\n- #1 scout: "t1"\n- #2 scout: "t2"',
  );

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

test("refreshUi: keeps one widget component and requests in-place renders", () => {
  const registry = createJobRegistry();
  registry.add("reviewer", "review safety fixes", "Review safety fixes");
  let factoryCalls = 0;
  let renderRequests = 0;
  let widgetContent: unknown;
  const tui = { requestRender: () => { renderRequests += 1; } };
  const ui = {
    setWidget: (_key: string, content: unknown) => {
      widgetContent = content;
      if (typeof content === "function") {
        factoryCalls += 1;
        content(tui, fakeTheme());
      }
    },
  };
  const ctx = { hasUI: true, ui } as never;

  refreshUi(ctx, registry);
  refreshUi(ctx, registry);
  refreshUi(ctx, registry);

  assert.equal(factoryCalls, 1);
  assert.equal(renderRequests, 2);

  registry.markCleared(registry.jobs.keys());
  for (const job of registry.running()) {
    registry.complete(job.id, { agent: job.agent, task: job.task, text: "done", exitCode: 0, error: "" });
  }
  refreshUi(ctx, registry);
  assert.equal(widgetContent, undefined);
});

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
  registry.recordQuestion(id, { id: "question-2", question: "Which format?" });
  assert.match(renderFullWidget(registry, (_color, text) => text, 80).join("\n"), /waiting for parent \(2\)/);

  const completedId = registry.add("worker", "finished task", "Finished task");
  registry.complete(completedId, {
    agent: "worker",
    task: "finished task",
    title: "Finished task",
    text: "done",
    exitCode: 0,
    error: "",
  });
  const tagged = renderFullWidget(
    registry,
    (color, text) => `[${color}]${text}[/${color}]`,
    200,
  ).join("\n");
  assert.match(tagged, /\[success\]✓ /);
  assert.match(tagged, /\[accent\]#2 worker/);
  assert.match(tagged, /\[muted\] \([^)]*\)/);
  assert.match(tagged, /\[dim\]: Finished task/);
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

  const fallbackColors: string[] = [];
  const fallbackTheme = {
    ...fakeTheme(),
    fg: (color: string, text: string) => { fallbackColors.push(color); return text; },
  } as never;
  const withoutDetails = captured!({ content: "plain", details: undefined }, options, fallbackTheme);
  assert.ok(renderable(withoutDetails));
  assert.equal(renderText(withoutDetails).trim(), "plain");
  assert.deepEqual(fallbackColors, ["toolOutput"]);

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

  const questionMessage = {
    content: "model-facing instructions",
    details: {
      jobId: 12,
      agent: "worker",
      questionId: "question-1",
      question: "Which API should I use?",
      context: "The code has two patterns.",
    },
  };
  const question = questionRenderer!(questionMessage, { ...options, expanded: true }, theme);
  const questionText = renderText(question);
  assert.match(questionText, /\? #12 worker: Which API should I use\?/);
  assert.match(questionText, /Context:.*The code has two patterns/);
  assert.match(questionText, /Waiting for parent reply/);
  assert.doesNotMatch(questionText, /question-1/);
  assert.doesNotMatch(questionText, /model-facing instructions/);

  const taggedTheme = {
    ...fakeTheme(),
    fg: (color: string, text: string) => `[${color}]${text}[/${color}]`,
  } as never;
  const taggedResult = renderText(captured!(
    {
      content: "out",
      details: {
        jobId: 7,
        agent: "a",
        task: "t",
        status: "completed",
        duration: "1s",
        icon: "✓",
      },
    },
    options,
    taggedTheme,
  ));
  assert.match(taggedResult, /\[success\]✓ /);
  assert.match(taggedResult, /\[accent\]#7 a/);
  assert.match(taggedResult, /\[muted\] \(1s\)/);
  assert.match(taggedResult, /\[dim\]: t/);

  const taggedQuestion = renderText(questionRenderer!(
    questionMessage,
    { ...options, expanded: true },
    taggedTheme,
  ));
  assert.match(taggedQuestion, /\[warning\]\? /);
  assert.match(taggedQuestion, /\[accent\]#12 worker/);
  assert.match(taggedQuestion, /\[dim\]: Which API should I use\?/);
  assert.match(taggedQuestion, /\[muted\]Context: /);
  assert.match(taggedQuestion, /\[dim\]The code has two patterns\./);
  assert.doesNotMatch(taggedQuestion, /question-1/);

  const questionFallbackColors: string[] = [];
  const questionFallbackTheme = {
    ...fakeTheme(),
    fg: (color: string, text: string) => { questionFallbackColors.push(color); return text; },
  } as never;
  const questionFallback = questionRenderer!(
    { content: "legacy question", details: undefined },
    options,
    questionFallbackTheme,
  );
  assert.equal(renderText(questionFallback).trim(), "legacy question");
  assert.deepEqual(questionFallbackColors, ["muted"]);
});

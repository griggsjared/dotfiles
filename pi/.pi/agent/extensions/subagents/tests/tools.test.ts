import { test } from "node:test";
import assert from "node:assert/strict";
import type { ChildProcess } from "node:child_process";
import childProcess, { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import os, { tmpdir } from "node:os";
import { join } from "node:path";
import { Box, visibleWidth } from "@earendil-works/pi-tui";
import { Check } from "typebox/value";
import type { ExtensionAPI, ExtensionContext, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import type { AgentConfig, SubagentSettings } from "../agents.ts";
import subagentsExtension, { reArmsProfileGate, restoreActiveProfile } from "../index.ts";
import { createJobRegistry } from "../registry.ts";
import { refreshUi, registerRenderers, renderFullWidget } from "../render.ts";
import { Batch, CompletionMailbox, createSubagentTool, resolveMode } from "../tools.ts";
import {
  confirmSubagentProfile,
  createCancelTool,
  createPeekTool,
  createReplyTool,
  createSendTool,
  createStatusTool,
  registerStatusCommands,
} from "../status-tools.ts";
import { EMPTY_USAGE, ENTRY_TYPE, PROFILE_ENTRY_TYPE, QUESTION_ENTRY_TYPE, STATUS_KEY } from "../types.ts";
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

function makeBatch(isIdle = true) {
  const registry = createJobRegistry();
  const sendMessage = spy();
  const sendUserMessage = spy();
  const appendEntry = spy();
  const pi = { sendMessage: sendMessage.fn, sendUserMessage: sendUserMessage.fn, appendEntry: appendEntry.fn } as unknown as ExtensionAPI;
  let refreshes = 0;
  const mailbox = new CompletionMailbox(pi);
  const batch = new Batch({ pi, registry, refresh: () => { refreshes += 1; }, mailbox, isIdle: () => isIdle });
  return { registry, batch, mailbox, sendMessage, sendUserMessage, appendEntry, refreshes: () => refreshes };
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

test("Batch: clears completed jobs only when the last job completes", () => {
  const { registry, batch, sendMessage } = makeBatch();
  const id1 = registry.add("a", "t1");
  const id2 = registry.add("b", "t2");
  batch.addJob(id1);
  batch.addJob(id2);

  complete(registry, id1);
  batch.recordCompletion(id1);
  batch.summary();
  assert.deepEqual(registry.pendingCompleted().map((job) => job.id), [id1]);

  complete(registry, id2, 1);
  batch.recordCompletion(id2);
  batch.summary();
  assert.equal(sendMessage.calls.length, 0);
  assert.equal(registry.pendingCompleted().length, 0);
});

test("Batch: an extra summary call has no effect", () => {
  const { registry, batch, sendMessage } = makeBatch();
  const id = registry.add("a", "t");
  batch.addJob(id);
  complete(registry, id);
  batch.recordCompletion(id);
  batch.summary();
  batch.summary();
  assert.equal(sendMessage.calls.length, 0);
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
  const mailbox = new CompletionMailbox(pi);
  const b1 = new Batch({ pi, registry, refresh: () => {}, mailbox, isIdle: () => true });
  const b2 = new Batch({ pi, registry, refresh: () => {}, mailbox, isIdle: () => true });

  const id1 = registry.add("a", "t1");
  const id2 = registry.add("b", "t2");
  b1.addJob(id1);
  b2.addJob(id2);

  complete(registry, id1);
  b1.recordCompletion(id1);
  b1.summary();
  assert.equal(sendMessage.calls.length, 0);

  complete(registry, id2);
  b2.recordCompletion(id2);
  b2.summary();
  assert.equal(sendMessage.calls.length, 0);

  // b1 cleared id1 but not id2; b2's own summary then cleared id2 as well
  assert.equal(registry.pendingCompleted().length, 0);
});

test("Batch: deliverResult displays a card and sends a hidden parent message", () => {
  const { registry, batch, sendMessage, appendEntry } = makeBatch();
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
  assert.equal(appendEntry.calls.length, 1);
  const [entryType, entry] = appendEntry.calls[0] as [string, { content: string }];
  assert.equal(entryType, ENTRY_TYPE);
  assert.equal(entry.content.length, 20002); // 20000 + "\n…"
  assert.equal(sendMessage.calls.length, 1);
  const [message, options] = sendMessage.calls[0] as [
    { customType: string; content: string; display: boolean; details: { status: string; icon: string; jobId?: number; agent: string; model?: string; thinkingLevel?: string } },
    { deliverAs: string; triggerTurn: boolean },
  ];
  assert.equal(message.customType, ENTRY_TYPE);
  assert.equal(message.display, false);
  assert.equal(message.content.length, 20002);
  assert.equal(message.details.status, "completed");
  assert.equal(message.details.icon, "✓");
  assert.equal(message.details.jobId, id);
  assert.equal(message.details.model, "openai-codex/gpt-5.6-luna");
  assert.equal(message.details.thinkingLevel, "high");
  assert.equal(options.deliverAs, "steer");
  assert.equal(options.triggerTurn, true);
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
  assert.equal(appendEntry.calls.length, 2);
  assert.match((sendMessage.calls[1]?.[0] as { content: string }).content, /Cancelled \(timeout\)/);
});

test("CompletionMailbox displays active-turn results and waits to deliver them", () => {
  const { registry, batch, mailbox, sendMessage, appendEntry } = makeBatch(false);
  const id = registry.add("a", "t");
  batch.addJob(id);
  complete(registry, id);
  batch.deliverResult(id, { agent: "a", task: "t", text: "done", exitCode: 0, error: "" });

  assert.equal(appendEntry.calls.length, 1);
  assert.equal(sendMessage.calls.length, 0);

  mailbox.flush(() => true);
  assert.equal(sendMessage.calls.length, 1);
  assert.deepEqual(sendMessage.calls[0]?.[1], { triggerTurn: true, deliverAs: "steer" });
});

test("subagent status includes compact model and effort", async () => {
  const registry = createJobRegistry();
  registry.add("scout", "running task", undefined, {
    model: "openai-codex/gpt-5.6-luna",
    thinkingLevel: "minimal",
    profile: "primary",
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
  assert.doesNotMatch(text, /profile/i);
  assert.match(text, /⊙ #1 scout .*openai-codex\/gpt-5\.6-luna:minimal/);
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
  assert.equal((first.content[0] as { text: string }).text, "subagent peek #1 scout · running task\n[2] read src/auth.ts\n[3] Found the auth module.\nnextCursor: 3");

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

  const longTaskId = registry.add("worker", "t".repeat(900));
  registry.appendEvent(longTaskId, { kind: "assistant", summary: "event still fits" });
  const longTask = await tool.execute("peek-long-task", { jobId: longTaskId, maxChars: 2000 }, undefined, undefined, {} as never);
  assert.deepEqual(longTask.details.events.map((event) => event.seq), [1]);
  assert.equal(longTask.details.nextCursor, 1);
  assert.match((longTask.content[0] as { text: string }).text, /\[1\] event still fits/);
  assert.ok((longTask.content[0] as { text: string }).text.length <= 2000);

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
  assert.equal((raw.content[0] as { text: string }).text, "subagent peek #4 worker · structured result\n[1] read success: one · 2 lines\nnextCursor: 1");
  assert.ok(tool.outputSchema);
  assert.equal(tool.exposure ?? "direct", "direct");
  for (const result of [first, next, fromStart, capped, terminal, dropped, raw]) {
    assert.ok(Check(tool.outputSchema, result.structuredContent));
    if (result !== raw) assert.deepEqual(result.structuredContent, result.details);
    assert.equal(result.details.jobId, result === dropped ? ringId : result === raw ? rawId : runningId);
  }
  assert.deepEqual(raw.structuredContent, {
    ...raw.details,
    events: [{ ...raw.details.events[0]!, summary: "read success: one · 2 lines" }],
  });
  const tiny = await tool.execute("tiny", { jobId: runningId, since: 0, maxChars: 1 }, undefined, undefined, {} as never);
  assert.ok(Check(tool.outputSchema, tiny.structuredContent));
  assert.deepEqual(tiny.structuredContent, { jobId: runningId, agent: "scout", task: "running task", status: "completed", events: [], nextCursor: 0 });
  assert.deepEqual(tiny.content, [{ type: "text", text: "" }]);
  const emptyId = registry.add("worker", "no events");
  const empty = await tool.execute("empty", { jobId: emptyId }, undefined, undefined, {} as never);
  assert.ok(Check(tool.outputSchema, empty.structuredContent));
  assert.deepEqual(empty.structuredContent, { jobId: emptyId, agent: "worker", task: "no events", status: "running", events: [], nextCursor: 0 });
  assert.deepEqual(empty.content, [{ type: "text", text: "subagent peek #5 worker · no events\nnextCursor: 0" }]);
});

test("subagent peek structured summaries share the bounded human preview without raw tool bodies", async () => {
  const registry = createJobRegistry({ now: () => 1234 });
  const jobId = registry.add("worker", "bounded tool results");
  registry.appendEvent(jobId, { kind: "state", summary: "started" });
  const prefix = "read success: ";
  const large = prefix + JSON.stringify({
    content: [{ type: "text", text: `\u001b]2;pwned\u0007${"x".repeat(100000)}\nRAW_TOOL_BODY` }],
  });
  const wrapper = JSON.stringify({ content: [{ type: "text", text: "" }] });
  const runnerSummary = prefix + JSON.stringify({
    content: [{ type: "text", text: "y".repeat(500 - prefix.length - wrapper.length) }],
  });
  assert.equal(runnerSummary.length, 500);
  registry.appendEvent(jobId, { kind: "tool-end", summary: large });
  registry.appendEvent(jobId, { kind: "tool-end", summary: runnerSummary });
  registry.appendEvent(jobId, { kind: "assistant", summary: "z".repeat(500) });
  for (let i = 0; i < 97; i++) registry.appendEvent(jobId, { kind: "state", summary: "running" });
  const tool = createPeekTool({ registry });
  const maxChars = 350;
  const result = await tool.execute("bounded", { jobId, since: 0, limit: 100, maxChars }, undefined, undefined, {} as never);
  const summaries = [
    `${prefix}${"x".repeat(119)}… · 2 lines`,
    `${prefix}${"y".repeat(119)}… · 1 line`,
  ];
  const preview = `[history dropped before 2]\n[2] ${summaries[0]}\n[3] ${summaries[1]}`;
  assert.deepEqual(result.content, [{ type: "text", text: `${preview}\nnextCursor: 3` }]);
  assert.ok((result.content[0] as { text: string }).text.length <= maxChars);
  assert.deepEqual(result.details, {
    jobId, agent: "worker", task: "bounded tool results", status: "running",
    events: [
      { seq: 2, timestamp: 1234, kind: "tool-end", summary: large },
      { seq: 3, timestamp: 1234, kind: "tool-end", summary: runnerSummary },
    ],
    nextCursor: 3, droppedBefore: 2,
  });
  const serialized = JSON.stringify(result.structuredContent);
  const structured = JSON.parse(serialized);
  assert.ok(tool.outputSchema);
  assert.ok(Check(tool.outputSchema, structured));
  assert.deepEqual(structured, {
    ...result.details,
    events: result.details.events.map((event, index) => ({ ...event, summary: summaries[index]! })),
  });
  assert.ok(structured.events.reduce((length: number, event: { summary: string }) => length + event.summary.length, 0) <= maxChars);
  assert.ok(serialized.length < 1000);
  assert.doesNotMatch(serialized, /RAW_TOOL_BODY|pwned|content|\\u001b/);
  assert.deepEqual(registry.readEvents(jobId, { since: 0, limit: 2 })?.events[0], result.details.events[0]);

  const next = await tool.execute("next", { jobId, since: structured.nextCursor, limit: 1, maxChars: 600 }, undefined, undefined, {} as never);
  assert.ok(Check(tool.outputSchema, JSON.parse(JSON.stringify(next.structuredContent))));
  const nextSummary = "z".repeat(500);
  assert.deepEqual(next.details.events, [{ seq: 4, timestamp: 1234, kind: "assistant", summary: nextSummary }]);
  assert.deepEqual(next.structuredContent, {
    ...next.details,
    events: [{ seq: 4, timestamp: 1234, kind: "assistant", summary: nextSummary }],
  });
  assert.equal(next.details.nextCursor, 4);
  assert.equal(next.details.droppedBefore, undefined);
  assert.deepEqual(next.content, [{ type: "text", text: `subagent peek #1 worker · bounded tool results\n[4] ${nextSummary}\nnextCursor: 4` }]);
});

test("subagent status structured results preserve empty, filtered, and unknown snapshots", async () => {
  const registry = createJobRegistry();
  const tool = createStatusTool({ registry });
  assert.ok(tool.outputSchema);
  assert.equal(tool.exposure ?? "direct", "direct");
  const empty = await tool.execute("empty", {}, undefined, undefined, {} as never);
  assert.ok(Check(tool.outputSchema, empty.structuredContent));
  assert.deepEqual(empty.structuredContent, { text: "**Running:** none", jobs: [] });
  assert.deepEqual(empty.content, [{ type: "text", text: "**Running:** none" }]);

  const runningId = registry.add("scout", "running task", "Running title");
  const recentId = registry.add("worker", "recent task");
  registry.complete(recentId, { agent: "worker", task: "recent task", text: "done", exitCode: 0, error: "" });
  const oldRegistry = createJobRegistry({ now: () => Date.now() - 61000 });
  const oldId = oldRegistry.add("old", "old task");
  oldRegistry.complete(oldId, { agent: "old", task: "old task", text: "done", exitCode: 0, error: "" });
  const oldTool = createStatusTool({ registry: oldRegistry });
  const old = await oldTool.execute("old", {}, undefined, undefined, {} as never);
  assert.ok(Check(oldTool.outputSchema!, old.structuredContent));
  assert.deepEqual(old.structuredContent, { text: "**Running:** none", jobs: [] });

  const aggregate = await tool.execute("all", {}, undefined, undefined, {} as never);
  assert.ok(Check(tool.outputSchema, aggregate.structuredContent));
  assert.deepEqual(aggregate.structuredContent, {
    text: aggregate.details.text,
    jobs: [
      { jobId: runningId, agent: "scout", status: "running", label: "Running title" },
      { jobId: recentId, agent: "worker", status: "completed", label: "recent task" },
    ],
  });
  registry.updateLive(runningId, { text: "x".repeat(5000) });
  const individual = await tool.execute("one", { jobId: runningId }, undefined, undefined, {} as never);
  assert.ok(Check(tool.outputSchema, individual.structuredContent));
  assert.deepEqual(individual.structuredContent, {
    text: individual.details.text,
    jobId: runningId,
    jobs: [{ jobId: runningId, agent: "scout", status: "running", label: "Running title" }],
  });
  assert.deepEqual(individual.content, [{ type: "text", text: individual.details.text }]);
  assert.match(individual.details.text, /Latest output:\n/);
  assert.ok(individual.details.text.includes(`${"x".repeat(4000)}\n…`));
  assert.ok(!individual.details.text.includes("x".repeat(4001)));
  const unknown = await tool.execute("unknown", { jobId: 999 }, undefined, undefined, {} as never);
  assert.ok(Check(tool.outputSchema, unknown.structuredContent));
  assert.deepEqual(unknown.structuredContent, {
    text: "subagent status #999: Unknown subagent job ID: 999", jobId: 999, jobs: [], error: "subagent status #999: Unknown subagent job ID: 999",
  });
  assert.deepEqual(unknown.content, [{ type: "text", text: "subagent status #999: Unknown subagent job ID: 999" }]);
  assert.equal(unknown.isError, undefined);
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
  const runningId = registry.add("scout", "actual running task", "Status title", { profile: "backup" });
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
  assert.match(individualText, /Task: actual running task/);
  assert.match(individualText, /Title: Status title/);
  assert.match(individualText, /Profile: backup/);
  assert.match(individualText, /Progress: reading files/);
  assert.match(individualText, /Usage: 1 turn p\/m:minimal/);
  assert.match(individualText, /Tool calls \(1\):\n- read src\/index\.ts/);
  assert.match(individualText, /Latest output:\nlatest output/);
  assert.doesNotMatch(individualText, new RegExp(`#${completedId} worker`));

  registry.recordQuestion(runningId, { id: "question-1", question: "Which API?" });
  const waiting = await tool.execute("call2", { jobId: runningId }, undefined, undefined, {} as never);
  assert.match((waiting.content[0] as { text: string }).text, /Waiting for parent \(1\):\n- question-1: Which API\?/);

  const unknown = await tool.execute("call3", { jobId: 999 }, undefined, undefined, {} as never);
  assert.equal((unknown.content[0] as { text: string }).text, "subagent status #999: Unknown subagent job ID: 999");
});

test("subagent status tool previews use render width without enlarging model summaries", async () => {
  const registry = createJobRegistry();
  const jobId = registry.add("scout", "Inspect the output");
  registry.updateLive(jobId, {
    toolCalls: [
      { name: "bash", args: { command: `echo ${"argument ".repeat(10)}useful trailing details` } },
      { name: "read", args: { path: "/Users/jared/project/pi/.pi/agent/extensions/subagents/status-tools.ts", offset: 10, limit: 20 } },
    ],
  });
  const tool = createStatusTool({ registry });
  const result = await tool.execute("status", { jobId }, undefined, undefined, {} as never);
  assert.doesNotMatch((result.content[0] as { text: string }).text, /useful trailing details/);
  registry.updateLive(jobId, { toolCalls: [] });
  const component = tool.renderResult!(result, { expanded: false, isPartial: false }, fakeTheme() as never, { args: { jobId } } as never)!;
  const narrow = component.render(70);
  const wide = component.render(180);
  assert.ok(narrow.every((line) => visibleWidth(line) <= 70));
  assert.ok(wide.every((line) => visibleWidth(line) <= 180));
  assert.doesNotMatch(narrow.join("\n"), /useful trailing details/);
  assert.match(wide.join("\n"), /useful trailing details/);
  assert.match(narrow.join("\n"), /status-tools\.ts:10-29/);
  assert.equal(narrow.filter((line) => line.trimStart().startsWith("- ")).length, 2);
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
  assert.equal(renderText(statusTool.renderCall!({ jobId }, theme, {} as never)).trim(), "subagent status #1 scout · Inspect the error path");
  const statusResult = await statusTool.execute("status", { jobId }, undefined, undefined, {} as never);
  assert.match(statusResult.details.text, /Subagent #1/);
  const statusColors: string[] = [];
  const statusTheme = {
    ...fakeTheme(),
    fg: (color: string, text: string) => { statusColors.push(color); return text; },
  } as never;
  const renderedStatus = renderText(
    statusTool.renderResult!(statusResult, { expanded: false, isPartial: false }, statusTheme, { args: { jobId } } as never),
  );
  assert.doesNotMatch(renderedStatus, /Subagent #1/);
  assert.doesNotMatch(renderedStatus, /\*\*Subagent #1\*\*/);
  assert.doesNotMatch(renderedStatus, /f7455070/);
  assert.ok(["muted", "dim", "toolOutput"].every((color) => statusColors.includes(color)));

  const taggedStatusTheme = {
    ...fakeTheme(),
    fg: (color: string, text: string) => `[${color}]${text}[/${color}]`,
  } as never;
  const taggedStatus = renderText(
    statusTool.renderResult!(statusResult, { expanded: false, isPartial: false }, taggedStatusTheme, { args: { jobId } } as never),
  );
  assert.doesNotMatch(taggedStatus, /\[dim\] Inspect the error path/);
  assert.match(taggedStatus, /\[dim\]- Which path\?/);
  assert.match(taggedStatus, /\[toolOutput\]Error: output text/);
  assert.match(taggedStatus, /\[toolOutput\]- output item/);
  assert.match(taggedStatus, /\[toolOutput\]\*\*output heading\*\*/);
  assert.doesNotMatch(taggedStatus, /f7455070/);

  const aggregateResult = await statusTool.execute("status-all", {}, undefined, undefined, {} as never);
  const taggedAggregate = renderText(
    statusTool.renderResult!(aggregateResult, { expanded: false, isPartial: false }, taggedStatusTheme, {} as never),
  );
  assert.match(taggedAggregate, /\[accent\]⊙ /);
  assert.match(taggedAggregate, /\[accent\]#1 scout/);
  assert.match(taggedAggregate, /\[muted\] \([^)]*\)/);
  assert.match(taggedAggregate, /\[dim\]: Inspect the error path/);

  const malformedStatus = statusTool.renderResult!(
    { content: [{ type: "text", text: "legacy status" }], details: { text: 123 } } as never,
    { expanded: false, isPartial: false },
    theme,
    {} as never,
  );
  assert.equal(renderTrimmed(malformedStatus), "subagent status all\n  legacy status");

  const sendTool = createSendTool({ registry });
  const sendArgs = { jobId, message: "Check the failure path", deliverAs: "steer" as const };
  const sendCall = renderText(sendTool.renderCall!(sendArgs, theme, {} as never))
    .split("\n").map((line) => line.trimEnd()).join("\n").trim();
  assert.equal(sendCall, "subagent send #1 scout · Inspect the error path · steering\n  Check the failure path");
  const longMessage = `first\n${"x".repeat(140)} trailing-message`;
  const widePreview = renderAtWidth(
    sendTool.renderCall!({ ...sendArgs, message: longMessage }, theme, {} as never),
    220,
  );
  const narrowPreview = renderAtWidth(
    sendTool.renderCall!({ ...sendArgs, message: longMessage }, theme, {} as never),
    80,
  );
  assert.equal(widePreview.split("\n").length, 2);
  assert.ok(visibleWidth(widePreview.split("\n")[1]!) > 80);
  assert.match(widePreview, /first x+ trailing-message/);
  assert.equal(narrowPreview.split("\n").length, 2);
  assert.ok(visibleWidth(narrowPreview.split("\n")[1]!) <= 80);
  const sendResult = await sendTool.execute("send", sendArgs, undefined, undefined, {} as never);
  const renderedSendResult = renderText(
    sendTool.renderResult!(sendResult, { expanded: false, isPartial: false }, theme, { args: sendArgs } as never),
  ).split("\n").map((line) => line.trimEnd()).join("\n").trim();
  assert.equal(renderedSendResult, "✓ delivered");
  const combinedSendPreview = `${sendCall}\n${renderedSendResult}`;
  assert.equal(combinedSendPreview.match(/Check the failure path/g)?.length, 1);
  assert.equal(combinedSendPreview.match(/Inspect the error path/g)?.length, 1);
  const taggedTheme = {
    ...fakeTheme(),
    fg: (color: string, text: string) => `[${color}]${text}[/${color}]`,
  } as never;
  const taggedSendResult = renderText(
    sendTool.renderResult!(sendResult, { expanded: false, isPartial: false }, taggedTheme, { args: sendArgs } as never),
  );
  assert.match(taggedSendResult, /\[success\]✓ /);
  assert.match(taggedSendResult, /\[muted\]delivered/);
  assert.doesNotMatch(taggedSendResult, /#1 scout|Inspect the error path|Check the failure path/);
  const sendError = sendTool.renderResult!(
    { content: [{ type: "text", text: "transport failed" }], details: {} } as never,
    { expanded: false, isPartial: false },
    theme,
    { args: sendArgs, isError: true } as never,
  );
  assert.equal(renderTrimmed(sendError), "transport failed");
  const legacySend = sendTool.renderResult!(
    { content: [{ type: "text", text: "legacy send result" }], details: {} } as never,
    { expanded: false, isPartial: false },
    theme,
    {} as never,
  );
  assert.equal(renderTrimmed(legacySend), "subagent send #?\n  legacy send result");

  const peekFallback = createPeekTool({ registry }).renderResult!(
    { content: [{ type: "text", text: "peek failed" }], details: {} } as never,
    { expanded: false, isPartial: false },
    theme,
    { args: { jobId }, isError: true } as never,
  );
  assert.equal(renderTrimmed(peekFallback), "peek failed");

  const cancelTool = createCancelTool({ registry });
  assert.equal(renderText(cancelTool.renderCall!({ jobId }, theme, {} as never)).trim(), "subagent cancel #1 scout · Inspect the error path");
  const cancelResult = await cancelTool.execute("cancel", { jobId }, undefined, undefined, {} as never);
  assert.equal(
    renderText(cancelTool.renderResult!(cancelResult, { expanded: false, isPartial: false }, theme, { args: { jobId } } as never))
      .split("\n").map((line) => line.trimEnd()).join("\n").trim(),
    "⊘ cancelling 1 subagent",
  );
  const taggedCancelResult = renderText(
    cancelTool.renderResult!(cancelResult, { expanded: false, isPartial: false }, taggedTheme, { args: { jobId } } as never),
  );
  assert.match(taggedCancelResult, /\[warning\]⊘ /);
  assert.match(taggedCancelResult, /\[muted\]cancelling /);
  assert.doesNotMatch(taggedCancelResult, /\[accent\]#1 scout/);
  assert.doesNotMatch(taggedCancelResult, /\[dim\] · Inspect the error path/);
  const cancelError = cancelTool.renderResult!(
    { content: [{ type: "text", text: "cancel failed" }], details: {} } as never,
    { expanded: false, isPartial: false },
    theme,
    { args: { jobId }, isError: true } as never,
  );
  assert.equal(renderTrimmed(cancelError), "cancel failed");
  const legacyCancel = cancelTool.renderResult!(
    { content: [{ type: "text", text: "legacy cancel result" }], details: {} } as never,
    { expanded: false, isPartial: false },
    theme,
    {} as never,
  );
  assert.equal(renderTrimmed(legacyCancel), "subagent cancel all\n  legacy cancel result");
});

test("resolved status and peek results omit only duplicated identity", async () => {
  const registry = createJobRegistry();
  const jobId = registry.add("scout", "actual task", "Displayed title");
  registry.updateLive(jobId, {
    text: "Task: body task\nAgent: body agent\noutput body",
  });

  const statusTool = createStatusTool({ registry });
  const statusArgs = { jobId };
  const statusCall = renderText(statusTool.renderCall!(statusArgs, fakeTheme() as never, {} as never));
  const statusResult = await statusTool.execute("status", statusArgs, undefined, undefined, {} as never);
  const statusText = renderText(statusTool.renderResult!(
    statusResult,
    { expanded: false, isPartial: false },
    fakeTheme() as never,
    { args: statusArgs } as never,
  ));
  const combinedStatus = `${statusCall}\n${statusText}`;
  assert.equal(combinedStatus.match(/#1 scout · Displayed title/g)?.length, 1);
  assert.doesNotMatch(statusText, /Subagent #1|Agent: scout|Title: Displayed title/);
  assert.match(statusText, /State: running/);
  assert.match(statusText, /Task: actual task/);
  assert.match(statusText, /Task: body task/);
  assert.match(statusText, /Agent: body agent/);
  assert.match(statusText, /output body/);

  const peekTool = createPeekTool({ registry });
  const peekArgs = { jobId, since: 0 };
  const peekCall = renderText(peekTool.renderCall!(peekArgs, fakeTheme() as never, {} as never));
  const peekResult = {
    content: [{ type: "text", text: "legacy peek" }],
    details: {
      jobId,
      agent: "scout",
      task: "actual task",
      title: "Displayed title",
      status: "running",
      droppedBefore: 4,
      events: [{ seq: 5, timestamp: 1, kind: "assistant", summary: "event body" }],
      nextCursor: 5,
    },
  };
  const peekText = renderText(peekTool.renderResult!(
    peekResult as never,
    { expanded: false, isPartial: false },
    fakeTheme() as never,
    { args: peekArgs } as never,
  ));
  const combinedPeek = `${peekCall}\n${peekText}`;
  assert.equal(combinedPeek.match(/#1 scout · Displayed title/g)?.length, 1);
  assert.doesNotMatch(peekText, /subagent peek #1 scout|Title: Displayed title/);
  assert.match(peekText, /Task: actual task/);
  assert.match(peekText, /history dropped before event 4/);
  assert.match(peekText, /event body/);
  assert.match(peekText, /cursor: 5/);

  const legacyPeek = renderText(peekTool.renderResult!(
    peekResult as never,
    { expanded: false, isPartial: false },
    fakeTheme() as never,
    {} as never,
  ));
  assert.match(legacyPeek, /subagent peek #1 scout · Displayed title/);
  assert.match(legacyPeek, /Task: actual task/);
  assert.match(legacyPeek, /Title: Displayed title/);

  registry.jobs.delete(jobId);
  const archivedPeek = renderText(peekTool.renderResult!(
    peekResult as never,
    { expanded: false, isPartial: false },
    fakeTheme() as never,
    { args: peekArgs } as never,
  ));
  assert.match(archivedPeek, /subagent peek #1 scout · Displayed title/);
  assert.match(archivedPeek, /Task: actual task/);
  assert.match(archivedPeek, /Title: Displayed title/);
});

test("launch failures and cancellations keep status while avoiding a repeated target", () => {
  const { tool } = makeTool();
  const theme = fakeTheme() as never;
  const args = { agent: "scout", task: "launch task", title: "Launch title" };
  const call = renderText(tool.renderCall!(args, theme, {} as never));
  const failed = renderText(tool.renderResult!(
    {
      content: [{ type: "text", text: "subagent launch scout · Launch title: Error: spawn failed" }],
      details: { status: "failed", jobId: 1, agent: "scout", task: "launch task", title: "Launch title" },
    } as never,
    { expanded: false, isPartial: false },
    theme,
    { args } as never,
  ));
  const combinedLaunch = `${call}\n${failed}`;
  assert.equal(combinedLaunch.match(/Launch title/g)?.length, 1);
  assert.doesNotMatch(failed, /subagent launch/);
  assert.match(failed, /✗/);
  assert.match(failed, /Error: spawn failed/);

  const cancelled = renderText(tool.renderResult!(
    {
      content: [{ type: "text", text: "subagent launch scout · Launch title: Cancelled (manual)." }],
      details: { status: "cancelled", jobId: 1, agent: "scout", task: "launch task", title: "Launch title" },
    } as never,
    { expanded: false, isPartial: false },
    theme,
    { args } as never,
  ));
  assert.doesNotMatch(cancelled, /subagent launch scout · Launch title/);
  assert.match(cancelled, /⊘/);
  assert.match(cancelled, /Cancelled \(manual\)/);

  const mismatched = renderText(tool.renderResult!(
    {
      content: [{ type: "text", text: "subagent launch scout · Other title: Error: mismatch" }],
      details: { status: "failed", jobId: 1, agent: "scout", task: "launch task", title: "Other title" },
    } as never,
    { expanded: false, isPartial: false },
    theme,
    { args } as never,
  ));
  assert.match(mismatched, /subagent launch scout · Other title/);
  assert.match(mismatched, /Error: mismatch/);

  const legacy = renderText(tool.renderResult!(
    {
      content: [{ type: "text", text: "subagent launch scout · Launch title: Error: legacy" }],
      details: { status: "failed", jobId: 1, agent: "scout", task: "launch task", title: "Launch title" },
    } as never,
    { expanded: false, isPartial: false },
    theme,
    {} as never,
  ));
  assert.match(legacy, /subagent launch scout · Launch title/);
  assert.match(legacy, /Error: legacy/);

  const launched = renderText(tool.renderResult!(
    { content: [{ type: "text", text: "Launched **scout** subagent #1: \\\"launch task\\\"" }], details: { status: "launched", jobIds: [1] } } as never,
    { expanded: false, isPartial: false },
    theme,
    { args } as never,
  ));
  assert.equal(launched.trim(), "");
});

test("send and reply receipts keep identity only for fallback cases", async () => {
  const registry = createJobRegistry();
  const sendId = registry.add("scout", "hidden send task", "Send title");
  registry.registerControl(sendId, { cancel: () => {}, send: async () => {}, reply: async () => {} });
  const sendTool = createSendTool({ registry });
  for (const deliverAs of ["steer", "followUp"] as const) {
    const args = { jobId: sendId, message: `${deliverAs} message`, deliverAs };
    const call = renderText(sendTool.renderCall!(args, fakeTheme() as never, {} as never));
    const result = await sendTool.execute(`send-${deliverAs}`, args, undefined, undefined, {} as never);
    const receipt = renderTrimmed(sendTool.renderResult!(
      result,
      { expanded: false, isPartial: false },
      fakeTheme() as never,
      { args } as never,
    ));
    const combined = `${call}\n${receipt}`;
    assert.equal(combined.match(/#1 scout · Send title/g)?.length, 1);
    assert.equal(combined.match(new RegExp(`${deliverAs} message`, "g"))?.length, 1);
    assert.equal(receipt, "✓ delivered");
  }

  registry.jobs.delete(sendId);
  const archivedSend = renderTrimmed(sendTool.renderResult!(
    {
      content: [{ type: "text", text: "Sent steering message to subagent #1 scout · Send title." }],
      details: {
        jobId: sendId, agent: "scout", task: "hidden send task", title: "Send title", label: "Send title",
        message: "archived message", deliverAs: "steer",
      },
    } as never,
    { expanded: false, isPartial: false },
    fakeTheme() as never,
    { args: { jobId: sendId, message: "archived message", deliverAs: "steer" } } as never,
  ));
  assert.equal(archivedSend, "✓ delivered to #1 scout · Send title");
  const noArgsSend = renderTrimmed(sendTool.renderResult!(
    {
      content: [{ type: "text", text: "legacy send success" }],
      details: {
        jobId: sendId, agent: "scout", task: "hidden send task", title: "Send title", label: "Send title",
        message: "archived message", deliverAs: "steer",
      },
    } as never,
    { expanded: false, isPartial: false },
    fakeTheme() as never,
    {} as never,
  ));
  assert.equal(noArgsSend, "✓ delivered to #1 scout · Send title");

  const replyRegistry = createJobRegistry();
  const replyId = replyRegistry.add("worker", "hidden reply task", "Reply title");
  replyRegistry.registerControl(replyId, { cancel: () => {}, send: async () => {}, reply: async () => {} });
  replyRegistry.recordQuestion(replyId, { id: "question-1", question: "Continue?" });
  const replyTool = createReplyTool({ registry: replyRegistry });
  const replyArgs = { jobId: replyId, questionId: "question-1", answer: "yes" };
  const replyCall = renderText(replyTool.renderCall!(replyArgs, fakeTheme() as never, {} as never));
  const replyResult = await replyTool.execute("reply", replyArgs, undefined, undefined, {} as never);
  const replyReceipt = renderTrimmed(replyTool.renderResult!(
    replyResult,
    { expanded: false, isPartial: false },
    fakeTheme() as never,
    { args: replyArgs } as never,
  ));
  const combinedReply = `${replyCall}\n${replyReceipt}`;
  assert.equal(combinedReply.match(/#1 worker · Reply title/g)?.length, 1);
  assert.equal(combinedReply.match(/Continue\?/g)?.length, 1);
  assert.equal(combinedReply.match(/yes/g)?.length, 1);
  assert.equal(replyReceipt, "✓ answered\n  Q: Continue?\n  A: yes");

  replyRegistry.jobs.delete(replyId);
  const archivedReply = renderTrimmed(replyTool.renderResult!(
    {
      content: [{ type: "text", text: "Answered subagent #1 worker · Reply title." }],
      details: {
        jobId: replyId, agent: "worker", task: "hidden reply task", title: "Reply title",
        questionId: "question-1", question: "Continue?", answer: "yes",
      },
    } as never,
    { expanded: false, isPartial: false },
    fakeTheme() as never,
    { args: replyArgs } as never,
  ));
  assert.equal(archivedReply, "✓ answered · #1 worker · Reply title\n  Q: Continue?\n  A: yes");
  const noArgsReply = renderTrimmed(replyTool.renderResult!(
    {
      content: [{ type: "text", text: "legacy reply success" }],
      details: {
        jobId: replyId, agent: "worker", task: "hidden reply task", title: "Reply title",
        questionId: "question-1", question: "Continue?", answer: "yes",
      },
    } as never,
    { expanded: false, isPartial: false },
    fakeTheme() as never,
    {} as never,
  ));
  assert.equal(noArgsReply, "✓ answered · #1 worker · Reply title\n  Q: Continue?\n  A: yes");
});

test("cancel results keep all targets but compact a resolved single target", async () => {
  const registry = createJobRegistry();
  const first = registry.add("scout", "first task", "First title");
  registry.registerControl(first, { cancel: () => {}, send: async () => {}, reply: async () => {} });
  const tool = createCancelTool({ registry });
  const firstArgs = { jobId: first };
  const call = renderText(tool.renderCall!(firstArgs, fakeTheme() as never, {} as never));
  const firstResult = await tool.execute("cancel-one", firstArgs, undefined, undefined, {} as never);
  const compact = renderText(tool.renderResult!(
    firstResult,
    { expanded: false, isPartial: false },
    fakeTheme() as never,
    { args: firstArgs } as never,
  ));
  assert.equal(`${call}\n${compact}`.match(/#1 scout · First title/g)?.length, 1);
  assert.match(compact, /⊘ cancelling 1 subagent/);
  assert.doesNotMatch(compact, /First title/);

  registry.complete(first, { agent: "scout", task: "first task", title: "First title", text: "", exitCode: 130, error: "Cancelled (manual).", cancelled: true, cancellationReason: "manual" });
  const zero = await tool.execute("cancel-zero", firstArgs, undefined, undefined, {} as never);
  const zeroText = renderTrimmed(tool.renderResult!(
    zero,
    { expanded: false, isPartial: false },
    fakeTheme() as never,
    { args: firstArgs } as never,
  ));
  assert.match(zeroText, /no running subagent/i);
  assert.doesNotMatch(zeroText, /First title/);
  const zeroLegacy = renderTrimmed(tool.renderResult!(
    zero,
    { expanded: false, isPartial: false },
    fakeTheme() as never,
    {} as never,
  ));
  assert.match(zeroLegacy, /subagent cancel all/);
  assert.match(zeroLegacy, /no running subagent/i);

  const second = registry.add("worker", "second task", "Second title");
  registry.registerControl(second, { cancel: () => {}, send: async () => {}, reply: async () => {} });
  const third = registry.add("builder", "third task", "Third title");
  registry.registerControl(third, { cancel: () => {}, send: async () => {}, reply: async () => {} });
  const allArgs = { all: true };
  const allResult = await tool.execute("cancel-all", allArgs, undefined, undefined, {} as never);
  const allText = renderTrimmed(tool.renderResult!(
    allResult,
    { expanded: false, isPartial: false },
    fakeTheme() as never,
    { args: allArgs } as never,
  ));
  assert.match(allText, /⊘ cancelling 2 subagents/);
  assert.match(allText, /#2 worker · Second title/);
  assert.match(allText, /#3 builder · Third title/);
  assert.doesNotMatch(allText, /#1 scout · First title/);
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

test("/subagent-profile and its ctrl+shift+l shortcut select, validate, and persist profiles", async () => {
  const settings = {
    profiles: {
      primary: { defaults: { model: "primary/model" }, agents: {} },
      backup: { defaults: { model: "backup/model" }, agents: {} },
    },
    extensions: [],
  };
  let activeProfile = "primary";
  const entries: Array<[string, unknown]> = [];
  const notices: Array<{ text: string; level: string }> = [];
  const pickerOptions: string[][] = [];
  const commands = new Map<string, { handler: (args: string, ctx: unknown) => Promise<void> }>();
  const shortcuts = new Map<string, { handler: (ctx: unknown) => Promise<void> | void }>();
  const pi = {
    appendEntry: (type: string, data: unknown) => entries.push([type, data]),
    registerCommand: (name: string, command: { handler: (args: string, ctx: unknown) => Promise<void> }) => commands.set(name, command),
    registerShortcut: (key: string, shortcut: { handler: (ctx: unknown) => Promise<void> | void }) => shortcuts.set(key, shortcut),
  } as unknown as ExtensionAPI;
  registerStatusCommands(pi, {
    registry: createJobRegistry(),
    profiles: {
      settings,
      getActiveProfile: () => activeProfile,
      setActiveProfile: (name) => { activeProfile = name; },
    },
  });
  const command = commands.get("subagent-profile");
  assert.ok(command);
  const ctx = {
    mode: "tui",
    hasUI: true,
    ui: {
      notify: (text: string, level: string) => notices.push({ text, level }),
      select: async (_title: string, options: string[]) => {
        pickerOptions.push(options);
        return "primary";
      },
    },
  };

  await command.handler("backup", ctx);
  assert.equal(activeProfile, "backup");
  assert.deepEqual(entries, [[PROFILE_ENTRY_TYPE, { name: "backup" }]]);
  assert.match(notices.at(-1)?.text ?? "", /New jobs will use it/);

  await command.handler("missing", ctx);
  assert.equal(activeProfile, "backup");
  assert.equal(notices.at(-1)?.level, "error");

  await command.handler("", ctx);
  assert.deepEqual(pickerOptions, [["primary", "backup"]]);
  assert.equal(activeProfile, "primary");
  assert.deepEqual(entries.at(-1), [PROFILE_ENTRY_TYPE, { name: "primary" }]);

  await command.handler("", { ...ctx, mode: "print" });
  assert.match(notices.at(-1)?.text ?? "", /Active subagent profile: primary/);

  const shortcut = shortcuts.get("ctrl+shift+l");
  assert.ok(shortcut);
  await shortcut.handler({
    ...ctx,
    ui: {
      notify: ctx.ui.notify,
      select: async (_title: string, options: string[]) => {
        pickerOptions.push(options);
        return "backup";
      },
    },
  });
  assert.equal(activeProfile, "backup");
  assert.deepEqual(entries.at(-1), [PROFILE_ENTRY_TYPE, { name: "backup" }]);
});

test("restoreActiveProfile uses the latest valid session selection", () => {
  const settings = {
    profiles: {
      primary: { defaults: {}, agents: {} },
      backup: { defaults: {}, agents: {} },
    },
    extensions: [],
  };
  assert.equal(restoreActiveProfile([], settings), undefined);
  assert.equal(restoreActiveProfile([], { profiles: {}, extensions: [] }), undefined);
  assert.equal(restoreActiveProfile([], { profiles: { primary: settings.profiles.primary }, extensions: [] }), "primary");
  assert.equal(restoreActiveProfile([
    { type: "custom", customType: PROFILE_ENTRY_TYPE, data: { name: "removed" } },
    { type: "custom", customType: PROFILE_ENTRY_TYPE, data: { name: "constructor" } },
  ], settings), undefined);
  assert.equal(restoreActiveProfile([
    { type: "custom", customType: PROFILE_ENTRY_TYPE, data: { name: "backup" } },
    { type: "custom", customType: PROFILE_ENTRY_TYPE, data: { name: "removed" } },
  ], settings), "backup");
});

test("extension selects profiles explicitly and uses the headless fallback", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "subagents-test-"));
  const extensionDir = join(dir, "extensions", "subagents");
  const settingsDir = join(dir, ".pi", "agent");
  const dirname = Object.getOwnPropertyDescriptor(globalThis, "__dirname");
  t.after(async () => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
    if (dirname) Object.defineProperty(globalThis, "__dirname", dirname);
    else Reflect.deleteProperty(globalThis, "__dirname");
    await rm(dir, { recursive: true, force: true });
  });
  await mkdir(join(extensionDir, "agents"), { recursive: true });
  await mkdir(settingsDir, { recursive: true });
  await writeFile(join(extensionDir, "agents", "scout.md"), "---\nname: scout\nthinkingLevel: high\n---\nYou are a scout.");
  Object.defineProperty(globalThis, "__dirname", { configurable: true, value: extensionDir });
  t.mock.method(os, "homedir", () => dir);
  syncBuiltinESMExports();

  const profiles = {
    primary: { defaults: { model: "primary/model" }, agents: {} },
    backup: { defaults: { model: "backup/model" }, agents: { scout: { thinkingLevel: "medium" } } },
  };
  const cases: Array<{
    name: string; mode: "print" | "tui"; profiles: Record<string, unknown>; flag?: string;
    profile?: string; model?: string; thinking?: string; error?: RegExp; rearm?: boolean;
    restored?: string; live?: boolean;
  }> = [
    { name: "zero profiles", mode: "print", profiles: {}, model: "p/m", thinking: "high" },
    { name: "sole profile", mode: "print", profiles: { primary: profiles.primary }, profile: "primary", model: "primary/model", thinking: "high" },
    { name: "headless ignores a restored choice among multiple profiles", mode: "print", profiles, model: "p/m", thinking: "high" },
    { name: "headless flag selects a profile", mode: "print", profiles, flag: "backup", profile: "backup", model: "backup/model", thinking: "medium" },
    { name: "unknown flag rejects the launch", mode: "print", profiles, flag: "missing", error: /Unknown subagent profile "missing"/ },
    { name: "inherited object properties are not profiles", mode: "print", profiles, flag: "constructor", error: /Unknown subagent profile "constructor"/ },
    { name: "disabled flag rejects the launch", mode: "print", profiles: { ...profiles, backup: { ...profiles.backup, enabled: false } }, flag: "backup", error: /Unknown subagent profile "backup"/ },
    { name: "interactive zero profiles", mode: "tui", profiles: {}, model: "p/m", thinking: "high" },
    { name: "interactive sole profile is inferred", mode: "tui", profiles: { primary: profiles.primary }, profile: "primary", model: "primary/model", thinking: "high", rearm: true },
    { name: "interactive restored profile still requires confirmation", mode: "tui", profiles, restored: "backup", profile: "primary", model: "primary/model", thinking: "high" },
    { name: "interactive launch requires a choice", mode: "tui", profiles, profile: "primary", model: "primary/model", thinking: "high", live: true },
    { name: "interactive flag confirms a choice until the model changes", mode: "tui", profiles, flag: "backup", profile: "backup", model: "backup/model", thinking: "medium", rearm: true },
  ];
  for (const entry of cases) {
    await t.test(entry.name, async (t) => {
      await writeFile(join(settingsDir, "settings.json"), JSON.stringify({ subagents: { profiles: entry.profiles } }));
      const children = [new FakeChild(), new FakeChild()];
      const { spawnFn, calls } = fakeSpawnChildren(children);
      t.mock.method(childProcess, "spawn", spawnFn);
      syncBuiltinESMExports();
      const tools = new Map<string, ReturnType<typeof createSubagentTool>>();
      const commands = new Map<string, { handler: (args: string, ctx: unknown) => Promise<void> }>();
      const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => unknown>();
      const shortcuts = new Map<string, { handler: (ctx: unknown) => Promise<void> | void }>();
      const flags: Array<[string, string]> = [];
      const entries = spy();
      const statuses = spy();
      let latestStatuses = statuses;
      const titles: string[] = [];
      const notices: string[] = [];
      const pi = {
        registerFlag: (name: string, options: { type: string }) => flags.push([name, options.type]),
        getFlag: () => entry.flag,
        registerTool: (tool: ReturnType<typeof createSubagentTool>) => tools.set(tool.name, tool),
        registerCommand: (name: string, command: { handler: (args: string, ctx: unknown) => Promise<void> }) => commands.set(name, command),
        registerShortcut: (key: string, shortcut: { handler: (ctx: unknown) => Promise<void> | void }) => shortcuts.set(key, shortcut),
        registerEntryRenderer: () => {},
        registerMessageRenderer: () => {},
        on: (event: string, handler: (event: unknown, ctx: ExtensionContext) => unknown) => handlers.set(event, handler),
        appendEntry: entries.fn,
        sendMessage: () => {},
      } as unknown as ExtensionAPI;
      const ctx = {
        cwd: dir,
        tools: [],
        executeTool: async () => assert.fail("unexpected nested tool call"),
        mode: entry.mode,
        model: { provider: "p", id: "m" },
        thinkingLevel: "minimal",
        hasUI: entry.mode === "tui",
        isIdle: () => true,
        sessionManager: {
          getEntries: () => entry.mode === "tui" && entry.flag === undefined && !entry.restored ? [] : [
            { type: "custom", customType: PROFILE_ENTRY_TYPE, data: { name: entry.restored ?? "primary" } },
          ],
        },
        ui: {
          notify: (text: string) => notices.push(text),
          select: async (title: string) => { titles.push(title); return "primary"; },
          setWidget: () => {},
          setStatus: statuses.fn,
        },
      } as unknown as ExtensionToolContext;
      try {
        await subagentsExtension(pi);
        assert.deepEqual(flags, [["subagent-profile", "string"]]);
        assert.deepEqual(statuses.calls, []);
        await handlers.get("session_start")!({}, ctx);
        const names = Object.keys(entry.profiles);
        const initialProfile = entry.flag ?? entry.restored ?? (names.length === 1 ? names[0] : undefined);
        assert.deepEqual(statuses.calls, entry.mode === "tui" ? [[PROFILE_ENTRY_TYPE, initialProfile]] : []);
        const tool = tools.get("subagent")!;
        if (entry.error) {
          await assert.rejects(tool.execute("launch", { agent: "scout", task: "t" }, undefined, undefined, ctx), entry.error);
          assert.equal(calls.length, 0);
          const status = await tools.get("subagent_status")!.execute("status", {}, undefined, undefined, ctx);
          assert.match((status.content[0] as { text: string }).text, /Running:\*\* none/);
          return;
        }
        if (Object.keys(entry.profiles).length === 0) {
          await commands.get("subagent-profile")!.handler("", { ...ctx, hasUI: true });
          assert.deepEqual(notices, ["Active subagent profile: none. Available: none"]);
        }
        const result = await tool.execute("launch", { agent: "scout", task: "t" }, undefined, undefined, ctx);
        assert.equal(result.details.profile, entry.profile);
        assert.deepEqual(titles, entry.mode === "tui" && !entry.flag && names.length > 1 ? [`Subagent profile (active: ${initialProfile ?? "none"})`] : []);
        assert.deepEqual(statuses.calls.at(-1), entry.mode === "tui" ? [PROFILE_ENTRY_TYPE, entry.profile] : undefined);
        await sleep(10);
        assert.equal(calls.length, 1);
        const args = calls[0]!.args;
        assert.equal(args[args.indexOf("--model") + 1], entry.model);
        assert.equal(args[args.indexOf("--thinking") + 1], entry.thinking);
        children[0]!.stdout.emit("data", Buffer.from(endEvent("done")));
        children[0]!.finish(0);
        await sleep(20);
        if (entry.rearm) {
          const beforeModelSelect = [...statuses.calls];
          await handlers.get("model_select")!({ source: "restore" }, ctx);
          assert.deepEqual(statuses.calls, beforeModelSelect);
          await handlers.get("model_select")!({ source: "set" }, ctx);
          const hasMultipleProfiles = Object.keys(entry.profiles).length > 1;
          assert.deepEqual(statuses.calls, hasMultipleProfiles
            ? [...beforeModelSelect, [PROFILE_ENTRY_TYPE, undefined]]
            : beforeModelSelect);
          const next = await tool.execute("next", { agent: "scout", task: "t" }, undefined, undefined, ctx);
          assert.equal(next.details.profile, "primary");
          assert.deepEqual(statuses.calls.at(-1), [PROFILE_ENTRY_TYPE, "primary"]);
          assert.deepEqual(titles, hasMultipleProfiles ? ["Subagent profile (active: none)"] : []);
          assert.equal(entries.calls.some((call) => call[0] === PROFILE_ENTRY_TYPE), hasMultipleProfiles);
          await sleep(10);
          assert.equal(calls.length, 2);
          children[1]!.stdout.emit("data", Buffer.from(endEvent("done")));
          children[1]!.finish(0);
          await sleep(20);
        }
        if (entry.live) {
          const command = commands.get("subagent-profile")!;
          await command.handler("backup", ctx);
          assert.deepEqual(statuses.calls.at(-1), [PROFILE_ENTRY_TYPE, "backup"]);
          const beforeInvalid = [...statuses.calls];
          await command.handler("missing", ctx);
          assert.deepEqual(statuses.calls, beforeInvalid);
          await command.handler("", ctx);
          assert.deepEqual(statuses.calls.at(-1), [PROFILE_ENTRY_TYPE, "primary"]);
          await shortcuts.get("ctrl+shift+l")!.handler({
            ...ctx,
            ui: { ...ctx.ui, select: async () => "backup" },
          });
          assert.deepEqual(statuses.calls.at(-1), [PROFILE_ENTRY_TYPE, "backup"]);

          const resetStatuses = spy();
          const resetCtx = { ...ctx, ui: { ...ctx.ui, setStatus: resetStatuses.fn } };
          await handlers.get("session_start")!({}, resetCtx);
          latestStatuses = resetStatuses;
          assert.deepEqual(resetStatuses.calls, [[PROFILE_ENTRY_TYPE, undefined]]);
          const beforeReset = [...statuses.calls];
          for (const key of ["hasUI", "ui"]) {
            Object.defineProperty(ctx, key, { get: () => { throw new Error("stale context"); } });
          }
          await command.handler("backup", resetCtx);
          assert.deepEqual(resetStatuses.calls.at(-1), [PROFILE_ENTRY_TYPE, "backup"]);
          assert.deepEqual(statuses.calls, beforeReset);
        }
      } finally {
        await handlers.get("session_shutdown")?.({}, ctx);
        assert.deepEqual(latestStatuses.calls.slice(-2), entry.mode === "tui" ? [
          [STATUS_KEY, undefined],
          [PROFILE_ENTRY_TYPE, undefined],
        ] : []);
        t.mock.restoreAll();
        syncBuiltinESMExports();
      }
    });
  }
});

test("reArmsProfileGate re-arms on model changes but not on resume", () => {
  assert.equal(reArmsProfileGate("set"), true);
  assert.equal(reArmsProfileGate("cycle"), true);
  assert.equal(reArmsProfileGate("restore"), false);
});

test("confirmSubagentProfile gates the first launch and persists the choice", async () => {
  const settings = {
    profiles: {
      primary: { defaults: {}, agents: {} },
      backup: { defaults: {}, agents: {} },
    },
    extensions: [],
  };
  let activeProfile = "primary";
  let confirmed = false;
  const entries: Array<[string, unknown]> = [];
  const pickerOptions: string[][] = [];
  const pauses: string[] = [];
  const pi = {
    appendEntry: (type: string, data: unknown) => entries.push([type, data]),
  } as unknown as ExtensionAPI;
  const profiles = {
    settings,
    getActiveProfile: () => activeProfile,
    setActiveProfile: (name: string) => { activeProfile = name; confirmed = true; },
    needsConfirmation: () => !confirmed,
  };
  const ctx = {
    mode: "tui",
    hasUI: true,
    ui: {
      notify: () => {},
      select: async (_title: string, options: string[]) => {
        pickerOptions.push(options);
        return "backup";
      },
    },
  } as unknown as ExtensionContext;

  assert.equal(await confirmSubagentProfile(pi, profiles, ctx, (message) => pauses.push(message)), true);
  assert.deepEqual(pickerOptions, [["primary", "backup"]]);
  assert.deepEqual(pauses, ["Paused: waiting for subagent profile selection"]);
  assert.equal(activeProfile, "backup");
  assert.deepEqual(entries, [[PROFILE_ENTRY_TYPE, { name: "backup" }]]);

  assert.equal(await confirmSubagentProfile(pi, profiles, ctx, (message) => pauses.push(message)), true);
  assert.equal(pickerOptions.length, 1);
  assert.equal(pauses.length, 1);
});

test("confirmSubagentProfile returns false when the picker is dismissed", async () => {
  const settings = {
    profiles: {
      primary: { defaults: {}, agents: {} },
      backup: { defaults: {}, agents: {} },
    },
    extensions: [],
  };
  let activeProfile = "primary";
  const entries: Array<[string, unknown]> = [];
  const pi = {
    appendEntry: (type: string, data: unknown) => entries.push([type, data]),
  } as unknown as ExtensionAPI;
  const profiles = {
    settings,
    getActiveProfile: () => activeProfile,
    setActiveProfile: (name: string) => { activeProfile = name; },
    needsConfirmation: () => true,
  };
  const ctx = {
    mode: "tui",
    hasUI: true,
    ui: { notify: () => {}, select: async () => undefined },
  } as unknown as ExtensionContext;

  assert.equal(await confirmSubagentProfile(pi, profiles, ctx), false);
  assert.equal(activeProfile, "primary");
  assert.deepEqual(entries, []);
});

test("confirmSubagentProfile skips the picker for one profile or a non-TUI context", async () => {
  let selects = 0;
  const ctx = {
    mode: "tui",
    hasUI: true,
    ui: { notify: () => {}, select: async () => { selects += 1; return "primary"; } },
  } as unknown as ExtensionContext;
  const single = {
    settings: { profiles: { primary: { defaults: {}, agents: {} } }, extensions: [] },
    getActiveProfile: () => "primary",
    setActiveProfile: () => {},
    needsConfirmation: () => true,
  };
  assert.equal(await confirmSubagentProfile({} as ExtensionAPI, single, ctx), true);

  const multiple = {
    settings: {
      profiles: { primary: { defaults: {}, agents: {} }, backup: { defaults: {}, agents: {} } },
      extensions: [],
    },
    getActiveProfile: () => "primary",
    setActiveProfile: () => {},
    needsConfirmation: () => true,
  };
  assert.equal(await confirmSubagentProfile({} as ExtensionAPI, multiple, { ...ctx, mode: "print" }), true);
  assert.equal(selects, 0);
});

test("/subagent-tail opens a live overlay and follows new events", async () => {
  const registry = createJobRegistry();
  const id = registry.add("scout", "running task", "Tail title");
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
  assert.match(renderText(component), /Task: running task/);
  assert.match(renderText(component), /Title: Tail title/);
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

test("slash commands guide no-ID selections without implicit cancellation", async () => {
  const registry = createJobRegistry();
  const runningId = registry.add("scout", "running task", "Running title");
  const completedId = registry.add("worker", "completed task", "Completed title");
  registry.complete(completedId, { agent: "worker", task: "completed task", title: "Completed title", text: "done", exitCode: 0, error: "" });
  const guidedSends: Array<{ jobId: number; message: string; deliverAs: string }> = [];
  registry.registerControl(runningId, {
    cancel: () => {},
    send: async (message, deliverAs) => { guidedSends.push({ jobId: runningId, message, deliverAs }); },
    reply: async () => {},
  });
  const commands = new Map<string, { handler: (args: string, ctx: unknown) => Promise<void> }>();
  const selections: string[][] = [];
  const notices: Array<{ text: string; level: string }> = [];
  const pi = {
    registerCommand: (name: string, command: { handler: (args: string, ctx: unknown) => Promise<void> }) => commands.set(name, command),
  } as unknown as ExtensionAPI;
  registerStatusCommands(pi, { registry });
  const answers = [
    0,
    0,
    0,
    0,
    0,
  ];
  let selectIndex = 0;
  const ui = {
    select: async (_prompt: string, options: string[]) => {
      selections.push(options);
      const index = answers[selectIndex++] ?? 0;
      return options[index];
    },
    input: async () => "Narrow the scope",
    notify: (text: string, level: string) => notices.push({ text, level }),
    custom: async () => {},
  };
  const ctx = { mode: "tui", hasUI: true, ui };

  await commands.get("subagent-status")!.handler("", ctx);
  await commands.get("subagent-tail")!.handler("", ctx);
  await commands.get("subagent-send")!.handler("", ctx);
  await commands.get("subagent-cancel")!.handler("", ctx);
  assert.equal(registry.get(runningId)?.cancellationReason, "manual");
  assert.deepEqual(selections[0], ["#1 scout [running] · Running title", "#2 worker [completed] · Completed title"]);
  assert.deepEqual(selections[1], selections[0]);
  assert.deepEqual(selections[2], [selections[0]![0]]);
  assert.deepEqual(selections[3], ["steering", "follow-up"]);
  assert.deepEqual(selections[4], [selections[0]![0]]);
  assert.deepEqual(guidedSends, [{ jobId: runningId, message: "Narrow the scope", deliverAs: "steer" }]);
  assert.match(notices[0]?.text ?? "", /Subagent #1/);

  const emptyRegistry = createJobRegistry();
  const emptyNotices: Array<{ text: string; level: string }> = [];
  const emptyCommands = new Map<string, { handler: (args: string, ctx: unknown) => Promise<void> }>();
  const emptyPi = {
    registerCommand: (name: string, command: { handler: (args: string, ctx: unknown) => Promise<void> }) => emptyCommands.set(name, command),
  } as unknown as ExtensionAPI;
  registerStatusCommands(emptyPi, { registry: emptyRegistry });
  const emptyCtx = {
    mode: "tui",
    hasUI: true,
    ui: {
      notify: (text: string, level: string) => emptyNotices.push({ text, level }),
      select: async () => undefined,
      custom: async () => {},
    },
  };
  await emptyCommands.get("subagent-status")!.handler("", emptyCtx);
  await emptyCommands.get("subagent-tail")!.handler("", emptyCtx);
  await emptyCommands.get("subagent-send")!.handler("", emptyCtx);
  await emptyCommands.get("subagent-cancel")!.handler("", emptyCtx);
  assert.deepEqual(emptyNotices, [
    { text: "No subagents are available.", level: "info" },
    { text: "No subagents are available.", level: "info" },
    { text: "No running subagents are available.", level: "info" },
    { text: "No running subagents are available.", level: "info" },
  ]);
});

test("slash picker rows fit the terminal and prefer titles over full tasks", async (t) => {
  const columns = Object.getOwnPropertyDescriptor(process.stdout, "columns");
  t.after(() => {
    if (columns) Object.defineProperty(process.stdout, "columns", columns);
    else Reflect.deleteProperty(process.stdout, "columns");
  });
  const registry = createJobRegistry();
  registry.add("scout", "HIDDEN_TASK ".repeat(40), `${"Review 界 ".repeat(8)}TITLE_END`);
  registry.add("worker", "Fallback task 界 ".repeat(30));
  const commands = new Map<string, { handler: (args: string, ctx: unknown) => Promise<void> }>();
  const pi = {
    registerCommand: (name: string, command: { handler: (args: string, ctx: unknown) => Promise<void> }) => commands.set(name, command),
  } as unknown as ExtensionAPI;
  registerStatusCommands(pi, { registry });
  const selections: string[][] = [];
  const notices: string[] = [];
  const ctx = {
    mode: "tui",
    hasUI: true,
    ui: {
      select: async (_prompt: string, options: string[]) => {
        selections.push(options);
        return options[1];
      },
      notify: (text: string) => notices.push(text),
    },
  };
  for (const width of [40, 180]) {
    Object.defineProperty(process.stdout, "columns", { configurable: true, value: width });
    await commands.get("subagent-status")!.handler("", ctx);
    const options = selections.at(-1)!;
    assert.ok(options.every((option) => visibleWidth(option) <= width - 4));
    assert.ok(options.every((option) => !/[\r\n\t\u001b]/.test(option)));
    assert.match(options[0]!, /^#1 scout \[running\]/);
    assert.match(options[1]!, /^#2 worker \[running\].*Fallback/);
    assert.doesNotMatch(options[0]!, /HIDDEN_TASK/);
  }
  assert.doesNotMatch(selections[0]![0]!, /TITLE_END/);
  assert.match(selections[1]![0]!, /TITLE_END/);
  assert.ok(notices.every((notice) => /Subagent #2/.test(notice)));
});

test("slash picker dismissal at job, mode, and input stages is a no-op", async () => {
  const cases = [
    { command: "subagent-cancel", stage: "job" },
    { command: "subagent-send", stage: "job" },
    { command: "subagent-send", stage: "mode" },
    { command: "subagent-send", stage: "input" },
  ] as const;
  for (const current of cases) {
    const registry = createJobRegistry();
    const id = registry.add("scout", "task");
    let cancellations = 0;
    let sends = 0;
    registry.registerControl(id, {
      cancel: () => { cancellations += 1; },
      send: async () => { sends += 1; },
      reply: async () => {},
    });
    const commands = new Map<string, { handler: (args: string, ctx: unknown) => Promise<void> }>();
    const pi = { registerCommand: (name: string, command: { handler: (args: string, ctx: unknown) => Promise<void> }) => commands.set(name, command) } as unknown as ExtensionAPI;
    registerStatusCommands(pi, { registry });
    let selects = 0;
    const ctx = {
      mode: "tui",
      hasUI: true,
      ui: {
        select: async (_prompt: string, options: string[]) => {
          selects += 1;
          if (current.stage === "job" || (current.stage === "mode" && selects === 2)) return undefined;
          return options[0];
        },
        input: async () => current.stage === "input" ? undefined : "message",
        notify: () => {},
      },
    };
    await commands.get(current.command)!.handler("", ctx);
    assert.equal(cancellations, 0, `${current.command} ${current.stage} dismissal must not cancel`);
    assert.equal(sends, 0, `${current.command} ${current.stage} dismissal must not send`);
    assert.equal(registry.get(id)?.cancellationReason, undefined);
  }
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
  assert.deepEqual(notices, [{ text: "subagent send #1 scout · task: RPC prompt rejected", level: "error" }]);
});

// --- createSubagentTool.execute ----------------------------------------------

function makeTool(
  spawnOverride?: { spawnFn: typeof spawn },
  settings: SubagentSettings = { profiles: {}, extensions: [] },
  activeProfile: string | undefined = restoreActiveProfile([], settings),
  confirmProfile: (ctx: ExtensionContext, onPause?: (message: string) => void) => Promise<boolean> = async () => true,
) {
  const registry = createJobRegistry();
  const sendMessage = spy();
  const sendUserMessage = spy();
  const appendEntry = spy();
  const handlers = new Map<string, (...args: unknown[]) => void>();
  const pi = {
    sendMessage: sendMessage.fn,
    sendUserMessage: sendUserMessage.fn,
    appendEntry: appendEntry.fn,
    on: (event: string, handler: (...args: unknown[]) => void) => handlers.set(event, handler),
  } as unknown as ExtensionAPI;
  const activeTickers = new Set<ReturnType<typeof setInterval>>();
  const activeProcs = new Set<ChildProcess>();
  const child = new FakeChild();
  const tool = createSubagentTool({
    pi,
    agents: [AGENT],
    settings,
    getActiveProfile: () => activeProfile,
    confirmProfile,
    discover: async () => [AGENT],
    registry,
    activeProcs,
    activeTickers,
    extensionPaths: [],
    bridgeExtensionPath: "/extensions/child-bridge.ts",
    onUiContext: () => {},
    refresh: () => {},
    spawnFn: spawnOverride?.spawnFn ?? fakeSpawn(child),
  });
  const ctx = {
    cwd: "/tmp",
    tools: [],
    executeTool: async () => assert.fail("unexpected nested tool call"),
    model: { provider: "p", id: "m" },
    thinkingLevel: undefined,
    hasUI: false,
    isIdle: () => true,
  } as unknown as ExtensionToolContext;
  return { tool, registry, sendMessage, sendUserMessage, appendEntry, handlers, activeTickers, activeProcs, child, ctx };
}

test("execute: profile confirmation surfaces a paused progress update", async () => {
  const updates: Array<{ content: unknown; details: unknown }> = [];
  const { tool, ctx } = makeTool(undefined, undefined, undefined, async (_ctx, onPause) => {
    onPause?.("Paused: waiting for subagent profile selection");
    return true;
  });
  await tool.execute(
    "call1",
    { agent: "scout", task: "t" },
    undefined,
    (partial) => updates.push(partial),
    ctx,
  );
  assert.deepEqual(updates, [{
    content: [{ type: "text", text: "subagent launch scout · t: Paused: waiting for subagent profile selection" }],
    details: { status: "running", targets: [{ agent: "scout", task: "t" }] },
  }]);
});

test("execute: cancelling profile confirmation returns a cancelled result", async () => {
  const child = new FakeChild();
  const calls: SpawnCall[] = [];
  const spawnFn = ((cmd: string, args: string[], options?: Record<string, unknown>) => {
    calls.push({ cmd, args, options: options ?? {} });
    return child;
  }) as unknown as typeof spawn;
  let confirmations = 0;
  const { tool, ctx } = makeTool({ spawnFn }, undefined, undefined, async () => {
    confirmations += 1;
    return false;
  });
  const result = await tool.execute("call1", { agent: "scout", task: "t" }, undefined, undefined, ctx);
  assert.equal(result.details?.status, "cancelled");
  assert.match(result.content[0]?.type === "text" ? result.content[0].text : "", /no profile selected/i);
  assert.equal(confirmations, 1);
  assert.equal(calls.length, 0);
});

test("execute: local settings set child model and thinking level", async () => {
  const child = new FakeChild();
  const calls: SpawnCall[] = [];
  const spawnFn = ((cmd: string, args: string[], options?: Record<string, unknown>) => {
    calls.push({ cmd, args, options: options ?? {} });
    return child;
  }) as unknown as typeof spawn;
  const { tool, ctx } = makeTool(
    { spawnFn },
    {
      profiles: {
        default: {
          defaults: { model: "default-model", thinkingLevel: "low" },
          agents: { scout: { model: "local-model", thinkingLevel: "high" } },
        },
      },
      extensions: [],
    },
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

test("execute: sole profile defaults set child model and thinking level", async () => {
  const child = new FakeChild();
  const calls: SpawnCall[] = [];
  const spawnFn = ((cmd: string, args: string[], options?: Record<string, unknown>) => {
    calls.push({ cmd, args, options: options ?? {} });
    return child;
  }) as unknown as typeof spawn;
  const { tool, ctx } = makeTool(
    { spawnFn },
    {
      profiles: { default: { defaults: { model: "default-model", thinkingLevel: "low" }, agents: {} } },
      extensions: [],
    },
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

test("execute: selected profile controls new jobs and completion metadata", async () => {
  const settings = {
    profiles: {
      primary: { defaults: { model: "primary/model", thinkingLevel: "low" }, agents: {} },
      backup: { defaults: { model: "backup/model", thinkingLevel: "high" }, agents: {} },
    },
    extensions: [],
  };
  const child = new FakeChild();
  const calls: SpawnCall[] = [];
  const spawnFn = ((cmd: string, args: string[], options?: Record<string, unknown>) => {
    calls.push({ cmd, args, options: options ?? {} });
    return child;
  }) as unknown as typeof spawn;
  const { tool, registry, sendMessage, ctx } = makeTool({ spawnFn }, settings, "backup");
  const launch = await tool.execute("call1", { agent: "scout", task: "t" }, undefined, undefined, ctx);

  assert.equal(launch.details.profile, "backup");
  assert.doesNotMatch((launch.content[0] as { text: string }).text, /profile/i);
  assert.equal(registry.get(1)?.profile, "backup");
  await sleep(10);
  const args = calls[0]?.args ?? [];
  assert.equal(args[args.indexOf("--model") + 1], "backup/model");
  assert.equal(args[args.indexOf("--thinking") + 1], "high");

  child.stdout.emit("data", Buffer.from(endEvent("done")));
  child.finish(0);
  await sleep(20);
  const completion = sendMessage.calls[0]?.[0] as { details: { profile?: string } };
  assert.equal(completion.details.profile, "backup");
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
  assert.deepEqual(notices, ["subagent #1 scout — failed: Error: spawn failed · t"]);
});

test("subagent schema has no execution mode", () => {
  const { tool } = makeTool();
  const properties = (tool.parameters as { properties: Record<string, unknown> }).properties;
  assert.equal("execution" in properties, false);
});

test("subagent tool runs sequentially so parallel calls cannot double-open the picker", () => {
  const { tool } = makeTool();
  assert.equal(tool.executionMode, "sequential");
  assert.equal(tool.exposure, "model-only");
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
    task: "t",
    title: undefined,
    status: "launched",
    jobIds: [1],
    targets: [{ agent: "scout", task: "t", jobId: 1 }],
    jobScope: registry.scope,
    profile: undefined,
  });

  await sleep(10); // let runSubagent attach stream listeners
  child.stdout.emit("data", Buffer.from(endEvent("scouted")));
  child.finish(0);
  await sleep(20);

  assert.equal(sendMessage.calls.length, 1, "completion sends one hidden parent message");
  assert.equal(registry.running().length, 0);
  assert.equal(activeTickers.size, 0);
  assert.equal(activeProcs.size, 0);
});

test("execute: single returns launched, then displays and delivers its result", async () => {
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

  assert.equal(sendMessage.calls.length, 1);
  const [message, options] = sendMessage.calls[0] as [{ display: boolean; details: { status: string } }, { triggerTurn: boolean }];
  assert.equal(message.details.status, "completed");
  assert.equal(message.display, false);
  assert.equal(options.triggerTurn, true);
});

test("execute: active parent holds results until agent_settled", async () => {
  const { tool, sendMessage, appendEntry, handlers, child, ctx } = makeTool();
  (ctx as unknown as { isIdle: () => boolean }).isIdle = () => false;
  await tool.execute("call1", { agent: "scout", task: "t" }, undefined, undefined, ctx);

  await sleep(10);
  child.stdout.emit("data", Buffer.from(endEvent("scouted")));
  child.finish(0);
  await sleep(20);

  assert.equal(appendEntry.calls.length, 1);
  assert.equal(sendMessage.calls.length, 0);
  handlers.get("agent_settled")?.({}, { isIdle: () => true });
  assert.equal(sendMessage.calls.length, 1);
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
  assert.match((sent.content[0] as { text: string }).text, /Sent steering message to subagent #1 scout/);

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
  assert.equal((replied.content[0] as { text: string }).text, "Answered subagent #1 scout · t.");
  assert.deepEqual(child.stdin.commands()[1], {
    type: "extension_ui_response",
    id: "question-1",
    value: "Use the existing API.",
  });
  assert.deepEqual(registry.get(1)?.pendingQuestions, []);

  child.stdout.emit("data", Buffer.from(endEvent("done")));
  child.finish(0);
  await sleep(20);
  assert.equal(sendMessage.calls.length, 2, "question and result sent once each");
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
  const deliveries = sendMessage.calls.filter((call) => (call[0] as { display?: boolean }).display === false);
  assert.equal(deliveries.length, 1);
  assert.equal((deliveries[0]?.[0] as { details: { jobId?: number } }).details.jobId, 1);
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
  assert.equal(renderText(call).trim(), "subagent reply #1 scout · task");
  assert.doesNotMatch(renderText(call), /f7455070/);

  const result = await tool.execute(
    "call1",
    { jobId, questionId: "f7455070-1bdd-4bf8-9806-2647a04b1eba", answer: "yes" },
    undefined,
    undefined,
    {} as never,
  );
  const renderedResult = renderText(tool.renderResult!(result, { expanded: false, isPartial: false }, theme, {
    args: { jobId, questionId: "f7455070-1bdd-4bf8-9806-2647a04b1eba", answer: "yes" },
  } as never))
    .split("\n").map((line) => line.trimEnd()).join("\n").trim();
  assert.equal(renderedResult, "✓ answered\n  Q: Continue?\n  A: yes");
  const combinedReply = `${renderText(call)}\n${renderedResult}`;
  assert.equal(combinedReply.split("#1 scout · task").length - 1, 1);
  const taggedTheme = {
    ...fakeTheme(),
    fg: (color: string, text: string) => `[${color}]${text}[/${color}]`,
  } as never;
  const taggedResult = renderText(
    tool.renderResult!(result, { expanded: false, isPartial: false }, taggedTheme, {
      args: { jobId, questionId: "f7455070-1bdd-4bf8-9806-2647a04b1eba", answer: "yes" },
    } as never),
  );
  assert.match(taggedResult, /\[success\]✓ /);
  assert.match(taggedResult, /\[muted\]answered/);
  assert.doesNotMatch(taggedResult, /\[accent\]#1/);
  assert.match(taggedResult, /\[muted\]Q: /);
  assert.match(taggedResult, /\[dim\]Continue\?/);
  assert.match(taggedResult, /\[muted\]A: /);
  assert.match(taggedResult, /\[dim\]yes/);
  assert.doesNotMatch(taggedResult, /f7455070/);

  const errorResult = tool.renderResult!(
    { content: [{ type: "text", text: "reply failed" }], details: {} } as never,
    { expanded: false, isPartial: false },
    theme,
    { args: { jobId, questionId: "f7455070-1bdd-4bf8-9806-2647a04b1eba", answer: "yes" }, isError: true } as never,
  );
  assert.equal(renderTrimmed(errorResult), "reply failed");
  const legacyResult = tool.renderResult!(
    { content: [{ type: "text", text: "legacy reply result" }], details: {} } as never,
    { expanded: false, isPartial: false },
    theme,
    {} as never,
  );
  assert.equal(renderTrimmed(legacyResult), "subagent reply #?\n  legacy reply result");
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
  assert.deepEqual(result.details.jobIds, [1, 2]);
  assert.equal(result.details.jobScope, registry.scope);

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
  assert.deepEqual(notices, ["subagent #2 scout — cancelled (timeout) · two"]);
  assert.match((sendMessage.calls.at(-1)?.[0] as { content: string }).content, /Cancelled \(timeout\)/);
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

test("execute: parallel batch displays and delivers each result", async () => {
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

  assert.equal(sendMessage.calls.length, 2, "one hidden parent message per result");
  assert.equal(sendUserMessage.calls.length, 0);
  assert.equal((sendMessage.calls[1]?.[0] as { display: boolean }).display, false);
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

function renderAtWidth(value: unknown, width: number): string {
  return (value as { render: (width: number) => string[] }).render(width).join("\n");
}

function renderText(value: unknown): string {
  return renderAtWidth(value, 120);
}

function renderTrimmed(value: unknown): string {
  return renderText(value).split("\n").map((line) => line.trimEnd()).join("\n").trim();
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

test("refreshUi: clicks open the rendered job's tail and leave other mouse gestures alone", async (t) => {
  const registry = createJobRegistry();
  const completedId = registry.add("scout", "finished task");
  const runningId = registry.add("worker", "running task");
  complete(registry, completedId);
  type Widget = {
    render(width: number): string[];
    handleMouse(event: { type: string; button: string; y: number }): unknown;
    dispose(): void;
  };
  type Tail = { render(width: number): string[]; handleInput(data: string): void; dispose(): void };
  let widget: Widget | undefined;
  const tails: Tail[] = [];
  const options: unknown[] = [];
  const tui = { requestRender: () => {} };
  const ui = {
    setWidget: (_key: string, factory: unknown) => {
      if (typeof factory === "function") widget = factory(tui, fakeTheme());
    },
    custom: (
      factory: (tui: unknown, theme: unknown, keybindings: unknown, done: () => void) => Tail,
      overlayOptions: unknown,
    ) => new Promise<void>((resolve) => {
      options.push(overlayOptions);
      tails.push(factory(tui, fakeTheme(), {}, resolve));
    }),
  };
  t.after(() => { widget?.dispose(); for (const tail of tails) tail.dispose(); });
  refreshUi({ hasUI: true, ui } as never, registry);
  assert.ok(widget);
  const lines = widget.render(80);
  assert.match(lines[0]!, new RegExp(`#${runningId} worker`));
  assert.match(lines[1]!, new RegExp(`#${completedId}`));

  for (const type of ["press", "release", "move", "drag", "wheel"]) {
    assert.equal(widget.handleMouse({ type, button: "left", y: 0 }), undefined);
  }
  for (const button of ["middle", "right", "none"]) {
    assert.equal(widget.handleMouse({ type: "click", button, y: 0 }), undefined);
  }
  for (const y of [-1, 0.5, 2, NaN]) {
    assert.equal(widget.handleMouse({ type: "click", button: "left", y }), undefined);
  }
  assert.equal(tails.length, 0);

  const addedId = registry.add("worker", "new task");
  assert.deepEqual(widget.handleMouse({ type: "click", button: "left", y: 0 }), { handled: true });
  assert.match(renderText(tails[0]), new RegExp(`Subagent #${runningId}`));
  assert.deepEqual(options[0], {
    overlay: true,
    overlayOptions: { anchor: "center", width: "100%", minWidth: 60, maxHeight: "100%", margin: 1 },
  });
  assert.deepEqual(widget.handleMouse({ type: "click", button: "left", y: 1 }), { handled: true });
  assert.equal(tails.length, 1);
  tails[0]!.handleInput("q");
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.deepEqual(widget.handleMouse({ type: "click", button: "left", y: 1 }), { handled: true });
  assert.match(renderText(tails[1]), new RegExp(`Subagent #${completedId}`));
  tails[1]!.handleInput("\x1b");
  await new Promise<void>((resolve) => setImmediate(resolve));

  widget.render(30);
  assert.deepEqual(widget.handleMouse({ type: "click", button: "left", y: 1 }), { handled: true });
  assert.match(renderText(tails[2]), new RegExp(`Subagent #${addedId}`));
  tails[2]!.handleInput("q");
});

test("refreshUi: failed tail opens recover and disposed widgets cannot open tails", async () => {
  const registry = createJobRegistry();
  registry.add("scout", "task");
  type Widget = {
    render(width: number): string[];
    handleMouse(event: { type: string; button: string; y: number }): unknown;
    dispose(): void;
  };
  const widgets: Widget[] = [];
  let opens = 0;
  const ui = {
    setWidget: (_key: string, factory: unknown) => {
      if (typeof factory === "function") widgets.push(factory({ requestRender: () => {} }, fakeTheme()));
    },
    custom: () => {
      opens += 1;
      if (opens === 1) throw new Error("synchronous open failure");
      if (opens === 2) return Promise.reject(new Error("asynchronous open failure"));
      return new Promise<void>(() => {});
    },
  };
  const ctx = { hasUI: true, ui } as never;
  refreshUi(ctx, registry);
  const widget = widgets[0]!;
  widget.render(80);
  const click = { type: "click", button: "left", y: 0 };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    assert.doesNotThrow(() => widget.handleMouse(click));
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(opens, attempt + 1);
  }
  widget.dispose();
  assert.equal(widget.handleMouse(click), undefined);
  assert.deepEqual(widget.render(80), []);
  refreshUi(ctx, registry);
  assert.equal(widgets.length, 2);
  const replacement = widgets[1]!;
  replacement.render(80);
  assert.deepEqual(replacement.handleMouse(click), { handled: true });
  assert.equal(opens, 4);
  replacement.dispose();
});

test("refreshUi: truncation rows and vanished jobs are not clickable", () => {
  const registry = createJobRegistry();
  for (let index = 0; index < 11; index += 1) registry.add("scout", `task ${index}`);
  let widget: {
    render(width: number): string[];
    handleMouse(event: { type: string; button: string; y: number }): unknown;
    dispose(): void;
  } | undefined;
  let opens = 0;
  const ui = {
    setWidget: (_key: string, factory: unknown) => {
      if (typeof factory === "function") widget = factory({ requestRender: () => {} }, fakeTheme());
    },
    custom: () => { opens += 1; return Promise.resolve(); },
  };
  refreshUi({ hasUI: true, ui } as never, registry);
  assert.ok(widget);
  const lines = widget.render(20);
  assert.equal(lines.length, 10);
  assert.ok(lines.every((line) => visibleWidth(line) <= 20));
  assert.ok(lines[0]?.startsWith(" "));
  assert.match(lines[9]!, /widget trunca/);
  assert.equal(widget.handleMouse({ type: "click", button: "left", y: 9 }), undefined);
  registry.jobs.delete(1);
  assert.equal(widget.handleMouse({ type: "click", button: "left", y: 0 }), undefined);
  assert.equal(opens, 0);
  widget.dispose();
});

test("renderFullWidget: shows one line per active agent", () => {
  const registry = createJobRegistry();
  const id = registry.add("scout", "task", "a".repeat(60), {
    model: "openai-codex/gpt-5.6-luna",
    thinkingLevel: "high",
    profile: "primary",
  });
  registry.updateLive(id, { progress: "reading files", text: "live agent output" });
  const lines = renderFullWidget(registry, (_color, text) => text, 80);
  const output = lines.join("\n");
  assert.equal(lines.length, 1);
  assert.ok(lines.every((line) => visibleWidth(line) <= 80));
  assert.match(output, new RegExp(`⊙ #${id} scout`));
  assert.doesNotMatch(output, /profile/i);
  assert.doesNotMatch(output, /reading files/);
  assert.doesNotMatch(output, /openai-codex\/gpt-5\.6-luna:high/);
  assert.doesNotMatch(output, /live agent output/);

  registry.recordQuestion(id, { id: "question-1", question: "Which API?" });
  registry.recordQuestion(id, { id: "question-2", question: "Which format?" });
  const waitingLines = renderFullWidget(registry, (_color, text) => text, 80);
  assert.equal(waitingLines.length, 1);
  assert.doesNotMatch(waitingLines.join("\n"), /waiting for parent \(2\)/);

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
  const runningText = renderText(render({ status: "running" })).trim();
  assert.match(runningText, /subagent launch/);
  assert.match(runningText, /⊙ s/);
  assert.match(renderText(render({ status: "cancelled" })).trim(), /⊘ s/);
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

test("message and entry renderers render results and parent questions", () => {
  const renderers = new Map<string, (message: unknown, options: unknown, theme: unknown) => unknown>();
  const entryRenderers = new Map<string, (entry: unknown, options: unknown, theme: unknown) => unknown>();
  const pi = {
    registerMessageRenderer: (type: string, fn: unknown) => {
      renderers.set(type, fn as never);
    },
    registerEntryRenderer: (type: string, fn: unknown) => {
      entryRenderers.set(type, fn as never);
    },
  } as unknown as ExtensionAPI;
  registerRenderers(pi);
  const captured = renderers.get(ENTRY_TYPE);
  const entryRenderer = entryRenderers.get(ENTRY_TYPE);
  const questionRenderer = renderers.get(QUESTION_ENTRY_TYPE);
  assert.ok(captured, "result message renderer registered");
  assert.ok(entryRenderer, "result entry renderer registered");
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
        profile: "primary",
      },
    },
    options,
    theme,
  );
  assert.ok(renderable(withDetails));
  const compactText = renderText(withDetails);
  assert.match(compactText, /✓ #7 a/);
  assert.doesNotMatch(compactText, /profile/i);
  assert.match(compactText, /openai-codex\/gpt-5\.6-luna:high/);
  assert.doesNotMatch(compactText, /\bout\b/);
  assert.match(compactText, /Ctrl\+O to expand/);
  assert.equal(compactText.split("\n").filter((line) => line.trim()).length, 3);

  const entryCard = entryRenderer!(
    {
      data: {
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
    },
    { expanded: false },
    theme,
  );
  assert.match(renderText(entryCard), /✓ #7 a/);
  assert.match(renderText(entryCard), /Ctrl\+O to expand/);

  const failedMessage = {
    content: "subagent launch scout · LaunchFailureTitle: Error: spawn failed",
    details: { jobId: 7, agent: "scout", task: "launch task", title: "LaunchFailureTitle", status: "failed", duration: "?", icon: "✗" },
  };
  for (const failedCard of [
    captured!(failedMessage, { ...options, expanded: true }, theme),
    entryRenderer!({ data: failedMessage }, { expanded: true }, theme),
  ]) {
    const failedText = renderText(failedCard);
    assert.equal(failedText.split("LaunchFailureTitle").length - 1, 1);
    assert.match(failedText, /subagent launch: Error: spawn failed/);
  }
  assert.equal(failedMessage.content, "subagent launch scout · LaunchFailureTitle: Error: spawn failed");

  const longTask = `${"long task ".repeat(16)}WIDE_TASK_END`;
  const longCard = captured!(
    { content: "out", details: { jobId: 7, agent: "a", task: longTask, status: "completed", duration: "1s", icon: "✓" } },
    options,
    theme,
  );
  const narrowHeadline = renderAtWidth(longCard, 120).split("\n").find((line) => line.includes("✓ #7 a"));
  const wideHeadline = renderAtWidth(longCard, 220).split("\n").find((line) => line.includes("✓ #7 a"));
  assert.ok(narrowHeadline);
  assert.ok(wideHeadline);
  assert.equal(renderAtWidth(longCard, 120).split("\n").filter((line) => line.includes("✓ #7 a")).length, 1);
  assert.equal(renderAtWidth(longCard, 220).split("\n").filter((line) => line.includes("✓ #7 a")).length, 1);
  assert.equal(renderAtWidth(longCard, 120).split("\n").length, renderAtWidth(longCard, 220).split("\n").length);
  assert.doesNotMatch(narrowHeadline, /WIDE_TASK_END/);
  assert.match(wideHeadline, /WIDE_TASK_END/);

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
        usage: { ...EMPTY_USAGE, turns: 1 },
        model: "openai-codex/gpt-5.6-luna",
        thinkingLevel: "high",
        toolCalls: [
          { name: "read", args: { path: "src/index.ts", offset: 1, limit: 2 } },
          { name: "read", args: { path: "/tmp/project/packages/subagents/extensions/subagents/retained-filename.ts" } },
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
  const compactStats = compactText.split("\n").find((line) => line.includes("openai-codex/gpt-5.6-luna:high"));
  const expandedStats = renderText(expanded).split("\n").find((line) => line.includes("openai-codex/gpt-5.6-luna:high"));
  assert.ok(compactStats, "compact stats line should be rendered");
  assert.ok(expandedStats, "expanded stats line should be rendered");
  assert.equal(compactStats.match(/^\s*/)?.[0].length, expandedStats.match(/^\s*/)?.[0].length);
  assert.match(renderAtWidth(expanded, 220), /retained-filename\.ts/);
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

test("renderers preserve card backgrounds through ellipsis and padding", () => {
  const renderers = new Map<string, (message: unknown, options: unknown, theme: unknown) => unknown>();
  const entryRenderers = new Map<string, (entry: unknown, options: unknown, theme: unknown) => unknown>();
  const pi = {
    registerMessageRenderer: (type: string, fn: unknown) => renderers.set(type, fn as never),
    registerEntryRenderer: (type: string, fn: unknown) => entryRenderers.set(type, fn as never),
  } as unknown as ExtensionAPI;
  registerRenderers(pi);

  const ansiTheme = {
    fg: (color: string, text: string) => {
      const codes: Record<string, number> = {
        toolTitle: 252,
        accent: 81,
        muted: 245,
        dim: 242,
        success: 78,
        warning: 214,
        error: 203,
      };
      const prefix = color === "dim"
        ? `\x1b[2;38;5;${codes[color] ?? 250}m`
        : `\x1b[38;5;${codes[color] ?? 250}m`;
      return `${prefix}${text}${color === "dim" ? "\x1b[22;39m" : "\x1b[39m"}`;
    },
    bg: (_color: string, text: string) => `\x1b[48;5;236m${text}\x1b[49m`,
    bold: (text: string) => `\x1b[1m${text}\x1b[22m`,
  };

  const completionMessage = renderers.get(ENTRY_TYPE)!({
    content: "completion output",
    details: {
      jobId: 7,
      agent: "scout",
      task: `${"completion-task ".repeat(18)}COMPLETION_END`,
      status: "completed",
      duration: "1s",
      icon: "✓",
    },
  }, { expanded: false, outputPad: 1 }, ansiTheme);
  const completionCard = entryRenderers.get(ENTRY_TYPE)!({
    data: {
      content: "completion output",
      details: {
        jobId: 7,
        agent: "scout",
        task: `${"completion-card ".repeat(18)}CARD_END`,
        status: "completed",
        duration: "1s",
        icon: "✓",
      },
    },
  }, { expanded: false }, ansiTheme);
  const question = renderers.get(QUESTION_ENTRY_TYPE)!({
    content: "model-facing question",
    details: {
      jobId: 12,
      agent: "worker",
      question: `${"parent-question ".repeat(18)}QUESTION_END`,
    },
  }, { expanded: false, outputPad: 1 }, ansiTheme);

  const { tool: launchTool } = makeTool();
  const sendRegistry = createJobRegistry();
  const sendJobId = sendRegistry.add("scout", "send task");
  const sendTool = createSendTool({ registry: sendRegistry });
  const launchCall = launchTool.renderCall!({
    agent: "scout",
    task: `${"launch-task ".repeat(18)}LAUNCH_END`,
  }, ansiTheme as never, {} as never);
  const sendCall = sendTool.renderCall!({
    jobId: sendJobId,
    deliverAs: "steer",
    message: `${"send-message ".repeat(18)}SEND_END`,
  }, ansiTheme as never, {} as never);

  const cases: Array<[string, unknown]> = [
    ["completion message", completionMessage],
    ["completion card", completionCard],
    ["parent question", question],
    ["launch call", launchCall],
    ["send call", sendCall],
  ];
  const width = 52;
  for (const [label, component] of cases) {
    const card = new Box(0, 0, (text) => ansiTheme.bg("customMessageBg", text));
    card.addChild(component as never);
    const lines = card.render(width);
    assert.ok(lines.length > 0, `${label}: should render`);
    assert.ok(lines.every((line) => visibleWidth(line) <= width), `${label}: width overflow`);
    const ellipsisLines = lines.filter((line) => line.includes("..."));
    assert.equal(ellipsisLines.length, 1, `${label}: expected one single-line preview`);
    const line = ellipsisLines[0]!;
    const dots = line.indexOf("...");
    const sgrs = [...line.matchAll(/\x1b\[([0-9;]*)m/g)];
    let backgroundDepth = 0;
    let lastBackgroundChange: number | undefined;
    let bold = false;
    let dim = false;
    let foreground = false;
    for (const match of sgrs) {
      if ((match.index ?? 0) >= dots) break;
      const params = (match[1] ?? "0").split(";").map(Number);
      for (const code of params) {
        if (code === 0) {
          backgroundDepth = 0;
          lastBackgroundChange = 0;
          bold = false;
          dim = false;
          foreground = false;
        } else if (code === 48) {
          backgroundDepth += 1;
          lastBackgroundChange = 48;
        } else if (code === 49) {
          backgroundDepth = Math.max(0, backgroundDepth - 1);
          lastBackgroundChange = 49;
        } else if (code === 1) {
          bold = true;
        } else if (code === 2) {
          dim = true;
        } else if (code === 22) {
          bold = false;
          dim = false;
        } else if (code === 39 || (code >= 30 && code <= 37) || (code >= 90 && code <= 97) || code === 38) {
          foreground = code !== 39;
        }
      }
    }
    assert.equal(lastBackgroundChange, 48, `${label}: ellipsis lost its enclosing background`);
    assert.ok(backgroundDepth > 0, `${label}: no background active at ellipsis`);
    assert.equal(bold, false, `${label}: bold leaked onto ellipsis`);
    assert.equal(dim, false, `${label}: dim leaked onto ellipsis`);
    assert.equal(foreground, false, `${label}: foreground leaked onto ellipsis`);

    const paddingMatch = [...line.matchAll(/ +(?=\x1b\[49m)/g)].filter((match) => (match.index ?? 0) > dots).at(-1);
    assert.ok(paddingMatch, `${label}: missing trailing padding`);
    const paddingStart = paddingMatch!.index ?? 0;
    let paddingBackgroundDepth = 0;
    for (const match of line.matchAll(/\x1b\[([0-9;]*)m/g)) {
      if ((match.index ?? 0) >= paddingStart) break;
      const first = Number((match[1] ?? "0").split(";", 1)[0]);
      if (first === 0) paddingBackgroundDepth = 0;
      else if (first === 48) paddingBackgroundDepth += 1;
      else if (first === 49) paddingBackgroundDepth = Math.max(0, paddingBackgroundDepth - 1);
    }
    assert.ok(paddingBackgroundDepth > 0, `${label}: trailing padding lost its enclosing background`);
  }
});

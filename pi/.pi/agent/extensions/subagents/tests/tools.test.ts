import { test } from "node:test";
import assert from "node:assert/strict";
import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AgentConfig } from "../agents.ts";
import { createJobRegistry } from "../registry.ts";
import { registerRenderers } from "../render.ts";
import { Batch, createSubagentTool, resolveMode } from "../tools.ts";
import { ENTRY_TYPE } from "../types.ts";
import { FakeChild, fakeSpawn, fakeSpawnChildren, endEvent } from "./fake-child.ts";

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
  const { registry, batch, sendUserMessage } = makeBatch();
  const id1 = registry.add("a", "t1");
  const id2 = registry.add("b", "t2");
  batch.addJob(id1);
  batch.addJob(id2);

  complete(registry, id1);
  batch.recordCompletion(id1);
  batch.summary();
  assert.equal(sendUserMessage.calls.length, 0, "pending > 0, no summary yet");

  complete(registry, id2, 1);
  batch.recordCompletion(id2);
  batch.summary();
  assert.equal(sendUserMessage.calls.length, 1);
  const lines = sendUserMessage.calls[0]?.[0] as string;
  assert.equal(lines.split("\n")[0], "**Subagents complete:**");
  assert.match(lines, /✓ a \(.*\): t1/);
  assert.match(lines, /✗ b \(.*\): t2/);
  // markCleared ran: nothing pending for display anymore
  assert.equal(registry.pendingCompleted().length, 0);
});

test("Batch: an extra summary call never re-fires", () => {
  const { registry, batch, sendUserMessage } = makeBatch();
  const id = registry.add("a", "t");
  batch.addJob(id);
  complete(registry, id);
  batch.recordCompletion(id);
  batch.summary();
  batch.summary(); // would decrement to -1 under a naive guard
  assert.equal(sendUserMessage.calls.length, 1);
});

test("Batch: summary with no completed jobs sends nothing", () => {
  const { registry, batch, sendUserMessage } = makeBatch();
  const id = registry.add("a", "t");
  batch.addJob(id);
  batch.summary();
  assert.equal(sendUserMessage.calls.length, 0);
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
  assert.equal(sendUserMessage.calls.length, 1, "b1 completes independently");

  complete(registry, id2);
  b2.recordCompletion(id2);
  b2.summary();
  assert.equal(sendUserMessage.calls.length, 2, "b2 completes independently");

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
  });
  assert.equal(sendMessage.calls.length, 1);
  const [message, options] = sendMessage.calls[0] as [
    { customType: string; content: string; details: { status: string; icon: string; agent: string } },
    { deliverAs: string },
  ];
  assert.equal(message.customType, ENTRY_TYPE);
  assert.equal(message.content.length, 20002); // 20000 + "\n…"
  assert.equal(message.details.status, "completed");
  assert.equal(message.details.icon, "✓");
  assert.equal(options.deliverAs, "steer");
});

// --- createSubagentTool.execute ----------------------------------------------

function makeTool(spawnOverride?: { spawnFn: typeof spawn }) {
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
    discover: async () => [AGENT],
    registry,
    activeProcs,
    activeTickers,
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

test("execute: sync single drives the child and returns completed details", async () => {
  const { tool, registry, activeTickers, activeProcs, child, ctx } = makeTool();
  const pending = tool.execute("call1", { agent: "scout", task: "t", execution: "sync" }, undefined, undefined, ctx);

  await sleep(10); // let runSubagent attach stream listeners
  child.stdout.emit("data", Buffer.from(endEvent("scouted")));
  child.finish(0);

  const result = await pending;
  assert.equal(result.content[0]?.type, "text");
  assert.equal((result.content[0] as { text: string }).text, "scouted");
  assert.deepEqual(result.details, { agent: "scout", status: "completed", execution: "sync" });
  const job = [...registry.running()];
  assert.equal(job.length, 0);
  assert.equal(activeTickers.size, 0, "ticker stopped after sync completion");
  assert.equal(activeProcs.size, 0);
});

test("execute: async single returns launched, then delivers result + summary", async () => {
  const { tool, sendMessage, sendUserMessage, child, ctx } = makeTool();
  const result = await tool.execute("call1", { agent: "scout", task: "t", execution: "async" }, undefined, undefined, ctx);
  assert.equal(result.details.status, "launched");

  await sleep(10);
  child.stdout.emit("data", Buffer.from(endEvent("scouted")));
  child.finish(0);
  await sleep(20); // let the .then chain run

  assert.equal(sendMessage.calls.length, 1, "deliverResult sent the entry message");
  assert.equal(sendUserMessage.calls.length, 1, "batch summary sent");
  assert.equal((sendMessage.calls[0]?.[0] as { details: { status: string } }).details.status, "completed");
});

test("execute: all-unknown sync batch throws", async () => {
  const { tool, ctx } = makeTool();
  await assert.rejects(
    tool.execute(
      "call1",
      { tasks: [{ agent: "ghost", task: "t" }], execution: "sync" },
      undefined,
      undefined,
      ctx,
    ),
    /Unknown agent\(s\): ghost/,
  );
});

test("execute: partial-unknown sync batch returns failed with skipped count", async () => {
  const { tool, child, ctx } = makeTool();
  const pending = tool.execute(
    "call1",
    { tasks: [{ agent: "ghost", task: "t" }, { agent: "scout", task: "t2" }], execution: "sync" },
    undefined,
    undefined,
    ctx,
  );
  await sleep(10);
  child.stdout.emit("data", Buffer.from(endEvent("scouted")));
  child.finish(0);
  const result = await pending;
  assert.equal(result.details.status, "failed");
  assert.equal(result.details.skipped, 1);
  assert.equal(result.details.count, 1);
  const text = (result.content[0] as { text: string }).text;
  assert.match(text, /Unknown agent "ghost"/);
  assert.match(text, /scouted/);
});

test("execute: async parallel batch delivers per-job results and one summary", async () => {
  const children = [new FakeChild(), new FakeChild()];
  const { spawnFn, calls } = fakeSpawnChildren(children);
  const { tool, sendMessage, sendUserMessage, activeTickers, activeProcs, ctx } = makeTool({ spawnFn });
  const result = await tool.execute(
    "call1",
    { tasks: [{ agent: "scout", task: "t1" }, { agent: "scout", task: "t2" }], execution: "async" },
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

  assert.equal(sendMessage.calls.length, 2, "deliverResult per job");
  assert.equal(sendUserMessage.calls.length, 1, "exactly one batch summary");
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
  assert.ok(renderable(render({ status: "launched" })));
  assert.ok(renderable(render({ status: "failed" })));
  assert.ok(renderable(render({ status: "completed" })));
});

test("renderCall: renders single and parallel invocations", () => {
  const { tool } = makeTool();
  const theme = fakeTheme() as never;
  assert.ok(renderable(tool.renderCall!({ agent: "scout", task: "t" } as never, theme, {} as never)));
  assert.ok(renderable(
    tool.renderCall!({ tasks: [{ agent: "scout", task: "t" }, { agent: "scout", task: "t2" }] } as never, theme, {} as never),
  ));
});

test("message renderer: renders with details and falls back without them", () => {
  let captured: ((message: unknown, options: unknown, theme: unknown) => unknown) | undefined;
  const pi = {
    registerMessageRenderer: (_type: string, fn: unknown) => {
      captured = fn as never;
    },
  } as unknown as ExtensionAPI;
  registerRenderers(pi);
  assert.ok(captured, "renderer registered");

  const theme = fakeTheme() as never;
  const options = { expanded: false, outputPad: 2 };
  const withDetails = captured!(
    { content: "out", details: { agent: "a", task: "t", status: "completed", duration: "1s", icon: "✓" } },
    options,
    theme,
  );
  assert.ok(renderable(withDetails));

  const withoutDetails = captured!({ content: "plain", details: undefined }, options, theme);
  assert.ok(renderable(withoutDetails));

  const expanded = captured!(
    { content: "out", details: { agent: "a", task: "t", status: "failed", duration: "1s", icon: "✗" } },
    { ...options, expanded: true },
    theme,
  );
  assert.ok(renderable(expanded));
});

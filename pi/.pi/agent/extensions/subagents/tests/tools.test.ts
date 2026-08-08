import { test } from "node:test";
import assert from "node:assert/strict";
import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AgentConfig } from "../agents.ts";
import { createJobRegistry } from "../registry.ts";
import { registerRenderers, renderFullWidget } from "../render.ts";
import { Batch, createSubagentTool, resolveMode } from "../tools.ts";
import { createStatusTool } from "../status-tools.ts";
import { EMPTY_USAGE, ENTRY_TYPE } from "../types.ts";
import { FakeChild, fakeSpawn, fakeSpawnChildren, endEvent, type SpawnCall } from "./fake-child.ts";

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
  assert.match(lines, /✓ a \(.*\): t1/);
  assert.match(lines, /✗ b \(.*\): t2/);
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
    { customType: string; content: string; details: { status: string; icon: string; agent: string; model?: string; thinkingLevel?: string } },
    { deliverAs: string },
  ];
  assert.equal(message.customType, ENTRY_TYPE);
  assert.equal(message.content.length, 20002); // 20000 + "\n…"
  assert.equal(message.details.status, "completed");
  assert.equal(message.details.icon, "✓");
  assert.equal(message.details.model, "openai-codex/gpt-5.6-luna");
  assert.equal(message.details.thinkingLevel, "high");
  assert.equal(options.deliverAs, "steer");
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
  assert.match(text, /◐ scout .*openai-codex\/gpt-5\.6-luna:minimal/);
  assert.match(text, /openai-codex\/gpt-5\.6-luna:high/);
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
  const pending = tool.execute("call1", { agent: "scout", task: "t", execution: "sync" }, undefined, undefined, ctx);

  await sleep(10);
  child.stdout.emit("data", Buffer.from(endEvent("done")));
  child.finish(0);
  await pending;

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
  const pending = tool.execute("call1", { agent: "scout", task: "t", execution: "sync" }, undefined, undefined, ctx);

  await sleep(10);
  child.stdout.emit("data", Buffer.from(endEvent("done")));
  child.finish(0);
  await pending;

  const args = calls[0]?.args ?? [];
  assert.equal(args[args.indexOf("--model") + 1], "default-model");
  assert.equal(args[args.indexOf("--thinking") + 1], "low");
});

test("execute: setup failures preserve inherited model and effort", async () => {
  const spawnFn = (() => {
    throw new Error("spawn failed");
  }) as typeof spawn;
  const { tool, sendMessage, ctx } = makeTool({ spawnFn });
  (ctx as unknown as { thinkingLevel?: string }).thinkingLevel = "medium";

  const result = await tool.execute("call1", { agent: "scout", task: "t", execution: "sync" }, undefined, undefined, ctx);
  assert.equal(result.details.status, "failed");
  const [message] = sendMessage.calls[0] as [{ details: { model?: string; thinkingLevel?: string } }];
  assert.equal(message.details.model, "p/m");
  assert.equal(message.details.thinkingLevel, "medium");
});

test("execute: sync single drives the child and returns completed details", async () => {
  const { tool, registry, sendMessage, activeTickers, activeProcs, child, ctx } = makeTool();
  const updates: unknown[] = [];
  const pending = tool.execute("call1", { agent: "scout", task: "t", execution: "sync" }, undefined, () => updates.push(true), ctx);

  await sleep(10); // let runSubagent attach stream listeners
  child.stdout.emit("data", Buffer.from(endEvent("scouted")));
  child.finish(0);

  const result = await pending;
  assert.equal(result.content[0]?.type, "text");
  assert.equal((result.content[0] as { text: string }).text, "scouted");
  assert.equal(updates.length, 0, "sync execution does not stream intermediate tool output");
  assert.equal(sendMessage.calls.length, 1, "sync completion uses the custom result entry");
  assert.deepEqual(result.details, {
    agent: "scout",
    status: "completed",
    execution: "sync",
    jobIds: [1],
    jobScope: registry.scope,
  });
  const job = [...registry.running()];
  assert.equal(job.length, 0);
  assert.equal(activeTickers.size, 0, "ticker stopped after sync completion");
  assert.equal(activeProcs.size, 0);
});

test("execute: async single returns launched, then delivers result + summary", async () => {
  const { tool, registry, sendMessage, child, ctx } = makeTool();
  const result = await tool.execute("call1", { agent: "scout", task: "t", execution: "async" }, undefined, undefined, ctx);
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
  const id = registry.add("scout", "task", "title", {
    model: "openai-codex/gpt-5.6-luna",
    thinkingLevel: "high",
  });
  registry.updateLive(id, { progress: "reading files", text: "live agent output" });
  const output = renderFullWidget(registry, (_color, text) => text).join("\n");
  assert.match(output, /reading files/);
  assert.match(output, /openai-codex\/gpt-5\.6-luna:high/);
  assert.doesNotMatch(output, /live agent output/);
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

test("renderCall: shows mode and every agent title", () => {
  const { tool } = makeTool();
  const theme = fakeTheme() as never;
  const rendered = tool.renderCall!(
    {
      tasks: [
        { agent: "scout", task: "task one", title: "First task" },
        { agent: "worker", task: "task two", title: "Second task" },
      ],
      execution: "async",
    } as never,
    theme,
    {} as never,
  );
  assert.ok(renderable(rendered));
  const text = renderText(rendered);
  assert.match(text, /parallel \(2 tasks\)/);
  assert.match(text, /\[async/);
  assert.match(text, /scout.*First task/);
  assert.match(text, /worker.*Second task/);
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
    {
      content: "out",
      details: {
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
  assert.match(renderText(withDetails), /openai-codex\/gpt-5\.6-luna:high/);

  const withoutDetails = captured!({ content: "plain", details: undefined }, options, theme);
  assert.ok(renderable(withoutDetails));

  const expanded = captured!(
    { content: "out", details: { agent: "a", task: "t", status: "failed", duration: "1s", icon: "✗" } },
    { ...options, expanded: true },
    theme,
  );
  assert.ok(renderable(expanded));
});

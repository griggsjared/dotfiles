import { test } from "node:test";
import assert from "node:assert/strict";
import { createJobRegistry, type SubagentControl } from "../registry.ts";
import { EMPTY_USAGE, type SubagentResult } from "../types.ts";

function result(overrides: Partial<SubagentResult> = {}): SubagentResult {
  return {
    agent: "worker",
    task: "task",
    text: "done",
    exitCode: 0,
    error: "",
    usage: { ...EMPTY_USAGE, turns: 1 },
    ...overrides,
  };
}

function control(overrides: Partial<SubagentControl> = {}): SubagentControl {
  return {
    cancel: () => {},
    send: async () => {},
    reply: async () => {},
    ...overrides,
  };
}

test("registry lifecycle: add -> complete -> pendingCompleted -> markCleared", () => {
  let time = 0;
  const registry = createJobRegistry({ now: () => time });
  const id = registry.add("worker", "task", "  title \n", { model: "served-model", thinkingLevel: "high" });
  const job = registry.jobs.get(id)!;
  assert.equal(job.title, "title");
  assert.equal(job.status, "running");
  assert.equal(job.model, "served-model");
  assert.equal(job.thinkingLevel, "high");
  assert.equal(registry.running().length, 1);

  time = 100;
  registry.recordStep(id, { phase: "start", id: "assistant", kind: "assistant", summary: "Thinking" });
  registry.updateLive(id, { text: "partial", progress: "read x.ts", model: "served-model", thinkingLevel: "high", toolCalls: [{ name: "read", args: { path: "x.ts" } }] });
  assert.equal(job.steps[0]?.startedAt, 100);
  assert.equal(job.steps[0]?.endedAt, undefined);
  assert.equal(job.text, "partial");
  assert.equal(job.progress, "read x.ts");
  assert.equal(job.model, "served-model");
  assert.equal(job.thinkingLevel, "high");

  time = 1000;
  registry.complete(id, result({ thinkingLevel: "high", toolCalls: [] }));
  assert.equal(job.status, "completed");
  assert.equal(job.thinkingLevel, "high");
  assert.equal(job.endTime, 1000);
  time = 2000;
  assert.equal(registry.recordStep(id, { phase: "end", id: "assistant" }), false);
  assert.equal(registry.recordStep(id, { phase: "start", id: "late", kind: "retry", summary: "Retry" }), false);
  registry.complete(id, result());
  assert.deepEqual(job.steps, [{ id: "assistant", kind: "assistant", summary: "Thinking", startedAt: 100, endedAt: 1000 }]);
  assert.equal(registry.running().length, 0);
  assert.deepEqual(registry.pendingCompleted().map((j) => j.id), [id]);
  assert.equal(registry.recent(1).length, 1);

  registry.markCleared([id]);
  assert.equal(registry.pendingCompleted().length, 0);
  assert.equal(registry.recent(1).length, 1);
});

test("registry snapshots the launch profile without lifecycle overwrites", () => {
  const registry = createJobRegistry();
  const id = registry.add("worker", "task", undefined, {
    model: "launch-model",
    thinkingLevel: "high",
    profile: "primary",
  });
  const job = registry.get(id)!;

  registry.updateLive(id, { model: "served-model", thinkingLevel: "minimal" });
  registry.complete(id, result({ model: "result-model", thinkingLevel: "off", profile: "backup" }));
  assert.equal(job.model, "result-model");
  assert.equal(job.thinkingLevel, "off");
  assert.equal(job.profile, "primary");
});

test("registry: event ring sequences, limits, cursors, and defensive copies", () => {
  let time = 10;
  const registry = createJobRegistry({ now: () => time++ });
  const id = registry.add("worker", "task");
  assert.equal(registry.appendEvent(id, { kind: "state", summary: "started" }), true);
  assert.equal(registry.appendEvent(id, { kind: "assistant", summary: "hello" }), true);
  assert.equal(registry.appendEvent(id, { kind: "tool-start", summary: "read" }), true);

  const latest = registry.readEvents(id, { limit: 2 });
  assert.deepEqual(latest, {
    events: [
      { seq: 2, timestamp: 12, kind: "assistant", summary: "hello" },
      { seq: 3, timestamp: 13, kind: "tool-start", summary: "read" },
    ],
    nextCursor: 3,
  });
  latest!.events[0]!.summary = "changed";
  assert.equal(registry.readEvents(id, { since: 1 })?.events[0]?.summary, "hello");
  assert.deepEqual(registry.readEvents(id, { since: 0 })?.events.map((event) => event.seq), [1, 2, 3]);
  assert.equal(registry.readEvents(id, { since: 0 })?.droppedBefore, undefined);
  assert.deepEqual(registry.readEvents(id, { since: 1, limit: 1 })?.events.map((event) => event.seq), [2]);
  assert.equal(registry.readEvents(id, { since: 1, limit: 1 })?.nextCursor, 2);
  assert.deepEqual(registry.readEvents(id, { since: 3 }), { events: [], nextCursor: 3 });
  assert.throws(() => registry.readEvents(id, { since: 4 }), /ahead of current sequence/);

  for (let i = 0; i < 100; i++) registry.appendEvent(id, { kind: "state", summary: String(i) });
  const retained = registry.readEvents(id, { since: 0, limit: 200 })!;
  assert.equal(retained.events.length, 100);
  assert.equal(retained.events[0]!.seq, 4);
  assert.equal(retained.droppedBefore, 4);
});

test("registry: concurrent same-name steps correlate events by ID and freeze timing", () => {
  let time = 10;
  const registry = createJobRegistry({ now: () => time });
  const id = registry.add("worker", "task");
  assert.equal(registry.recordStep(999, { phase: "end", id: "a" }), false);
  assert.equal(registry.recordStep(id, { phase: "end", id: "missing" }), false);
  const a = { phase: "start", id: "a", kind: "tool", summary: "read a", toolCall: { name: "read", args: { path: "a" } } } as const;
  assert.equal(registry.recordStep(id, a), true);
  registry.appendEvent(id, { kind: "tool-start", summary: "read a", stepId: "a" });
  time = 20;
  assert.equal(registry.recordStep(id, a), false);
  registry.recordStep(id, { phase: "start", id: "b", kind: "tool", summary: "read b", toolCall: { name: "read", args: { path: "b" } } });
  time = 30;
  assert.equal(registry.recordStep(id, { phase: "end", id: "b" }), true);
  registry.appendEvent(id, { kind: "tool-end", summary: "read b", stepId: "b" });
  assert.equal(registry.get(id)?.steps.find((step) => step.id === "a")?.endedAt, undefined);
  time = 50;
  registry.recordStep(id, { phase: "end", id: "a" });
  time = 100;
  assert.equal(registry.recordStep(id, { phase: "end", id: "a" }), false);
  assert.equal(registry.recordStep(id, a), false);
  registry.appendEvent(id, { kind: "tool-end", summary: "read a", stepId: "a" });
  registry.appendEvent(id, { kind: "tool-end", summary: "unknown", stepId: "unknown" });
  assert.deepEqual(registry.readEvents(id)?.events, [
    { seq: 1, timestamp: 10, kind: "tool-start", summary: "read a", stepId: "a", startedAt: 10 },
    { seq: 2, timestamp: 30, kind: "tool-end", summary: "read b", stepId: "b", startedAt: 20, durationMs: 10 },
    { seq: 3, timestamp: 100, kind: "tool-end", summary: "read a", stepId: "a", startedAt: 10, durationMs: 40 },
    { seq: 4, timestamp: 100, kind: "tool-end", summary: "unknown", stepId: "unknown" },
  ]);
  assert.deepEqual(registry.get(id)?.steps.map((step) => step.toolCall), [
    { name: "read", args: { path: "b" } },
    { name: "read", args: { path: "a" } },
  ]);

  registry.recordStep(id, { phase: "start", id: "retry", kind: "retry", summary: "Retry" });
  time = 90;
  registry.recordStep(id, { phase: "end", id: "retry" });
  registry.appendEvent(id, { kind: "state", summary: "Retried", stepId: "retry" });
  assert.equal(registry.readEvents(id)?.events.at(-1)?.durationMs, 0);
});

test("registry: active steps survive event eviction and retain the latest 20 completions", () => {
  let time = 0;
  const registry = createJobRegistry({ now: () => time++ });
  const id = registry.add("worker", "task");
  for (let i = 0; i < 21; i++) {
    registry.recordStep(id, { phase: "start", id: `active-${i}`, kind: "tool", summary: "read" });
    registry.appendEvent(id, { kind: "tool-start", summary: "read", stepId: `active-${i}` });
  }
  for (let i = 0; i < 21; i++) {
    registry.recordStep(id, { phase: "start", id: `finished-${i}`, kind: "assistant", summary: "Thinking" });
    registry.recordStep(id, { phase: "end", id: `finished-${i}` });
  }
  for (let i = 0; i < 100; i++) registry.appendEvent(id, { kind: "state", summary: "progress" });
  assert.equal(registry.readEvents(id)?.events.length, 100);
  assert.equal(registry.readEvents(id)?.events.some((event) => event.kind === "tool-start"), false);
  const job = registry.get(id)!;
  assert.equal(job.steps.filter((step) => step.endedAt === undefined).length, 21);
  assert.deepEqual(job.steps.filter((step) => step.endedAt !== undefined).map((step) => step.id),
    Array.from({ length: 20 }, (_, i) => `finished-${i + 1}`));

  const startedAt = job.steps[0]!.startedAt;
  registry.recordStep(id, { phase: "end", id: "active-0" });
  registry.appendEvent(id, { kind: "tool-end", summary: "read", stepId: "active-0" });
  assert.equal(registry.readEvents(id)?.events.at(-1)?.startedAt, startedAt);
  assert.equal(job.steps.length, 40);
  assert.equal(job.steps.some((step) => step.id === "finished-1"), false);
  assert.equal(job.steps.at(-1)?.id, "active-0");
  registry.appendEvent(id, { kind: "state", summary: "evicted", stepId: "finished-0" });
  assert.equal(registry.readEvents(id)?.events.at(-1)?.startedAt, undefined);

  registry.complete(id, result());
  assert.deepEqual(job.steps.map((step) => step.id), Array.from({ length: 20 }, (_, i) => `active-${i + 1}`));
  assert.ok(job.steps.every((step) => step.endedAt === job.endTime));
});

test("registry: event rings retain terminal jobs and are pruned with them", () => {
  let time = 0;
  const registry = createJobRegistry({ now: () => time });
  const id = registry.add("worker", "task");
  registry.appendEvent(id, { kind: "state", summary: "done" });
  registry.complete(id, result());
  assert.equal(registry.appendEvent(id, { kind: "state", summary: "late" }), false);
  assert.equal(registry.readEvents(id)?.events[0]?.summary, "done");
  registry.markCleared([id]);
  const next = registry.add("worker", "next");
  time = 300_001;
  registry.complete(next, result());
  assert.equal(registry.readEvents(id), undefined);
});

test("registry: failed jobs keep error and are pruned after cutoff once cleared", () => {
  let time = 0;
  const registry = createJobRegistry({ now: () => time });
  const a = registry.add("worker", "task");
  time = 10;
  registry.complete(a, result({ exitCode: 1, error: "boom" }));
  assert.equal(registry.jobs.get(a)?.status, "failed");
  assert.equal(registry.jobs.get(a)?.error, "boom");
  registry.markCleared([a]);

  // A later completion triggers the prune pass; `a` is cleared and past cutoff.
  const b = registry.add("worker", "task2");
  time = 10 + 300_000 + 1;
  registry.complete(b, result());
  assert.ok(!registry.jobs.has(a), "cleared and past cutoff, must be pruned");
  assert.ok(registry.jobs.has(b), "fresh completion must survive");
});

test("registry: updateLive ignores unknown ids and skips undefined fields", () => {
  const registry = createJobRegistry();
  const id = registry.add("worker", "task");
  registry.updateLive(id, { text: undefined, progress: "p" });
  assert.equal(registry.jobs.get(id)?.text, undefined);
  assert.equal(registry.jobs.get(id)?.progress, "p");
  registry.updateLive(999, { text: "x" }); // no throw
});

test("registry: recent sorts by endTime descending and limits", () => {
  let time = 0;
  const registry = createJobRegistry({ now: () => time });
  const a = registry.add("a", "t");
  time = 100;
  registry.complete(a, result({ agent: "a" }));
  const b = registry.add("b", "t");
  time = 200;
  registry.complete(b, result({ agent: "b" }));
  assert.deepEqual(registry.recent(1).map((j) => j.agent), ["b"]);
  assert.deepEqual(registry.recent().map((j) => j.agent), ["b", "a"]);
});

test("registry: cancellation before registration is delivered once and freezes steps", () => {
  let time = 10;
  const registry = createJobRegistry({ now: () => time });
  const id = registry.add("worker", "task");
  registry.recordStep(id, { phase: "start", id: "a", kind: "tool", summary: "read" });
  registry.recordStep(id, { phase: "start", id: "b", kind: "tool", summary: "read" });
  registry.recordStep(id, { phase: "end", id: "b" });
  time = 20;
  assert.equal(registry.cancel(id, "session-shutdown"), true);
  time = 30;
  registry.cancel(id);
  assert.equal(registry.recordStep(id, { phase: "end", id: "a" }), false);
  assert.equal(registry.recordStep(id, { phase: "start", id: "late", kind: "tool", summary: "read" }), false);
  assert.deepEqual(registry.get(id)?.steps.map((step) => [step.id, step.endedAt]), [["b", 10], ["a", 20]]);
  const reasons: string[] = [];
  registry.registerControl(id, control({ cancel: (reason) => reasons.push(reason) }));
  assert.deepEqual(reasons, ["session-shutdown"]);
  registry.complete(id, result());
  assert.equal(registry.get(id)?.status, "cancelled");
  assert.equal(registry.get(id)?.cancellationReason, "session-shutdown");
  assert.deepEqual(registry.get(id)?.steps.map((step) => [step.id, step.endedAt]), [["b", 10], ["a", 20]]);
});

test("registry: unknown, terminal, and duplicate handles cannot become unreachable", () => {
  const registry = createJobRegistry();
  const unknown: string[] = [];
  registry.registerControl(999, control({ cancel: (reason) => unknown.push(reason) }));
  assert.deepEqual(unknown, ["manual"]);

  const id = registry.add("worker", "task");
  const first: string[] = [];
  const duplicate: string[] = [];
  registry.registerControl(id, control({ cancel: (reason) => first.push(reason) }));
  registry.registerControl(id, control({ cancel: (reason) => duplicate.push(reason) }));
  assert.deepEqual(duplicate, ["manual"]);
  registry.cancel(id, "timeout");
  assert.deepEqual(first, ["timeout"]);
  assert.deepEqual(duplicate, ["manual"]);

  registry.complete(id, result({ cancelled: true, cancellationReason: "timeout", exitCode: 130 }));
  const terminal: string[] = [];
  registry.registerControl(id, control({ cancel: (reason) => terminal.push(reason) }));
  assert.deepEqual(terminal, ["timeout"]);
});

test("registry: cancellation reasons are first-wins for all lifecycle causes", () => {
  for (const reason of ["manual", "timeout", "parent-abort", "session-shutdown"] as const) {
    const registry = createJobRegistry();
    const id = registry.add("worker", "task");
    const seen: string[] = [];
    registry.registerControl(id, control({ cancel: (value) => seen.push(value) }));
    registry.cancel(id, reason);
    registry.cancel(id, "manual");
    registry.complete(id, result());
    assert.equal(registry.get(id)?.status, "cancelled");
    assert.equal(registry.get(id)?.cancellationReason, reason);
    assert.deepEqual(seen, [reason]);
  }
});

test("registry: sends messages and resolves the matching pending question", async () => {
  const registry = createJobRegistry({ now: () => 123 });
  const id = registry.add("worker", "task");
  const sends: unknown[][] = [];
  const replies: unknown[][] = [];
  registry.registerControl(id, control({
    send: async (...args) => { sends.push(args); },
    reply: async (...args) => { replies.push(args); },
  }));

  assert.equal(registry.recordQuestion(id, { id: "q1", question: "Which API?", context: "Two choices" }), true);
  assert.equal(registry.recordQuestion(id, { id: "q1", question: "duplicate" }), false);
  assert.deepEqual(registry.get(id)?.pendingQuestions, [{
    id: "q1",
    question: "Which API?",
    context: "Two choices",
    askedAt: 123,
  }]);

  await registry.send(id, "Use the existing pattern", "steer");
  await registry.reply(id, "q1", "Use v2");
  assert.deepEqual(sends, [["Use the existing pattern", "steer"]]);
  assert.deepEqual(replies, [["q1", "Use v2"]]);
  assert.deepEqual(registry.get(id)?.pendingQuestions, []);
  await assert.rejects(registry.reply(id, "q1", "again"), /Unknown or answered question q1/);
});

test("registry: concurrent replies cannot answer the same question twice", async () => {
  const registry = createJobRegistry();
  const id = registry.add("worker", "task");
  let release: (() => void) | undefined;
  registry.registerControl(id, control({
    reply: () => new Promise<void>((resolve) => { release = resolve; }),
  }));
  registry.recordQuestion(id, { id: "q1", question: "Continue?" });

  const first = registry.reply(id, "q1", "yes");
  await assert.rejects(registry.reply(id, "q1", "no"), /already being answered/);
  release?.();
  await first;
  assert.deepEqual(registry.get(id)?.pendingQuestions, []);
});

test("registry: failed replies remain pending", async () => {
  const registry = createJobRegistry();
  const id = registry.add("worker", "task");
  registry.registerControl(id, control({
    reply: async () => { throw new Error("write failed"); },
  }));
  registry.recordQuestion(id, { id: "q1", question: "Continue?" });

  await assert.rejects(registry.reply(id, "q1", "yes"), /write failed/);
  assert.deepEqual(registry.get(id)?.pendingQuestions.map((question) => question.id), ["q1"]);
});

test("registry: messaging rejects unknown, queued, cancelling, and terminal jobs", async () => {
  const registry = createJobRegistry();
  await assert.rejects(registry.send(999, "message", "steer"), /Unknown subagent job ID: 999/);

  const id = registry.add("worker", "task");
  await assert.rejects(registry.send(id, "message", "steer"), /has not started yet/);
  registry.recordQuestion(id, { id: "q1", question: "Continue?" });
  registry.cancel(id, "manual");
  assert.deepEqual(registry.get(id)?.pendingQuestions, []);
  await assert.rejects(registry.send(id, "message", "followUp"), /is cancelling \(manual\)/);

  registry.complete(id, result({ cancelled: true, cancellationReason: "manual", exitCode: 130 }));
  await assert.rejects(registry.send(id, "message", "steer"), /is cancelled/);
});

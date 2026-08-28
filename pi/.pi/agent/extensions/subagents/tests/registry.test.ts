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

  registry.updateLive(id, { text: "partial", progress: "read x.ts", model: "served-model", thinkingLevel: "high" });
  assert.equal(job.text, "partial");
  assert.equal(job.progress, "read x.ts");
  assert.equal(job.model, "served-model");
  assert.equal(job.thinkingLevel, "high");

  time = 1000;
  registry.complete(id, result({ thinkingLevel: "high" }));
  assert.equal(job.status, "completed");
  assert.equal(job.thinkingLevel, "high");
  assert.equal(job.endTime, 1000);
  assert.equal(registry.running().length, 0);
  assert.deepEqual(registry.pendingCompleted().map((j) => j.id), [id]);
  assert.equal(registry.recent(1).length, 1);

  registry.markCleared([id]);
  assert.equal(registry.pendingCompleted().length, 0);
  assert.equal(registry.recent(1).length, 1);
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

test("registry: cancellation before registration is delivered once", () => {
  const registry = createJobRegistry();
  const id = registry.add("worker", "task");
  assert.equal(registry.cancel(id, "session-shutdown"), true);
  const reasons: string[] = [];
  registry.registerControl(id, control({ cancel: (reason) => reasons.push(reason) }));
  assert.deepEqual(reasons, ["session-shutdown"]);
  registry.complete(id, result());
  assert.equal(registry.get(id)?.status, "cancelled");
  assert.equal(registry.get(id)?.cancellationReason, "session-shutdown");
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

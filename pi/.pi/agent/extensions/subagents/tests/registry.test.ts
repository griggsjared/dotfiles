import { test } from "node:test";
import assert from "node:assert/strict";
import { createJobRegistry } from "../registry.ts";
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

test("registry lifecycle: add -> complete -> pendingCompleted -> markCleared", () => {
  let time = 0;
  const registry = createJobRegistry({ now: () => time });
  const id = registry.add("worker", "task", "  title \n");
  const job = registry.jobs.get(id)!;
  assert.equal(job.title, "title");
  assert.equal(job.status, "running");
  assert.equal(registry.running().length, 1);

  registry.updateLive(id, { text: "partial", progress: "read x.ts" });
  assert.equal(job.text, "partial");
  assert.equal(job.progress, "read x.ts");

  time = 1000;
  registry.complete(id, result());
  assert.equal(job.status, "completed");
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

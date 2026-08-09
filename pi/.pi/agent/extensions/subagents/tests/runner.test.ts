import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { getPiCommand, runSubagent, runWithConcurrencyLimit } from "../runner.ts";
import type { AgentConfig } from "../agents.ts";
import { FakeChild, fakeSpawn, endEvent, updateEvent, type SpawnCall } from "./fake-child.ts";

const agent: AgentConfig = {
  name: "worker",
  description: "test agent",
  systemPrompt: "You are a worker.",
};

test("getPiCommand", () => {
  // npm-installed pi: node + cli entry script
  assert.deepEqual(getPiCommand(["/usr/bin/node", "/path/to/pi/cli.js"], "/usr/bin/node"), {
    cmd: "/usr/bin/node",
    args: ["/path/to/pi/cli.js"],
  });
  // compiled single binary
  assert.deepEqual(getPiCommand(["/opt/pi/bin/pi"], "/opt/pi/bin/pi"), { cmd: "/opt/pi/bin/pi", args: [] });
  // bun virtual bundle: fall back to PATH
  assert.deepEqual(getPiCommand(["bun", "/$bunfs/root/app.js"], "bun"), { cmd: "pi", args: [] });
  // bare node/bun with a full path: original behavior returns the binary itself
  assert.deepEqual(getPiCommand(["/usr/bin/node"], "/usr/bin/node"), { cmd: "/usr/bin/node", args: [] });
});

test("runWithConcurrencyLimit: preserves order and caps concurrency", async () => {
  let active = 0;
  let peak = 0;
  const fn = async (n: number) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 5));
    active -= 1;
    return n * 2;
  };
  const results = await runWithConcurrencyLimit([1, 2, 3, 4, 5], 2, fn);
  assert.deepEqual(results, [2, 4, 6, 8, 10]);
  assert.ok(peak <= 2);
  assert.deepEqual(await runWithConcurrencyLimit([], 2, fn), []);
});

test("runWithConcurrencyLimit: propagates errors", async () => {
  await assert.rejects(
    runWithConcurrencyLimit([1, 2], 2, async (n) => {
      if (n === 2) throw new Error("boom");
      return n;
    }),
    /boom/,
  );
});

test("runSubagent: assembles result from streamed JSONL", async () => {
  const child = new FakeChild();
  const { result } = await runSubagent(agent, "do the thing", "/tmp", "m/provider", {
    spawnFn: fakeSpawn(child),
    thinkingLevel: "medium",
  });
  const promise = result.then((r) => {
    assert.equal(r.agent, "worker");
    assert.equal(r.task, "do the thing");
    assert.equal(r.text, "final answer");
    assert.equal(r.exitCode, 0);
    assert.deepEqual(r.usage, {
      turns: 1, input: 5, output: 3, cacheRead: 0, cacheWrite: 0, cost: 0.0001, contextTokens: 8,
    });
    assert.equal(r.model, "served-model");
    assert.equal(r.thinkingLevel, "medium");
  });

  child.stdout.emit("data", Buffer.from(updateEvent("partial")));
  child.stdout.emit("data", Buffer.from(endEvent("final answer", { model: "served-model" })));
  child.finish(0);
  await promise;
});

test("runSubagent: reports live updates when state changes", async () => {
  const child = new FakeChild();
  const { result } = await runSubagent(agent, "t", "/tmp", undefined, {
    spawnFn: fakeSpawn(child),
    onUpdate: (u) => updates.push(u),
  });
  const updates: unknown[] = [];

  child.stdout.emit("data", Buffer.from(endEvent("first", { model: "m1" })));
  assert.equal(updates.length, 1); // first update fires immediately, throttle only caps repeats
  const first = updates[0] as { text: string; usage: { turns: number }; model: string };
  assert.equal(first.text, "first");
  assert.equal(first.usage.turns, 1);
  assert.equal(first.model, "m1");

  child.finish(0);
  await result;
  assert.equal(updates.length, 2); // final flush on close
});

test("runSubagent: zero maxRuntimeMs disables the timeout", async () => {
  const child = new FakeChild();
  const { result } = await runSubagent(agent, "t", "/tmp", "m", {
    spawnFn: fakeSpawn(child),
    maxRuntimeMs: 0,
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(child.killed, null);
  child.finish(0);
  assert.equal((await result).exitCode, 0);
});

test("runSubagent: timeout kills the child and reports exit code 124", async () => {
  const child = new FakeChild();
  const { result } = await runSubagent(agent, "t", "/tmp", "m", {
    spawnFn: fakeSpawn(child),
    maxRuntimeMs: 50,
    killDelayMs: 10,
  });
  const r = await result;
  assert.equal(r.exitCode, 130);
  assert.equal(r.cancelled, true);
  assert.equal(r.cancellationReason, "timeout");
  assert.match(r.error, /Cancelled \(timeout\)/);
  assert.equal(child.killed, "SIGTERM");
});

test("runSubagent: pre-aborted signal kills the child (real contract: exit 143)", async () => {
  const child = new FakeChild();
  const controller = new AbortController();
  controller.abort();
  const { result } = await runSubagent(agent, "t", "/tmp", "m", {
    spawnFn: fakeSpawn(child),
    signal: controller.signal,
    killDelayMs: 10,
  });
  const r = await result;
  assert.equal(r.exitCode, 130);
  assert.equal(r.cancelled, true);
  assert.equal(r.cancellationReason, "parent-abort");
  assert.match(r.error, /Cancelled \(parent-abort\)/);
  assert.equal(child.killed, "SIGTERM");
});

test("runSubagent: unhandleable signal reports the signal name", async () => {
  const child = new FakeChild();
  const { result } = await runSubagent(agent, "t", "/tmp", "m", {
    spawnFn: fakeSpawn(child),
  });
  child.signalCode = "SIGKILL";
  child.emit("close", null, "SIGKILL");
  const r = await result;
  assert.equal(r.exitCode, 1);
  assert.match(r.error, /Killed by SIGKILL/);
});

test("runSubagent: spawns the child with the full pi CLI contract", async () => {
  const child = new FakeChild();
  const calls: SpawnCall[] = [];
  const { result } = await runSubagent(agent, "do it", "/tmp", "p/m", {
    spawnFn: ((cmd: string, args: string[], options?: Record<string, unknown>) => {
      calls.push({ cmd, args, options: options ?? {} });
      return child;
    }) as unknown as typeof spawn,
    thinkingLevel: "low",
    title: "my title",
  });
  child.finish(0);
  await result;

  assert.equal(calls.length, 1);
  const { args, options } = calls[0]!;
  const flags = args.slice(1); // args[0] is the pi entry script from getPiCommand
  assert.deepEqual(flags.slice(0, 4), ["--mode", "json", "-p", "--no-session"]);
  assert.ok(flags.includes("--no-extensions"), "no recursive subagent spawns");
  assert.ok(flags.includes("--no-context-files"));
  const modelIdx = flags.indexOf("--model");
  assert.equal(flags[modelIdx + 1], "p/m");
  assert.ok(flags.includes("--thinking"));
  assert.ok(flags.includes("--append-system-prompt"));
  assert.ok(flags.some((a) => a === "Title: my title"));
  assert.ok(flags.some((a) => a === "Task: do it"));
  assert.match(
    String((options.env as { NODE_OPTIONS?: string } | undefined)?.NODE_OPTIONS),
    /--max-old-space-size=8192/,
  );
});

test("runSubagent: escalates SIGTERM to SIGKILL when the child ignores it", async () => {
  const child = new FakeChild();
  child.ignoreKill = true; // zombie: records signals, never closes
  const { result } = await runSubagent(agent, "t", "/tmp", "m", {
    spawnFn: fakeSpawn(child),
    maxRuntimeMs: 40,
    killDelayMs: 30,
  });
  const r = await result;
  assert.equal(child.killed, "SIGKILL", "escalation fired after SIGTERM was ignored");
  assert.equal(r.exitCode, 130);
  assert.equal(r.cancelled, true);
  assert.equal(r.cancellationReason, "timeout");
  assert.match(r.error, /Cancelled \(timeout\)/);
});

test("runSubagent: spawn failure rejects", async () => {
  await assert.rejects(
    runSubagent(agent, "t", "/tmp", "m", {
      spawnFn: (() => {
        throw new Error("nope");
      }) as never,
    }),
    /nope/,
  );
});

test("runSubagent: process error preserves partial JSONL output", async () => {
  const child = new FakeChild();
  const { result } = await runSubagent(agent, "t", "/tmp", "m", {
    spawnFn: fakeSpawn(child),
  });
  child.stdout.emit("data", Buffer.from(JSON.stringify({
    type: "message_end",
    message: {
      role: "assistant",
      content: [
        { type: "text", text: "partial answer" },
        { type: "toolCall", name: "read", arguments: { path: "README.md" } },
      ],
      usage: { input: 5, output: 3, totalTokens: 8, cost: 0.0001 },
    },
  })));
  child.emit("error");

  const r = await result;
  assert.equal(r.exitCode, 1);
  assert.equal(r.text, "partial answer");
  assert.deepEqual(r.usage, {
    turns: 1, input: 5, output: 3, cacheRead: 0, cacheWrite: 0, cost: 0.0001, contextTokens: 8,
  });
  assert.deepEqual(r.toolCalls, [{ name: "read", args: { path: "README.md" } }]);
  assert.equal(r.error, "failed to spawn subagent");
});

test("runSubagent: cancellation survives process error and later close", async () => {
  const child = new FakeChild();
  const { result, cancel } = await runSubagent(agent, "t", "/tmp", "m", {
    spawnFn: fakeSpawn(child),
  });
  cancel("manual");
  child.emit("error");
  child.emit("close", 1, null);

  const r = await result;
  assert.equal(r.exitCode, 130);
  assert.equal(r.cancelled, true);
  assert.equal(r.cancellationReason, "manual");
  assert.match(r.error, /Cancelled \(manual\)/);
});

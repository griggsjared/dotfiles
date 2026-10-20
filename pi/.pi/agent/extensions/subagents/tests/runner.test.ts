import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { getPiCommand, runSubagent, runWithConcurrencyLimit } from "../runner.ts";
import type { AgentConfig } from "../agents.ts";
import type { JobEventInput, JobStepInput, SubagentInactivity } from "../types.ts";
import {
  FakeChild,
  fakeSpawn,
  endEvent,
  questionEvent,
  responseEvent,
  updateEvent,
  type SpawnCall,
} from "./fake-child.ts";

const agent: AgentConfig = {
  name: "worker",
  description: "test agent",
  systemPrompt: "You are a worker.",
};
const BRIDGE_EXTENSION = "/extensions/child-bridge.ts";

function respondToCommand(child: FakeChild, index = 0, success = true, error?: string) {
  const command = child.stdin.commands()[index];
  assert.ok(command, `missing child RPC command ${index}`);
  child.stdout.emit("data", Buffer.from(responseEvent(command, success, error)));
  return command;
}

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

test("runSubagent: correlates steering and preserves a racing follow-up", async () => {
  const child = new FakeChild();
  const launched = await runSubagent(agent, "t", "/tmp", "m", {
    spawnFn: fakeSpawn(child),
    bridgeExtensionPath: BRIDGE_EXTENSION,
  });
  respondToCommand(child);

  const steering = launched.send("Check the failure path", "steer");
  assert.deepEqual(child.stdin.commands()[1], {
    id: "subagent-2",
    type: "prompt",
    message: "Check the failure path",
    streamingBehavior: "steer",
  });
  respondToCommand(child, 1);
  await steering;

  const followUp = launched.send("Now run the focused tests", "followUp");
  assert.deepEqual(child.stdin.commands()[2], {
    id: "subagent-3",
    type: "prompt",
    message: "Now run the focused tests",
    streamingBehavior: "followUp",
  });
  child.stdout.emit("data", Buffer.from(`${JSON.stringify({ type: "agent_settled" })}\n`));
  assert.equal(child.stdin.ended, false, "an unacknowledged continuation keeps RPC open");
  respondToCommand(child, 2);
  await followUp;
  assert.equal(child.stdin.ended, false, "an accepted continuation waits for its next settle");

  child.stdout.emit("data", Buffer.from(`${JSON.stringify({ type: "agent_start" })}\n`));
  child.stdout.emit("data", Buffer.from(`${JSON.stringify({ type: "agent_settled" })}\n`));
  assert.equal(child.stdin.ended, true);
  await assert.rejects(launched.send("too late", "steer"), /no longer accepting messages/);
  child.finish(0);
  await launched.result;
});

test("runSubagent: forwards parent questions and writes the matching reply", async () => {
  const child = new FakeChild();
  const questions: unknown[] = [];
  const launched = await runSubagent(agent, "t", "/tmp", "m", {
    spawnFn: fakeSpawn(child),
    bridgeExtensionPath: BRIDGE_EXTENSION,
    onQuestion: (question) => questions.push(question),
  });
  respondToCommand(child);
  child.stdout.emit("data", Buffer.from(questionEvent("question-1", "Which API?", "Two choices")));
  assert.deepEqual(questions, [{ id: "question-1", question: "Which API?", context: "Two choices" }]);

  await launched.reply("question-1", "Use the existing API.");
  assert.deepEqual(child.stdin.commands()[1], {
    type: "extension_ui_response",
    id: "question-1",
    value: "Use the existing API.",
  });
  await assert.rejects(launched.reply("question-1", "again"), /Unknown or answered/);

  child.stdout.emit("data", Buffer.from(`${JSON.stringify({ type: "agent_settled" })}\n`));
  assert.equal(child.stdin.ended, true);
  child.finish(0);
  await launched.result;
});

test("runSubagent: a rejected initial prompt fails the transport", async () => {
  const child = new FakeChild();
  const { result } = await runSubagent(agent, "t", "/tmp", "m", {
    spawnFn: fakeSpawn(child),
  });
  respondToCommand(child, 0, false, "prompt rejected");
  await Promise.resolve();
  assert.equal(child.stdin.ended, true);
  child.finish(0);

  const completed = await result;
  assert.equal(completed.exitCode, 1);
  assert.match(completed.error, /Initial RPC prompt failed: Error: prompt rejected/);
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

test("runSubagent: inactivity uses runner override then agent then five-minute default, with zero disabling", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 10000 });
  for (const [agentTimeout, optionTimeout, expected] of [
    [undefined, undefined, 300000], [30, undefined, 30], [10, 20, 20], [10, 0, 0], [0, undefined, 0],
  ] as const) {
    const child = new FakeChild();
    const notifications: SubagentInactivity[] = [];
    const launched = await runSubagent({ ...agent, inactivityTimeoutMs: agentTimeout }, "t", "/tmp", "m", {
      spawnFn: fakeSpawn(child),
      inactivityTimeoutMs: optionTimeout,
      onInactivity: (idle) => notifications.push(idle),
    });
    const startedAt = Date.now();
    if (expected) {
      t.mock.timers.tick(expected - 1);
      assert.equal(notifications.length, 0);
      t.mock.timers.tick(1);
      assert.deepEqual(notifications, [{ lastActivityAt: startedAt, detectedAt: startedAt + expected, inactivityTimeoutMs: expected }]);
    }
    t.mock.timers.tick(600000);
    assert.equal(notifications.length, expected ? 1 : 0);
    assert.equal(child.killed, null);
    assert.equal(child.stdin.ended, false);
    child.finish(0);
    assert.equal((await launched.result).cancelled, false);
    t.mock.timers.tick(600000);
    assert.equal(notifications.length, expected ? 1 : 0);
  }
});

test("runSubagent: final message alone does not trigger the shutdown watchdog", async () => {
  const child = new FakeChild();
  const { result } = await runSubagent(agent, "t", "/tmp", "m", {
    spawnFn: fakeSpawn(child),
    shutdownGraceMs: 20,
  });
  child.stdout.emit("data", Buffer.from(endEvent("final answer")));
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(child.killed, null);
  child.finish(0);
  assert.equal((await result).exitCode, 0);
});

test("runSubagent: cancels the shutdown watchdog when the child closes", async () => {
  const child = new FakeChild();
  const { result } = await runSubagent(agent, "t", "/tmp", "m", {
    spawnFn: fakeSpawn(child),
    shutdownGraceMs: 20,
  });
  respondToCommand(child);
  child.stdout.emit("data", Buffer.from(`${JSON.stringify({ type: "agent_settled" })}\n`));
  child.finish(0);
  assert.equal((await result).exitCode, 0);
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(child.killed, null);
});

test("runSubagent: terminates a child that stays open after agent_settled without an inactivity warning", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 10000 });
  const child = new FakeChild();
  const notifications: SubagentInactivity[] = [];
  const { result } = await runSubagent(agent, "t", "/tmp", "m", {
    spawnFn: fakeSpawn(child),
    inactivityTimeoutMs: 10,
    onInactivity: (idle) => notifications.push(idle),
    shutdownGraceMs: 20,
    killDelayMs: 10,
  });
  respondToCommand(child);
  child.stdout.emit("data", Buffer.from(endEvent("final answer")));
  child.stdout.emit("data", Buffer.from(`${JSON.stringify({ type: "agent_settled" })}\n`));
  t.mock.timers.tick(20);

  const r = await result;
  assert.equal(notifications.length, 0);
  assert.equal(child.killed, "SIGTERM");
  assert.equal(r.text, "final answer");
  assert.equal(r.exitCode, 0);
  assert.equal(r.cancelled, false);
  assert.equal(r.error, "");
});

test("runSubagent: inactivity notifies once despite callback failure and raw child activity re-arms it", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 10000 });
  t.mock.method(console, "error", () => {});
  const child = new FakeChild();
  const notifications: SubagentInactivity[] = [];
  const launched = await runSubagent(agent, "t", "/tmp", "m", {
    spawnFn: fakeSpawn(child),
    inactivityTimeoutMs: 100,
    onInactivity: (idle) => { notifications.push(idle); throw new Error("callback failed"); },
  });
  respondToCommand(child);
  t.mock.timers.tick(100);
  assert.equal(notifications.length, 1);
  t.mock.timers.tick(500);
  assert.equal(notifications.length, 1);

  for (const [stream, chunk] of [
    [child.stdout, "{"], [child.stdout, "malformed\n"], [child.stdout, " \n"],
    [child.stdout, updateEvent("same")], [child.stdout, updateEvent("same")], [child.stderr, "diagnostic"],
  ] as const) {
    stream.emit("data", Buffer.from(chunk));
    const count: number = notifications.length;
    t.mock.timers.tick(60);
    stream.emit("data", Buffer.from(chunk));
    const activityAt = Date.now();
    t.mock.timers.tick(99);
    assert.equal(notifications.length, count);
    stream.emit("data", Buffer.from(""));
    t.mock.timers.tick(1);
    assert.deepEqual(notifications.at(-1), { lastActivityAt: activityAt, detectedAt: activityAt + 100, inactivityTimeoutMs: 100 });
    assert.equal(notifications.length, count + 1);
  }
  assert.equal(child.killed, null);
  child.finish(0);
  await launched.result;
});

test("runSubagent: inactivity stops when the transport exits before its pipes close", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 10000 });
  const child = new FakeChild();
  const notifications: SubagentInactivity[] = [];
  const launched = await runSubagent(agent, "t", "/tmp", "m", {
    spawnFn: fakeSpawn(child), inactivityTimeoutMs: 100,
    onInactivity: (idle) => notifications.push(idle),
  });
  child.exitCode = 0;
  t.mock.timers.tick(100);
  child.stderr.emit("data", Buffer.from("last diagnostic"));
  t.mock.timers.tick(100);
  assert.equal(notifications.length, 0);
  child.finish(0);
  await launched.result;
});

test("runSubagent: inactivity ignores parent steering and monitors unresolved settling continuations", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 10000 });
  const child = new FakeChild();
  const notifications: SubagentInactivity[] = [];
  const launched = await runSubagent(agent, "t", "/tmp", "m", {
    spawnFn: fakeSpawn(child), inactivityTimeoutMs: 100,
    onInactivity: (idle) => notifications.push(idle),
  });
  respondToCommand(child);
  t.mock.timers.tick(75);
  const steering = launched.send("keep going", "steer");
  t.mock.timers.tick(25);
  assert.equal(notifications.length, 1);
  respondToCommand(child, 1);
  await steering;

  const followUp = launched.send("more work", "followUp");
  child.stdout.emit("data", Buffer.from('{"type":"agent_settled"}\n'));
  t.mock.timers.tick(100);
  assert.equal(notifications.length, 2);
  assert.equal(child.stdin.ended, false);
  respondToCommand(child, 2);
  await followUp;
  child.stdout.emit("data", Buffer.from('{"type":"agent_settled"}\n'));
  assert.equal(child.stdin.ended, true);
  t.mock.timers.tick(100);
  assert.equal(notifications.length, 2);
  child.finish(0);
  await launched.result;
});

test("runSubagent: inactivity stays suppressed until the final parent reply succeeds", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 10000 });
  const child = new FakeChild();
  const notifications: SubagentInactivity[] = [];
  const launched = await runSubagent(agent, "t", "/tmp", "m", {
    spawnFn: fakeSpawn(child), inactivityTimeoutMs: 100,
    onInactivity: (idle) => notifications.push(idle),
  });
  respondToCommand(child);
  child.stdout.emit("data", Buffer.from(questionEvent("q1", "First?")));
  child.stdout.emit("data", Buffer.from(questionEvent("q2", "Second?")));
  t.mock.timers.tick(200);
  await launched.reply("q1", "yes");
  t.mock.timers.tick(200);
  assert.equal(notifications.length, 0);
  child.stdin.writeError = new Error("write failed");
  await assert.rejects(launched.reply("q2", "yes"), /write failed/);
  child.stderr.emit("data", Buffer.from("still waiting"));
  const lastActivityAt = Date.now();
  t.mock.timers.tick(200);
  assert.equal(notifications.length, 0);
  child.stdin.writeError = undefined;
  let completeWrite: ((error?: Error | null) => void) | undefined;
  t.mock.method(child.stdin, "write", (_data: string | Uint8Array, callback?: (error?: Error | null) => void) => { completeWrite = callback; return true; });
  const reply = launched.reply("q2", "yes");
  t.mock.timers.tick(200);
  assert.equal(notifications.length, 0);
  completeWrite!();
  await reply;
  const repliedAt = Date.now();
  t.mock.timers.tick(99);
  assert.equal(notifications.length, 0);
  t.mock.timers.tick(1);
  assert.deepEqual(notifications, [{ lastActivityAt, detectedAt: repliedAt + 100, inactivityTimeoutMs: 100 }]);
  child.finish(0);
  await launched.result;
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
  assert.equal(r.error, "[subagents] Killed by SIGKILL");
});

test("runSubagent: appends signal diagnostics without blank lines after stderr", async () => {
  const child = new FakeChild();
  const { result } = await runSubagent(agent, "t", "/tmp", "m", {
    spawnFn: fakeSpawn(child),
  });
  child.stderr.emit("data", Buffer.from("child error\n"));
  child.signalCode = "SIGKILL";
  child.emit("close", null, "SIGKILL");

  const r = await result;
  assert.equal(r.error, "child error\n[subagents] Killed by SIGKILL");
});

test("runSubagent: formats no-text diagnostics from nonempty JSONL records", async () => {
  const child = new FakeChild();
  const { result } = await runSubagent(agent, "t", "/tmp", "m", {
    spawnFn: fakeSpawn(child),
  });
  child.stdout.emit("data", Buffer.from('{"type":"progress"}\n{"type":"progress","step":2}\n'));
  child.finish(0);

  const r = await result;
  assert.equal(r.text, "");
  assert.equal(
    r.error,
    "[subagents] No text extracted from 2 JSONL lines. Last lines:\n"
      + "  {\"type\":\"progress\"}\n"
      + "  {\"type\":\"progress\",\"step\":2}",
  );
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
    bridgeExtensionPath: BRIDGE_EXTENSION,
  });
  child.finish(0);
  await result;

  assert.equal(calls.length, 1);
  const { args, options } = calls[0]!;
  const flags = args.slice(1); // args[0] is the pi entry script from getPiCommand
  assert.deepEqual(flags.slice(0, 4), ["--mode", "rpc", "--no-session", "--no-extensions"]);
  assert.equal(flags.includes("-p"), false);
  assert.ok(flags.includes("--no-extensions"), "no recursive subagent spawns");
  const extensionIdx = flags.indexOf("--extension");
  assert.equal(flags[extensionIdx + 1], BRIDGE_EXTENSION);
  const toolsIdx = flags.indexOf("--tools");
  assert.match(flags[toolsIdx + 1] ?? "", /(?:^|,)ask_parent(?:,|$)/);
  const modelIdx = flags.indexOf("--model");
  assert.equal(flags[modelIdx + 1], "p/m");
  assert.ok(flags.includes("--thinking"));
  assert.ok(flags.includes("--append-system-prompt"));
  assert.equal(flags.some((a) => a === "Title: my title"), false);
  assert.equal(flags.some((a) => a === "Task: do it"), false);
  assert.deepEqual(child.stdin.commands()[0], {
    id: "subagent-1",
    type: "prompt",
    message: "Title: my title\nTask: do it",
  });
  assert.equal(options.cwd, "/tmp");
  assert.match(
    String((options.env as { NODE_OPTIONS?: string } | undefined)?.NODE_OPTIONS),
    /--max-old-space-size=8192/,
  );
});

test("runSubagent: forwards allowlisted package extensions and ignores relative paths", async () => {
  const child = new FakeChild();
  const calls: SpawnCall[] = [];
  const { result } = await runSubagent(agent, "do it", "/tmp", "m", {
    spawnFn: ((cmd: string, args: string[], options?: Record<string, unknown>) => {
      calls.push({ cmd, args, options: options ?? {} });
      return child;
    }) as unknown as typeof spawn,
    bridgeExtensionPath: BRIDGE_EXTENSION,
    extensionPaths: ["/packages/pi-claude-bridge/src/index.ts", "relative/index.ts"],
  });
  child.finish(0);
  await result;

  const flags = calls[0]!.args.slice(1);
  const extensionValues = flags.flatMap((flag, index) => flag === "--extension" ? [flags[index + 1]] : []);
  assert.deepEqual(extensionValues, [BRIDGE_EXTENSION, "/packages/pi-claude-bridge/src/index.ts"]);
  assert.ok(flags.includes("--no-extensions"));
});

test("runSubagent: ignores obsolete workspace guard extension configuration", async () => {
  const child = new FakeChild();
  const calls: SpawnCall[] = [];
  const previousExtension = process.env.PI_WORKSPACE_GUARD_EXTENSION;
  const previousChild = process.env.PI_WORKSPACE_GUARD_CHILD;
  process.env.PI_WORKSPACE_GUARD_EXTENSION = "/workspace/guard-extension.ts";
  process.env.PI_WORKSPACE_GUARD_CHILD = "parent";
  try {
    const { result } = await runSubagent(agent, "do it", "/tmp", "m", {
      spawnFn: ((cmd: string, args: string[], options?: Record<string, unknown>) => {
        calls.push({ cmd, args, options: options ?? {} });
        return child;
      }) as unknown as typeof spawn,
      bridgeExtensionPath: BRIDGE_EXTENSION,
    });
    child.finish(0);
    await result;
  } finally {
    if (previousExtension === undefined) delete process.env.PI_WORKSPACE_GUARD_EXTENSION;
    else process.env.PI_WORKSPACE_GUARD_EXTENSION = previousExtension;
    if (previousChild === undefined) delete process.env.PI_WORKSPACE_GUARD_CHILD;
    else process.env.PI_WORKSPACE_GUARD_CHILD = previousChild;
  }

  const { args, options } = calls[0]!;
  const flags = args.slice(1);
  const extensionValues = flags.flatMap((flag, index) => flag === "--extension" ? [flags[index + 1]] : []);
  assert.deepEqual(extensionValues, [BRIDGE_EXTENSION]);
  assert.ok(flags.includes("--no-extensions"));
  assert.equal(options.cwd, "/tmp");
  assert.equal((options.env as { PI_WORKSPACE_GUARD_CHILD?: string }).PI_WORKSPACE_GUARD_CHILD, "parent");
  assert.match(String((options.env as { NODE_OPTIONS?: string }).NODE_OPTIONS), /--max-old-space-size=8192/);
});

test("runSubagent: preserves inherited environment without activating obsolete workspace guard paths", async () => {
  const previousExtension = process.env.PI_WORKSPACE_GUARD_EXTENSION;
  const previousChild = process.env.PI_WORKSPACE_GUARD_CHILD;
  const previousOther = process.env.PI_WORKSPACE_GUARD_OTHER;
  process.env.PI_WORKSPACE_GUARD_CHILD = "parent";
  process.env.PI_WORKSPACE_GUARD_OTHER = "keep";
  try {
    for (const extension of [undefined, "", "relative/guard-extension.ts"]) {
      if (extension === undefined) delete process.env.PI_WORKSPACE_GUARD_EXTENSION;
      else process.env.PI_WORKSPACE_GUARD_EXTENSION = extension;
      const child = new FakeChild();
      let call: SpawnCall | undefined;
      const { result } = await runSubagent(agent, "do it", "/tmp", "m", {
        spawnFn: ((cmd: string, args: string[], options?: Record<string, unknown>) => {
          call = { cmd, args, options: options ?? {} };
          return child;
        }) as unknown as typeof spawn,
        bridgeExtensionPath: BRIDGE_EXTENSION,
      });
      child.finish(0);
      await result;

      assert.ok(call);
      const flags = call.args.slice(1);
      const extensionValues = flags.flatMap((flag, index) => flag === "--extension" ? [flags[index + 1]] : []);
      assert.deepEqual(extensionValues, [BRIDGE_EXTENSION]);
      assert.equal((call.options.env as { PI_WORKSPACE_GUARD_CHILD?: string }).PI_WORKSPACE_GUARD_CHILD, "parent");
      assert.equal((call.options.env as { PI_WORKSPACE_GUARD_OTHER?: string }).PI_WORKSPACE_GUARD_OTHER, "keep");
      assert.equal(call.options.cwd, "/tmp");
      assert.match(String((call.options.env as { NODE_OPTIONS?: string }).NODE_OPTIONS), /--max-old-space-size=8192/);
    }
  } finally {
    if (previousExtension === undefined) delete process.env.PI_WORKSPACE_GUARD_EXTENSION;
    else process.env.PI_WORKSPACE_GUARD_EXTENSION = previousExtension;
    if (previousChild === undefined) delete process.env.PI_WORKSPACE_GUARD_CHILD;
    else process.env.PI_WORKSPACE_GUARD_CHILD = previousChild;
    if (previousOther === undefined) delete process.env.PI_WORKSPACE_GUARD_OTHER;
    else process.env.PI_WORKSPACE_GUARD_OTHER = previousOther;
  }
});

test("runSubagent: explicit cancellation clears inactivity and escalates SIGTERM to SIGKILL", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 10000 });
  const child = new FakeChild();
  child.ignoreKill = true;
  const notifications: SubagentInactivity[] = [];
  const { result, cancel } = await runSubagent(agent, "t", "/tmp", "m", {
    spawnFn: fakeSpawn(child),
    inactivityTimeoutMs: 10,
    onInactivity: (idle) => notifications.push(idle),
    killDelayMs: 30,
  });
  cancel("manual");
  assert.equal(child.killed, "SIGTERM");
  child.stderr.emit("data", Buffer.from("closing"));
  t.mock.timers.tick(30);
  const r = await result;
  assert.equal(child.killed, "SIGKILL", "escalation fired after SIGTERM was ignored");
  assert.equal(notifications.length, 0);
  assert.equal(r.exitCode, 130);
  assert.equal(r.cancelled, true);
  assert.equal(r.cancellationReason, "manual");
  assert.match(r.error, /Cancelled \(manual\)/);
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
  assert.equal(r.error, "failed to run subagent RPC transport");
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

test("runSubagent: emits ordered semantic events without deltas or tool bodies", async () => {
  const child = new FakeChild();
  const events: Array<{ kind: string; summary: string }> = [];
  const { result } = await runSubagent(agent, "t", "/tmp", "m", {
    spawnFn: fakeSpawn(child),
    onEvent: (event) => events.push(event),
  });
  const emit = (event: Record<string, unknown>) => child.stdout.emit("data", Buffer.from(`${JSON.stringify(event)}\n`));

  emit({ type: "agent_start" });
  emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "partial" } });
  emit({ type: "tool_execution_start", toolName: "write", args: { file_path: "notes.txt", content: "SECRET BODY\nsecond" } });
  emit({ type: "tool_execution_end", toolName: "write", isError: false, result: "SECRET BODY\nsecond" });
  emit({ type: "tool_execution_end", toolName: "edit", isError: false, result: "SECRET BODY\nsecond" });
  emit({ type: "tool_execution_end", toolName: "write", isError: true, result: "permission denied\nretry later" });
  emit({ type: "tool_execution_end", toolName: "edit", isError: true, result: { code: "ENOENT", message: "missing file" } });
  emit({ type: "tool_execution_start", toolName: "bash", args: { command: "npm test" } });
  emit({ type: "tool_execution_end", toolName: "bash", isError: false, result: "ok\nwith whitespace" });
  emit({
    type: "message_end",
    message: { role: "assistant", content: [{ type: "thinking", thinking: "not emitted" }, { type: "text", text: " final\n answer " }] },
  });
  emit({ type: "agent_settled" });
  child.finish(0);
  await result;

  assert.deepEqual(events.map(({ kind, summary }) => ({ kind, summary })), [
    { kind: "state", summary: "started" },
    { kind: "tool-start", summary: "write notes.txt (2 lines)" },
    { kind: "tool-end", summary: "write success" },
    { kind: "tool-end", summary: "edit success" },
    { kind: "tool-end", summary: "write error: permission denied retry later" },
    { kind: "tool-end", summary: 'edit error: {"code":"ENOENT","message":"missing file"}' },
    { kind: "tool-start", summary: "$ npm test" },
    { kind: "tool-end", summary: "bash success: ok with whitespace" },
    { kind: "assistant", summary: "final answer" },
    { kind: "state", summary: "settled" },
  ]);
  assert.equal(events.some((event) => event.summary.includes("SECRET BODY")), false);
  assert.equal(events.every((event) => event.summary.length <= 500 && !/[\r\n\t]/.test(event.summary)), true);
});

test("runSubagent: steps time assistant attempts without restarting on deltas or requiring text", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 10000 });
  const child = new FakeChild();
  const timeline: Array<{ at: number; step?: JobStepInput; event?: JobEventInput }> = [];
  const launched = await runSubagent(agent, "t", "/tmp", "m", {
    spawnFn: fakeSpawn(child),
    onStep: (step) => timeline.push({ at: Date.now(), step }),
    onEvent: (event) => timeline.push({ at: Date.now(), event }),
  });
  const emit = (event: Record<string, unknown>) => child.stdout.emit("data", Buffer.from(`${JSON.stringify(event)}\n`));
  emit({ type: "turn_start" });
  emit({ type: "message_start", message: { role: "user" } });
  t.mock.timers.tick(20);
  emit({ type: "message_start", message: { role: "assistant" } });
  t.mock.timers.tick(20);
  child.stdout.emit("data", Buffer.from(updateEvent("delta")));
  t.mock.timers.tick(20);
  emit({ type: "message_end", message: { role: "assistant", content: [] } });
  assert.deepEqual(timeline.map(({ at, step }) => [at, step?.phase]), [[10000, "start"], [10060, "end"]]);

  for (const content of [[{ type: "thinking", thinking: "private" }], []]) {
    emit({ type: "message_start", message: { role: "assistant" } });
    t.mock.timers.tick(10);
    emit({ type: "message_end", message: { role: "assistant", content, stopReason: "error" } });
  }
  child.stdout.emit("data", Buffer.from(updateEvent("fallback")));
  t.mock.timers.tick(10);
  child.stdout.emit("data", Buffer.from(endEvent("answer")));
  const steps = timeline.flatMap(({ step }) => step ? [step] : []);
  assert.equal(steps.length, 8);
  for (let index = 0; index < steps.length; index += 2) {
    const start = steps[index]!;
    assert.equal(start.phase, "start");
    if (start.phase === "start") assert.equal(start.kind, "assistant");
    assert.deepEqual(steps[index + 1], { phase: "end", id: start.id });
  }
  assert.equal(new Set(steps.filter((step) => step.phase === "start").map((step) => step.id)).size, 4);
  assert.deepEqual(timeline.at(-1)?.event, { kind: "assistant", summary: "answer", stepId: steps.at(-1)!.id });
  assert.equal(timeline.at(-2)?.step?.phase, "end");
  assert.equal(JSON.stringify(timeline).includes("private"), false);
  child.finish(0);
  await launched.result;
});

test("runSubagent: steps pair concurrent same-name tools by call ID and sanitize their arguments", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 10000 });
  const child = new FakeChild();
  const timeline: Array<JobStepInput | JobEventInput> = [];
  const launched = await runSubagent(agent, "t", "/tmp", "m", {
    spawnFn: fakeSpawn(child),
    onStep: (step) => timeline.push(step),
    onEvent: (event) => timeline.push(event),
  });
  const emit = (event: Record<string, unknown>) => child.stdout.emit("data", Buffer.from(`${JSON.stringify(event)}\n`));
  for (const id of ["a", "b"]) {
    emit({ type: "tool_execution_start", toolCallId: `private-call-${id}`, toolName: "write", args: { path: `${id}.txt`, content: "SECRET BODY" } });
    t.mock.timers.tick(10);
  }
  emit({ type: "tool_execution_start", toolCallId: "private-call-a", toolName: "write", args: { path: "a.txt", content: "SECRET BODY" } });
  emit({ type: "tool_execution_update", toolCallId: "private-call-a", toolName: "write", partialResult: "SECRET BODY" });
  for (const id of ["b", "a"]) emit({ type: "tool_execution_end", toolCallId: `private-call-${id}`, toolName: "write", result: "SECRET BODY" });
  emit({ type: "tool_execution_end", toolName: "write" });
  emit({ type: "tool_execution_end", toolCallId: "unknown", toolName: "write" });
  const starts = timeline.filter((entry): entry is Extract<JobStepInput, { phase: "start" }> => "phase" in entry && entry.phase === "start");
  assert.equal(starts.length, 2);
  assert.notEqual(starts[0]!.id, starts[1]!.id);
  assert.deepEqual(starts[0]!.toolCall, { name: "write", args: { path: "a.txt", content: undefined, contentLines: 1 } });
  assert.deepEqual(timeline[4], { kind: "tool-start", summary: "write a.txt", stepId: starts[0]!.id });
  assert.deepEqual(timeline.slice(5, 9), [
    { phase: "end", id: starts[1]!.id },
    { kind: "tool-end", summary: "write success", stepId: starts[1]!.id },
    { phase: "end", id: starts[0]!.id },
    { kind: "tool-end", summary: "write success", stepId: starts[0]!.id },
  ]);
  assert.deepEqual(timeline.slice(9), [
    { kind: "tool-end", summary: "write success" }, { kind: "tool-end", summary: "write success" },
  ]);
  for (let index = 0; index < 4; index += 2) {
    assert.equal((timeline[index] as JobStepInput).phase, "start");
    assert.equal((timeline[index + 1] as JobEventInput).stepId, (timeline[index] as JobStepInput).id);
  }
  emit({ type: "turn_start" });
  emit({ type: "message_end", message: { role: "assistant", content: [] } });
  emit({ type: "tool_execution_start", toolCallId: "private-call-a", toolName: "write", args: { path: "a.txt", content: "SECRET BODY" } });
  emit({ type: "tool_execution_end", toolCallId: "private-call-a", toolName: "write", result: "SECRET BODY" });
  const reused = timeline.at(-4) as Extract<JobStepInput, { phase: "start" }>;
  assert.equal(reused.phase, "start");
  assert.equal(reused.kind, "tool");
  assert.notEqual(reused.id, starts[0]!.id);
  assert.notEqual(reused.id, starts[1]!.id);
  assert.deepEqual(timeline.slice(-3), [
    { kind: "tool-start", summary: "write a.txt", stepId: reused.id },
    { phase: "end", id: reused.id },
    { kind: "tool-end", summary: "write success", stepId: reused.id },
  ]);
  const offset = timeline.length;
  emit({ type: "tool_execution_start", toolName: "write", args: { path: "a.txt" } });
  assert.deepEqual(timeline.slice(offset), [{ kind: "tool-start", summary: "write a.txt" }]);
  assert.equal(JSON.stringify(timeline).includes("SECRET BODY"), false);
  assert.equal(JSON.stringify(timeline).includes("private-call-"), false);
  child.finish(0);
  await launched.result;
});

test("runSubagent: retry steps close on retry end or the next attempt and use unique IDs", async () => {
  const child = new FakeChild();
  const timeline: Array<JobStepInput | JobEventInput> = [];
  const launched = await runSubagent(agent, "t", "/tmp", "m", {
    spawnFn: fakeSpawn(child),
    onStep: (step) => timeline.push(step),
    onEvent: (event) => timeline.push(event),
  });
  const emit = (event: Record<string, unknown>) => child.stdout.emit("data", Buffer.from(`${JSON.stringify(event)}\n`));
  for (let index = 0; index < 2; index += 1) {
    emit({ type: "turn_start" });
    emit({ type: "auto_retry_start", attempt: 1, errorMessage: "private provider error" });
    emit({ type: "auto_retry_end", attempt: 1, success: false });
  }
  const starts = timeline.filter((entry): entry is Extract<JobStepInput, { phase: "start" }> => "phase" in entry && entry.phase === "start");
  assert.deepEqual(starts.map((step) => step.kind), ["assistant", "retry", "assistant", "retry"]);
  assert.equal(new Set(starts.map((step) => step.id)).size, 4);
  for (let index = 0; index < timeline.length; index += 6) {
    const assistant = timeline[index] as JobStepInput;
    const retry = timeline[index + 2] as JobStepInput;
    assert.deepEqual(timeline.slice(index + 1, index + 6), [
      { phase: "end", id: assistant.id },
      { phase: "start", id: retry.id, kind: "retry", summary: "Retry wait" },
      { kind: "state", summary: "retrying", stepId: retry.id },
      { phase: "end", id: retry.id },
      { kind: "state", summary: "retry ended", stepId: retry.id },
    ]);
  }
  for (const nextAttempt of [
    { type: "turn_start" },
    { type: "message_start", message: { role: "assistant" } },
    { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "retry" } },
  ]) {
    emit({ type: "turn_start" });
    emit({ type: "auto_retry_start", attempt: 1 });
    const retry = timeline.at(-2) as JobStepInput;
    const offset = timeline.length;
    emit(nextAttempt);
    const assistant = timeline.at(-1) as JobStepInput;
    assert.deepEqual(timeline.slice(offset), [
      { phase: "end", id: retry.id },
      { phase: "start", id: assistant.id, kind: "assistant", summary: "Assistant response" },
    ]);
    emit({ type: "auto_retry_end", attempt: 1, success: true });
    assert.deepEqual(timeline.slice(offset + 2), [{ kind: "state", summary: "retry ended" }]);
    emit({ type: "message_end", message: { role: "assistant", content: [] } });
    assert.deepEqual(timeline.at(-1), { phase: "end", id: assistant.id });
  }
  const allStarts = timeline.filter((entry): entry is Extract<JobStepInput, { phase: "start" }> => "phase" in entry && entry.phase === "start");
  assert.equal(new Set(allStarts.map((step) => step.id)).size, allStarts.length);
  child.finish(0);
  await launched.result;
});

test("runSubagent: event and step callback exceptions do not interrupt processing", async (t) => {
  t.mock.method(console, "error", () => {});
  const child = new FakeChild();
  const { result } = await runSubagent(agent, "t", "/tmp", "m", {
    spawnFn: fakeSpawn(child),
    onEvent: () => { throw new Error("event callback failed"); },
    onStep: () => { throw new Error("step callback failed"); },
  });
  child.stdout.emit("data", Buffer.from(updateEvent("partial")));
  child.stdout.emit("data", Buffer.from(endEvent("final answer")));
  child.finish(0);
  assert.equal((await result).text, "final answer");
});

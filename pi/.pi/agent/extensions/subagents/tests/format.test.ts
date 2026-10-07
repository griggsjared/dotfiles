import { test } from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
  capOutput,
  formatDuration,
  formatResultOutput,
  formatTokens,
  formatUsageStats,
  normalizeTitle,
  shortLabel,
  toolCallLabel,
} from "../format.ts";
import { EMPTY_USAGE, type SubagentUsage } from "../types.ts";

test("formatTokens", () => {
  assert.equal(formatTokens(0), "0");
  assert.equal(formatTokens(999), "999");
  assert.equal(formatTokens(1000), "1.0k");
  assert.equal(formatTokens(9999), "10.0k");
  assert.equal(formatTokens(10000), "10k");
  assert.equal(formatTokens(999999), "1000k");
  assert.equal(formatTokens(1000000), "1.0M");
});

test("formatDuration uses whole seconds and compact minutes", () => {
  assert.equal(formatDuration(0), "1s");
  assert.equal(formatDuration(999), "1s");
  assert.equal(formatDuration(1999), "1s");
  assert.equal(formatDuration(2000), "2s");
  assert.equal(formatDuration(59999), "59s");
  assert.equal(formatDuration(60000), "1m0s");
  assert.equal(formatDuration(92000), "1m32s");
});

test("formatUsageStats keeps metadata without usage", () => {
  assert.equal(formatUsageStats(undefined), "");
  assert.equal(formatUsageStats(undefined, "opencode-go/x", "high"), "opencode-go/x:high");
});

test("formatUsageStats renders non-zero fields with compact model and effort suffix", () => {
  const usage: SubagentUsage = {
    ...EMPTY_USAGE,
    turns: 2,
    input: 1500,
    output: 400,
    cacheRead: 5000,
    cacheWrite: 0,
    cost: 0.0001234,
    contextTokens: 20000,
  };
  assert.equal(
    formatUsageStats(usage, "opencode-go/x", "high"),
    "2 turns ↑1.5k ↓400 R5.0k $0.0001 ctx:20k opencode-go/x:high",
  );
});

test("formatUsageStats omits zero fields", () => {
  assert.equal(formatUsageStats({ ...EMPTY_USAGE, input: 1 }), "↑1");
});

test("normalizeTitle", () => {
  assert.equal(normalizeTitle(undefined), undefined);
  assert.equal(normalizeTitle(""), undefined);
  assert.equal(normalizeTitle("   "), undefined);
  assert.equal(normalizeTitle("hello"), "hello");
  assert.equal(normalizeTitle("line1\nline2"), "line1 line2");
  assert.equal(normalizeTitle("\n  spaced  \n"), "spaced");
  assert.equal(normalizeTitle("line1\tline2\u0000line3"), "line1 line2 line3");
  assert.equal(normalizeTitle("\x1b[31mReview config\x1b[0m"), "Review config");
  assert.equal(normalizeTitle("\x1b]8;;https://example.com\x1b\\Review config\x1b]8;;\x1b\\"), "Review config");
});

test("shortLabel prefers title over task", () => {
  assert.equal(shortLabel("t", "task", 10), "t");
  assert.equal(shortLabel(undefined, "task", 10), "task");
  assert.equal(shortLabel(undefined, undefined, 10), "...");
  assert.equal(shortLabel(undefined, "a very long task", 6), "a ver…");
  assert.equal(shortLabel("a very long title", "task", 6), "a very long title");
});

test("shortLabel truncates inline text by terminal columns", () => {
  const label = shortLabel(undefined, "界界界", 4);
  assert.equal(label, "界…");
  assert.ok(visibleWidth(label) <= 4);
  assert.equal(shortLabel(undefined, "first\nsecond\tthird", 40), "first second third");
});

test("formatResultOutput", () => {
  assert.equal(formatResultOutput({ text: "", error: "" }), "(no output)");
  assert.equal(formatResultOutput({ text: "done", error: "" }), "done");
  assert.equal(formatResultOutput({ text: "", error: "boom" }), "boom");
  assert.equal(formatResultOutput({ text: "done", error: "boom" }), "done\nboom");
});

test("capOutput", () => {
  assert.equal(capOutput("short", 100), "short");
  assert.equal(capOutput("x".repeat(100), 10), `${"x".repeat(10)}\n…`);
});

test("toolCallLabel", () => {
  assert.equal(toolCallLabel("bash", { command: "ls -la" }), "$ ls -la");
  assert.equal(toolCallLabel("bash", {}), "$ …");
  assert.equal(toolCallLabel("read", { file_path: "/a/b.ts" }), "read /a/b.ts");
  assert.equal(toolCallLabel("read", { path: "/a/b.ts", offset: 10, limit: 20 }), "read /a/b.ts:10-29");
  assert.equal(toolCallLabel("read", { path: "/a/b.ts", offset: 5 }), "read /a/b.ts:5");
  assert.equal(toolCallLabel("write", { file_path: "/a/b.ts", contentLines: 3 }), "write /a/b.ts (3 lines)");
  assert.equal(toolCallLabel("write", { path: "/a/b.ts" }), "write /a/b.ts");
  assert.equal(toolCallLabel("edit", { path: "/a/b.ts" }), "edit /a/b.ts");
  assert.equal(toolCallLabel("ls", { path: "src" }), "ls src");
  assert.equal(toolCallLabel("find", { pattern: "*.ts", path: "src" }), "find *.ts in src");
  assert.equal(toolCallLabel("grep", { pattern: "TODO", path: "src" }), "grep /TODO/ in src");
  assert.equal(toolCallLabel("weird", { a: 1 }), 'weird {"a":1}');
});

test("toolCallLabel keeps nested subagent tools explicit and inline-safe", () => {
  assert.equal(toolCallLabel("subagent", { agent: "scout", task: "Review\nconfig" }), "subagent launch scout · Review config");
  assert.equal(
    toolCallLabel("subagent", {
      tasks: [
        { agent: "scout", title: "Review config" },
        { agent: "worker", task: "Run tests" },
      ],
    }),
    "subagent launch parallel (2 tasks): scout · Review config, worker · Run tests",
  );
  assert.equal(toolCallLabel("subagent_status", {}), "subagent status all");
  assert.equal(toolCallLabel("subagent_status", { jobId: 3 }), "subagent status #3");
  assert.equal(toolCallLabel("subagent_peek", { jobId: 3 }), "subagent peek #3");
  assert.equal(toolCallLabel("subagent_cancel", {}), "subagent cancel all");
  assert.equal(toolCallLabel("subagent_cancel", { all: true }), "subagent cancel all");
  assert.equal(toolCallLabel("subagent_cancel", { jobId: 3 }), "subagent cancel #3");
  assert.equal(
    toolCallLabel("subagent_send", { jobId: 3, deliverAs: "steer", message: "Check\ttests" }),
    "subagent send #3 steering · Check tests",
  );
  assert.equal(
    toolCallLabel("subagent_send", { jobId: 3, deliverAs: "followUp", message: "Run tests" }),
    "subagent send #3 follow-up · Run tests",
  );
  assert.equal(
    toolCallLabel("subagent_reply", { jobId: 3, questionId: "q1", answer: "Yes, proceed" }),
    "subagent reply #3 · Yes, proceed",
  );
});

test("toolCallLabel explicit widths reveal more content than the default cap", () => {
  const args = { command: `echo ${"argument ".repeat(10)}useful trailing details` };
  const short = toolCallLabel("bash", args, 20);
  const captured = toolCallLabel("bash", args);
  const wide = toolCallLabel("bash", args, 160);
  assert.ok(visibleWidth(short) <= 20);
  assert.ok(visibleWidth(wide) <= 160);
  assert.ok(visibleWidth(wide) > visibleWidth(captured));
  assert.doesNotMatch(captured, /useful trailing details/);
  assert.match(wide, /useful trailing details/);
});

test("toolCallLabel preserves path endings and read ranges at explicit widths", () => {
  const path = "/Users/jared/project/pi/.pi/agent/extensions/subagents/status-tools.ts";
  const narrow = toolCallLabel("read", { path }, 24);
  const medium = toolCallLabel("read", { path }, 40);
  const wide = toolCallLabel("read", { path, offset: 10, limit: 20 }, 80);
  assert.ok(visibleWidth(narrow) <= 24);
  assert.match(narrow, /status-tools\.ts$/);
  assert.ok(visibleWidth(medium) <= 40);
  assert.match(medium, /\/subagents\/status-tools\.ts$/);
  assert.ok(visibleWidth(medium) > visibleWidth(narrow));
  assert.ok(visibleWidth(wide) <= 80);
  assert.match(wide, /status-tools\.ts:10-29$/);

  const unicode = toolCallLabel("edit", { path: "/tmp/界界界/subagents/status-tools.ts" }, 24);
  assert.ok(visibleWidth(unicode) <= 24);
  assert.match(unicode, /status-tools\.ts$/);

  for (const [name, args] of [
    ["read", { path }] as const,
    ["write", { path }] as const,
    ["edit", { path }] as const,
    ["ls", { path }] as const,
    ["find", { pattern: "*.ts", path }] as const,
    ["grep", { pattern: "TODO", path }] as const,
  ]) {
    const label = toolCallLabel(name, args, 32);
    assert.ok(visibleWidth(label) <= 32);
    assert.match(label, /status-tools\.ts/);
  }
});

test("toolCallLabel explicit widths fit every subagent mode", () => {
  const calls: [string, Record<string, unknown>][] = [
    ["subagent", { agent: "scout", task: "A long task description" }],
    ["subagent", { tasks: [{ agent: "scout", task: "A long task description" }] }],
    ["subagent_status", { jobId: 3 }],
    ["subagent_peek", { jobId: 3 }],
    ["subagent_cancel", { jobId: 3 }],
    ["subagent_send", { jobId: 3, message: "A long message" }],
    ["subagent_reply", { jobId: 3, answer: "A long answer" }],
  ];
  for (const [name, args] of calls) assert.ok(visibleWidth(toolCallLabel(name, args, 24)) <= 24);
});

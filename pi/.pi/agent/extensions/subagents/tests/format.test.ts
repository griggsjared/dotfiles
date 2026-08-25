import { test } from "node:test";
import assert from "node:assert/strict";
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
});

test("shortLabel prefers title over task", () => {
  assert.equal(shortLabel("t", "task", 10), "t");
  assert.equal(shortLabel(undefined, "task", 10), "task");
  assert.equal(shortLabel(undefined, undefined, 10), "...");
  assert.equal(shortLabel(undefined, "a very long task", 6), "a very…");
  assert.equal(shortLabel("a very long title", "task", 6), "a very long title");
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

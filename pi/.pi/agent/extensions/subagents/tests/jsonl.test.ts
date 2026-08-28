import { test } from "node:test";
import assert from "node:assert/strict";
import {
  accumulateEvent,
  assistantText,
  createStreamState,
  extractFinalText,
  MAX_TOOL_CALLS,
  normalizeToolArgs,
  parseEventLine,
  parseParentQuestion,
  sanitizeToolCallArgs,
  truncateStrings,
} from "../jsonl.ts";

const end = (content: unknown, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ type: "message_end", message: { role: "assistant", content, ...extra } });

const update = (content: unknown) =>
  JSON.stringify({ type: "message_update", message: { role: "assistant", content } });

const rpcDelta = (type: "text_delta" | "thinking_delta", delta: string) =>
  JSON.stringify({ type: "message_update", assistantMessageEvent: { type, delta } });

test("parseEventLine", () => {
  assert.ok(parseEventLine('{"type":"message_end","message":{"role":"assistant","content":"x"}}'));
  assert.equal(parseEventLine(""), undefined);
  assert.equal(parseEventLine("not json"), undefined);
  assert.equal(parseEventLine('{"type":"message_end","message":{"role":"user"}}'), undefined);
  assert.equal(parseEventLine('{"type":"message_end"}'), undefined);
  assert.ok(parseEventLine(rpcDelta("text_delta", "x")));
});

test("parseParentQuestion recognizes only marked input requests", () => {
  assert.deepEqual(parseParentQuestion(JSON.stringify({
    type: "extension_ui_request",
    id: "question-1",
    method: "input",
    title: "subagents:ask-parent: Which API? ",
    placeholder: " Existing or new. ",
  })), {
    id: "question-1",
    question: "Which API?",
    context: "Existing or new.",
  });
  assert.deepEqual(parseParentQuestion(JSON.stringify({
    type: "extension_ui_request",
    id: "question-2",
    method: "input",
    title: "subagents:ask-parent:Continue?",
  })), { id: "question-2", question: "Continue?", context: undefined });
  assert.equal(parseParentQuestion("not json"), undefined);
  assert.equal(parseParentQuestion(JSON.stringify({
    type: "extension_ui_request",
    id: "",
    method: "input",
    title: "subagents:ask-parent:Missing ID",
  })), undefined);
  assert.equal(parseParentQuestion(JSON.stringify({
    type: "extension_ui_request",
    id: "question-3",
    method: "editor",
    title: "subagents:ask-parent:Wrong method",
  })), undefined);
  assert.equal(parseParentQuestion(JSON.stringify({
    type: "extension_ui_request",
    id: "question-4",
    method: "input",
    title: "Ordinary extension input",
  })), undefined);
});

test("assistantText", () => {
  assert.equal(assistantText("plain"), "plain");
  assert.equal(assistantText([{ type: "text", text: "a" }, { type: "text", text: "b" }]), "a\nb");
  assert.equal(assistantText([{ type: "thinking", thinking: "hmm" }]), "");
  assert.equal(assistantText([{ type: "text", text: 42 }]), "");
  assert.equal(assistantText(42), "");
});

test("accumulateEvent: message_end string content and usage", () => {
  const state = createStreamState("default-model");
  accumulateEvent(state, end("final answer", {
    usage: { input: 10, output: 20, cacheRead: 30, cacheWrite: 40, totalTokens: 60, cost: 0.001 },
    model: "served-model",
  }));
  assert.equal(state.finalText, "final answer");
  assert.equal(state.model, "served-model");
  assert.deepEqual(state.usage, {
    turns: 1, input: 10, output: 20, cacheRead: 30, cacheWrite: 40, cost: 0.001, contextTokens: 60,
  });
});

test("accumulateEvent: cost as object", () => {
  const state = createStreamState("m");
  accumulateEvent(state, end("x", { usage: { cost: { total: 0.5 } } }));
  assert.equal(state.usage.cost, 0.5);
});

test("accumulateEvent: tool calls parsed, sanitized, and truncated", () => {
  const state = createStreamState("m");
  const longContent = Array.from({ length: 10 }, () => "line").join("\n");
  accumulateEvent(state, end([
    { type: "text", text: "working" },
    { type: "toolCall", name: "write", arguments: { file_path: "/x.ts", content: longContent } },
    { type: "tool_use", name: "read", input: { path: "/y.ts" } },
  ]));
  assert.equal(state.toolCalls.length, 2);
  assert.equal(state.toolCalls[0]?.name, "write");
  assert.equal(state.toolCalls[0]?.args.content, undefined);
  assert.equal(state.toolCalls[0]?.args.contentLines, 10);
  assert.deepEqual(state.toolCalls[1], { name: "read", args: { path: "/y.ts" } });
});

test("accumulateEvent: keeps only the most recent MAX_TOOL_CALLS", () => {
  const state = createStreamState("m");
  const parts = Array.from({ length: MAX_TOOL_CALLS + 5 }, (_, i) => ({
    type: "toolCall", name: "read", arguments: { path: `/f${i}.ts` },
  }));
  accumulateEvent(state, end(parts));
  assert.equal(state.toolCalls.length, MAX_TOOL_CALLS);
  assert.equal(state.toolCalls[0]?.args.path, "/f5.ts");
  assert.equal(state.toolCalls[MAX_TOOL_CALLS - 1]?.args.path, `/f${MAX_TOOL_CALLS + 4}.ts`);
});

test("accumulateEvent: message_update keeps the longest legacy chunk", () => {
  const state = createStreamState("m");
  accumulateEvent(state, update("short"));
  accumulateEvent(state, update("much longer streaming chunk"));
  accumulateEvent(state, update("medium"));
  assert.equal(state.streamedText, "much longer streaming chunk");
  assert.equal(state.finalText, "");
});

test("accumulateEvent: assembles RPC text and thinking deltas", () => {
  const state = createStreamState("m");
  accumulateEvent(state, rpcDelta("text_delta", "Hello"));
  accumulateEvent(state, rpcDelta("text_delta", " world"));
  accumulateEvent(state, rpcDelta("thinking_delta", "checking"));
  assert.equal(state.streamedText, "Hello world");
  assert.equal(state.finalThinking, "checking");
});

test("accumulateEvent: ignores non-assistant and malformed lines", () => {
  const state = createStreamState("m");
  accumulateEvent(state, JSON.stringify({ type: "message_end", message: { role: "user", content: "hi" } }));
  accumulateEvent(state, "garbage");
  assert.equal(state.usage.turns, 0);
  assert.equal(state.finalText, "");
});

test("extractFinalText: full stream, thinking fallback, and truncated tail", () => {
  const stream = [
    update("partial"),
    end("final"),
    "garbage",
  ].join("\n");
  assert.equal(extractFinalText(stream), "final");
  assert.equal(extractFinalText(end("")), "");
  assert.equal(extractFinalText(end([{ type: "thinking", thinking: "only thinking" }])), "only thinking");
  // No trailing newline: last line must still be seen.
  assert.equal(extractFinalText(`garbage\n${end("last")}`), "last");
  assert.equal(extractFinalText(""), "");
});

test("normalizeToolArgs", () => {
  assert.deepEqual(normalizeToolArgs({ a: 1 }), { a: 1 });
  assert.deepEqual(normalizeToolArgs('{"a":1}'), { a: 1 });
  assert.deepEqual(normalizeToolArgs("not json"), {});
  assert.deepEqual(normalizeToolArgs(42), {});
  assert.deepEqual(normalizeToolArgs([1, 2]), {});
});

test("sanitizeToolCallArgs drops content for write/edit only", () => {
  assert.equal(sanitizeToolCallArgs("write", { content: "a\nb" }).contentLines, 2);
  assert.equal(sanitizeToolCallArgs("edit", { content: "a" }).contentLines, 1);
  assert.deepEqual(sanitizeToolCallArgs("read", { content: "a\nb" }), { content: "a\nb" });
});

test("truncateStrings truncates strings, arrays, and objects", () => {
  assert.equal(truncateStrings("x".repeat(200)), `${"x".repeat(120)}…`);
  assert.deepEqual(truncateStrings([1, "y".repeat(200)]), [1, `${"y".repeat(120)}…`]);
  assert.deepEqual(truncateStrings({ k: "z".repeat(200) }), { k: `${"z".repeat(120)}…` });
  assert.equal(truncateStrings(5), 5);
});

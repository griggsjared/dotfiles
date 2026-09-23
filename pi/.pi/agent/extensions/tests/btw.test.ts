import assert from "node:assert/strict";
import { test } from "node:test";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { fitModalBody, transcript } from "../btw.ts";

function answer(text: string): AssistantMessage {
	return { content: [{ type: "text", text }] } as AssistantMessage;
}

test("transcript renders Q/A pairs", () => {
	assert.equal(
		transcript([
			{ question: "what?", answer: answer("this") },
			{ question: "why?", answer: answer("because") },
		]),
		"Side conversation (via /btw):\n\nQ: what?\nA: this\n\nQ: why?\nA: because",
	);
});

test("transcript keeps a question whose answer has no text blocks", () => {
	const thinkingOnly = { content: [{ type: "thinking", thinking: "hmm" }] } as unknown as AssistantMessage;
	assert.equal(
		transcript([
			{ question: "unanswered?", answer: thinkingOnly },
			{ question: "answered?", answer: answer("ok") },
		]),
		"Side conversation (via /btw):\n\nQ: unanswered?\n\nQ: answered?\nA: ok",
	);
});

test("transcript truncates older turns once the budget is exceeded", () => {
	const filler = "x".repeat(5000);
	const result = transcript([
		{ question: "first", answer: answer(filler) },
		{ question: "second", answer: answer(filler) },
	]);
	assert.match(result, /\[…earlier turns truncated\]/);
	assert.doesNotMatch(result, /Q: first/);
	assert.match(result, /Q: second/);
});

test("modal body grows until the padded terminal height is full", () => {
	const body = ["one", "two", "three"];
	assert.deepEqual(fitModalBody(body, 0, 12, 4), {
		lines: body,
		scrollTop: 0,
		viewportRows: 4,
		maxScroll: 0,
	});
});

test("modal body scrolls within the padded terminal height", () => {
	const body = Array.from({ length: 10 }, (_, index) => `line ${index + 1}`);
	assert.deepEqual(fitModalBody(body, Number.MAX_SAFE_INTEGER, 12, 4), {
		lines: ["line 7", "line 8", "line 9", "line 10"],
		scrollTop: 6,
		viewportRows: 4,
		maxScroll: 6,
	});
});

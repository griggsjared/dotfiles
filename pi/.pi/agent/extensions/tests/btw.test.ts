import assert from "node:assert/strict";
import { test } from "node:test";
import type { AssistantMessage, Context } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionCommandContext, SessionEntry, SessionMessageEntry } from "@earendil-works/pi-coding-agent";
import { KeybindingsManager, TUI_KEYBINDINGS } from "@earendil-works/pi-tui";
import btw, { fitModalBody, transcript } from "../btw.ts";

function answer(text: string): AssistantMessage {
	return { role: "assistant", content: [{ type: "text", text }], stopReason: "stop", timestamp: 1 } as AssistantMessage;
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

type Modal = { handleInput(data: string): void; dispose(): void };
type RequestOptions = { signal: AbortSignal; sessionId: string; cacheRetention: string };

function harness(history: SessionMessageEntry["message"][] = []) {
	let handler!: Parameters<ExtensionAPI["registerCommand"]>[1]["handler"];
	let shutdown!: () => void;
	let modal!: Modal;
	let renders = 0;
	let completions = 0;
	const sent: { text: string; options: unknown }[] = [];
	const notifications: { text: string; level: string }[] = [];
	const requests: {
		model: unknown;
		context: Context;
		options: RequestOptions;
		resolve(value: AssistantMessage): void;
		reject(error: Error): void;
	}[] = [];
	const entries: SessionEntry[] = history.map((message, index) => ({
		type: "message",
		id: String(index),
		parentId: index ? String(index - 1) : null,
		timestamp: new Date(0).toISOString(),
		message,
	}));
	const originalEntries = structuredClone(entries);
	const model = { provider: "test-router", id: "virtual" };
	btw({
		on: (_event: string, callback: () => void) => { shutdown = callback; },
		registerCommand: (_name: string, command: { handler: typeof handler }) => { handler = command.handler; },
		sendUserMessage: (text: string, options: unknown) => { sent.push({ text, options }); },
		appendEntry: () => assert.fail("unexpected main-session write"),
		sendMessage: () => assert.fail("unexpected main-session message"),
	} as unknown as ExtensionAPI);
	const ctx = {
		mode: "tui",
		model,
		sessionManager: {
			getEntries: () => entries,
			getLeafId: () => entries.at(-1)?.id ?? null,
			getSessionId: () => assert.fail("must not reuse the main session ID"),
			appendMessage: () => assert.fail("unexpected main-session write"),
		},
		modelRegistry: {
			getApiKeyAndHeaders: () => assert.fail("authentication belongs to the registry"),
			complete: () => assert.fail("complete does not route virtual models"),
			streamSimple: (selected: unknown, context: Context, options: RequestOptions) => {
				const pending = Promise.withResolvers<AssistantMessage>();
				requests.push({ model: selected, context: structuredClone(context), options, ...pending });
				return { result: () => pending.promise };
			},
		},
		ui: {
			notify: (text: string, level: string) => { notifications.push({ text, level }); },
			custom: (factory: (
				tui: unknown, theme: unknown, kb: unknown, done: (value: string | null) => void,
			) => Modal) => {
				const pending = Promise.withResolvers<string | null>();
				modal = factory(
					{ requestRender: () => { renders++; }, terminal: { rows: 24 } },
					{ fg: (_color: string, text: string) => text },
					new KeybindingsManager(TUI_KEYBINDINGS),
					(value) => { completions++; pending.resolve(value); },
				);
				return pending.promise.then((value) => { modal.dispose(); return value; });
			},
		},
	} as unknown as ExtensionCommandContext;
	return {
		start: (question: string) => handler(question, ctx),
		input: (key: string) => modal.handleInput(key),
		shutdown: () => shutdown(),
		requests, sent, notifications, entries, originalEntries, model,
		get renders() { return renders; },
		get completions() { return completions; },
	};
}

async function flush() {
	await new Promise<void>((resolve) => setImmediate(resolve));
}

test("registry requests isolate all system state while retaining context and successive private turns", async () => {
	const history = [
		{ role: "system", content: [{ type: "text", text: "MAIN instructions" }], toolsAdded: [{ name: "inheritedDeclaration" }], timestamp: 1 },
		{ role: "user", content: [{ type: "text", text: "main question" }, { type: "image", data: "aW1hZ2U=", mimeType: "image/png" }], timestamp: 2 },
		{ ...answer("main answer"), content: [{ type: "toolCall", id: "call", name: "read", arguments: { path: "example" } }] },
		{ role: "toolResult", toolCallId: "call", toolName: "read", content: [{ type: "text", text: "file contents" }, { type: "image", data: "dG9vbA==", mimeType: "image/png" }], isError: false, timestamp: 3 },
		{ role: "system", content: [{ type: "text", text: "MAIN delta" }], toolsAdded: [{ name: "laterDeclaration" }], timestamp: 4 },
		{ role: "custom", customType: "context", content: "legitimate extension context", display: false, timestamp: 5 },
	] as unknown as SessionMessageEntry["message"][];
	const h = harness(history);
	const running = h.start("side question");
	assert.equal(h.requests.length, 1);
	const first = h.requests[0];
	assert.equal(first.model, h.model);
	assert.equal(first.context.systemPrompt, "You are answering a side question about the current conversation. Answer the question directly and concisely. Do not continue the main task, call tools, or propose changes unless the question explicitly asks for them.");
	assert.equal("tools" in first.context, false);
	assert.equal(first.context.messages.some((message) => message.role === "system"), false);
	assert.doesNotMatch(JSON.stringify(first.context), /MAIN|inheritedDeclaration|laterDeclaration|toolsAdded/);
	assert.deepEqual(first.context.messages.slice(0, 3), history.slice(1, 4));
	assert.deepEqual(first.context.messages[3], { role: "user", content: [{ type: "text", text: "legitimate extension context" }], timestamp: 5 });
	assert.equal(first.options.cacheRetention, "none");
	assert.deepEqual(Object.keys(first.options).sort(), ["cacheRetention", "sessionId", "signal"]);
	assert.match(first.options.sessionId, /^[0-9a-f-]{36}$/);
	h.input("\x13");
	assert.equal(h.completions, 0, "Ctrl+S must not forward while loading");
	first.resolve(answer("side answer"));
	await flush();
	h.input("follow-up");
	h.input("\r");
	assert.equal(h.requests.length, 2);
	const second = h.requests[1];
	assert.equal(second.model, h.model);
	assert.equal(second.context.systemPrompt, first.context.systemPrompt);
	assert.deepEqual(second.context.messages.slice(0, -2), first.context.messages);
	assert.deepEqual(second.context.messages.at(-2), answer("side answer"));
	assert.deepEqual(second.context.messages.at(-1)?.content, [{ type: "text", text: "follow-up" }]);
	assert.notEqual(second.options.sessionId, first.options.sessionId);
	assert.equal(second.options.signal, first.options.signal);
	assert.equal(second.options.cacheRetention, "none");
	second.resolve(answer("second answer"));
	await flush();
	assert.deepEqual(h.sent.slice(), []);
	assert.deepEqual(h.entries, h.originalEntries);
	h.input("\x13");
	await running;
	assert.deepEqual(h.sent, [{
		text: "Side conversation (via /btw):\n\nQ: side question\nA: side answer\n\nQ: follow-up\nA: second answer",
		options: { deliverAs: "followUp" },
	}]);
	assert.equal(first.options.signal.aborted, true);
	assert.equal(h.completions, 1);
	assert.deepEqual(h.entries, h.originalEntries);
});

for (const cancellation of ["escape", "shutdown"]) {
	for (const stale of ["answer", "error", "rejection"]) {
		test(`${cancellation} aborts and cleans up without accepting a stale ${stale}`, async () => {
			const h = harness();
			const running = h.start("cancel me");
			const first = h.requests[0];
			await h.start("blocked");
			assert.equal(h.requests.length, 1);
			assert.deepEqual(h.notifications.pop(), { text: "A /btw question is already in progress", level: "error" });
			if (cancellation === "escape") h.input("\x1b");
			else h.shutdown();
			await running;
			assert.equal(first.options.signal.aborted, true);
			assert.equal(h.completions, 1);
			const next = h.start("new question");
			const renders = h.renders;
			if (stale === "rejection") first.reject(new Error("stale failure"));
			else first.resolve({ ...answer("stale answer"), stopReason: stale === "error" ? "error" : "stop" });
			await flush();
			assert.equal(h.renders, renders);
			assert.equal(h.completions, 1);
			assert.deepEqual(h.notifications, []);
			assert.deepEqual(h.sent.slice(), []);
			assert.deepEqual(h.requests[1].context.messages.map((message) => message.content), [[{ type: "text", text: "new question" }]]);
			h.requests[1].resolve(answer("fresh answer"));
			await flush();
			h.input("\x13");
			await next;
			assert.equal(h.sent.length, 1);
			assert.doesNotMatch(h.sent[0].text, /stale|cancel me/);
			assert.equal(h.requests[1].options.signal.aborted, true);
			assert.deepEqual(h.entries, h.originalEntries);
		});
	}
}

for (const failure of ["aborted", "error", "rejection"]) {
	test(`registry ${failure} closes the modal and releases the active operation`, async () => {
		const h = harness();
		const running = h.start("question");
		if (failure === "rejection") h.requests[0].reject(new Error("registry failure"));
		else h.requests[0].resolve({ ...answer("discard"), stopReason: failure as "aborted" | "error", errorMessage: "registry failure" });
		await running;
		assert.equal(h.requests[0].options.signal.aborted, true);
		assert.equal(h.completions, 1);
		assert.deepEqual(h.notifications, failure === "aborted" ? [] : [{ text: "btw request failed", level: "error" }]);
		assert.deepEqual(h.sent.slice(), []);
		const next = h.start("");
		assert.equal(h.requests.length, 1, "empty modal must not request a model");
		h.input("retry");
		h.input("\r");
		assert.equal(h.requests.length, 2);
		h.requests[1].resolve(answer("retry answer"));
		await flush();
		h.input("\x1b");
		await next;
		assert.deepEqual(h.sent.slice(), []);
		assert.deepEqual(h.entries, h.originalEntries);
	});
}

import assert from "node:assert/strict";
import { test } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import workingIndicator from "../index.ts";

type TestContext = ReturnType<typeof createContext>["ctx"];
type Handler = (event: Record<string, unknown>, context: TestContext) => void;

type Calls = {
	messages: Array<string | undefined>;
	indicators: Array<unknown>;
	visibility: boolean[];
	editors: unknown[];
};

function register() {
	const handlers = new Map<string, Handler>();
	workingIndicator({
		on(event: string, handler: Handler) {
			handlers.set(event, handler);
		},
	} as unknown as ExtensionAPI);
	return handlers;
}

function createContext() {
	const calls: Calls = { messages: [], indicators: [], visibility: [], editors: [] };
	return {
		calls,
		ctx: {
			mode: "tui",
			hasUI: true,
			ui: {
				theme: {
					fg(_color: string, text: string) { return text; },
					bold(text: string) { return text; },
				},
				setWorkingMessage(message?: string) { calls.messages.push(message); },
				setWorkingIndicator(indicator?: unknown) { calls.indicators.push(indicator); },
				setWorkingVisible(visible: boolean) { calls.visibility.push(visible); },
				setEditorComponent(factory: unknown) { calls.editors.push(factory); },
			},
			isIdle: () => true,
		},
	};
}

function emit(handlers: Map<string, Handler>, name: string, context: TestContext, event: Record<string, unknown> = {}) {
	handlers.get(name)?.(event, context);
}

function assistantMessage(content: unknown[] = [], output = 0) {
	return { role: "assistant", content, usage: { output } };
}

function latestTokens(calls: Calls): string {
	const message = calls.messages.at(-1);
	assert.ok(message);
	const match = message.match(/↓ ([^ ]+) tokens/);
	assert.ok(match);
	return match[1]!;
}

function cleanup(handlers: Map<string, Handler>, ctx: TestContext) {
	emit(handlers, "agent_settled", ctx);
}

test("starts and settles the observable working indicator lifecycle", () => {
	const handlers = register();
	const { calls, ctx } = createContext();

	emit(handlers, "session_start", ctx);
	assert.equal(typeof calls.editors.at(-1), "function");
	assert.equal(calls.visibility.at(-1), false);
	emit(handlers, "agent_start", ctx);
	assert.equal(calls.visibility.at(-1), true);
	assert.equal(typeof calls.messages.at(-1), "string");
	assert.ok(calls.indicators.at(-1));

	cleanup(handlers, ctx);
	assert.equal(calls.messages.at(-1), undefined);
	assert.equal(calls.indicators.at(-1), undefined);
	assert.equal(calls.visibility.at(-1), false);
});

test("shutdown invalidates the local generation before cleanup", () => {
	const handlers = register();
	const { calls, ctx } = createContext();

	emit(handlers, "session_start", ctx);
	emit(handlers, "agent_start", ctx);
	emit(handlers, "session_shutdown", ctx);
	const callCount = calls.visibility.length;
	emit(handlers, "agent_start", ctx);

	assert.equal(calls.messages.at(-1), undefined);
	assert.equal(calls.indicators.at(-1), undefined);
	assert.equal(calls.visibility.at(-1), false);
	assert.equal(calls.visibility.length, callCount);
});

test("terminal content supplies fallback tokens without double-counting deltas", () => {
	const handlers = register();
	const { calls, ctx } = createContext();
	emit(handlers, "session_start", ctx);
	emit(handlers, "agent_start", ctx);

	const content = [{ type: "text", text: "12345678" }];
	emit(handlers, "message_update", ctx, {
		message: assistantMessage(content),
		assistantMessageEvent: { type: "text_delta", delta: "12345678" },
	});
	assert.equal(latestTokens(calls), "2");
	emit(handlers, "message_update", ctx, {
		message: assistantMessage(content),
		assistantMessageEvent: { type: "text_end" },
	});
	assert.equal(latestTokens(calls), "2");
	cleanup(handlers, ctx);
});

test("terminal thinking and tool-call events estimate content when no delta arrived", () => {
	const handlers = register();
	const { calls, ctx } = createContext();
	emit(handlers, "session_start", ctx);
	emit(handlers, "agent_start", ctx);

	emit(handlers, "message_update", ctx, {
		message: assistantMessage([{ type: "thinking", thinking: "12345678" }]),
		assistantMessageEvent: { type: "thinking_end" },
	});
	assert.equal(latestTokens(calls), "2");
	emit(handlers, "message_update", ctx, {
		message: assistantMessage([{ type: "toolCall", arguments: { command: "12345678" } }]),
		assistantMessageEvent: { type: "toolcall_end" },
	});
	assert.ok(Number.parseFloat(latestTokens(calls)) >= 2);
	cleanup(handlers, ctx);
});

test("message updates render at most once per color frame", () => {
	const handlers = register();
	const { calls, ctx } = createContext();
	emit(handlers, "session_start", ctx);
	emit(handlers, "agent_start", ctx);
	const content = [{ type: "text", text: "hello" }];
	const event = { message: assistantMessage(content), assistantMessageEvent: { type: "text_end" } };
	emit(handlers, "message_update", ctx, event);
	const count = calls.messages.length;
	emit(handlers, "message_update", ctx, event);
	assert.equal(calls.messages.length, count);
	cleanup(handlers, ctx);
});

test("steering and follow-ups preserve totals while normal input resets them", () => {
	const handlers = register();
	const { calls, ctx } = createContext();
	emit(handlers, "session_start", ctx);
	emit(handlers, "agent_start", ctx);
	emit(handlers, "message_update", ctx, {
		message: assistantMessage([{ type: "text", text: "12345678" }]),
		assistantMessageEvent: { type: "text_delta", delta: "12345678" },
	});
	const tokens = latestTokens(calls);
	emit(handlers, "input", ctx, { streamingBehavior: "steer" });
	assert.equal(latestTokens(calls), tokens);
	emit(handlers, "input", ctx, { streamingBehavior: "followUp" });
	assert.equal(latestTokens(calls), tokens);
	emit(handlers, "input", ctx, { streamingBehavior: "prompt" });
	assert.equal(latestTokens(calls), "0");
	cleanup(handlers, ctx);
});

test("a newer runtime makes stale callbacks harmless", () => {
	const first = register();
	const firstContext = createContext();
	emit(first, "session_start", firstContext.ctx);
	emit(first, "agent_start", firstContext.ctx);

	const second = register();
	const secondContext = createContext();
	emit(second, "session_start", secondContext.ctx);
	const firstVisibilityCount = firstContext.calls.visibility.length;
	emit(first, "agent_start", firstContext.ctx);
	emit(first, "session_shutdown", firstContext.ctx);
	assert.equal(firstContext.calls.visibility.length, firstVisibilityCount);

	emit(second, "agent_start", secondContext.ctx);
	assert.equal(secondContext.calls.visibility.at(-1), true);
	cleanup(second, secondContext.ctx);
});

test("session shutdown clears the active indicator", () => {
	const handlers = register();
	const { calls, ctx } = createContext();
	emit(handlers, "session_start", ctx);
	emit(handlers, "agent_start", ctx);
	emit(handlers, "session_shutdown", ctx);

	assert.equal(calls.messages.at(-1), undefined);
	assert.equal(calls.indicators.at(-1), undefined);
	assert.equal(calls.visibility.at(-1), false);
});

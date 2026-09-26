import assert from "node:assert/strict";
import { test } from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import askUser from "../ask-user.ts";

const CHAT_LABEL = "Let's chat about this";
const question = {
	question: "Which approach?",
	options: [{ label: "First" }, { label: "Second" }],
};

function tool() {
	let registered!: Parameters<ExtensionAPI["registerTool"]>[0];
	askUser({ registerTool: (definition) => { registered = definition; } } as ExtensionAPI);
	return registered;
}

function tui(screens: string[][]): ExtensionContext {
	return {
		hasUI: true,
		mode: "tui",
		ui: {
			custom: async (factory: (
				tui: unknown,
				theme: unknown,
				kb: unknown,
				done: (value: unknown) => void,
			) => { render(width: number): string[]; handleInput(data: string): void }) => {
				const keys = screens.shift();
				assert.ok(keys, "unexpected picker");
				let settled = false;
				let result: unknown;
				const component = factory(
					{ requestRender() {} },
					{ fg: (_color: string, text: string) => text, bg: (_color: string, text: string) => text, bold: (text: string) => text },
					undefined,
					(value: unknown) => { settled = true; result = value; },
				);
				assert.ok(component.render(80).some((line: string) => line.includes(CHAT_LABEL)));
				for (const key of keys) {
					assert.equal(settled, false, "picker closed before the last key");
					component.handleInput(key);
				}
				assert.equal(settled, true, "picker did not close");
				return result;
			},
		},
	} as unknown as ExtensionContext;
}

function execute(ctx: ExtensionContext, questions: (typeof question & { multiple?: boolean })[] = [question]) {
	return tool().execute("test", { questions }, undefined, undefined, ctx);
}

function assertChat(result: Awaited<ReturnType<typeof execute>>) {
	assert.equal(result.terminate, undefined);
	assert.deepEqual(result.details, { answers: [], cancelled: false, chat: true });
	const text = result.content[0].type === "text" ? result.content[0].text : "";
	assert.match(text, /Briefly restate the question and invite discussion in prose, then wait for their reply/);
	assert.match(text, /Do not pick a default, continue the task, or reopen the picker/);
}

for (const multiple of [false, true]) {
	for (const keys of [["4"], ["up", "enter"], ["up", "tab", "enter"]]) {
		test(`chat exits ${multiple ? "multi" : "single"}-select via ${keys.join(", ")}`, async () => {
			assertChat(await execute(tui([keys]), [{ ...question, multiple }]));
		});
	}
}

test("chat exits multi-select with space and discards checked options", async () => {
	assertChat(await execute(tui([["1", "down", "down", "down", "space"]]), [{ ...question, multiple: true }]));
});

test("chat discards earlier answers and skips remaining questions and confirmation", async () => {
	const current = { ...question, question: "Which database?" };
	const result = await execute(tui([["1"], ["4"]]), [question, current, question]);
	assertChat(result);
	assert.match(result.content[0].type === "text" ? result.content[0].text : "", /Discuss: Which database\?$/);
});

test("chat is available at confirmation", async () => {
	const second = { ...question, question: "Which database?" };
	const result = await execute(tui([["1"], ["1"], ["4"]]), [question, second]);
	assertChat(result);
	assert.match(result.content[0].type === "text" ? result.content[0].text : "", /Discuss: Which approach\?\nWhich database\?$/);
});

test("chat is available while re-answering", async () => {
	assertChat(await execute(tui([["1"], ["2"], ["4"]])));
});

test("simple picker filters model-supplied chat options and returns chat", async () => {
	const ctx = {
		hasUI: true,
		mode: "rpc",
		ui: {
			select: async (_title: string, options: string[]) => {
				assert.deepEqual(options, ["First", "Second", "Other (specify)", CHAT_LABEL]);
				return CHAT_LABEL;
			},
		},
	} as unknown as ExtensionContext;
	assertChat(await execute(ctx, [{
		...question,
		options: [...question.options, { label: CHAT_LABEL }, { label: " Let’s chat about this " }],
	}]));
});

test("simple multi-select gives chat priority over other choices", async () => {
	const ctx = {
		hasUI: true,
		mode: "rpc",
		ui: {
			input: async (_title: string, placeholder: string) => {
				assert.ok(placeholder.includes(`4. ${CHAT_LABEL}`));
				return "1,3,4";
			},
		},
	} as unknown as ExtensionContext;
	assertChat(await execute(ctx, [{ ...question, multiple: true }]));
});

test("simple confirmation offers chat", async () => {
	const replies = ["First", CHAT_LABEL];
	const ctx = {
		hasUI: true,
		mode: "rpc",
		ui: {
			select: async (_title: string, options: string[]) => {
				assert.ok(options.includes(CHAT_LABEL));
				return replies.shift();
			},
		},
	} as unknown as ExtensionContext;
	assertChat(await execute(ctx));
	assert.deepEqual(replies, []);
});

test("normal answers still require confirmation and do not terminate", async () => {
	const result = await execute(tui([["1"], ["1"]]));
	assert.equal(result.terminate, undefined);
	assert.deepEqual(result.details, {
		answers: [{ question: question.question, selected: { label: "First", description: undefined, index: 0, context: undefined } }],
		cancelled: false,
	});
});

test("Other still accepts a written answer", async () => {
	const result = await execute(tui([["3", "h", "i", "enter"], ["1"]]));
	assert.equal(result.terminate, undefined);
	assert.deepEqual(result.details, {
		answers: [{ question: question.question, selected: { other: "hi" } }],
		cancelled: false,
	});
});

test("escape remains cancellation rather than chat", async () => {
	const result = await execute(tui([["escape"]]));
	assert.equal(result.terminate, undefined);
	assert.deepEqual(result.details, { answers: [], cancelled: true });
});

test("non-interactive mode still rejects the picker", async () => {
	await assert.rejects(execute({ hasUI: false } as ExtensionContext), /Cannot show interactive pickers/);
});

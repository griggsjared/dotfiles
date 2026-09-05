import { uuidv7, type AssistantMessage, type Message } from "@earendil-works/pi-ai";
import { complete as completeLlm } from "@earendil-works/pi-ai/compat";
import {
	AssistantMessageComponent,
	buildSessionContext,
	convertToLlm,
	CustomEditor,
	getMarkdownTheme,
	type ExtensionAPI,
	UserMessageComponent,
} from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const SYSTEM_PROMPT =
	"You are answering a side question about the current conversation. Answer the question directly and concisely. Do not continue the main task, call tools, or propose changes unless the question explicitly asks for them.";

type Operation = {
	controller: AbortController;
	generation: number;
	close?: () => void;
};

type Turn = { question: string; answer: AssistantMessage };

function answerLines(turns: Turn[], width: number, pendingQuestion?: string): string[] {
	const lines: string[] = [];
	const markdownTheme = getMarkdownTheme();
	for (const turn of turns) {
		// Reuse Pi's native message components: user rows use userMessageBg and
		// outputPad=1, while assistant rows retain the normal unboxed stream style.
		lines.push("");
		lines.push(...new UserMessageComponent(turn.question, markdownTheme, 1).render(width));
		lines.push(...new AssistantMessageComponent(turn.answer, false, markdownTheme, "Thinking...", 1).render(width));
	}
	if (pendingQuestion !== undefined) {
		lines.push("");
		lines.push(...new UserMessageComponent(pendingQuestion, markdownTheme, 1).render(width));
	}
	return lines;
}

function boxed(lines: string[], width: number, theme: { fg(color: string, text: string): string }, title: string): string[] {
	if (width < 3) return lines.map((line) => truncateToWidth(line, Math.max(1, width), "", true));
	const innerWidth = width - 2;
	const border = (text: string) => theme.fg("border", text);
	const titleText = truncateToWidth(` ${title} `, innerWidth, "", true);
	const left = "─".repeat(Math.max(0, Math.floor((innerWidth - visibleWidth(titleText)) / 2)));
	const right = "─".repeat(Math.max(0, innerWidth - visibleWidth(titleText) - left.length));
	const output = [border(`╭${left}`) + theme.fg("accent", titleText) + border(`${right}╮`)];
	for (const line of lines) {
		const clipped = truncateToWidth(line, innerWidth, "", true);
		output.push(`${border("│")}${clipped}${" ".repeat(Math.max(0, innerWidth - visibleWidth(clipped)))}${border("│")}`);
	}
	output.push(border(`╰${"─".repeat(innerWidth)}╯`));
	return output;
}

export default function (pi: ExtensionAPI) {
	let active: Operation | undefined;
	let generation = 0;

	const cancel = () => {
		const operation = active;
		if (!operation) return;
		generation++;
		operation.controller.abort();
		operation.close?.();
	};

	pi.on("session_shutdown", () => cancel());

	pi.registerCommand("btw", {
		description: "Ask a private side question without interrupting the main task",
		handler: async (args, ctx) => {
			const question = args.trim();
			if (ctx.mode !== "tui") {
				ctx.ui.notify("btw requires interactive mode", "error");
				return;
			}
			if (ctx.model === undefined && question) {
				ctx.ui.notify("No model selected", "error");
				return;
			}
			if (active) {
				ctx.ui.notify("A /btw question is already in progress", "error");
				return;
			}

			const model = ctx.model;
			const snapshot = buildSessionContext(ctx.sessionManager.getEntries(), ctx.sessionManager.getLeafId());
			const messages: Message[] = [...convertToLlm(snapshot.messages)];
			const operation: Operation = { controller: new AbortController(), generation: ++generation };
			active = operation;
			let error: unknown;

			try {
				const result = await ctx.ui.custom<string | null>(
					(tui, theme, keybindings, done) => {
						let settled = false;
						let disposed = false;
						let loading = question.length > 0;
						let pendingQuestion: string | undefined = question || undefined;
						let scrollTop = 0;
						let contentWidth = 1;
						let viewportRows = 1;
						const turns: Turn[] = [];
						let auth: Awaited<ReturnType<typeof ctx.modelRegistry.getApiKeyAndHeaders>> | undefined;

						const finish = (value: string | null) => {
							if (settled) return;
							settled = true;
							done(value);
						};
						const close = () => {
							operation.controller.abort();
							finish(null);
						};
						const fail = (caught: unknown) => {
							if (!operation.controller.signal.aborted && active === operation) error = caught;
							close();
						};
						let failureScheduled = false;
						const scheduleFail = (caught: unknown) => {
							if (failureScheduled || settled) return;
							failureScheduled = true;
							queueMicrotask(() => {
								failureScheduled = false;
								if (!settled) fail(caught);
							});
						};
						const startLoading = (nextQuestion: string) => {
							pendingQuestion = nextQuestion;
							loading = true;
							tui.requestRender();
						};

						operation.close = close;
						operation.controller.signal.addEventListener("abort", () => finish(null), { once: true });

						const editorTheme = {
							borderColor: (text: string) => theme.fg("borderMuted", text),
							selectList: {
								selectedPrefix: (text: string) => theme.fg("accent", text),
								selectedText: (text: string) => theme.fg("accent", text),
								description: (text: string) => theme.fg("muted", text),
								scrollInfo: (text: string) => theme.fg("muted", text),
								noMatch: (text: string) => theme.fg("muted", text),
							},
						};
						const replyInput = new CustomEditor(tui, editorTheme, keybindings, { paddingX: 1 });
						replyInput.onSubmit = (value) => {
							const reply = value.trim();
							if (!reply || loading) return;
							replyInput.setText("");
							startLoading(reply);
							request(reply).catch(fail);
						};
						replyInput.focused = true;

						const request = async (nextQuestion: string) => {
							if (!model) throw new Error("No model selected");
							if (!auth) {
								auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
								if (!auth.ok) throw new Error(auth.error);
							}
							if (
								operation.controller.signal.aborted ||
								active !== operation ||
								operation.generation !== generation
							) return;
							messages.push({ role: "user", content: [{ type: "text", text: nextQuestion }], timestamp: Date.now() });
							const resolvedAuth = auth;
							if (!resolvedAuth || !resolvedAuth.ok) throw new Error(resolvedAuth?.error ?? "Authentication unavailable");
							const response = await completeLlm(
								model,
								{ systemPrompt: SYSTEM_PROMPT, messages },
								{
									signal: operation.controller.signal,
									apiKey: resolvedAuth.apiKey,
									headers: resolvedAuth.headers,
									env: resolvedAuth.env,
									cacheRetention: "none",
									sessionId: uuidv7(),
								},
							);
							if (response.stopReason === "aborted") {
								close();
								return;
							}
							if (
								operation.controller.signal.aborted ||
								active !== operation ||
								operation.generation !== generation
							) return;
							if (response.stopReason === "error") throw new Error(response.errorMessage ?? "Model request failed");
							messages.push(response);
							turns.push({ question: nextQuestion, answer: response });
							loading = false;
							pendingQuestion = undefined;
							scrollTop = Number.MAX_SAFE_INTEGER;
							tui.requestRender();
						};

						if (question) request(question).catch(fail);

						return {
							render: (width: number) => {
								if (disposed) return [];
								const maxWidth = Math.max(1, Math.floor(width));
								const innerWidth = Math.max(1, maxWidth - 2);
								contentWidth = innerWidth;
								viewportRows = Math.max(1, tui.terminal.rows - (loading ? 7 : 6));
								try {
									const body = answerLines(turns, innerWidth, loading ? pendingQuestion : undefined);
									const maxScroll = Math.max(0, body.length - viewportRows);
									scrollTop = Math.min(maxScroll, Math.max(0, scrollTop));
									const visible = body.slice(scrollTop, scrollTop + viewportRows);
									const lines = [...visible];
									lines.push(...replyInput.render(innerWidth));
									if (loading) lines.push(theme.fg("dim", "Thinking…"));
									lines.push(theme.fg("dim", loading ? "Esc close" : "PgUp/PgDn scroll · Enter send · Esc close"));
									return boxed(lines, maxWidth, theme, "btw");
								} catch (caught) {
									scheduleFail(caught);
									return [];
								}
							},
							invalidate: () => {
								replyInput?.invalidate();
							},
							handleInput: (data: string) => {
								if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
									close();
									return;
								}
								if (matchesKey(data, Key.pageUp) || matchesKey(data, Key.pageDown)) {
									try {
										const bodyLength = answerLines(turns, contentWidth).length;
										const page = viewportRows;
										scrollTop += matchesKey(data, Key.pageUp) ? -page : page;
										const maxScroll = Math.max(0, bodyLength - page);
										scrollTop = Math.min(maxScroll, Math.max(0, scrollTop));
									} catch (caught) {
										scheduleFail(caught);
									}
									tui.requestRender();
									return;
								}
								replyInput.handleInput(data);
								tui.requestRender();
							},
							dispose: () => {
								disposed = true;
								operation.controller.abort();
							},
						};
					},
					{ overlay: true, overlayOptions: { anchor: "center", width: "100%", minWidth: 60, maxHeight: "100%", margin: 1 } },
				);

				if (result === null && error) ctx.ui.notify("btw request failed", "error");
			} finally {
				if (active === operation) active = undefined;
			}
		},
	});
}

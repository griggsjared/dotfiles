import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { DynamicBorder } from "@earendil-works/pi-coding-agent";
import {
	Container,
	getKeybindings,
	type SelectItem,
	Text,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { Type } from "typebox";

const OTHER_VALUE = "__other__";
const DONE_VALUE = "__done__";
const MAX_QUESTIONS = 4;
const MAX_OPTIONS = 4;
const MIN_OPTIONS = 2;

const OptionParams = Type.Object({
	label: Type.String({ description: "Option label shown in the picker" }),
	description: Type.Optional(
		Type.String({ description: "One-line explanation shown under the label" }),
	),
});

const QuestionParams = Type.Object({
	question: Type.String({ description: "The question to ask the user" }),
	title: Type.Optional(
		Type.String({ description: "Optional short title shown above the question" }),
	),
	description: Type.Optional(
		Type.String({ description: "Optional extra context shown under the question" }),
	),
	options: Type.Array(OptionParams, {
		minItems: MIN_OPTIONS,
		maxItems: MAX_OPTIONS,
		description: `${MIN_OPTIONS}-${MAX_OPTIONS} options`,
	}),
	multiple: Type.Optional(
		Type.Boolean({
			default: false,
			description: "Allow selecting multiple options (checkboxes)",
		}),
	),
	allowOther: Type.Optional(
		Type.Boolean({
			default: true,
			description:
				"Show the 'Other (specify)' free-text fallback (on by default) — set false when the options are exhaustive",
		}),
	),
});

const AskUserParams = Type.Object({
	questions: Type.Array(QuestionParams, {
		minItems: 1,
		maxItems: MAX_QUESTIONS,
		description: `1-${MAX_QUESTIONS} questions asked in order`,
	}),
});

type MultiSelected = {
	items: { label: string; description?: string; index: number }[];
	other?: string;
};

type Selected =
	| { label: string; description?: string; index: number }
	| { other: string }
	| MultiSelected;

type Answer = { question: string; selected: Selected };

type InitialState = { values?: string[]; otherText?: string };

type PickResult =
	| { kind: "item"; item: SelectItem }
	| { kind: "other"; text: string }
	| { kind: "multi"; values: string[]; otherToggled: boolean; otherText?: string };

interface UiLike {
	select(title: string, options: string[], opts?: { signal?: AbortSignal }): Promise<string | undefined>;
	input(title: string, placeholder?: string, opts?: { signal?: AbortSignal }): Promise<string | undefined>;
}

function buildItems(question: {
	options: { label: string; description?: string }[];
	allowOther?: boolean;
}): SelectItem[] {
	const items: SelectItem[] = question.options.map((option, index) => ({
		value: String(index),
		label: option.label,
		description: option.description,
	}));
	if (question.allowOther !== false) {
		items.push({
			value: OTHER_VALUE,
			label: "Other (specify)",
			description: "Type a custom answer",
		});
	}
	return items;
}

function titleFor(question: { title?: string; question: string }): string {
	return question.title ? `${question.title} — ${question.question}` : question.question;
}

function pickSimple(
	ui: UiLike,
	question: { title?: string; description?: string; question: string },
	items: SelectItem[],
	signal?: AbortSignal,
): Promise<PickResult | null> {
	return ui.select(titleFor(question), items.map((item) => item.label), { signal }).then(
		(picked) => {
			if (picked === undefined) return null;
			const item = items.find((item) => item.label === picked);
			return item ? { kind: "item", item } : null;
		},
	);
}

function pickMultiSimple(
	ui: UiLike,
	question: { title?: string; description?: string; question: string },
	items: SelectItem[],
	signal?: AbortSignal,
): Promise<PickResult | null> {
	const numbered = items.map(
		(item, index) => `${index + 1}. ${item.label}${item.description ? ` — ${item.description}` : ""}`,
	);
	const placeholder = `numbers, e.g. 1,3 · ${numbered.join(" · ")}`;
	return ui
		.input(`${titleFor(question)} (multi-select)`, placeholder, { signal })
		.then((raw) => {
			if (raw === undefined) return null;
			const values = new Set<string>();
			for (const part of raw.split(/[,\s]+/)) {
				const n = Number(part);
				if (Number.isInteger(n) && n >= 1 && n <= items.length) {
					values.add(items[n - 1]!.value);
				}
			}
			return {
				kind: "multi",
				values: [...values],
				otherToggled: values.has(OTHER_VALUE),
			};
		});
}

interface TuiLike {
	ui: UiLike & {
		custom<T>(
			cb: (
				tui: { requestRender(): void },
				theme: {
					fg(color: string, text: string): string;
					bold(text: string): string;
					bg(color: string, text: string): string;
				},
				kb: unknown,
				done: (value: T) => void,
			) => { render(w: number): string[]; invalidate(): void; handleInput(data: string): void },
		): Promise<T>;
	};
}

interface MultiLineListTheme {
	selectedText: (text: string) => string;
	selectedBg: (text: string) => string;
	description: (text: string) => string;
	scrollInfo: (text: string) => string;
}

function listTheme(theme: {
	fg(color: string, text: string): string;
	bold(text: string): string;
	bg(color: string, text: string): string;
}): MultiLineListTheme {
	return {
		selectedText: (t) => theme.fg("accent", theme.bold(t)),
		selectedBg: (t) => theme.bg("selectedBg", t),
		description: (t) => theme.fg("muted", t),
		scrollInfo: (t) => theme.fg("dim", t),
	};
}

// SelectList renders label and description on one line; this variant stacks each
// description on its own line beneath the label so long descriptions wrap
// instead of truncating next to the label.
class MultiLineSelectList {
	private items: SelectItem[];
	private selectedIndex: number;
	private maxVisible: number;
	private theme: MultiLineListTheme;
	private descriptionIndent: number;
	onSelect?: (item: SelectItem) => void;
	onCancel?: () => void;
	onSelectionChange?: (item: SelectItem) => void;

	constructor(
		items: SelectItem[],
		maxVisible: number,
		theme: MultiLineListTheme,
		descriptionIndent = 2,
	) {
		this.items = items;
		this.selectedIndex = 0;
		this.maxVisible = maxVisible;
		this.theme = theme;
		this.descriptionIndent = descriptionIndent;
	}

	setSelectedIndex(index: number): void {
		this.selectedIndex = Math.max(0, Math.min(index, this.items.length - 1));
	}

	getSelectedItem(): SelectItem | null {
		return this.items[this.selectedIndex] ?? null;
	}

	invalidate(): void {}

	handleInput(keyData: string): void {
		const kb = getKeybindings();
		if (kb.matches(keyData, "tui.select.up") || keyData === "up") {
			this.selectedIndex =
				this.selectedIndex === 0 ? this.items.length - 1 : this.selectedIndex - 1;
			this.notifySelectionChange();
		} else if (kb.matches(keyData, "tui.select.down") || keyData === "down") {
			this.selectedIndex =
				this.selectedIndex === this.items.length - 1 ? 0 : this.selectedIndex + 1;
			this.notifySelectionChange();
		} else if (
			kb.matches(keyData, "tui.select.confirm") ||
			keyData === "\n" ||
			keyData === "enter" ||
			keyData === "\r"
		) {
			const item = this.items[this.selectedIndex];
			if (item && this.onSelect) this.onSelect(item);
		} else if (kb.matches(keyData, "tui.select.cancel") || keyData === "escape" || keyData === "ctrl+c") {
			if (this.onCancel) this.onCancel();
		}
	}

	private notifySelectionChange(): void {
		const item = this.items[this.selectedIndex];
		if (item && this.onSelectionChange) this.onSelectionChange(item);
	}

	render(width: number): string[] {
		const startIndex = Math.max(
			0,
			Math.min(
				this.selectedIndex - Math.floor(this.maxVisible / 2),
				this.items.length - this.maxVisible,
			),
		);
		const endIndex = Math.min(startIndex + this.maxVisible, this.items.length);
		const lines: string[] = [];
		const labelWidth = Math.max(1, width - 2);
		for (let index = startIndex; index < endIndex; index++) {
			const item = this.items[index];
			if (!item) continue;
			const selected = index === this.selectedIndex;
			const label = truncateToWidth(item.label, labelWidth, "");
			const row = `${selected ? "→ " : "  "}${label}`;
			const padded = row + " ".repeat(Math.max(0, width - visibleWidth(row)));
			lines.push(selected ? this.theme.selectedBg(this.theme.selectedText(padded)) : padded);
			if (item.description) {
				for (const line of wrapTextWithAnsi(
					item.description,
					Math.max(1, labelWidth - this.descriptionIndent),
				)) {
					lines.push(" ".repeat(this.descriptionIndent) + this.theme.description(line));
				}
			}
		}
		if (startIndex > 0 || endIndex < this.items.length) {
			const scrollText = `  (${this.selectedIndex + 1}/${this.items.length})`;
			lines.push(this.theme.scrollInfo(truncateToWidth(scrollText, width - 2, "")));
		}
		return lines;
	}
}

function pickTui(
	ctx: TuiLike,
	question: { title?: string; description?: string; question: string },
	items: SelectItem[],
	signal?: AbortSignal,
	initial?: InitialState,
): Promise<PickResult | null> {
	return ctx.ui.custom<PickResult | null>((tui, theme, _kb, done) => {
		const container = new Container();
		container.addChild(new DynamicBorder((s: string) => theme.fg("borderAccent", s)));
		if (question.title) {
			container.addChild(new Text(theme.fg("accent", theme.bold(question.title)), 1, 0));
		}
		container.addChild(new Text(theme.fg("text", question.question), 1, 0));
		if (question.description) {
			container.addChild(new Text(theme.fg("muted", question.description), 1, 0));
		}
		let typing = false;
		let otherText = "";
		const kb = getKeybindings();
		const otherInput = new Text("", 1, 0);
		const updateOtherInput = () => {
			otherInput.setText(
				typing
					? theme.fg("accent", theme.bold("Other: ")) +
							theme.fg("toolOutput", otherText) +
							theme.fg("warning", "▏")
					: "",
			);
			tui.requestRender();
		};
		const beginTyping = () => {
			otherText = typing ? otherText : initial?.otherText ?? "";
			typing = true;
			updateOtherInput();
		};
		const selectList = new MultiLineSelectList(
			initial?.otherText
				? items.map((item) =>
						item.value === OTHER_VALUE
							? { ...item, description: initial.otherText }
							: item,
					)
				: items,
			Math.min(items.length, 10),
			listTheme(theme),
		);
		selectList.setSelectedIndex(
			Math.max(0, items.findIndex((item) => item.value === initial?.values?.[0])),
		);
		selectList.onSelect = (item) => {
			if (item.value === OTHER_VALUE) {
				beginTyping();
				return;
			}
			done({ kind: "item", item });
		};
		selectList.onCancel = () => done(null);
		container.addChild(selectList);
		container.addChild(otherInput);
		container.addChild(
			new Text(theme.fg("dim", "↑↓ navigate • 1-9 select • enter confirm • esc cancel"), 1, 0),
		);
		container.addChild(new DynamicBorder((s: string) => theme.fg("borderAccent", s)));
		signal?.addEventListener("abort", () => done(null), { once: true });
		return {
			render: (w) => container.render(w),
			invalidate: () => container.invalidate(),
			handleInput: (data) => {
				if (typing) {
					if (kb.matches(data, "tui.select.cancel") || data === "escape" || data === "ctrl+c") {
						typing = false;
						otherText = "";
						updateOtherInput();
					} else if (kb.matches(data, "tui.select.confirm") || data === "\n" || data === "enter" || data === "\r") {
						if (otherText.trim()) {
							done({ kind: "other", text: otherText.trim() });
						} else {
							typing = false;
							updateOtherInput();
						}
					} else if (data === "backspace" || data === "\u007f") {
						otherText = otherText.slice(0, -1);
						updateOtherInput();
					} else if (data === "space") {
						otherText += " ";
						updateOtherInput();
					} else if (data.length === 1 && data >= " ") {
						otherText += data;
						updateOtherInput();
					}
					return;
				}
				if (/^[1-9]$/.test(data)) {
					const item = items[Number(data) - 1];
					if (item) {
						if (item.value === OTHER_VALUE) {
							beginTyping();
							return;
						}
						done({ kind: "item", item });
						return;
					}
				}
				selectList.handleInput(data);
				tui.requestRender();
			},
		};
	});
}

function pickMultiTui(
	ctx: TuiLike,
	question: { title?: string; description?: string; question: string },
	items: SelectItem[],
	signal?: AbortSignal,
	initial?: InitialState,
): Promise<PickResult | null> {
	return ctx.ui.custom<PickResult | null>((tui, theme, _kb, done) => {
		const container = new Container();
		container.addChild(new DynamicBorder((s: string) => theme.fg("borderAccent", s)));
		if (question.title) {
			container.addChild(new Text(theme.fg("accent", theme.bold(question.title)), 1, 0));
		}
		container.addChild(new Text(theme.fg("text", question.question), 1, 0));
		if (question.description) {
			container.addChild(new Text(theme.fg("muted", question.description), 1, 0));
		}
		const selected = new Set<string>(initial?.values ?? []);
		let listHolder: MultiLineSelectList;
		let cursor = 0;
		let typing = false;
		let otherText = "";
		let committedOtherText = initial?.otherText ?? "";
		const kb = getKeybindings();
		const otherInput = new Text("", 1, 0);
		const updateOtherInput = () => {
			otherInput.setText(
				typing
					? theme.fg("accent", theme.bold("Other: ")) +
							theme.fg("toolOutput", otherText) +
							theme.fg("warning", "▏")
					: "",
			);
			tui.requestRender();
		};
		const listItems = (): SelectItem[] => [
			...items.map((item) => ({
				...item,
				label: selected.has(item.value)
					? `${theme.fg("success", "✓")} ${item.label}`
					: `  ${item.label}`,
				description:
					item.value === OTHER_VALUE && selected.has(OTHER_VALUE)
						? committedOtherText
						: item.description,
			})),
			...(selected.size > 0
				? [{ value: DONE_VALUE, label: "  Done", description: "Confirm selection" }]
				: []),
		];
		const replaceList = (from: MultiLineSelectList, next: MultiLineSelectList) => {
			const index = container.children.indexOf(from);
			container.removeChild(from);
			if (index !== -1) container.children.splice(index, 0, next);
			else container.addChild(next);
		};
		const makeList = (): MultiLineSelectList => {
			const selectList = new MultiLineSelectList(
				listItems(),
				Math.min(items.length + 1, 10),
				listTheme(theme),
				4,
			);
			selectList.setSelectedIndex(Math.min(cursor, items.length));
			selectList.onSelectionChange = (item) => {
				cursor = listItems().findIndex((i) => i.value === item.value);
			};
			selectList.onSelect = (item) => {
				if (item.value === DONE_VALUE) {
					done({
						kind: "multi",
						values: [...selected],
						otherToggled: selected.has(OTHER_VALUE),
						otherText: selected.has(OTHER_VALUE) ? committedOtherText : undefined,
					});
					return;
				}
				toggle(item.value);
			};
			selectList.onCancel = () => done(null);
			listHolder = selectList;
			return selectList;
		};
		const rebuild = () => {
			const current = listHolder;
			replaceList(current, makeList());
			tui.requestRender();
		};
		const toggle = (value: string) => {
			if (value === OTHER_VALUE) {
				otherText = selected.has(OTHER_VALUE) ? committedOtherText : initial?.otherText ?? "";
				typing = true;
				cursor = listItems().findIndex((i) => i.value === value);
				updateOtherInput();
				return;
			}
			if (selected.has(value)) {
				selected.delete(value);
			} else {
				selected.add(value);
			}
			cursor = listItems().findIndex((i) => i.value === value);
			rebuild();
		};
		container.addChild(makeList());
		container.addChild(otherInput);
		container.addChild(
			new Text(theme.fg("dim", "↑↓ navigate • 1-9 toggle • enter/space toggle • done confirms • esc cancel"), 1, 0),
		);
		container.addChild(new DynamicBorder((s: string) => theme.fg("borderAccent", s)));
		signal?.addEventListener("abort", () => done(null), { once: true });
		return {
			render: (w) => container.render(w),
			invalidate: () => container.invalidate(),
			handleInput: (data) => {
				if (typing) {
					if (kb.matches(data, "tui.select.cancel") || data === "escape" || data === "ctrl+c") {
						typing = false;
						otherText = selected.has(OTHER_VALUE) ? committedOtherText : "";
						updateOtherInput();
					} else if (kb.matches(data, "tui.select.confirm") || data === "\n" || data === "enter" || data === "\r") {
						if (otherText.trim()) {
							selected.add(OTHER_VALUE);
							committedOtherText = otherText;
							typing = false;
							cursor = listItems().findIndex((i) => i.value === OTHER_VALUE);
							rebuild();
							updateOtherInput();
						} else {
							selected.delete(OTHER_VALUE);
							committedOtherText = "";
							otherText = "";
							typing = false;
							updateOtherInput();
							rebuild();
						}
					} else if (data === "backspace" || data === "\u007f") {
						otherText = otherText.slice(0, -1);
						updateOtherInput();
					} else if (data === "space") {
						otherText += " ";
						updateOtherInput();
					} else if (data.length === 1 && data >= " ") {
						otherText += data;
						updateOtherInput();
					}
					return;
				}
				if (data === "space") {
					const item = listHolder.getSelectedItem();
					if (item && item.value !== DONE_VALUE) {
						toggle(item.value);
					}
					return;
				}
				if (/^[1-9]$/.test(data)) {
					const item = listItems()[Number(data) - 1];
					if (item) {
						if (item.value === DONE_VALUE) {
							done({
								kind: "multi",
								values: [...selected],
								otherToggled: selected.has(OTHER_VALUE),
								otherText: selected.has(OTHER_VALUE) ? committedOtherText : undefined,
							});
							return;
						}
						toggle(item.value);
						return;
					}
				}
				listHolder.handleInput(data);
				tui.requestRender();
			},
		};
	});
}

function pickConfirmTui(
	ctx: TuiLike,
	summary: string[],
	items: SelectItem[],
	signal?: AbortSignal,
): Promise<SelectItem | null> {
	return ctx.ui.custom<SelectItem | null>((tui, theme, _kb, done) => {
		const container = new Container();
		container.addChild(new DynamicBorder((s: string) => theme.fg("borderAccent", s)));
		container.addChild(new Text(theme.fg("accent", theme.bold("Confirm answers")), 1, 0));
		for (const line of summary) {
			container.addChild(new Text(theme.fg("muted", line), 1, 0));
		}
		const selectList = new MultiLineSelectList(items, Math.min(items.length, 10), listTheme(theme));
		selectList.onSelect = (item) => done(item);
		selectList.onCancel = () => done(null);
		container.addChild(selectList);
		container.addChild(
			new Text(theme.fg("dim", "↑↓ navigate • 1-9 select • enter confirm • esc cancel"), 1, 0),
		);
		container.addChild(new DynamicBorder((s: string) => theme.fg("borderAccent", s)));
		signal?.addEventListener("abort", () => done(null), { once: true });
		return {
			render: (w) => container.render(w),
			invalidate: () => container.invalidate(),
			handleInput: (data) => {
				if (/^[1-9]$/.test(data)) {
					const item = items[Number(data) - 1];
					if (item) {
						done(item);
						return;
					}
				}
				selectList.handleInput(data);
				tui.requestRender();
			},
		};
	});
}

async function pickConfirmSimple(
	ui: UiLike,
	options: string[],
	signal?: AbortSignal,
): Promise<number | null> {
	const picked = await ui.select("Confirm answers", options, { signal });
	if (picked === undefined) return null;
	const index = options.indexOf(picked);
	return index === -1 ? null : index;
}

async function confirmAnswers(
	ctx: TuiLike & { mode: string },
	summary: string[],
	items: SelectItem[],
	signal?: AbortSignal,
): Promise<number | null> {
	if (ctx.mode === "tui") {
		const picked = await pickConfirmTui(ctx, summary, items, signal);
		if (picked === null) return null;
		return items.findIndex((item) => item.value === picked.value);
	}
	const options = [
		"Confirm answers",
		...Array.from({ length: items.length - 1 }, (_, index) => `Re-answer question ${index + 1}`),
	];
	return pickConfirmSimple(ctx.ui, options, signal);
}

function choiceText(selected: Selected): string {
	if ("label" in selected) return selected.label;
	if ("items" in selected) {
		const parts = selected.items.map((item) => item.label);
		if (selected.other) parts.push(`Other: ${selected.other}`);
		return parts.join(", ");
	}
	return `Other: ${selected.other}`;
}

function formatAnswers(answers: Answer[], cancelled: boolean): string {
	if (answers.length === 0) {
		return cancelled ? "User cancelled without answering any question." : "(no answers)";
	}
	const lines = answers.map(
		(answer, index) => `${index + 1}. ${answer.question}\n   → ${choiceText(answer.selected)}`,
	);
	if (cancelled) lines.push("(user cancelled — answers not confirmed)");
	return lines.join("\n");
}

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "ask_user",
		label: "Ask User",
		description:
			"Ask the user multiple-choice questions when the task needs direction or clarification. Renders an interactive picker in the TUI (single-select or multi-select), then a confirmation step with per-question re-answer, and returns the chosen options, or free text via the 'Other (specify)' fallback. Up to 4 questions per call, 2-4 options each.",
		promptSnippet: "Ask the user multiple-choice questions when direction is needed",
		promptGuidelines: [
			"When the task needs direction — ambiguous requirements, multiple valid approaches, or choices with trade-offs — ask the user with ask_user instead of guessing or asking in prose.",
			"One decision per question: keep questions and option labels short, and add a one-line description to each option when it clarifies the trade-off.",
			"Limit to 4 questions per call and 2-4 options per question. Set multiple when several options can apply at once (e.g. 'which features?'). 'Other (specify)' is on by default — set allowOther: false only when the options are exhaustive.",
			"If the user cancels, ask in prose or proceed with the most reasonable default and state your assumption.",
		],
		parameters: AskUserParams,
		renderCall(args, theme, _context) {
			const questionCount = (args.questions ?? []).length;
			return new Text(
				theme.fg("toolTitle", theme.bold("ask_user ")) +
					theme.fg("muted", `${questionCount} question${questionCount > 1 ? "s" : ""}`),
				0,
				0,
			);
		},

		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			if (!ctx.hasUI) {
				throw new Error(
					"Cannot show interactive pickers in this mode. Ask the user in prose or proceed with the most reasonable default and state your assumption.",
				);
			}
			const answers: Answer[] = [];
			let cancelled = false;
			const askOne = async (
				question: (typeof params.questions)[number],
				previous?: Answer,
			): Promise<Answer | null> => {
				const initial: InitialState | undefined = previous
					? "items" in previous.selected
						? {
								values: [
									...previous.selected.items.map((item) => String(item.index)),
									...(previous.selected.other ? [OTHER_VALUE] : []),
								],
								otherText: previous.selected.other,
							}
						: "other" in previous.selected
							? { otherText: previous.selected.other }
							: { values: [String(previous.selected.index)] }
					: undefined;
				const items = buildItems(question);
				const result =
					ctx.mode === "tui"
						? question.multiple
							? await pickMultiTui(ctx, question, items, signal, initial)
							: await pickTui(ctx, question, items, signal, initial)
						: question.multiple
							? await pickMultiSimple(ctx.ui, question, items, signal)
							: await pickSimple(ctx.ui, question, items, signal);
				if (result === null) return null;
				if (result.kind === "multi") {
					const otherToggled = result.values.includes(OTHER_VALUE);
					const multi: MultiSelected = {
						items: result.values
							.filter((value) => value !== OTHER_VALUE)
							.map((value) => {
								const item = items.find((i) => i.value === value);
								return {
									label: item?.label ?? value,
									description: item?.description,
									index: Number(value),
								};
							}),
					};
					if (otherToggled) {
						const text =
							result.otherText ??
							(await ctx.ui.input("Other (specify)", "Type your answer", { signal }));
						if (text !== undefined && text.trim()) multi.other = text.trim();
					}
					return { question: question.question, selected: multi };
				}
				if (result.kind === "other") {
					return { question: question.question, selected: { other: result.text } };
				}
				const item = result.item;
				if (item.value === OTHER_VALUE) {
					const text = await ctx.ui.input("Other (specify)", "Type your answer", { signal });
					if (text === undefined) return null;
					return { question: question.question, selected: { other: text } };
				}
				return {
					question: question.question,
					selected: {
						label: item.label,
						description: item.description,
						index: Number(item.value),
					},
				};
			};

			for (const question of params.questions) {
				const answer = await askOne(question);
				if (answer === null) {
					cancelled = true;
					break;
				}
				answers.push(answer);
			}

			if (!cancelled) {
				while (true) {
					const items: SelectItem[] = [
						{ value: "confirm", label: "Confirm answers", description: "Use these answers" },
						...params.questions.map((question, index) => ({
							value: `re-${index}`,
							label: `Re-answer question ${index + 1}`,
							description: choiceText(answers[index].selected),
						})),
					];
					const summary = params.questions.map(
						(question, index) =>
							`${index + 1}. ${question.question} → ${choiceText(answers[index].selected)}`,
					);
					const confirmIndex = await confirmAnswers(ctx, summary, items, signal);
					if (confirmIndex === null) {
						cancelled = true;
						break;
					}
					if (confirmIndex === 0) break;
					const reanswered = await askOne(params.questions[confirmIndex - 1], answers[confirmIndex - 1]);
					if (reanswered === null) {
						cancelled = true;
						break;
					}
					answers[confirmIndex - 1] = reanswered;
				}
			}
			return {
				content: [{ type: "text", text: formatAnswers(answers, cancelled) }],
				details: { answers, cancelled },
			};
		},
	});
}

/**
 * Custom footer that mimics the Claude Code statusline format.
 *
 * Shows model name, thinking level, context usage, token stats, and the
 * provider — all in a compact Claude-style layout.
 */
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

function formatTokens(count: number): string {
	if (count < 1000) return String(count);
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	return `${Math.round(count / 1000000)}m`;
}

const WORKING_WORDS = [
	"Pondering", "Wrangling", "Conjuring", "Untangling", "Harmonizing",
	"Investigating", "Frolicking", "Mulling", "Wibbling", "Reasoning",
	"Rummaging", "Brewing", "Sketching", "Connecting", "Exploring",
	"Deciphering", "Composing", "Meandering", "Calculating", "Tinkering",
	"Percolating", "Consulting", "Unraveling", "Constructing", "Improvising",
	"Contemplating", "Cross-checking", "Distilling", "Researching", "Orchestrating",
	"Assembling", "Navigating", "Comparing", "Refining", "Sifting",
	"Spelunking", "Synthesizing", "Interrogating", "Mapping", "Deliberating",
];

const THEME_COLORS = ["accent", "error", "warning", "success", "borderAccent", "customMessageLabel", "muted", "text"] as const;
const WORKING_PATTERNS = ["shimmer", "bounce", "karaoke", "ripple", "sparkle"] as const;
const COLOR_INTERVAL_MS = 300;
const WORD_INTERVAL_MS = 9000;
const SPINNER_INTERVAL_MS = 150;
type WorkingPattern = (typeof WORKING_PATTERNS)[number];
type PaletteColor = (typeof THEME_COLORS)[number];
type ThemeColor = PaletteColor;

const SPINNER_SYMBOLS: Record<WorkingPattern, string[]> = {
	shimmer: ["✶", "✸", "✹", "✺", "✹", "✷"],
	bounce: ["⠁", "⠂", "⠄", "⠂"],
	karaoke: ["◜", "◠", "◝", "◞", "◡", "◟"],
	ripple: ["◴", "◷", "◶", "◵"],
	sparkle: ["·", "+", "×", "*"],
};

function patternColor(
	pattern: WorkingPattern,
	index: number,
	length: number,
	offset: number,
	colors: PaletteColor[],
): ThemeColor {
	const primary = colors[0];
	const secondary = colors[1];
	const base = colors[2];
	switch (pattern) {
		case "shimmer": {
			const head = offset % (length + 4) - 2;
			const distance = Math.abs(index - head);
			return distance === 0 ? primary : distance === 1 ? secondary : base;
		}
		case "bounce": {
			const pathLength = Math.max(1, length * 2 - 2);
			const position = offset % pathLength;
			const head = position < length ? position : pathLength - position;
			const distance = Math.abs(index - head);
			return distance === 0 ? primary : distance === 1 ? secondary : base;
		}
		case "karaoke": {
			const progress = offset % (length * 2 + 2);
			const edge = progress <= length ? progress : progress - length;
			const active = progress <= length ? index < edge : index >= edge;
			return index === edge ? secondary : active ? primary : base;
		}
		case "ripple": {
			const radius = Math.ceil(length / 2);
			const pathLength = radius * 2;
			const position = offset % pathLength;
			const ring = position <= radius ? position : pathLength - position;
			const distance = Math.floor(Math.abs(index - (length - 1) / 2));
			return distance === ring ? primary : Math.abs(distance - ring) === 1 ? secondary : base;
		}
		case "sparkle": {
			const first = offset * 3 % length;
			const second = (offset * 5 + Math.floor(length / 2)) % length;
			return index === first ? primary : index === second ? secondary : base;
		}
	}
}

function styleWorkingText(
	text: string,
	colorize: (color: ThemeColor, text: string) => string,
	pattern: WorkingPattern,
	offset: number,
	colors: PaletteColor[],
): string {
	const characters = [...text];
	return characters.map((character, index) =>
		colorize(patternColor(pattern, index, characters.length, offset, colors), character),
	).join("");
}

export default function (pi: ExtensionAPI) {
	let workingTimer: ReturnType<typeof setInterval> | undefined;

	pi.on("agent_start", (_event, ctx) => {
		if (workingTimer) clearInterval(workingTimer);

		let wordIndex = Math.floor(Math.random() * WORKING_WORDS.length);
		const firstPatternIndex = Math.floor(Math.random() * WORKING_PATTERNS.length);
		const plans = WORKING_WORDS.map((_, index) => ({
			pattern: WORKING_PATTERNS[(firstPatternIndex + index) % WORKING_PATTERNS.length],
			colors: [...THEME_COLORS].sort(() => Math.random() - 0.5),
		}));
		let planIndex = 0;
		let animationTick = 0;
		const spinnerFramesPerWord = WORD_INTERVAL_MS / SPINNER_INTERVAL_MS;
		const spinnerFrames = plans.flatMap(({ pattern, colors }) => {
			const symbols = SPINNER_SYMBOLS[pattern];
			return Array.from({ length: spinnerFramesPerWord }, (_, frameIndex) => {
				const symbolIndex = frameIndex % symbols.length;
				const colorOffset = Math.floor(frameIndex * SPINNER_INTERVAL_MS / COLOR_INTERVAL_MS);
				return ctx.ui.theme.fg(
					patternColor(pattern, symbolIndex, symbols.length, colorOffset, colors),
					symbols[symbolIndex],
				);
			});
		});
		const updateWorkingMessage = () => {
			const { pattern, colors } = plans[planIndex];
			ctx.ui.setWorkingMessage(`${styleWorkingText(
				WORKING_WORDS[wordIndex],
				(color, character) => ctx.ui.theme.fg(color, character),
				pattern,
				animationTick,
				colors,
			)}…`);
		};
		updateWorkingMessage();
		ctx.ui.setWorkingIndicator({ frames: spinnerFrames, intervalMs: SPINNER_INTERVAL_MS });
		workingTimer = setInterval(() => {
			animationTick++;
			if (animationTick * COLOR_INTERVAL_MS >= WORD_INTERVAL_MS) {
				animationTick = 0;
				wordIndex = (wordIndex + 1) % WORKING_WORDS.length;
				planIndex = (planIndex + 1) % plans.length;
			}
			updateWorkingMessage();
		}, COLOR_INTERVAL_MS);
	});

	pi.on("agent_settled", (_event, ctx) => {
		if (workingTimer) clearInterval(workingTimer);
		workingTimer = undefined;
		ctx.ui.setWorkingMessage();
		ctx.ui.setWorkingIndicator();
	});

	pi.on("session_shutdown", () => {
		if (workingTimer) clearInterval(workingTimer);
		workingTimer = undefined;
	});

	pi.on("session_start", (_event, ctx) => {
		ctx.ui.setFooter((_tui, theme, footerData) => {
			return {
				dispose() {},
				invalidate() {},
				render(width: number): string[] {
					//Model name
					const model = ctx.model;
					const modelName = model?.name || model?.id || "no-model";
					let line = theme.fg("success", modelName);

					//Thinking level / effort
					if (ctx.thinkingLevel && ctx.thinkingLevel !== "off") {
						line += theme.fg("warning", ` ${ctx.thinkingLevel}`);
					}

					//Context usage
					const contextUsage = ctx.getContextUsage();
					if (contextUsage && contextUsage.tokens !== null && contextUsage.contextWindow > 0) {
						const used = formatTokens(contextUsage.tokens);
						const total = formatTokens(contextUsage.contextWindow);
						line += ` ${theme.fg("borderAccent", `${used}/${total}`)}`;
					}

					//Token stats
					let input = 0, output = 0, cost = 0;
					for (const e of ctx.sessionManager.getBranch()) {
						if (e.type === "message" && e.message.role === "assistant") {
							const m = e.message as AssistantMessage;
							input += m.usage.input;
							output += m.usage.output;
							cost += m.usage.cost.total;
						}
					}
					if (input || output) {
						const stats = `↑${formatTokens(input)} ↓${formatTokens(output)}`;
						line += ` ${theme.fg("dim", stats)}`;
						if (cost > 0) {
							line += theme.fg("dim", ` $${cost.toFixed(3)}`);
						}
					}

					// ── Provider (dim, right-aligned) ──
					const provider = model?.provider ? theme.fg("muted", model.provider) : "";
					const gap = width - visibleWidth(line) - visibleWidth(provider);

					const result = gap >= 2
						? line + " ".repeat(gap) + provider
						: truncateToWidth(line, width, "...");

					// ── Show extension statuses on subsequent lines ──
					const statuses = footerData.getExtensionStatuses();
					if (statuses.size > 0) {
						const sorted = Array.from(statuses.entries())
							.sort(([a], [b]) => a.localeCompare(b))
							.map(([, text]) => text);
						return [result, ...sorted.map((s) => truncateToWidth(s, width, theme.fg("dim", "...")))];
					}

					return [result];
				},
			};
		});
	});
}

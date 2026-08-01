import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const WORKING_WORDS = [
	"Pondering", "Wrangling", "Conjuring", "Untangling", "Harmonizing",
	"Investigating", "Frolicking", "Mulling", "Wibbling", "Reasoning", "Imagining",
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

const SPINNER_SYMBOLS = ["✻", "✽", "✻", "✾"];

function patternColor(
	pattern: WorkingPattern,
	index: number,
	length: number,
	offset: number,
	colors: PaletteColor[],
): PaletteColor {
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

function formatTokens(count: number): string {
	if (count < 1000) return String(count);
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	return `${Math.round(count / 1000000)}m`;
}

function formatDuration(milliseconds: number): string {
	const seconds = Math.floor(milliseconds / 1000);
	const minutes = Math.floor(seconds / 60);
	return minutes > 0 ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
}

function styleWorkingText(
	text: string,
	colorize: (color: PaletteColor, text: string) => string,
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
	let startedAt = 0;
	let outputTokens = 0;
	let renderWorkingMessage: (() => void) | undefined;

	pi.on("agent_start", (_event, ctx) => {
		if (workingTimer) clearInterval(workingTimer);
		startedAt = Date.now();
		outputTokens = 0;

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
			const symbols = SPINNER_SYMBOLS;
			return Array.from({ length: spinnerFramesPerWord }, (_, frameIndex) => {
				const symbolIndex = frameIndex % symbols.length;
				const colorOffset = Math.floor(frameIndex * SPINNER_INTERVAL_MS / COLOR_INTERVAL_MS);
				return ctx.ui.theme.fg(
					patternColor(pattern, symbolIndex, symbols.length, colorOffset, colors),
					symbols[symbolIndex],
				);
			});
		});
		renderWorkingMessage = () => {
			const { pattern, colors } = plans[planIndex];
			const message = styleWorkingText(
				`${WORKING_WORDS[wordIndex]}…`,
				(color, character) => ctx.ui.theme.fg(color, character),
				pattern,
				animationTick,
				colors,
			);
			const elapsed = Date.now() - startedAt;
			const details = `(${formatDuration(elapsed)} · ↓ ${formatTokens(outputTokens)} tokens)`;
			ctx.ui.setWorkingMessage(`${message} ${ctx.ui.theme.fg("dim", details)}`);
		};
		renderWorkingMessage();
		ctx.ui.setWorkingIndicator({ frames: spinnerFrames, intervalMs: SPINNER_INTERVAL_MS });
		workingTimer = setInterval(() => {
			animationTick++;
			if (animationTick * COLOR_INTERVAL_MS >= WORD_INTERVAL_MS) {
				animationTick = 0;
				wordIndex = (wordIndex + 1) % WORKING_WORDS.length;
				planIndex = (planIndex + 1) % plans.length;
			}
			renderWorkingMessage?.();
		}, COLOR_INTERVAL_MS);
	});

	pi.on("message_update", (event) => {
		if (event.message.role !== "assistant") return;

		if (event.message.usage.output > 0) {
			outputTokens = event.message.usage.output;
		} else {
			const characters = event.message.content.reduce((total, block) => {
				if (block.type === "text") return total + block.text.length;
				if (block.type === "thinking") return total + block.thinking.length;
				if (block.type === "toolCall") return total + JSON.stringify(block.arguments).length;
				return total;
			}, 0);
			const estimate = Math.ceil(characters / 4);
			if (estimate > outputTokens) {
				outputTokens = estimate;
			}
		}
		renderWorkingMessage?.();
	});

	pi.on("agent_settled", (_event, ctx) => {
		if (workingTimer) clearInterval(workingTimer);
		workingTimer = undefined;
		renderWorkingMessage = undefined;
		startedAt = 0;
		outputTokens = 0;
		ctx.ui.setWorkingMessage();
		ctx.ui.setWorkingIndicator();
	});

	pi.on("session_shutdown", () => {
		if (workingTimer) clearInterval(workingTimer);
		workingTimer = undefined;
		renderWorkingMessage = undefined;
		startedAt = 0;
		outputTokens = 0;
	});
}

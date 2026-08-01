import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

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
}

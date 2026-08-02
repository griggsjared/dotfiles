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

const THEME_COLORS = ["error", "warning", "success", "accent", "borderAccent", "customMessageLabel"] as const;
const WORKING_PATTERNS = ["shimmer", "bounce", "karaoke", "ripple", "sparkle", "rainbow", "palettePulse"] as const;
const COLOR_INTERVAL_MS = 300;
const PALETTE_PULSE_INTERVAL_MS = 1500;
const WORD_INTERVAL_MS = 9000;
const SPINNER_INTERVAL_MS = 150;
type WorkingPattern = (typeof WORKING_PATTERNS)[number];
type PaletteColor = (typeof THEME_COLORS)[number];
type ColorIntensity = "bright" | "normal" | "dim";
type IntensityDirection = "brighten" | "darken";
type PatternColor = { color: PaletteColor; intensity: ColorIntensity };

const SPINNER_SYMBOLS = ["✻", "✽", "✻", "✾"];

function patternColor(
	pattern: WorkingPattern,
	index: number,
	length: number,
	offset: number,
	colors: PaletteColor[],
	intensityDirection: IntensityDirection,
): PatternColor {
	const color = colors[0]!;
	const intensity = (value: ColorIntensity): ColorIntensity => {
		if (intensityDirection === "brighten") return value;
		return value === "dim" ? "bright" : "normal";
	};
	const primary = { color, intensity: intensity("bright") };
	const secondary = { color, intensity: intensity("normal") };
	const base = { color, intensity: intensity("dim") };
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
		case "rainbow":
			return { color: colors[(index + offset) % colors.length]!, intensity: "normal" };
		case "palettePulse": {
			const colorIndex = Math.floor(offset * COLOR_INTERVAL_MS / PALETTE_PULSE_INTERVAL_MS) % colors.length;
			return { color: colors[colorIndex]!, intensity: "normal" };
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
	colorize: (color: PatternColor, text: string) => string,
	pattern: WorkingPattern,
	offset: number,
	colors: PaletteColor[],
	intensityDirection: IntensityDirection,
): string {
	const characters = [...text];
	return characters.map((character, index) =>
		colorize(patternColor(pattern, index, characters.length, offset, colors, intensityDirection), character),
	).join("");
}

export default function (pi: ExtensionAPI) {
	let workingTimer: ReturnType<typeof setInterval> | undefined;
	let workingRunId = 0;
	let startedAt = 0;
	let outputTokens = 0;
	let renderWorkingMessage: (() => void) | undefined;

	pi.on("agent_start", (_event, ctx) => {
		if (workingTimer) clearInterval(workingTimer);
		const runId = ++workingRunId;
		startedAt = Date.now();
		outputTokens = 0;

		const initialWordIndex = Math.floor(Math.random() * WORKING_WORDS.length);
		const firstPatternIndex = Math.floor(Math.random() * WORKING_PATTERNS.length);
		const plans = WORKING_WORDS.map((_, index) => {
			const pattern = WORKING_PATTERNS[(firstPatternIndex + index) % WORKING_PATTERNS.length];
			const color = THEME_COLORS[Math.floor(Math.random() * THEME_COLORS.length)]!;
			const randomizeIntensity = pattern === "shimmer"
				|| pattern === "bounce"
				|| pattern === "ripple"
				|| pattern === "sparkle";
			const intensityDirection: IntensityDirection = randomizeIntensity && Math.random() < 0.5
				? "darken"
				: "brighten";
			return {
				pattern,
				colors: pattern === "rainbow" || pattern === "palettePulse" ? [...THEME_COLORS] : [color],
				intensityDirection,
			};
		});
		const spinnerFramesPerWord = WORD_INTERVAL_MS / SPINNER_INTERVAL_MS;
		const styleColor = (styledColor: PatternColor, text: string): string => {
			const colored = ctx.ui.theme.fg(styledColor.color, text);
			if (styledColor.intensity === "bright") return ctx.ui.theme.bold(colored);
			if (styledColor.intensity === "dim") return `\x1b[2m${colored}\x1b[22m`;
			return colored;
		};
		const spinnerFrames = plans.flatMap(({ pattern, colors, intensityDirection }) => {
			const symbols = SPINNER_SYMBOLS;
			return Array.from({ length: spinnerFramesPerWord }, (_, frameIndex) => {
				const symbolIndex = frameIndex % symbols.length;
				const colorOffset = Math.floor(frameIndex * SPINNER_INTERVAL_MS / COLOR_INTERVAL_MS);
				return styleColor(
					patternColor(pattern, symbolIndex, symbols.length, colorOffset, colors, intensityDirection),
					symbols[symbolIndex],
				);
			});
		});
		renderWorkingMessage = () => {
			if (runId !== workingRunId) return;
			const elapsed = Date.now() - startedAt;
			const cycle = Math.floor(elapsed / WORD_INTERVAL_MS);
			const { pattern, colors, intensityDirection } = plans[cycle % plans.length];
			const message = styleWorkingText(
				`${WORKING_WORDS[(initialWordIndex + cycle) % WORKING_WORDS.length]}…`,
				(style, character) => styleColor(style, character),
				pattern,
				Math.floor(elapsed / COLOR_INTERVAL_MS),
				colors,
				intensityDirection,
			);
			const details = `(${formatDuration(elapsed)} · ↓ ${formatTokens(outputTokens)} tokens)`;
			ctx.ui.setWorkingMessage(`${message} ${ctx.ui.theme.fg("dim", details)}`);
		};
		renderWorkingMessage();
		ctx.ui.setWorkingVisible(true);
		const resyncSpinner = (cycle: number) => {
			const start = (cycle % plans.length) * spinnerFramesPerWord;
			ctx.ui.setWorkingIndicator({
				frames: [...spinnerFrames.slice(start), ...spinnerFrames.slice(0, start)],
				intervalMs: SPINNER_INTERVAL_MS,
			});
		};
		resyncSpinner(0);
		let timer: ReturnType<typeof setInterval>;
		let lastCycle = 0;
		timer = setInterval(() => {
			if (runId !== workingRunId) {
				clearInterval(timer);
				return;
			}
			const cycle = Math.floor((Date.now() - startedAt) / WORD_INTERVAL_MS);
			if (cycle !== lastCycle) {
				lastCycle = cycle;
				resyncSpinner(cycle);
			}
			renderWorkingMessage?.();
		}, COLOR_INTERVAL_MS);
		workingTimer = timer;
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
		if (!ctx.isIdle()) return;
		workingRunId++;
		if (workingTimer) clearInterval(workingTimer);
		workingTimer = undefined;
		renderWorkingMessage = undefined;
		startedAt = 0;
		outputTokens = 0;
		ctx.ui.setWorkingMessage();
		ctx.ui.setWorkingIndicator();
		ctx.ui.setWorkingVisible(false);
	});

	pi.on("session_shutdown", (_event, ctx) => {
		workingRunId++;
		if (workingTimer) clearInterval(workingTimer);
		workingTimer = undefined;
		renderWorkingMessage = undefined;
		startedAt = 0;
		outputTokens = 0;
		ctx.ui.setWorkingMessage();
		ctx.ui.setWorkingIndicator();
		ctx.ui.setWorkingVisible(false);
	});
}

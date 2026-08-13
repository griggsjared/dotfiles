import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type Phase = "thinking" | "writing" | "tooling" | "waiting";

const THINKING_WORDS = [
	"Pondering", "Mulling", "Reasoning", "Contemplating", "Deliberating",
	"Calculating", "Percolating", "Brewing", "Distilling", "Imagining",
	"Conjuring", "Improvising", "Connecting", "Synthesizing", "Meandering",
	"Wibbling", "Frolicking", "Untangling", "Ruminating", "Theorizing",
	"Cogitating", "Musing", "Wondering", "Reflecting", "Introspecting",
	"Grappling", "Chewing", "Simmering", "Steeping", "Marinating",
	"Envisioning", "Hypothesizing", "Postulating", "Weaving", "Braiding",
	"Alchemizing", "Transmuting", "Delving", "Prospecting", "Unfolding",
	"Reckoning", "Weighing", "Tessellating", "Gamboling", "Daydreaming",
	"Wandering", "Chasing", "Brooding",
	"Philosophizing", "Speculating", "Discerning", "Crystallizing", "Coalescing",
	"Incubating", "Hatching", "Reframing", "Rehearsing",
	"Triaging", "Fleshing out", "Spiraling", "Bemusing",
	"Noodling", "Boiling down", "Whisking", "Effervescing", "Waxing",
	"Tackling", "Gleaning", "Coining", "Doodling", "Anchoring",
	"Grasping", "Pursuing", "Experimenting",
];

const WRITING_WORDS = [
	"Composing", "Sketching", "Constructing", "Assembling", "Refining",
	"Mapping", "Harmonizing", "Orchestrating", "Articulating", "Drafting",
	"Authoring", "Penning", "Inscribing", "Scribbling", "Transcribing",
	"Narrating", "Recounting", "Explaining", "Elaborating", "Expounding",
	"Depicting", "Painting", "Illustrating", "Formulating", "Polishing",
	"Buffing", "Trimming", "Pruning", "Carving", "Whittling",
	"Molding", "Stitching", "Stringing", "Crafting", "Forging",
	"Fashioning", "Fabricating", "Spinning", "Condensing", "Rewriting",
	"Revising", "Summarizing", "Framing", "Blueprinting", "Outlining",
	"Journaling", "Choreographing",
	"Publishing", "Calligraphing", "Copywriting", "Ghostwriting", "Songwriting",
	"Headlining", "Blurbing", "Footnoting", "Paraphrasing", "Translating",
	"Interpreting", "Rendering", "Expressing", "Enunciating", "Rhapsodizing",
	"Prosing", "Ranting", "Gushing", "Storyboarding", "Foreshadowing",
	"Bulletpointing", "Punctuating", "Anagramming", "Quipping", "Bantering",
	"Satirizing", "Parodying", "Mimicking",
];

const WAITING_WORDS = [
	"Transmitting", "Fetching", "Hailing", "Pinging", "Reaching out",
	"Buffering", "Awaiting", "Anticipating", "Handshaking", "Connecting",
	"Holding", "Lingering", "Loitering", "Twiddling", "Fidgeting",
	"Drumming", "Humming", "Whistling", "Staring", "Squinting",
	"Straining", "Listening", "Sounding", "Retrying", "Negotiating",
	"Inhaling", "Crossing", "Hoping", "Praying", "Pacing",
	"Glancing", "Biding",
	"Waiting", "Killing time", "Zoning out", "Bobbing", "Wriggling",
	"Swaying", "Rocking", "Jittering", "Fretting", "Wishing",
	"Knocking", "Tapping", "Dawdling", "Lollygagging", "Hanging",
	"Suspending", "Pausing", "Stalling", "Idling", "Coasting",
	"Gliding", "Hovering", "Floating", "Loading", "Spooling",
	"Queueing", "Polling", "Dialing", "Waving",
];

const TOOL_WORDS: Record<string, string[]> = {
	bash: [
		"Wrangling", "Rummaging", "Interrogating", "Spelunking", "Sifting", "Executing",
		"Bashing", "Crunching", "Churning", "Grinding", "Debugging", "Testing",
		"Scripting", "Automating", "Compiling", "Building", "Syncing",
		"Shuffling", "Tidying", "Cleaning", "Scrubbing", "Archiving", "Compressing",
		"Unpacking", "Fixing", "Profiling",
		"Benchmarking", "Counting", "Indexing", "Searching", "Mining", "Excavating",
		"Drilling", "Hammering", "Juggling", "Spawning", "Chaining", "Gluing",
		"Driving", "Racing", "Zipping", "Firing", "Piping", "Globbing",
		"Grepping", "Tunneling", "Networking", "Forking", "Streaming", "Redirecting",
		"Proxying", "Mirroring", "Restoring", "Resurrecting",
		"Encoding", "Hashing", "Escaping", "Recursing",
		"Deduping", "Normalizing", "Rotating", "Tailing", "Caching", "Fuzzing",
	],
	read: [
		"Perusing", "Scanning", "Sifting", "Spelunking", "Navigating", "Investigating", "Deciphering", "Comparing",
		"Browsing", "Skimming", "Leafing", "Combing", "Scouring", "Dredging", "Unearthing", "Dissecting",
		"Parsing", "Tracing", "Following", "Tracking", "Sleuthing", "Inspecting", "Examining", "Studying",
		"Analyzing", "Digesting", "Absorbing", "Devouring", "Inhaling", "Peeking",
		"Peering", "Sniffing", "Surveying", "Auditing",
		"Reviewing", "Cross-referencing", "Extracting", "Lifting",
		"Poring", "Reading", "Thumbing", "Flipping", "Rifling", "Plumbing",
		"Grubbing", "Slogging", "Learning", "Highlighting", "Bookmarking", "Speed-reading",
		"Gobbling", "Bingeing", "Roaming", "Sweeping",
		"Raking", "Screening", "Re-reading", "Recalling",
	],
	edit: [
		"Tinkering", "Refining", "Sculpting", "Shaping",
		"Editing", "Tweaking", "Nudging", "Adjusting", "Calibrating", "Tuning",
		"Trimming", "Pruning", "Carving", "Chiseling", "Whittling", "Shaving",
		"Sanding", "Filing", "Patching", "Mending", "Splicing", "Stitching",
		"Rewriting", "Swapping", "Injecting", "Removing", "Stripping", "Formatting",
		"Refactoring", "Simplifying", "Prettifying", "Tightening", "Sharpening", "Honing",
		"Revising", "Retouching", "Massaging", "Weeding", "Grafting", "Iterating",
		"Fiddling", "Jabbing", "Twisting", "Turning", "Etching", "Grooving",
		"Burnishing", "Glazing", "Varnishing", "Gilding", "Soldering", "Welding",
		"Fusing", "Melding", "Kneading", "Stretching", "Squishing", "Easing",
		"Quieting", "Silencing", "Uncommenting", "Renaming", "Duplicating", "Cutting",
		"Pasting", "Reverting", "Undoing", "Backtracking",
	],
	write: [
		"Composing", "Constructing", "Assembling", "Sketching",
		"Writing", "Authoring", "Creating", "Generating", "Producing",
		"Crafting", "Forging", "Fashioning", "Fabricating", "Scaffolding",
		"Bootstrapping", "Prototyping", "Architecting", "Engineering", "Designing",
		"Concocting", "Baking", "Cooking", "Whipping up", "Manifesting",
		"Coding", "Programming", "Blueprinting", "Founding", "Planting",
		"Typing", "Dictating", "Seeding", "Sowing", "Cultivating", "Tending",
		"Growing", "Casting", "Emitting", "Outputting", "Exporting", "Dumping",
		"Persisting", "Saving", "Recording", "Forming", "Booting", "Spinning up",
		"Firing up", "Awakening", "Rousing",
	],
	web_search: [
		"Searching", "Querying", "Googling", "Hunting", "Digging", "Probing",
		"Scanning", "Scouring", "Combing", "Sifting", "Filtering", "Trawling",
		"Netting", "Mining", "Crawling", "Prowling", "Sniffing", "Surveying",
		"Ranking", "Exploring", "Investigating", "Cross-checking", "Triangulating",
		"Verifying", "Fact-checking", "Sleuthing", "Scouting", "Tracking down",
		"Chasing leads", "Narrowing down", "Zeroing in", "Pinpointing", "Locating",
		"Discovering", "Unearthing", "Prospecting", "Panning", "Sourcing",
		"Angling", "Fishing", "Hunting down", "Looking up", "Checking",
	],
	web_fetch: [
		"Fetching", "Retrieving", "Reading", "Pulling", "Downloading", "Grabbing",
		"Snagging", "Loading", "Opening", "Visiting", "Browsing", "Skimming",
		"Perusing", "Parsing", "Extracting", "Scraping", "Harvesting", "Ingesting",
		"Consuming", "Absorbing", "Devouring", "Citing", "Quoting", "Delving",
		"Diving into", "Paging through", "Thumbing", "Flipping through", "Loading up",
		"Pulling up", "Decoding", "Rendering", "Rummaging", "Combing through",
	],
	subagent: [
		"Consulting", "Delegating", "Coordinating", "Orchestrating",
		"Summoning", "Dispatching", "Assigning", "Enlisting", "Recruiting",
		"Marshaling", "Supervising", "Stewarding", "Herding", "Corralling",
		"Deploying", "Outsourcing", "Briefing", "Relaying", "Spawning", "Splitting",
		"Cloning", "Hatching", "Mustering", "Rallying", "Gathering", "Conscripting",
		"Hiring", "Tasking", "Debriefing", "Directing", "Leading", "Guiding",
		"Mentoring", "Overseeing", "Shepherding", "Flocking", "Swarming", "Divvying",
		"Dividing", "Distributing", "Handing off", "Tag-teaming", "Partnering", "Collaborating",
		"Teaming up",
	],
};

const ALL_WORDS = [
	...THINKING_WORDS,
	...WRITING_WORDS,
	...WAITING_WORDS,
	...Object.values(TOOL_WORDS).flat(),
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

// Timers live in a process-global registry, not per-instance state: a runtime
// detached by /reload stops receiving events, so a timer created in the gap
// between session_shutdown and the fresh runtime would never be cleared by its
// own handlers. The fresh runtime clears the registry on session_start.
const TIMER_REGISTRY_KEY = "__pi_working_indicator_timers__";
const WORKING_GENERATION_KEY = "__pi_working_indicator_generation__";

function beginWorkingGeneration(): symbol {
	const generation = Symbol();
	(globalThis as Record<string, unknown>)[WORKING_GENERATION_KEY] = generation;
	return generation;
}

function isCurrentWorkingGeneration(generation: symbol): boolean {
	return (globalThis as Record<string, unknown>)[WORKING_GENERATION_KEY] === generation;
}

function liveTimers(): Set<ReturnType<typeof setInterval>> {
	const g = globalThis as Record<string, unknown>;
	const existing = g[TIMER_REGISTRY_KEY];
	if (existing instanceof Set) return existing;
	const created = new Set<ReturnType<typeof setInterval>>();
	g[TIMER_REGISTRY_KEY] = created;
	return created;
}

function clearAllWorkingTimers(): void {
	for (const timer of liveTimers()) clearInterval(timer);
	liveTimers().clear();
}

function patternColor(
	pattern: WorkingPattern,
	index: number,
	length: number,
	offset: number,
	colors: PaletteColor[],
	intensityDirection: IntensityDirection,
): PatternColor {
	const color = colors[0] ?? "accent";
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
			return { color: colors[(index + offset) % colors.length] ?? color, intensity: "normal" };
		case "palettePulse": {
			const colorIndex = Math.floor(offset * COLOR_INTERVAL_MS / PALETTE_PULSE_INTERVAL_MS) % colors.length;
			return { color: colors[colorIndex] ?? color, intensity: "normal" };
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
	return minutes > 0 ? `${minutes}m${seconds % 60}s` : `${seconds}s`;
}

function messageCharacters(content: readonly { type: string; text?: string; thinking?: string; arguments?: unknown }[]): number {
	return content.reduce((total, block) => {
		if (block.type === "text") return total + (block.text?.length ?? 0);
		if (block.type === "thinking") return total + (block.thinking?.length ?? 0);
		if (block.type === "toolCall") return total + JSON.stringify(block.arguments ?? {}).length;
		return total;
	}, 0);
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
	let workingRunId = 0;
	let runtimeGeneration: symbol | undefined;
	let startedAt = 0;
	// Task totals, kept across agent runs (reset on each new user prompt):
	// usage of completed messages plus the message currently streaming.
	let settledTokens = 0;
	let inFlightTokens = 0;
	let inFlightCharacters = 0;
	let outputTokens = 0;
	let renderWorkingMessage: (() => void) | undefined;
	let currentPhase: Phase = "thinking";
	let currentTool: string | undefined;
	const activeTools = new Set<string>();
	const lastWordIndexByBucket: Record<string, number> = {};

	const bucketFor = (phase: Phase, tool: string | undefined): string =>
		phase === "tooling" ? (tool && TOOL_WORDS[tool] ? `tool:${tool}` : "tool:generic") : phase;

	const wordsFor = (bucket: string): string[] => {
		if (bucket.startsWith("tool:")) return TOOL_WORDS[bucket.slice(5)] ?? ALL_WORDS;
		return bucket === "thinking" ? THINKING_WORDS
			: bucket === "writing" ? WRITING_WORDS
			: bucket === "waiting" ? WAITING_WORDS
			: ALL_WORDS;
	};

	const pickWord = (bucket: string): string => {
		const words = wordsFor(bucket);
		const last = lastWordIndexByBucket[bucket] ?? -1;
		let index = Math.floor(Math.random() * words.length);
		while (words.length > 1 && index === last) index = (index + 1) % words.length;
		lastWordIndexByBucket[bucket] = index;
		return words[index] ?? words[0] ?? "Working";
	};

	pi.on("agent_start", (_event, ctx) => {
		if (runtimeGeneration === undefined || !isCurrentWorkingGeneration(runtimeGeneration)) return;
		clearAllWorkingTimers();
		const generation = runtimeGeneration;
		const runId = ++workingRunId;
		if (startedAt === 0) startedAt = Date.now();
		currentPhase = "thinking";
		currentTool = undefined;
		activeTools.clear();

		const firstPatternIndex = Math.floor(Math.random() * WORKING_PATTERNS.length);
		const plans = Array.from({ length: 12 }, (_, index) => {
			const pattern = WORKING_PATTERNS[(firstPatternIndex + index) % WORKING_PATTERNS.length] ?? "shimmer";
			const color = THEME_COLORS[Math.floor(Math.random() * THEME_COLORS.length)] ?? "accent";
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
				const symbol = symbols[symbolIndex] ?? symbols[0] ?? "✻";
				return styleColor(
					patternColor(pattern, symbolIndex, symbols.length, colorOffset, colors, intensityDirection),
					symbol,
				);
			});
		});
		let lastWordCycle = -1;
		let lastBucket = "";
		let currentWord = "";
		let lastWorkingMessage = "";
		let lastWorkingSecond = -1;
		let lastWorkingBucket = "";
		let lastWorkingTokens = "";
		let lastWorkingColorFrame = -1;
		renderWorkingMessage = () => {
			if (runId !== workingRunId || !isCurrentWorkingGeneration(generation)) return;
			const elapsed = Date.now() - startedAt;
			const cycle = Math.floor(elapsed / WORD_INTERVAL_MS);
			const bucket = bucketFor(currentPhase, currentTool);
			if (bucket !== lastBucket || cycle !== lastWordCycle) {
				lastBucket = bucket;
				lastWordCycle = cycle;
				currentWord = pickWord(bucket);
			}
			const plan = plans[cycle % plans.length];
			if (!plan) return;
			const second = Math.floor(elapsed / 1000);
			const tokenDisplay = formatTokens(outputTokens);
			const colorFrame = Math.floor(elapsed / COLOR_INTERVAL_MS);
			if (second === lastWorkingSecond && bucket === lastWorkingBucket && tokenDisplay === lastWorkingTokens && colorFrame === lastWorkingColorFrame) return;
			lastWorkingSecond = second;
			lastWorkingBucket = bucket;
			lastWorkingTokens = tokenDisplay;
			lastWorkingColorFrame = colorFrame;
			const { pattern, colors, intensityDirection } = plan;
			const message = styleWorkingText(
				`${currentWord}…`,
				(style, character) => styleColor(style, character),
				pattern,
				colorFrame,
				colors,
				intensityDirection,
			);
			const details = `(${formatDuration(elapsed)} · ↓ ${tokenDisplay} tokens)`;
			const workingMessage = `${message} ${ctx.ui.theme.fg("dim", details)}`;
			if (workingMessage !== lastWorkingMessage) {
				lastWorkingMessage = workingMessage;
				ctx.ui.setWorkingMessage(workingMessage);
			}
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
		const startCycle = Math.floor((Date.now() - startedAt) / WORD_INTERVAL_MS);
		resyncSpinner(startCycle);
		let timer: ReturnType<typeof setInterval>;
		let lastCycle = startCycle;
		timer = setInterval(() => {
			if (runId !== workingRunId || !isCurrentWorkingGeneration(generation)) {
				clearInterval(timer);
				liveTimers().delete(timer);
				return;
			}
			const cycle = Math.floor((Date.now() - startedAt) / WORD_INTERVAL_MS);
			if (cycle !== lastCycle) {
				lastCycle = cycle;
				resyncSpinner(cycle);
			}
			renderWorkingMessage?.();
		}, COLOR_INTERVAL_MS);
		timer.unref?.();
		liveTimers().add(timer);
	});

	pi.on("input", (event) => {
		if (event.streamingBehavior === "steer" || event.streamingBehavior === "followUp") return;
		startedAt = Date.now();
		settledTokens = 0;
		inFlightTokens = 0;
		inFlightCharacters = 0;
		outputTokens = 0;
		renderWorkingMessage?.();
	});

	pi.on("message_update", (event) => {
		if (event.message.role !== "assistant") return;

		if (event.message.usage.output > 0) {
			inFlightTokens = event.message.usage.output;
		} else {
			const update = event.assistantMessageEvent;
			if ("delta" in update && typeof update.delta === "string") {
				inFlightCharacters += update.delta.length;
			}
			if (update.type === "thinking_end" || update.type === "text_end" || update.type === "toolcall_end") {
				inFlightCharacters = Math.max(inFlightCharacters, messageCharacters(event.message.content));
			}
			const estimate = Math.ceil(inFlightCharacters / 4);
			if (estimate > inFlightTokens) inFlightTokens = estimate;
		}
		outputTokens = settledTokens + inFlightTokens;
		switch (event.assistantMessageEvent.type) {
			case "thinking_start": case "thinking_delta": case "thinking_end": currentPhase = "thinking"; break;
			case "text_start": case "text_delta": case "text_end": currentPhase = "writing"; break;
			case "toolcall_start": case "toolcall_delta": case "toolcall_end": currentPhase = "tooling"; break;
		}
		renderWorkingMessage?.();
	});

	pi.on("message_end", (event) => {
		if (event.message.role !== "assistant") return;
		const usageOutput = event.message.usage.output;
		settledTokens += usageOutput > 0 ? usageOutput : inFlightTokens;
		inFlightTokens = 0;
		inFlightCharacters = 0;
		outputTokens = settledTokens;
		renderWorkingMessage?.();
	});

	pi.on("turn_start", () => {
		currentPhase = "thinking";
		currentTool = undefined;
		renderWorkingMessage?.();
	});

	pi.on("tool_execution_start", (event) => {
		currentPhase = "tooling";
		currentTool = event.toolName;
		activeTools.add(event.toolCallId);
		renderWorkingMessage?.();
	});

	pi.on("tool_execution_end", (event) => {
		activeTools.delete(event.toolCallId);
		if (activeTools.size === 0) {
			currentPhase = "thinking";
			currentTool = undefined;
		}
		renderWorkingMessage?.();
	});

	pi.on("before_provider_request", () => {
		currentPhase = "waiting";
		renderWorkingMessage?.();
	});

	pi.on("after_provider_response", () => {
		currentPhase = "thinking";
		renderWorkingMessage?.();
	});

	pi.on("agent_settled", (_event, ctx) => {
		if (runtimeGeneration === undefined || !isCurrentWorkingGeneration(runtimeGeneration) || !ctx.isIdle()) return;
		workingRunId++;
		clearAllWorkingTimers();
		renderWorkingMessage = undefined;
		ctx.ui.setWorkingMessage();
		ctx.ui.setWorkingIndicator();
		ctx.ui.setWorkingVisible(false);
	});

	pi.on("session_shutdown", (_event, ctx) => {
		if (runtimeGeneration === undefined || !isCurrentWorkingGeneration(runtimeGeneration)) return;
		runtimeGeneration = undefined;
		workingRunId++;
		clearAllWorkingTimers();
		renderWorkingMessage = undefined;
		startedAt = 0;
		settledTokens = 0;
		inFlightTokens = 0;
		inFlightCharacters = 0;
		outputTokens = 0;
		ctx.ui.setWorkingMessage();
		ctx.ui.setWorkingIndicator();
		ctx.ui.setWorkingVisible(false);
	});

	pi.on("session_start", (_event, ctx) => {
		if (ctx.hasUI === false) return;
		// Invalidate callbacks from a runtime being replaced during reload. A
		// callback can already be queued even after its timer was cleared.
		runtimeGeneration = beginWorkingGeneration();
		workingRunId++;
		clearAllWorkingTimers();
		renderWorkingMessage = undefined;
		currentPhase = "thinking";
		currentTool = undefined;
		activeTools.clear();
		startedAt = Date.now();
		settledTokens = 0;
		inFlightTokens = 0;
		inFlightCharacters = 0;
		outputTokens = 0;
		ctx.ui.setWorkingMessage();
		ctx.ui.setWorkingIndicator();
		ctx.ui.setWorkingVisible(false);
	});
}

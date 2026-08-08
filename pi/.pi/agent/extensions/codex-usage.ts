import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const CODEX_PROVIDER = "openai-codex";
const CODEX_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const STATUS_KEY = "codex-usage";
const CACHE_TTL_MS = 60_000;
const REFRESH_INTERVAL_MS = 60_000;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 64 * 1024;
const WEEKLY_WINDOW_THRESHOLD_SECONDS = 24 * 60 * 60;

type ObjectValue = Record<string, unknown>;

type CodexUsageWindow = {
	usedPercent: number;
	remainingPercent: number;
	windowSeconds?: number;
	resetAt?: number;
};

export type CodexUsage = {
	fiveHour?: CodexUsageWindow;
	weekly?: CodexUsageWindow;
	capturedAt: number;
};

function asObject(value: unknown): ObjectValue | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? value as ObjectValue
		: undefined;
}

function asNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeResetAt(value: number | undefined): number | undefined {
	if (value === undefined || value < 0) return undefined;
	return value > 10_000_000_000 ? Math.round(value / 1000) : Math.round(value);
}

export function normalizeWindow(value: unknown): CodexUsageWindow | undefined {
	const object = asObject(value);
	if (!object) return undefined;

	const used = asNumber(object.used_percent) ?? asNumber(object.usedPercent);
	if (used === undefined) return undefined;

	const windowSeconds = asNumber(object.limit_window_seconds)
		?? asNumber(object.window_seconds)
		?? (asNumber(object.window_minutes) !== undefined ? asNumber(object.window_minutes)! * 60 : undefined);
	const resetAt = normalizeResetAt(asNumber(object.reset_at) ?? asNumber(object.resetAt));
	const usedPercent = Math.max(0, Math.min(100, used));

	return {
		usedPercent,
		remainingPercent: 100 - usedPercent,
		...(windowSeconds !== undefined && windowSeconds > 0 ? { windowSeconds } : {}),
		...(resetAt !== undefined ? { resetAt } : {}),
	};
}

function classifyWindows(
	primary: CodexUsageWindow | undefined,
	secondary: CodexUsageWindow | undefined,
): Pick<CodexUsage, "fiveHour" | "weekly"> {
	const result: Pick<CodexUsage, "fiveHour" | "weekly"> = {};
	const unknown: Array<{ position: "primary" | "secondary"; window: CodexUsageWindow }> = [];

	for (const [position, window] of [["primary", primary], ["secondary", secondary]] as const) {
		if (!window) continue;
		if (window.windowSeconds === undefined) {
			unknown.push({ position, window });
			continue;
		}

		const key = window.windowSeconds >= WEEKLY_WINDOW_THRESHOLD_SECONDS ? "weekly" : "fiveHour";
		if (!result[key]) result[key] = window;
		else unknown.push({ position, window });
	}

	for (const { position, window } of unknown) {
		const preferred = position === "primary" ? "fiveHour" : "weekly";
		const fallback = preferred === "fiveHour" ? "weekly" : "fiveHour";
		if (!result[preferred]) result[preferred] = window;
		else if (!result[fallback]) result[fallback] = window;
	}

	return result;
}

export function normalizeCodexUsage(payload: unknown, capturedAt = Date.now()): CodexUsage | undefined {
	const rateLimit = asObject(asObject(payload)?.rate_limit);
	if (!rateLimit) return undefined;

	const windows = classifyWindows(
		normalizeWindow(rateLimit.primary_window),
		normalizeWindow(rateLimit.secondary_window),
	);
	if (!windows.fiveHour && !windows.weekly) return undefined;

	return { ...windows, capturedAt };
}

export function extractAccountId(accessToken: string): string | undefined {
	const encodedPayload = accessToken.split(".")[1];
	if (!encodedPayload) return undefined;

	try {
		const payload = asObject(JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")));
		const auth = asObject(payload?.["https://api.openai.com/auth"]);
		const accountId = auth?.chatgpt_account_id;
		return typeof accountId === "string" && accountId.length > 0 ? accountId : undefined;
	} catch {
		return undefined;
	}
}

export function formatResetCountdown(resetAt: number | undefined, now = Date.now()): string | undefined {
	if (resetAt === undefined || !Number.isFinite(resetAt)) return undefined;

	const seconds = Math.max(0, Math.round(resetAt - now / 1000));
	if (seconds === 0) return "now";
	if (seconds < 60) return "0h1m";

	const days = Math.floor(seconds / 86_400);
	const hours = Math.floor((seconds % 86_400) / 3_600);
	const minutes = Math.floor((seconds % 3_600) / 60);
	if (days > 0) return `${days}d${hours}h${minutes}m`;
	return `${hours}h${minutes}m`;
}

function formatWindow(window: CodexUsageWindow | undefined, now: number): string | undefined {
	if (!window) return undefined;
	const reset = formatResetCountdown(window.resetAt, now);
	return `${Math.round(window.usedPercent)}%${reset ? ` (${reset})` : ""}`;
}

export function formatCodexUsage(usage: CodexUsage, now = Date.now()): string {
	return [
		formatWindow(usage.fiveHour, now),
		formatWindow(usage.weekly, now),
	].filter((value): value is string => value !== undefined).join(" ");
}

function isOfficialBaseUrl(value: string | undefined): boolean {
	if (!value) return true;
	try {
		const url = new URL(value);
		return url.protocol === "https:"
			&& url.hostname === "chatgpt.com"
			&& url.pathname.replace(/\/+$/, "") === "/backend-api";
	} catch {
		return false;
	}
}

async function fetchCodexUsage(ctx: ExtensionContext, signal: AbortSignal): Promise<CodexUsage> {
	const provider = ctx.modelRegistry.getProvider(CODEX_PROVIDER);
	if (!provider || !isOfficialBaseUrl(provider.baseUrl)) throw new Error("Codex provider endpoint is not official");

	const resolved = await ctx.modelRegistry.getProviderAuth(CODEX_PROVIDER);
	if (!resolved || !isOfficialBaseUrl(resolved.auth.baseUrl)) throw new Error("Codex auth is unavailable");

	const accessToken = resolved.auth.apiKey;
	if (!accessToken) throw new Error("Codex access token is unavailable");
	const accountId = extractAccountId(accessToken);
	if (!accountId) throw new Error("Codex account id is unavailable");

	const response = await fetch(CODEX_USAGE_URL, {
		headers: {
			Accept: "application/json",
			Authorization: `Bearer ${accessToken}`,
			"ChatGPT-Account-Id": accountId,
		},
		signal,
	});
	if (!response.ok) throw new Error(`Codex usage request failed (${response.status})`);

	const body = await response.text();
	if (body.length > MAX_RESPONSE_BYTES) throw new Error("Codex usage response is too large");

	let payload: unknown;
	try {
		payload = JSON.parse(body);
	} catch {
		throw new Error("Codex usage response is invalid");
	}

	const usage = normalizeCodexUsage(payload);
	if (!usage) throw new Error("Codex usage response has no rate limits");
	return usage;
}

export default function codexUsage(pi: ExtensionAPI): void {
	let activeContext: ExtensionContext | undefined;
	let activeProvider: string | undefined;
	let latestUsage: CodexUsage | undefined;
	let lastFetchedAt = 0;
	let generation = 0;
	let refreshPromise: Promise<void> | undefined;
	let requestController: AbortController | undefined;
	let refreshTimer: ReturnType<typeof setInterval> | undefined;
	let sessionActive = false;

	const clearRequest = (): void => {
		requestController?.abort();
		requestController = undefined;
		refreshPromise = undefined;
	};

	const clearUsage = (ctx: ExtensionContext): void => {
		latestUsage = undefined;
		lastFetchedAt = 0;
		if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, undefined);
	};

	const publish = (ctx: ExtensionContext, usage: CodexUsage | undefined): void => {
		if (!ctx.hasUI) return;
		ctx.ui.setStatus(STATUS_KEY, usage ? formatCodexUsage(usage) : "quota:?");
	};

	const refresh = (ctx: ExtensionContext): Promise<void> => {
		if (!ctx.hasUI || ctx.model?.provider !== CODEX_PROVIDER) {
			if (ctx.hasUI && activeProvider === CODEX_PROVIDER) clearUsage(ctx);
			return Promise.resolve();
		}

		if (latestUsage && Date.now() - lastFetchedAt < CACHE_TTL_MS) {
			publish(ctx, latestUsage);
			return Promise.resolve();
		}
		if (refreshPromise) return refreshPromise;

		const requestGeneration = generation;
		const controller = new AbortController();
		requestController = controller;
		const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
		const promise = (async () => {
			try {
				const usage = await fetchCodexUsage(ctx, controller.signal);
				if (!sessionActive || requestGeneration !== generation || ctx.model?.provider !== CODEX_PROVIDER) return;
				latestUsage = usage;
				lastFetchedAt = Date.now();
				publish(ctx, usage);
			} catch {
				if (!sessionActive || requestGeneration !== generation || ctx.model?.provider !== CODEX_PROVIDER) return;
				if (!latestUsage) publish(ctx, undefined);
			} finally {
				clearTimeout(timeout);
				if (requestController === controller) requestController = undefined;
			}
		})();
		refreshPromise = promise;
		promise.then(
			() => {
				if (refreshPromise === promise) refreshPromise = undefined;
			},
			() => {
				if (refreshPromise === promise) refreshPromise = undefined;
			},
		);
		return promise;
	};

	pi.on("session_start", (_event, ctx) => {
		sessionActive = true;
		activeContext = ctx;
		activeProvider = ctx.model?.provider;
		generation++;
		if (ctx.hasUI && activeProvider === CODEX_PROVIDER) publish(ctx, undefined);
		else if (ctx.hasUI) clearUsage(ctx);
		if (ctx.hasUI && !refreshTimer) {
			refreshTimer = setInterval(() => {
				if (activeContext && activeProvider === CODEX_PROVIDER) void refresh(activeContext);
			}, REFRESH_INTERVAL_MS);
		}
		void refresh(ctx);
	});

	pi.on("model_select", (event, ctx) => {
		activeContext = ctx;
		const provider = event.model.provider;
		if (provider !== activeProvider) {
			generation++;
			clearRequest();
			activeProvider = provider;
			clearUsage(ctx);
		}
		if (provider === CODEX_PROVIDER) {
			publish(ctx, latestUsage);
			void refresh(ctx);
		}
	});

	pi.on("turn_end", (_event, ctx) => {
		activeContext = ctx;
		if (ctx.model?.provider === CODEX_PROVIDER) void refresh(ctx);
	});

	pi.on("session_shutdown", (_event, ctx) => {
		sessionActive = false;
		generation++;
		clearRequest();
		if (refreshTimer) clearInterval(refreshTimer);
		refreshTimer = undefined;
		activeContext = undefined;
		activeProvider = undefined;
		latestUsage = undefined;
		lastFetchedAt = 0;
		if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, undefined);
	});
}

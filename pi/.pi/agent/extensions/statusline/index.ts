import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { registerStatusline } from "./footer.ts";
import {
	encodeUsageStatus,
	isUsageProvider,
	normalizeUsagePercent,
	USAGE_STATUS_KEY,
	type UsageProvider,
	type UsageStatus,
	type UsageWindow,
} from "./usage-status.ts";

const CODEX_PROVIDER = "openai-codex";
const OPENCODE_PROVIDER = "opencode-go";
const CODEX_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const OPENCODE_USAGE_URL = "https://opencode.ai/workspace/";
const CODEX_CACHE_TTL_MS = 60_000;
const OPENCODE_CACHE_TTL_MS = 5 * 60_000;
const REFRESH_INTERVAL_MS = 60_000;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 64 * 1024;
const MAX_HTML_RESPONSE_BYTES = 256 * 1024;
const WEEKLY_WINDOW_THRESHOLD_SECONDS = 24 * 60 * 60;
const MAX_HYDRATION_CANDIDATES = 256;
const MAX_HYDRATION_SCAN_CHARS = 16 * 1024;
const MAX_HYDRATION_SCAN_TOTAL = 256 * 1024;

type ObjectValue = Record<string, unknown>;

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

type CodexUsageWindow = {
	usedPercent: number;
	remainingPercent: number;
	windowSeconds?: number;
	resetAt?: number;
};

type CodexUsage = {
	fiveHour?: CodexUsageWindow;
	weekly?: CodexUsageWindow;
	capturedAt: number;
};

export function normalizeWindow(value: unknown): CodexUsageWindow | undefined {
	const object = asObject(value);
	if (!object) return undefined;

	const used = asNumber(object.used_percent) ?? asNumber(object.usedPercent);
	if (used === undefined) return undefined;

	const minutes = asNumber(object.window_minutes);
	const windowSeconds = asNumber(object.limit_window_seconds)
		?? asNumber(object.window_seconds)
		?? (minutes === undefined ? undefined : minutes * 60);
	const resetAt = normalizeResetAt(asNumber(object.reset_at) ?? asNumber(object.resetAt));
	const usedPercent = Math.max(0, Math.min(100, used));
	return {
		usedPercent,
		remainingPercent: 100 - usedPercent,
		...(windowSeconds !== undefined && windowSeconds > 0 ? { windowSeconds } : {}),
		...(resetAt !== undefined ? { resetAt } : {}),
	};
}

export function formatResetCountdown(resetAt: number | undefined, now = Date.now()): string | undefined {
	if (resetAt === undefined || !Number.isFinite(resetAt)) return undefined;

	const seconds = Math.max(0, Math.round(resetAt - now / 1000));
	if (seconds === 0) return "now";
	if (seconds < 60) return "1m";

	const days = Math.floor(seconds / 86_400);
	const hours = Math.floor((seconds % 86_400) / 3_600);
	const minutes = Math.floor((seconds % 3_600) / 60);
	if (days > 0) return `${days}d${hours}h${minutes}m`;
	return `${hours}h${minutes}m`;
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

export function normalizeCodexUsage(payload: unknown, capturedAt = Date.now()): UsageStatus | undefined {
	const rateLimit = asObject(asObject(payload)?.rate_limit);
	if (!rateLimit) return undefined;
	const windows = classifyWindows(normalizeWindow(rateLimit.primary_window), normalizeWindow(rateLimit.secondary_window));
	const canonical: UsageWindow[] = [];
	if (windows.fiveHour) {
		canonical.push({
			kind: "rolling",
			label: "5h",
			usedPercent: windows.fiveHour.usedPercent,
			...(windows.fiveHour.resetAt !== undefined ? { resetAtMs: windows.fiveHour.resetAt * 1000 } : {}),
		});
	}
	if (windows.weekly) {
		canonical.push({
			kind: "weekly",
			label: "7d",
			usedPercent: windows.weekly.usedPercent,
			...(windows.weekly.resetAt !== undefined ? { resetAtMs: windows.weekly.resetAt * 1000 } : {}),
		});
	}
	return canonical.length ? { provider: CODEX_PROVIDER, state: "ready", windows: canonical, capturedAtMs: capturedAt } : undefined;
}

function extractAccountId(accessToken: string): string | undefined {
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

async function cancelResponseBody(response: Response): Promise<void> {
	if (!response.body) return;
	try {
		await response.body.cancel();
	} catch {
		// The response is already unusable; there is nothing safe to report.
	}
}

export async function readResponseTextLimited(response: Response, maxBytes: number, name: string): Promise<string> {
	const contentLength = Number(response.headers.get("content-length"));
	if (Number.isFinite(contentLength) && contentLength > maxBytes) {
		await cancelResponseBody(response);
		throw new Error(`${name} usage response is too large`);
	}
	if (!response.body) {
		const body = await response.text();
		if (Buffer.byteLength(body) > maxBytes) throw new Error(`${name} usage response is too large`);
		return body;
	}

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let bytes = 0;
	let body = "";
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			bytes += value.byteLength;
			if (bytes > maxBytes) {
				await reader.cancel();
				throw new Error(`${name} usage response is too large`);
			}
			body += decoder.decode(value, { stream: true });
		}
		body += decoder.decode();
		return body;
	} finally {
		reader.releaseLock();
	}
}

async function readJson(response: Response, name: string): Promise<unknown> {
	if (!response.ok) {
		await cancelResponseBody(response);
		throw new Error(`${name} usage request failed (${response.status})`);
	}
	const body = await readResponseTextLimited(response, MAX_RESPONSE_BYTES, name);
	try {
		return JSON.parse(body);
	} catch {
		throw new Error(`${name} usage response is invalid`);
	}
}

async function resolveCodexAuth(ctx: ExtensionContext, signal: AbortSignal): Promise<Awaited<ReturnType<ExtensionContext["modelRegistry"]["getProviderAuth"]>>> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(() => reject(new Error("Codex auth resolution timed out")), REQUEST_TIMEOUT_MS);
	});
	const aborted = new Promise<never>((_, reject) => {
		if (signal.aborted) reject(new Error("Codex auth resolution aborted"));
		else signal.addEventListener("abort", () => reject(new Error("Codex auth resolution aborted")), { once: true });
	});
	try {
		return await Promise.race([ctx.modelRegistry.getProviderAuth(CODEX_PROVIDER), timeout, aborted]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}

async function fetchCodexUsage(ctx: ExtensionContext, signal: AbortSignal): Promise<UsageStatus> {
	const provider = ctx.modelRegistry.getProvider(CODEX_PROVIDER);
	if (!provider || !isOfficialBaseUrl(provider.baseUrl)) throw new Error("Codex provider endpoint is not official");
	const resolved = await resolveCodexAuth(ctx, signal);
	if (!resolved || !isOfficialBaseUrl(resolved.auth.baseUrl)) throw new Error("Codex auth is unavailable");
	const token = resolved.auth.apiKey;
	if (!token) throw new Error("Codex access token is unavailable");
	const accountId = extractAccountId(token);
	if (!accountId) throw new Error("Codex account id is unavailable");
	const response = await fetch(CODEX_USAGE_URL, {
		headers: {
			Accept: "application/json",
			Authorization: `Bearer ${token}`,
			"ChatGPT-Account-Id": accountId,
		},
		signal,
		redirect: "error",
	});
	const usage = normalizeCodexUsage(await readJson(response, "Codex"));
	if (!usage) throw new Error("Codex usage response has no rate limits");
	return usage;
}

type HydrationBudget = { candidates: number; scanned: number };

function findObjectAfter(html: string, start: number, budget: HydrationBudget): string | undefined {
	if (budget.candidates >= MAX_HYDRATION_CANDIDATES || budget.scanned >= MAX_HYDRATION_SCAN_TOTAL) return undefined;
	const open = html.indexOf("{", start);
	if (open < 0 || open - start > 128) return undefined;
	budget.candidates++;
	const end = Math.min(html.length, open + MAX_HYDRATION_SCAN_CHARS);
	budget.scanned += end - open;
	let depth = 0;
	let quoted = false;
	let escaped = false;
	for (let index = open; index < end; index++) {
		const character = html[index];
		if (quoted) {
			if (escaped) escaped = false;
			else if (character === "\\") escaped = true;
			else if (character === '"') quoted = false;
		} else if (character === '"') quoted = true;
		else if (character === "{") depth++;
		else if (character === "}" && --depth === 0) return html.slice(open, index + 1);
	}
	return undefined;
}

function hydrationVariants(value: string): string[] {
	const variants = [value];
	let decoded = value;
	for (let index = 0; index < 2; index++) {
		const next = decoded
			.replace(/\\u0022/g, '"')
			.replace(/\\"/g, '"')
			.replace(/\\\\/g, "\\");
		if (next === decoded) break;
		variants.push(next);
		decoded = next;
	}
	return variants;
}

function hydrationNumber(object: string, name: string): number | undefined {
	const match = object.match(new RegExp(`(?:["']?${name}["']?)\\s*:\\s*(-?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][+-]?\\d+)?)`));
	if (!match) return undefined;
	const value = Number(match[1]);
	return Number.isFinite(value) ? value : undefined;
}

function hydrationWindow(html: string, name: string, budget: HydrationBudget): { usagePercent: number; resetInSec: number } | undefined {
	for (const variant of hydrationVariants(html)) {
		let position = 0;
		while ((position = variant.indexOf(name, position)) >= 0) {
			const colon = variant.indexOf(":", position + name.length);
			if (colon >= 0 && colon - position < 128) {
				const object = findObjectAfter(variant, colon + 1, budget);
				if (object) {
					const usagePercent = hydrationNumber(object, "usagePercent");
					const resetInSec = hydrationNumber(object, "resetInSec");
					if (usagePercent !== undefined && resetInSec !== undefined) {
						return { usagePercent, resetInSec };
					}
				}
			}
			position += name.length;
		}
	}
	return undefined;
}

type ParsedHtmlWindow = { kind: UsageWindow["kind"]; label: string; usedPercent: number; resetInSec: number };

function balancedElementContent(html: string, tag: string, contentStart: number): { content: string; end: number } | undefined {
	const tagPattern = new RegExp(`<\\/?${tag}\\b[^>]*>`, "gi");
	tagPattern.lastIndex = contentStart;
	let depth = 1;
	for (const match of html.matchAll(tagPattern)) {
		if (match.index - contentStart > 8192) return undefined;
		if (match[0].startsWith("</")) depth--;
		else if (!match[0].endsWith("/>")) depth++;
		if (depth === 0) return { content: html.slice(contentStart, match.index), end: match.index + match[0].length };
	}
	return undefined;
}

function parseUsageItems(html: string): ParsedHtmlWindow[] {
	const windows: ParsedHtmlWindow[] = [];
	const itemPattern = /<([a-z][\w:-]*)\b[^>]*\bdata-slot\s*=\s*["']usage-item["'][^>]*>/gi;
	let match: RegExpExecArray | null;
	while ((match = itemPattern.exec(html))) {
		const item = balancedElementContent(html, match[1]!, match.index + match[0].length);
		if (!item) continue;
		itemPattern.lastIndex = item.end;
		const text = item.content.replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ").replace(/\s+/g, " ");
		const labelMatch = text.match(/\b(Rolling|Weekly|Monthly)\s+Usage\b/i);
		const percentMatch = text.match(/(\d+(?:\.\d+)?)\s*%/);
		const resetMatch = text.match(/reset(?:s|ting)?\s+in\s+([^<]+)/i);
		if (!labelMatch || !percentMatch || !resetMatch) continue;
		const units: Record<string, number> = { s: 1, sec: 1, secs: 1, second: 1, seconds: 1, m: 60, min: 60, mins: 60, minute: 60, minutes: 60, h: 3600, hr: 3600, hrs: 3600, hour: 3600, hours: 3600, d: 86400, day: 86400, days: 86400 };
		let resetInSec = 0;
		let matchedUnit = false;
		for (const part of resetMatch[1]!.matchAll(/(\d+(?:\.\d+)?)\s*(s|secs?|seconds?|m|mins?|minutes?|h|hrs?|hours?|d|days?)(?=\b)/gi)) {
			resetInSec += Number(part[1]) * units[part[2]!.toLowerCase()]!;
			matchedUnit = true;
		}
		if (!matchedUnit || !Number.isFinite(resetInSec) || resetInSec < 0) continue;
		const title = labelMatch[1]!.toLowerCase();
		windows.push({ kind: title === "rolling" ? "rolling" : title === "weekly" ? "weekly" : "monthly", label: title === "rolling" ? "5h" : title === "weekly" ? "7d" : "30d", usedPercent: Number(percentMatch[1]), resetInSec });
	}
	return windows;
}

export function normalizeOpencodeGoUsage(html: string, capturedAt = Date.now()): UsageStatus | undefined {
	const definitions: Array<[string, UsageWindow["kind"], string]> = [["rollingUsage", "rolling", "5h"], ["weeklyUsage", "weekly", "7d"], ["monthlyUsage", "monthly", "30d"]];
	const budget: HydrationBudget = { candidates: 0, scanned: 0 };
	const hydrated = definitions.flatMap(([field, kind, label]) => {
		const value = hydrationWindow(html, field, budget);
		const usedPercent = normalizeUsagePercent(value?.usagePercent);
		const resetInSec = value?.resetInSec;
		const resetAtMs = resetInSec === undefined ? undefined : capturedAt + resetInSec * 1000;
		return usedPercent === undefined || resetInSec === undefined || !Number.isFinite(resetInSec) || resetInSec < 0 || !Number.isFinite(resetAtMs) ? [] : [{ kind, label, usedPercent, resetAtMs } satisfies UsageWindow];
	});
	const fallback = parseUsageItems(html).flatMap((value) => {
		const usedPercent = normalizeUsagePercent(value.usedPercent);
		const resetAtMs = capturedAt + value.resetInSec * 1000;
		return usedPercent === undefined || !Number.isFinite(resetAtMs) ? [] : [{ kind: value.kind, label: value.label, usedPercent, resetAtMs } satisfies UsageWindow];
	});
	const hydratedKinds = new Set(hydrated.map((window) => window.kind));
	const values = [...hydrated, ...fallback.filter((window) => !hydratedKinds.has(window.kind))];
	return values.length ? { provider: OPENCODE_PROVIDER, state: "ready", windows: values, capturedAtMs: capturedAt } : undefined;
}

async function fetchOpencodeUsage(signal: AbortSignal): Promise<UsageStatus> {
	const workspace = process.env.OPENCODE_GO_WORKSPACE_ID;
	const cookie = process.env.OPENCODE_GO_AUTH_COOKIE;
	if (!workspace || !cookie) throw new Error("OpenCode Go credentials are unavailable");
	const response = await fetch(`${OPENCODE_USAGE_URL}${encodeURIComponent(workspace)}/go`, {
		headers: { Accept: "text/html", Cookie: `auth=${cookie}` },
		redirect: "error",
		signal,
	});
	if (!response.ok) {
		await cancelResponseBody(response);
		throw new Error(`OpenCode Go usage request failed (${response.status})`);
	}
	const html = await readResponseTextLimited(response, MAX_HTML_RESPONSE_BYTES, "OpenCode Go");
	const usage = normalizeOpencodeGoUsage(html);
	if (!usage) throw new Error("OpenCode Go usage response has no rate limits");
	return usage;
}

export default function providerUsage(pi: ExtensionAPI): void {
	registerStatusline(pi);
	let activeContext: ExtensionContext | undefined;
	let activeProvider: string | undefined;
	let latestUsage: UsageStatus | undefined;
	let lastFetchedAt = 0;
	let generation = 0;
	let refreshPromise: Promise<void> | undefined;
	let requestController: AbortController | undefined;
	let refreshTimer: ReturnType<typeof setInterval> | undefined;
	let sessionActive = false;

	const supported = (provider: string | undefined): provider is UsageProvider =>
		isUsageProvider(provider);

	const clearRequest = (): void => {
		requestController?.abort();
		requestController = undefined;
		refreshPromise = undefined;
	};

	const clearUsage = (ctx: ExtensionContext): void => {
		latestUsage = undefined;
		lastFetchedAt = 0;
		if (ctx.hasUI) ctx.ui.setStatus(USAGE_STATUS_KEY, undefined);
	};

	const publish = (ctx: ExtensionContext, usage: UsageStatus | undefined): void => {
		if (!ctx.hasUI) return;
		if (usage) {
			ctx.ui.setStatus(USAGE_STATUS_KEY, encodeUsageStatus(usage));
			return;
		}
		const provider = ctx.model?.provider;
		if (!provider || !supported(provider)) {
			ctx.ui.setStatus(USAGE_STATUS_KEY, undefined);
			return;
		}
		ctx.ui.setStatus(USAGE_STATUS_KEY, encodeUsageStatus({
			provider,
			state: "unknown",
			windows: [],
			capturedAtMs: Date.now(),
		}));
	};

	const refresh = (ctx: ExtensionContext): Promise<void> => {
		const provider = ctx.model?.provider;
		if (!ctx.hasUI || !supported(provider)) {
			if (ctx.hasUI && supported(activeProvider)) clearUsage(ctx);
			return Promise.resolve();
		}

		const cacheTtl = provider === OPENCODE_PROVIDER ? OPENCODE_CACHE_TTL_MS : CODEX_CACHE_TTL_MS;
		if (latestUsage?.provider === provider && Date.now() - lastFetchedAt < cacheTtl) {
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
				const usage = provider === OPENCODE_PROVIDER
					? await fetchOpencodeUsage(controller.signal)
					: await fetchCodexUsage(ctx, controller.signal);
				if (!sessionActive || requestGeneration !== generation || ctx.model?.provider !== activeProvider) return;
				latestUsage = usage;
				lastFetchedAt = Date.now();
				publish(ctx, usage);
			} catch {
				if (!sessionActive || requestGeneration !== generation || ctx.model?.provider !== provider) return;
				if (latestUsage?.provider === provider) publish(ctx, latestUsage);
				else publish(ctx, undefined);
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
		// A reload can start a new runtime without delivering the old shutdown
		// event. Do not let an in-flight request or cached quota cross sessions.
		generation++;
		clearRequest();
		if (refreshTimer) clearInterval(refreshTimer);
		refreshTimer = undefined;
		latestUsage = undefined;
		lastFetchedAt = 0;
		sessionActive = true;
		activeContext = ctx;
		activeProvider = ctx.model?.provider;
		if (ctx.hasUI && supported(activeProvider)) publish(ctx, undefined);
		else if (ctx.hasUI) clearUsage(ctx);
		if (ctx.hasUI && !refreshTimer) {
			refreshTimer = setInterval(() => {
				if (activeContext && supported(activeProvider)) void refresh(activeContext);
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
		} else if (supported(provider)) {
			// A same-provider model selection can refresh credentials; invalidate
			// any request and cached quota associated with the old credentials.
			generation++;
			clearRequest();
			clearUsage(ctx);
		}
		if (supported(provider)) {
			publish(ctx, latestUsage?.provider === provider ? latestUsage : undefined);
			void refresh(ctx);
		}
	});

	pi.on("turn_end", (_event, ctx) => {
		activeContext = ctx;
		if (supported(ctx.model?.provider)) void refresh(ctx);
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
		if (ctx.hasUI) ctx.ui.setStatus(USAGE_STATUS_KEY, undefined);
	});
}

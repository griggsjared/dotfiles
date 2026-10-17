import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { asNumber, asObject, readJson } from "../http.ts";
import { normalizeUsagePercent, type UsageStatus, type UsageWindow } from "../usage-status.ts";
import { resolveProviderAuth } from "./auth.ts";

export const ANTHROPIC_PROVIDER = "anthropic";
// The usage endpoint is rate-limited; response headers fill in between fetches.
export const ANTHROPIC_CACHE_TTL_MS = 300_000;

const HEADER_PREFIX = "anthropic-ratelimit-unified-";
const ANTHROPIC_USAGE_URL = "https://api.anthropic.com/api/oauth/usage";

function normalizeWindow(headers: Record<string, string>, key: string, kind: UsageWindow["kind"]): UsageWindow | undefined {
	const raw = headers[`${HEADER_PREFIX}${key}-utilization`];
	if (raw === undefined || raw.trim() === "") return undefined;
	const usedPercent = normalizeUsagePercent(Number(raw) * 100);
	if (usedPercent === undefined) return undefined;
	const reset = Number(headers[`${HEADER_PREFIX}${key}-reset`]);
	return { kind, label: key, usedPercent, ...(Number.isFinite(reset) && reset > 0 ? { resetAtMs: reset * 1000 } : {}) };
}

/**
 * Reads plan usage from the headers Anthropic attaches to every Messages
 * response, as Claude Code does. API-key responses carry no unified headers.
 */
export function normalizeAnthropicHeaders(headers: Record<string, string>, capturedAt = Date.now()): UsageStatus | undefined {
	const windows = [
		normalizeWindow(headers, "5h", "rolling"),
		normalizeWindow(headers, "7d", "weekly"),
	].filter((window): window is UsageWindow => window !== undefined);
	return windows.length ? { provider: ANTHROPIC_PROVIDER, state: "ready", windows, capturedAtMs: capturedAt } : undefined;
}

/** Unlike the headers, the usage endpoint reports utilization as 0-100. */
export function normalizeAnthropicUsage(payload: unknown, capturedAt = Date.now()): UsageStatus | undefined {
	const object = asObject(payload);
	const windows: UsageWindow[] = [];
	for (const [key, kind, label] of [["five_hour", "rolling", "5h"], ["seven_day", "weekly", "7d"]] as const) {
		const window = asObject(object?.[key]);
		const usedPercent = normalizeUsagePercent(asNumber(window?.utilization));
		if (usedPercent === undefined) continue;
		const resetAtMs = typeof window?.resets_at === "string" ? Date.parse(window.resets_at) : NaN;
		windows.push({ kind, label, usedPercent, ...(Number.isFinite(resetAtMs) && resetAtMs > 0 ? { resetAtMs } : {}) });
	}
	return windows.length ? { provider: ANTHROPIC_PROVIDER, state: "ready", windows, capturedAtMs: capturedAt } : undefined;
}

function isOfficialBaseUrl(value: string | undefined): boolean {
	if (!value) return true;
	try {
		const url = new URL(value);
		return url.protocol === "https:" && url.hostname === "api.anthropic.com" && url.port === "";
	} catch {
		return false;
	}
}

export async function fetchAnthropicUsage(ctx: ExtensionContext, signal: AbortSignal): Promise<UsageStatus> {
	const provider = ctx.modelRegistry.getProvider(ANTHROPIC_PROVIDER);
	if (!isOfficialBaseUrl(provider?.baseUrl)) throw new Error("Anthropic provider endpoint is not official");
	const resolved = await resolveProviderAuth(ctx, ANTHROPIC_PROVIDER, signal);
	if (!resolved || !isOfficialBaseUrl(resolved.auth.baseUrl)) throw new Error("Anthropic auth is unavailable");
	const token = resolved.auth.apiKey;
	if (!token) throw new Error("Anthropic access token is unavailable");
	// API keys have no plan quota to report.
	if (!token.startsWith("sk-ant-oat")) return { provider: ANTHROPIC_PROVIDER, state: "ready", windows: [], capturedAtMs: Date.now() };
	const response = await fetch(ANTHROPIC_USAGE_URL, {
		headers: {
			Accept: "application/json",
			Authorization: `Bearer ${token}`,
			"anthropic-beta": "oauth-2025-04-20",
		},
		signal,
		redirect: "error",
	});
	const usage = normalizeAnthropicUsage(await readJson(response, "Anthropic"));
	if (!usage) throw new Error("Anthropic usage response has no rate limits");
	return usage;
}

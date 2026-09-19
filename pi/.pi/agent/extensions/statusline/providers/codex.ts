import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { asNumber, asObject, readJson } from "../http.ts";
import type { UsageStatus, UsageWindow } from "../usage-status.ts";
import { resolveProviderAuth } from "./auth.ts";

export const CODEX_PROVIDER = "openai-codex";
export const CODEX_CACHE_TTL_MS = 60_000;

const CODEX_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const WEEKLY_WINDOW_THRESHOLD_SECONDS = 24 * 60 * 60;

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

function normalizeWindow(value: unknown): CodexUsageWindow | undefined {
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

export async function fetchCodexUsage(ctx: ExtensionContext, signal: AbortSignal): Promise<UsageStatus> {
	const provider = ctx.modelRegistry.getProvider(CODEX_PROVIDER);
	if (!provider || !isOfficialBaseUrl(provider.baseUrl)) throw new Error("Codex provider endpoint is not official");
	const resolved = await resolveProviderAuth(ctx, CODEX_PROVIDER, signal);
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

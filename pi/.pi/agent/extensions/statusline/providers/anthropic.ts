import { normalizeUsagePercent, type UsageStatus, type UsageWindow } from "../usage-status.ts";

export const ANTHROPIC_PROVIDER = "anthropic";

const HEADER_PREFIX = "anthropic-ratelimit-unified-";

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
 * response, as Claude Code does, instead of polling the rate-limited
 * /api/oauth/usage endpoint. API-key responses carry no unified headers.
 */
export function normalizeAnthropicHeaders(headers: Record<string, string>, capturedAt = Date.now()): UsageStatus | undefined {
	const windows = [
		normalizeWindow(headers, "5h", "rolling"),
		normalizeWindow(headers, "7d", "weekly"),
	].filter((window): window is UsageWindow => window !== undefined);
	return windows.length ? { provider: ANTHROPIC_PROVIDER, state: "ready", windows, capturedAtMs: capturedAt } : undefined;
}

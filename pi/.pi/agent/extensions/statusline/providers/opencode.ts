import { cancelResponseBody, readResponseTextLimited } from "../http.ts";
import { normalizeUsagePercent, type UsageStatus, type UsageWindow } from "../usage-status.ts";

export const OPENCODE_PROVIDER = "opencode-go";
export const OPENCODE_CACHE_TTL_MS = 5 * 60_000;

const OPENCODE_USAGE_URL = "https://opencode.ai/workspace/";
const MAX_HTML_RESPONSE_BYTES = 256 * 1024;
const MAX_HYDRATION_CANDIDATES = 256;
const MAX_HYDRATION_SCAN_CHARS = 16 * 1024;
const MAX_HYDRATION_SCAN_TOTAL = 256 * 1024;

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

export async function fetchOpencodeUsage(signal: AbortSignal): Promise<UsageStatus> {
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

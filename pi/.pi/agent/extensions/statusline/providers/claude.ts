import childProcess from "node:child_process";
import { stripVTControlCharacters } from "node:util";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { REQUEST_TIMEOUT_MS } from "../http.ts";
import { normalizeUsagePercent, type UsageStatus, type UsageWindow } from "../usage-status.ts";

export const CLAUDE_PROVIDER = "claude-bridge";
export const CLAUDE_CACHE_TTL_MS = 300_000;

function parseReset(reset: string, capturedAt: number): number | undefined {
	const match = /^(\w{3}) (\d{1,2}) at (\d{1,2}):(\d{2})(am|pm) \(([^)]+)\)$/i.exec(reset.trim());
	if (!match) return undefined;
	const month = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(match[1]!.toLowerCase());
	const day = Number(match[2]);
	const clockHour = Number(match[3]);
	const minute = Number(match[4]);
	if (month < 0 || day < 1 || day > 31 || clockHour < 1 || clockHour > 12 || minute > 59) return undefined;
	const hour = clockHour % 12 + (match[5]!.toLowerCase() === "pm" ? 12 : 0);
	try {
		const formatter = new Intl.DateTimeFormat("en-US", {
			timeZone: match[6], year: "numeric", month: "2-digit", day: "2-digit",
			hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
		});
		const current = Object.fromEntries(formatter.formatToParts(capturedAt).map((part) => [part.type, Number(part.value)]));
		const year = current.year! + (month + 1 - current.month! > 6 ? -1 : current.month! - month - 1 > 6 ? 1 : 0);
		const target = Date.UTC(year, month, day, hour, minute);
		if (new Date(target).getUTCMonth() !== month) return undefined;
		let instant = target;
		for (let attempt = 0; attempt < 3; attempt++) {
			const parts = Object.fromEntries(formatter.formatToParts(instant).map((part) => [part.type, Number(part.value)]));
			const delta = target - Date.UTC(parts.year!, parts.month! - 1, parts.day!, parts.hour!, parts.minute!, parts.second!);
			if (delta === 0) return instant >= 0 ? instant : undefined;
			instant += delta;
		}
		return undefined;
	} catch {
		return undefined;
	}
}

export function normalizeClaudeUsage(payload: unknown, capturedAt = Date.now()): UsageStatus | undefined {
	if (typeof payload !== "string") return undefined;
	const text = stripVTControlCharacters(payload);
	const windows: UsageWindow[] = [];
	for (const [pattern, kind, label] of [
		[/^Current session:\s*(-?\d+(?:\.\d+)?)%\s+used\b(?:\s*[·—-]\s*resets\s+(.+))?/im, "rolling", "5h"],
		[/^Current week \(all models\):\s*(-?\d+(?:\.\d+)?)%\s+used\b(?:\s*[·—-]\s*resets\s+(.+))?/im, "weekly", "7d"],
	] as const) {
		const match = pattern.exec(text);
		if (!match) continue;
		const usedPercent = normalizeUsagePercent(Number(match[1]));
		if (usedPercent === undefined) continue;
		const resetAtMs = match[2] === undefined ? undefined : parseReset(match[2], capturedAt);
		windows.push({ kind, label, usedPercent, ...(resetAtMs !== undefined ? { resetAtMs } : {}) });
	}
	return windows.length ? { provider: CLAUDE_PROVIDER, state: "ready", windows, capturedAtMs: capturedAt } : undefined;
}

export async function fetchClaudeUsage(_ctx: ExtensionContext, signal: AbortSignal): Promise<UsageStatus> {
	signal.throwIfAborted();
	const output = await new Promise<string>((resolve, reject) => {
		const child = childProcess.execFile("claude", [
			"--settings", JSON.stringify({ remoteControlAtStartup: false, disableAllHooks: true }),
			"--strict-mcp-config", "--tools", "", "--setting-sources", "", "/usage",
		], {
			encoding: "utf8", signal, timeout: REQUEST_TIMEOUT_MS, maxBuffer: 64 * 1024, killSignal: "SIGKILL",
		}, (error, stdout) => {
			if (signal.aborted) reject(signal.reason);
			else if (error) reject(new Error("Claude usage CLI request failed"));
			else resolve(stdout);
		});
		child.stdin?.end();
	});
	const usage = normalizeClaudeUsage(output);
	if (!usage) throw new Error("Claude usage response has no rate limits");
	return usage;
}

/**
 * Custom footer that mimics the Claude Code statusline format.
 *
 * Shows mode, model name, thinking level, context usage, session cost or provider
 * rate limits, and provider — all in a compact Claude-style layout.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import {
	decodeUsageStatus,
	isUsageProvider,
	USAGE_STATUS_KEY,
	type UsageStatus,
} from "./usage-status.ts";
const WINDOW_ORDER = ["rolling", "weekly", "monthly"] as const;

export function decodeFooterUsageStatus(value: string | undefined): UsageStatus | undefined {
	return value ? decodeUsageStatus(value) : undefined;
}

export function formatFooterReset(resetAtMs: number | undefined, now = Date.now()): string | undefined {
	if (resetAtMs === undefined || !Number.isFinite(resetAtMs) || resetAtMs <= 0) return undefined;
	const seconds = Math.max(0, Math.round(resetAtMs / 1000 - now / 1000));
	if (seconds === 0) return "now";
	if (seconds < 60) return "1m";
	const days = Math.floor(seconds / 86400);
	const hours = Math.floor((seconds % 86400) / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	if (days >= 7) return `${days}d`;
	if (days > 0) return `${days}d${hours > 0 ? `${hours}h` : ""}`;
	if (hours > 0) return `${hours}h${minutes > 0 ? `${minutes}m` : ""}`;
	return `${minutes}m`;
}

export function formatFooterUsage(status: UsageStatus, now = Date.now(), maxWidth = Infinity): string {
	const windows = [...status.windows]
		.sort((a, b) => WINDOW_ORDER.indexOf(a.kind) - WINDOW_ORDER.indexOf(b.kind));
	const full = windows.map((window) => {
		const reset = formatFooterReset(window.resetAtMs, now);
		return `${Math.round(window.usedPercent)}%${reset ? `(${reset})` : ""}`;
	}).join(" ");
	if (maxWidth === Infinity) return full;

	const width = Number.isFinite(maxWidth) ? Math.max(0, Math.floor(maxWidth)) : 0;
	if (visibleWidth(full) <= width) return full;
	const compact = windows.map((window) => `${Math.round(window.usedPercent)}%`).join(" ");
	if (visibleWidth(compact) <= width) return compact;
	const truncated = truncateToWidth(compact, width, "");
	return visibleWidth(truncated) <= width ? truncated : "";
}

export function calculateFooterCost(entries: ReadonlyArray<{ type: string; message?: unknown }>): number {
	let cost = 0;
	for (const entry of entries) {
		if (entry.type !== "message" || !entry.message || typeof entry.message !== "object") continue;
		const message = entry.message as { role?: unknown; usage?: unknown };
		if (message.role !== "assistant" || !message.usage || typeof message.usage !== "object") continue;
		const usage = message.usage as { cost?: unknown };
		if (!usage.cost || typeof usage.cost !== "object") continue;
		const total = (usage.cost as { total?: unknown }).total;
		if (typeof total === "number" && Number.isFinite(total)) cost += total;
	}
	return cost;
}

export function calculateFooterCacheHit(entries: ReadonlyArray<{ type: string; message?: unknown }>): number | undefined {
	let cacheRead = 0;
	let cacheInput = 0;
	for (const entry of entries) {
		if (entry.type !== "message" || !entry.message || typeof entry.message !== "object") continue;
		const message = entry.message as { role?: unknown; usage?: unknown };
		if (message.role !== "assistant" || !message.usage || typeof message.usage !== "object") continue;
		const usage = message.usage as { input?: unknown; cacheRead?: unknown; cacheWrite?: unknown };
		if (
			typeof usage.input !== "number" || !Number.isFinite(usage.input) ||
			typeof usage.cacheRead !== "number" || !Number.isFinite(usage.cacheRead) ||
			typeof usage.cacheWrite !== "number" || !Number.isFinite(usage.cacheWrite)
		) continue;
		cacheRead += usage.cacheRead;
		cacheInput += usage.input + usage.cacheRead + usage.cacheWrite;
	}
	return cacheInput > 0 ? cacheRead / cacheInput * 100 : undefined;
}

function formatTokens(count: number): string {
	if (count < 1000) return String(count);
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	return `${Math.round(count / 1000000)}m`;
}

export function registerStatusline(pi: ExtensionAPI) {
	let costVersion = 0;
	let costCache: { version: number; leafId: string | null; cost: number; cacheHit?: number } | undefined;
	const invalidateCost = (): void => {
		costVersion++;
	};

	pi.on("session_start", (_event, ctx) => {
		invalidateCost();
		ctx.ui.setFooter((tui, theme, footerData) => {
			const redrawTimer = setInterval(() => tui.invalidate(), 60_000);
			return {
				dispose() {
					clearInterval(redrawTimer);
				},
				invalidate() {},
				render(width: number): string[] {
					//Extension statuses
					const statuses = footerData.getExtensionStatuses();
					const rawMode = statuses.get("modes") ?? "";
					const modeStatus = rawMode
						? theme.fg(rawMode === "build" ? "error" : rawMode === "plan" ? "borderAccent" : "accent", `[${rawMode[0]}]`)
						: "";

					//Model name
					const model = ctx.model;
					const modelName = model?.name || model?.id || "no-model";
					let line = theme.fg("customMessageLabel", modelName);
					if (modeStatus) {
						line = `${modeStatus} ${line}`;
					}

					//Thinking level / effort
					if (ctx.thinkingLevel && ctx.thinkingLevel !== "off") {
						line += theme.fg("success", ` ${ctx.thinkingLevel}`);
					}

					//Context usage
					const contextUsage = ctx.getContextUsage();
					if (contextUsage && contextUsage.tokens !== null && contextUsage.contextWindow > 0) {
						const used = formatTokens(contextUsage.tokens);
						const total = formatTokens(contextUsage.contextWindow);
						line += ` ${theme.fg(contextUsage.tokens >= 200000 ? "error" : "borderAccent", `${used}/${total}`)}`;
					}

					const leafId = ctx.sessionManager.getLeafId();
					if (!costCache || costCache.version !== costVersion || costCache.leafId !== leafId) {
						const branch = ctx.sessionManager.getBranch();
						costCache = {
							version: costVersion,
							leafId,
							cost: calculateFooterCost(branch),
							cacheHit: calculateFooterCacheHit(branch),
						};
					}
					if (costCache.cacheHit !== undefined) {
						line += ` ${theme.fg("warning", `C${Math.round(costCache.cacheHit)}%`)}`;
					}

					const usage = decodeFooterUsageStatus(statuses.get(USAGE_STATUS_KEY));
					if (usage?.state === "ready" && usage.provider === model?.provider && usage.windows.length > 0) {
						const providerWidth = model?.provider ? model.provider.length : 0;
						const usageWidth = Math.max(0, width - visibleWidth(line) - providerWidth - 3);
						line += ` ${theme.fg("dim", formatFooterUsage(usage, Date.now(), usageWidth))}`;
					} else if (isUsageProvider(model?.provider)) {
						line += ` ${theme.fg("dim", "quota:?")}`;
					} else {
						const cost = costCache.cost;
						if (cost > 0) {
							line += ` ${theme.fg("dim", `$${cost.toFixed(3)}`)}`;
						}
					}

					// ── Provider (right-aligned) ──
					const provider = model?.provider ? theme.fg("muted", model.provider) : "";
					const gap = width - visibleWidth(line) - visibleWidth(provider);

					const result = gap >= 2
						? line + " ".repeat(gap) + provider
						: truncateToWidth(line, Math.max(0, width - visibleWidth("...")), "...");

					// ── Show remaining extension statuses on subsequent lines ──
					const rest = Array.from(statuses.entries())
						.filter(([key]) => key !== "modes" && key !== USAGE_STATUS_KEY)
						.sort(([a], [b]) => a.localeCompare(b))
						.map(([, text]) => text);
					if (rest.length > 0) {
						return [result, ...rest.map((s) => truncateToWidth(s, width, theme.fg("dim", "...")))];
					}

					return [result];
				},
			};
		});
	});

	pi.on("turn_end", invalidateCost);
	pi.on("session_tree", invalidateCost);
	pi.on("session_compact", invalidateCost);
}

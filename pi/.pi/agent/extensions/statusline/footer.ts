/**
 * Custom footer that mimics the Claude Code statusline format.
 *
 * Shows mode, model name, thinking level, context usage, provider balance or
 * rate limits, and provider — all in a compact Claude-style layout.
 */
import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import {
	decodeUsageStatus,
	isQuotaProvider,
	USAGE_STATUS_KEY,
	type UsageBalance,
	type UsageStatus,
} from "./usage-status.ts";
const WINDOW_ORDER = ["rolling", "weekly", "monthly"] as const;
const CURRENCY_SYMBOLS: Record<string, string> = { USD: "$", CNY: "¥" };

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

export function formatFooterUsage(status: UsageStatus, now = Date.now(), maxWidth = Infinity, theme?: Pick<Theme, "fg">): string {
	const windows = [...status.windows]
		.sort((a, b) => WINDOW_ORDER.indexOf(a.kind) - WINDOW_ORDER.indexOf(b.kind));
	const formatWindow = (window: UsageStatus["windows"][number], withReset: boolean): string => {
		const reset = withReset ? formatFooterReset(window.resetAtMs, now) : undefined;
		const text = `${Math.round(window.usedPercent)}%${reset ? `(${reset})` : ""}`;
		const color = window.usedPercent >= 95 ? "error" : window.usedPercent >= 90 ? "warning" : "dim";
		return theme ? theme.fg(color, text) : text;
	};
	const full = windows.map((window) => formatWindow(window, true)).join(" ");
	if (maxWidth === Infinity) return full;

	const width = Number.isFinite(maxWidth) ? Math.max(0, Math.floor(maxWidth)) : 0;
	if (visibleWidth(full) <= width) return full;
	const compact = windows.map((window) => formatWindow(window, false)).join(" ");
	if (visibleWidth(compact) <= width) return compact;
	const truncated = truncateToWidth(compact, width, "");
	return visibleWidth(truncated) <= width ? truncated : "";
}

export function formatFooterBalance(balance: UsageBalance): string {
	const symbol = CURRENCY_SYMBOLS[balance.currency] ?? `${balance.currency} `;
	return `b:${symbol}${balance.amount.toFixed(2)}`;
}

export function calculateFooterCost(entries: ReadonlyArray<{ type: string; message?: unknown; usage?: unknown }>): number {
	let cost = 0;
	for (const entry of entries) {
		let directUsage: unknown;
		if (entry.type === "message" && entry.message && typeof entry.message === "object") {
			const message = entry.message as { role?: unknown; usage?: unknown };
			if (message.role === "assistant" || message.role === "toolResult") directUsage = message.usage;
		} else if (entry.type === "usage" || entry.type === "compaction" || entry.type === "branch_summary") {
			directUsage = entry.usage;
		}
		if (!directUsage || typeof directUsage !== "object") continue;
		const usage = directUsage as { cost?: unknown };
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
	let costCache: { version: number; leafId: string | null; cacheHit?: number } | undefined;
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
					const margin = width >= 3 ? 1 : 0;
					width -= margin * 2;
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

					const profile = statuses.get("subagent-profile");
					if (profile) {
						line += theme.fg("accent", ` s:${profile}`);
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
							cacheHit: calculateFooterCacheHit(branch),
						};
					}
					if (costCache.cacheHit !== undefined) {
						line += ` ${theme.fg("warning", `c:${Math.round(costCache.cacheHit)}%`)}`;
					}

					const usage = decodeFooterUsageStatus(statuses.get(USAGE_STATUS_KEY));
					const usageReady = usage?.state === "ready" && usage.provider === model?.provider;
					const providerText = model?.provider ?? "";
					const reserved = providerText ? visibleWidth(providerText) + 3 : 0;

					// ── Provider (right-aligned) ──
					let right = "";
					if (usageReady && usage.windows.length > 0) {
						const usageWidth = Math.max(0, width - visibleWidth(line) - reserved);
						const text = formatFooterUsage(usage, Date.now(), usageWidth, theme);
						if (text) right = text;
					} else if (isQuotaProvider(model?.provider) && !usageReady) {
						right = theme.fg("dim", "quota:?");
					}
					if (usageReady && usage.balance) {
						const text = formatFooterBalance(usage.balance);
						if (visibleWidth(line) + visibleWidth(right) + (right ? 1 : 0) + visibleWidth(text) + reserved <= width) {
							const color = usage.balance.currency === "USD" && usage.balance.amount < 0.5 ? "error"
								: usage.balance.currency === "USD" && usage.balance.amount < 1 ? "warning" : "dim";
							right += `${right ? " " : ""}${theme.fg(color, text)}`;
						}
					}
					const provider = providerText ? theme.fg("muted", providerText) : "";
					right += `${right && provider ? " " : ""}${provider}`;
					const gap = width - visibleWidth(line) - visibleWidth(right);

					const result = gap >= 2
						? line + " ".repeat(gap) + right
						: truncateToWidth(line, Math.max(0, width - visibleWidth("...")), "...");

					// ── Show remaining extension statuses on subsequent lines ──
					const rest = Array.from(statuses.entries())
						.filter(([key]) => key !== "modes" && key !== "subagent-profile" && key !== USAGE_STATUS_KEY)
						.sort(([a], [b]) => a.localeCompare(b))
						.map(([, text]) => text);
					return [result, ...rest.map((s) => truncateToWidth(s, width, theme.fg("dim", "...")))]
						.map((line) => margin > 0 ? ` ${line} ` : line);
				},
			};
		});
	});

	pi.on("turn_end", invalidateCost);
	pi.on("session_tree", invalidateCost);
	pi.on("session_compact", invalidateCost);
}

/**
 * Custom footer that mimics the Claude Code statusline format.
 *
 * Shows mode, model name, thinking level, context usage, session cost, and
 * provider — all in a compact Claude-style layout.
 */
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

function formatTokens(count: number): string {
	if (count < 1000) return String(count);
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	return `${Math.round(count / 1000000)}m`;
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", (_event, ctx) => {
		ctx.ui.setFooter((_tui, theme, footerData) => {
			return {
				dispose() {},
				invalidate() {},
				render(width: number): string[] {
					//Extension statuses
					const statuses = footerData.getExtensionStatuses();
					const modeStatus = statuses.get("modes") ?? "";

					//Model name
					const model = ctx.model;
					const modelName = model?.name || model?.id || "no-model";
					let line = theme.fg("success", modelName);
					if (modeStatus) {
						line = `${modeStatus} ${line}`;
					}

					//Thinking level / effort
					if (ctx.thinkingLevel && ctx.thinkingLevel !== "off") {
						line += theme.fg("warning", ` ${ctx.thinkingLevel}`);
					}

					//Context usage
					const contextUsage = ctx.getContextUsage();
					if (contextUsage && contextUsage.tokens !== null && contextUsage.contextWindow > 0) {
						const used = formatTokens(contextUsage.tokens);
						const total = formatTokens(contextUsage.contextWindow);
						line += ` ${theme.fg("borderAccent", `${used}/${total}`)}`;
					}

					//Cost
					let cost = 0;
					for (const e of ctx.sessionManager.getBranch()) {
						if (e.type === "message" && e.message.role === "assistant") {
							cost += (e.message as AssistantMessage).usage.cost.total;
						}
					}
					if (cost > 0) {
						line += ` ${theme.fg("dim", `$${cost.toFixed(3)}`)}`;
					}

					// ── Provider (right-aligned) ──
					const provider = model?.provider ? theme.fg("muted", model.provider) : "";
					const gap = width - visibleWidth(line) - visibleWidth(provider);

					const result = gap >= 2
						? line + " ".repeat(gap) + provider
						: truncateToWidth(line, width, "...");

					// ── Show remaining extension statuses on subsequent lines ──
					const rest = Array.from(statuses.entries())
						.filter(([key]) => key !== "modes")
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
}

/**
 * Custom footer that mimics the Claude Code statusline format.
 *
 * Shows model name, thinking level, context usage, token stats, and the
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
					//Model name
					const model = ctx.model;
					const modelName = model?.name || model?.id || "no-model";
					let line = theme.fg("success", modelName);

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

					//Token stats
					let input = 0, output = 0, cost = 0;
					for (const e of ctx.sessionManager.getBranch()) {
						if (e.type === "message" && e.message.role === "assistant") {
							const m = e.message as AssistantMessage;
							input += m.usage.input;
							output += m.usage.output;
							cost += m.usage.cost.total;
						}
					}
					if (input || output) {
						const stats = `↑${formatTokens(input)} ↓${formatTokens(output)}`;
						line += ` ${theme.fg("dim", stats)}`;
						if (cost > 0) {
							line += theme.fg("dim", ` $${cost.toFixed(3)}`);
						}
					}

					// ── Provider (dim, right-aligned) ──
					const provider = model?.provider ? theme.fg("muted", model.provider) : "";
					const gap = width - visibleWidth(line) - visibleWidth(provider);

					const result = gap >= 2
						? line + " ".repeat(gap) + provider
						: truncateToWidth(line, width, "...");

					// ── Show extension statuses on subsequent lines ──
					const statuses = footerData.getExtensionStatuses();
					if (statuses.size > 0) {
						const sorted = Array.from(statuses.entries())
							.sort(([a], [b]) => a.localeCompare(b))
							.map(([, text]) => text);
						return [result, ...sorted.map((s) => truncateToWidth(s, width, theme.fg("dim", "...")))];
					}

					return [result];
				},
			};
		});
	});
}

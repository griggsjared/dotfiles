/**
 * Custom footer that mimics the Claude Code statusline format.
 *
 * Shows model name, context usage, thinking level, token stats,
 * and cwd/git branch — all in a compact Claude-style layout.
 */
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

function formatTokens(count: number): string {
	if (count < 1000) return String(count);
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
	return `${Math.round(count / 1000000)}M`;
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", (_event, ctx) => {
		ctx.ui.setFooter((tui, theme, footerData) => {
			const unsub = footerData.onBranchChange(() => tui.requestRender());

			return {
				dispose: unsub,
				invalidate() {},
				render(width: number): string[] {
					//Model name
					const model = ctx.model;
					const modelName = model?.name || model?.id || "no-model";
					let line = theme.fg("borderAccent", modelName);

					//Thinking level / effort
					if (ctx.thinkingLevel && ctx.thinkingLevel !== "off") {
						line += theme.fg("warning", ` ${ctx.thinkingLevel}`);
					}

					//Context usage
					const contextUsage = ctx.getContextUsage();
					if (contextUsage && contextUsage.tokens !== null && contextUsage.contextWindow > 0) {
						const used = formatTokens(contextUsage.tokens);
						const total = formatTokens(contextUsage.contextWindow);
						const pct = contextUsage.percent !== null
							? `${contextUsage.percent.toFixed(1)}%`
							: "?%";
						line += ` ${theme.fg("accent", `${used}/${total} (${pct})`)}`;
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

					// ── CWD + git branch (dim, right-aligned) ──
					const branch = footerData.getGitBranch();
					const cwd = ctx.cwd;
					const home = process.env.HOME || "";
					const shortCwd = cwd.startsWith(home)
						? `~${cwd.slice(home.length)}`
						: cwd;
					const location = branch
						? `${shortCwd} (${branch})`
						: shortCwd;
					const locationStr = theme.fg("dim", location);

					// ── Layout: line on left, location on right ──
					const lineWidth = visibleWidth(line);
					const locationWidth = visibleWidth(locationStr);
					const minGap = 2;
					const needed = lineWidth + minGap + locationWidth;

					let result: string;
					if (needed <= width) {
						const gap = width - lineWidth - locationWidth;
						result = line + " ".repeat(gap) + locationStr;
					} else {
						// Truncate location if too narrow
						const avail = width - lineWidth - minGap;
						if (avail > 10) {
							const truncated = truncateToWidth(locationStr, avail, theme.fg("dim", "..."));
							result = line + " ".repeat(minGap) + truncated;
						} else {
							result = truncateToWidth(line, width, "...");
						}
					}

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

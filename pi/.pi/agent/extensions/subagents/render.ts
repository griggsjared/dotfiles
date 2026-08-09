import type { TUI } from "@earendil-works/pi-tui";
import { Box, Markdown, Spacer, Text, truncateToWidth } from "@earendil-works/pi-tui";
import {
  getMarkdownTheme,
  type ExtensionAPI,
  type ExtensionContext,
  type Theme,
  type ThemeColor,
} from "@earendil-works/pi-coding-agent";
import { formatUsageStats, shortLabel, toolCallLabel } from "./format.ts";
import type { JobRegistry } from "./registry.ts";
import {
  ENTRY_TYPE,
  WIDGET_KEY,
  type SubagentMessageDetails,
} from "./types.ts";

export type Fg = (color: ThemeColor, text: string) => string;

const MAX_WIDGET_LINES = 10; // pi caps string-array widgets at 10 lines; keep the same cap for the factory form

export function renderFullWidget(registry: JobRegistry, fg: Fg, width = 80): string[] {
  const now = Date.now();
  const maxWidth = Math.max(1, Math.floor(width));
  const running = registry.running();
  const completed = registry.pendingCompleted();

  const lines: string[] = [];
  for (const job of running) {
    const elapsed = ((now - job.startTime) / 1000).toFixed(1);
    const title = job.title ? `: ${job.title}` : "";
    lines.push(truncateToWidth(
      fg("accent", `◐ #${job.id} ${job.agent}`) +
        fg("muted", ` (${elapsed}s)`) +
        (title ? fg("dim", title) : ""),
      maxWidth,
      "",
    ));
    lines.push(truncateToWidth(fg("muted", `  ${shortLabel(undefined, job.progress ?? job.task, 40)}`), maxWidth, ""));
  }
  for (const job of completed) {
    const duration = job.endTime ? ((job.endTime - job.startTime) / 1000).toFixed(1) : "?";
    const icon = job.status === "completed" ? "✓" : "✗";
    const color = job.status === "completed" ? "success" : "error";
    const label = job.title ? `: ${job.title}` : `: ${shortLabel(undefined, job.task, 40)}`;
    lines.push(truncateToWidth(
      fg(color, `${icon} #${job.id} ${job.agent}`) +
        fg("muted", ` (${duration}s)`) +
        fg("dim", label),
      maxWidth,
      "",
    ));
  }
  if (lines.length > MAX_WIDGET_LINES) {
    lines.length = MAX_WIDGET_LINES - 1;
    lines.push(truncateToWidth(fg("muted", "... (widget truncated)"), maxWidth, ""));
  }
  return lines;
}

// Runs from tickers and after the tool call returns, when the captured ctx
// may be stale; only hasUI and ui are used.
export type UiContext = Pick<ExtensionContext, "hasUI" | "ui">;

export function refreshUi(ctx: UiContext, registry: JobRegistry): void {
  try {
    if (!ctx.hasUI) return;
    const running = registry.running();
    if (running.length > 0 || registry.pendingCompleted().length > 0) {
      // Factory form so lines can use theme colors; re-set on every tick,
      // so the factory re-runs with the current theme.
      ctx.ui.setWidget(WIDGET_KEY, (_tui: TUI, theme: Theme) => ({
        render: (width) => renderFullWidget(registry, (color, text) => theme.fg(color, text), width),
        invalidate: () => {},
      }));
    } else {
      ctx.ui.setWidget(WIDGET_KEY, []);
    }
  } catch { /* ctx stale after session change */ }
}

export function registerRenderers(pi: ExtensionAPI): void {
  pi.registerMessageRenderer<SubagentMessageDetails>(ENTRY_TYPE, (message, { expanded, outputPad }, theme) => {
    const details = message.details;
    if (!details) return new Text(typeof message.content === "string" ? message.content : "", 0, 0);

    const color = details.status === "completed" ? "success" : "error";
    const jobLabel = details.jobId === undefined ? details.agent : `#${details.jobId} ${details.agent}`;
    const prefix = theme.fg(color, details.icon + " " + jobLabel);
    const usageStr = formatUsageStats(details.usage, details.model, details.thinkingLevel);
    const title = details.title ? theme.fg("dim", `: ${details.title}`) : "";
    const taskFallback = details.title ? "" : `: ${theme.fg("dim", shortLabel(undefined, details.task, 60))}`;
    const headLine = `${prefix}${theme.fg("muted", ` (${details.duration})`)}${title}${taskFallback}`;
    const statsLine = usageStr ? theme.fg("dim", usageStr) : undefined;
    const mdTheme = getMarkdownTheme();
    const output = typeof message.content === "string" ? message.content : "";

    if (expanded) {
      const box = new Box(outputPad, 1, (t) => theme.bg("customMessageBg", t));
      box.addChild(new Text(headLine, 0, 0));
      if (statsLine) box.addChild(new Text(`  ${statsLine}`, 0, 0));
      if (output) {
        box.addChild(new Spacer(1));
        box.addChild(new Markdown(output, 0, 0, mdTheme));
      }
      if (details.toolCalls && details.toolCalls.length > 0) {
        box.addChild(new Spacer(1));
        box.addChild(new Text(theme.fg("muted", "Tool calls"), 0, 0));
        for (const call of details.toolCalls) {
          box.addChild(new Text(theme.fg("dim", `  ${toolCallLabel(call.name, call.args)}`), 0, 0));
        }
      }
      return box;
    }

    // Collapsed: title line, stats, and expand hint.
    const box = new Box(outputPad, 1, (t) => theme.bg("customMessageBg", t));
    box.addChild(new Text(headLine, 0, 0));
    if (statsLine) box.addChild(new Text(statsLine, 1, 0));
    if (output) box.addChild(new Text(theme.fg("muted", "(Ctrl+O to expand)"), 1, 0));
    return box;
  });
}

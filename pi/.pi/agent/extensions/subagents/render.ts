import type { TUI } from "@earendil-works/pi-tui";
import { Box, Container, Markdown, Spacer, Text } from "@earendil-works/pi-tui";
import {
  getMarkdownTheme,
  type ExtensionAPI,
  type ExtensionContext,
  type Theme,
  type ThemeColor,
} from "@earendil-works/pi-coding-agent";
import { formatUsageStats, shortLabel } from "./format.ts";
import type { JobRegistry } from "./registry.ts";
import {
  ENTRY_TYPE,
  WIDGET_KEY,
  type SubagentMessageDetails,
} from "./types.ts";

export type Fg = (color: ThemeColor, text: string) => string;

const MAX_WIDGET_LINES = 10; // pi caps string-array widgets at 10 lines; keep the same cap for the factory form

export function renderFullWidget(registry: JobRegistry, fg: Fg): string[] {
  const now = Date.now();
  const running = registry.running();
  const completed = registry.pendingCompleted();

  const lines: string[] = [];
  for (const job of running) {
    const elapsed = ((now - job.startTime) / 1000).toFixed(1);
    const title = job.title ? `: ${job.title}` : "";
    lines.push(
      fg("accent", `◐ ${job.agent}`) +
        fg("muted", ` (${elapsed}s)`) +
        (title ? fg("dim", title) : ""),
    );
    lines.push(fg("muted", `  ${shortLabel(undefined, job.progress ?? job.task, 40)}`));
  }
  for (const job of completed) {
    const duration = job.endTime ? ((job.endTime - job.startTime) / 1000).toFixed(1) : "?";
    const icon = job.status === "completed" ? "✓" : "✗";
    const color = job.status === "completed" ? "success" : "error";
    const label = job.title ? `: ${job.title}` : `: ${shortLabel(undefined, job.task, 40)}`;
    lines.push(
      fg(color, `${icon} ${job.agent}`) +
        fg("muted", ` (${duration}s)`) +
        fg("dim", label),
    );
  }
  if (lines.length > MAX_WIDGET_LINES) {
    lines.length = MAX_WIDGET_LINES - 1;
    lines.push(fg("muted", "... (widget truncated)"));
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
        render: () => renderFullWidget(registry, (color, text) => theme.fg(color, text)),
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
    const prefix = theme.fg(color, details.icon + " " + details.agent);
    const usageStr = formatUsageStats(details.usage, details.model);
    const title = details.title ? theme.fg("dim", `: ${details.title}`) : "";
    const taskFallback = details.title ? "" : `: ${theme.fg("dim", shortLabel(undefined, details.task, 60))}`;
    const headLine = `${prefix}${theme.fg("muted", ` (${details.duration})`)}${title}${taskFallback}`;
    const statsLine = usageStr ? theme.fg("dim", usageStr) : undefined;
    const mdTheme = getMarkdownTheme();
    const output = typeof message.content === "string" ? message.content : "";

    if (expanded) {
      const container = new Container();
      container.addChild(new Text(headLine, 0, 0));
      if (statsLine) container.addChild(new Text(`  ${statsLine}`, 0, 0));
      if (output) {
        container.addChild(new Spacer(1));
        container.addChild(new Markdown(output, 0, 0, mdTheme));
      }
      return container;
    }

    // Collapsed: title line, stats, first output line, expand hint
    const box = new Box(outputPad, 1, (t) => theme.bg("customMessageBg", t));
    box.addChild(new Text(headLine, 0, 0));
    if (statsLine) box.addChild(new Text(statsLine, 1, 0));
    if (output) {
      const firstLine = (output.split("\n")[0] ?? "").trim();
      const capped = firstLine.length > 80 ? `${firstLine.slice(0, 80)}…` : firstLine;
      if (firstLine) box.addChild(new Text(theme.fg("dim", capped), 1, 0));
      box.addChild(new Text(theme.fg("muted", "(Ctrl+O to expand)"), firstLine ? 2 : 1, 0));
    }
    return box;
  });
}

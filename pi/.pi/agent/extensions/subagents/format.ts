import { sliceByColumn, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { SubagentUsage } from "./types.ts";

const ANSI_ESCAPE = /\x1b(?:\][^\x07]*?(?:\x07|\x1b\\)|\[[0-?]*[ -/]*[@-~]|[()][0-2A-Z])/g;

function inlineText(value: string): string {
  return value
    .replace(ANSI_ESCAPE, "")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function clip(text: string, max: number): string {
  const width = Number.isFinite(max) ? Math.max(0, Math.floor(max)) : max;
  if (visibleWidth(text) <= width) return text;
  // pi-tui adds reset sequences around an ellipsis; labels are deliberately
  // unstyled, so remove those generated resets from the plain result.
  return truncateToWidth(text, width, "…").replace(/\x1b\[[0-9;]*m/g, "");
}

function pathClip(path: string, max: number): string {
  const width = Number.isFinite(max) ? Math.max(0, Math.floor(max)) : max;
  if (visibleWidth(path) <= width) return path;
  if (width <= 0) return "";
  if (width <= visibleWidth("…")) return clip(path, width);

  const suffixWidth = width - visibleWidth("…");
  for (let index = 0; index < path.length; index++) {
    if (path[index] !== "/" && path[index] !== "\\") continue;
    const suffix = path.slice(index);
    if (visibleWidth(suffix) <= suffixWidth) return `…${suffix}`;
  }
  const start = Math.max(0, visibleWidth(path) - suffixWidth);
  return `…${sliceByColumn(path, start, suffixWidth, true)}`;
}

function splitContentWidths(first: string, second: string, total: number): [number, number] {
  const width = Math.max(0, Math.floor(total));
  if (!second) return [width, 0];
  if (!first) return [0, width];
  const firstBudget = Math.min(visibleWidth(first), Math.floor(width / 2));
  const secondBudget = Math.min(visibleWidth(second), width - firstBudget);
  return [width - secondBudget, secondBudget];
}

function valueText(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text === undefined ? "" : inlineText(text);
}

function stringArg(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function subagentTaskLabel(task: unknown, max = 60): string {
  if (!task || typeof task !== "object") return "…";
  const item = task as Record<string, unknown>;
  const label = shortLabel(stringArg(item.title), stringArg(item.task), max);
  return clip(label, max);
}

// Coerce empty/whitespace-only/control-containing titles to undefined so the
// `??` fallbacks at every display site behave uniformly and stay inline-safe.
export function normalizeTitle(title: string | undefined): string | undefined {
  if (!title) return undefined;
  const cleaned = inlineText(title);
  return cleaned.length > 0 ? cleaned : undefined;
}

export function shortLabel(title: string | undefined, task: string | undefined, max: number): string {
  const normalizedTitle = normalizeTitle(title);
  if (normalizedTitle) return normalizedTitle;
  const normalizedTask = normalizeTitle(task);
  if (!normalizedTask) return "...";
  return clip(normalizedTask, max);
}

export function formatTokens(count: number): string {
  if (count < 1000) return count.toString();
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1000000) return `${Math.round(count / 1000)}k`;
  return `${(count / 1000000).toFixed(1)}M`;
}

export function formatDuration(milliseconds: number): string {
  const seconds = Math.max(1, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(seconds / 60);
  return minutes > 0 ? `${minutes}m${seconds % 60}s` : `${seconds}s`;
}

export function formatUsageStats(usage: SubagentUsage | undefined, model?: string, thinkingLevel?: string): string {
  if (!usage && !model && !thinkingLevel) return "";
  const parts: string[] = [];
  if (usage) {
    if (usage.turns > 0) parts.push(`${usage.turns} turn${usage.turns > 1 ? "s" : ""}`);
    if (usage.input > 0) parts.push(`↑${formatTokens(usage.input)}`);
    if (usage.output > 0) parts.push(`↓${formatTokens(usage.output)}`);
    if (usage.cacheRead > 0) parts.push(`R${formatTokens(usage.cacheRead)}`);
    if (usage.cacheWrite > 0) parts.push(`W${formatTokens(usage.cacheWrite)}`);
    if (usage.cost > 0) parts.push(`$${usage.cost < 0.0001 ? usage.cost.toFixed(6) : usage.cost.toFixed(4)}`);
    if (usage.contextTokens > 0) parts.push(`ctx:${formatTokens(usage.contextTokens)}`);
  }
  if (model) parts.push(thinkingLevel ? `${model}:${thinkingLevel}` : model);
  else if (thinkingLevel) parts.push(`effort:${thinkingLevel}`);
  return parts.join(" ");
}

export function formatResultOutput(result: { text: string; error: string }): string {
  const parts: string[] = [];
  if (result.text) parts.push(result.text);
  if (result.error) parts.push(result.error);
  return parts.join("\n") || "(no output)";
}

export function capOutput(output: string, max: number): string {
  return output.length > max ? `${output.slice(0, max)}\n…` : output;
}

// Plain, short label of a tool call, used for live progress in the widget.
export function toolCallLabel(name: string, args: Record<string, unknown>, width?: number): string {
  const maxWidth = width === undefined ? undefined : Math.max(0, Math.floor(width));
  const str = (value: unknown, max = 60): string => {
    const text = valueText(value);
    return text ? clip(text, max) : "";
  };
  const full = (value: unknown): string => valueText(value);
  const fit = (label: string): string => maxWidth === undefined ? label : clip(label, maxWidth);
  const pathValue = (): string => valueText(args.file_path ?? args.path ?? "…");
  const pathOf = (): string => pathClip(pathValue(), 60);
  const pathWithSuffix = (prefix: string, suffix: string): string => {
    if (maxWidth === undefined) return `${prefix}${pathOf()}${suffix}`;
    const available = maxWidth - visibleWidth(prefix) - visibleWidth(suffix);
    if (available >= 1) return fit(`${prefix}${pathClip(pathValue(), available)}${suffix}`);
    if (maxWidth >= visibleWidth(prefix) + visibleWidth(suffix)) return fit(`${prefix}${suffix}`);
    return fit(`${prefix}${pathValue()}`);
  };
  const twoArgs = (prefix: string, first: string, separator: string, path: string): string => {
    if (maxWidth === undefined) return `${prefix}${str(first)}${separator}${pathClip(path, 60)}`;
    const available = maxWidth - visibleWidth(prefix) - visibleWidth(separator);
    const [firstBudget, pathBudget] = splitContentWidths(first, path, available);
    return fit(`${prefix}${clip(first, firstBudget)}${separator}${pathClip(path, pathBudget)}`);
  };
  switch (name) {
    case "bash": {
      if (maxWidth === undefined) return `$ ${str(args.command ?? "…")}`;
      return fit(`$ ${clip(full(args.command ?? "…"), maxWidth - 2)}`);
    }
    case "read": {
      const offset = Number(args.offset);
      const limit = Number(args.limit);
      const hasOffset = Number.isFinite(offset);
      const hasLimit = Number.isFinite(limit) && limit > 0;
      const suffix = hasOffset || hasLimit
        ? `:${hasOffset ? offset : 1}${hasLimit ? `-${(hasOffset ? offset : 1) + limit - 1}` : ""}`
        : "";
      return pathWithSuffix("read ", suffix);
    }
    case "write": {
      const lines = typeof args.contentLines === "number" ? args.contentLines : 1;
      const suffix = lines > 1 ? ` (${lines} lines)` : "";
      return pathWithSuffix("write ", suffix);
    }
    case "edit": return pathWithSuffix("edit ", "");
    case "ls": {
      if (maxWidth === undefined) return `ls ${pathClip(valueText(args.path ?? "."), 60)}`;
      return fit(`ls ${pathClip(valueText(args.path ?? "."), maxWidth - 3)}`);
    }
    case "find":
      return twoArgs("find ", full(args.pattern ?? "*"), " in ", valueText(args.path ?? "."));
    case "grep":
      return twoArgs("grep /", full(args.pattern ?? ""), "/ in ", valueText(args.path ?? "."));
    case "subagent": {
      if (maxWidth === undefined) {
        const agent = str(args.agent ?? "…", 40);
        const preview = clip(
          valueText(normalizeTitle(stringArg(args.title)) ?? stringArg(args.task)) || "…",
          60,
        );
        if (Array.isArray(args.tasks) && args.tasks.length > 0) {
          const tasks = args.tasks.slice(0, 4).map((task) => `${str((task as Record<string, unknown>)?.agent ?? "…", 32)} · ${subagentTaskLabel(task, 48)}`);
          const more = args.tasks.length > tasks.length ? `, … +${args.tasks.length - tasks.length}` : "";
          return `subagent launch parallel (${args.tasks.length} tasks): ${tasks.join(", ")}${more}`;
        }
        return `subagent launch ${agent} · ${preview}`;
      }
      const agent = full(args.agent ?? "…");
      const preview = valueText(normalizeTitle(stringArg(args.title)) ?? stringArg(args.task)) || "…";
      if (Array.isArray(args.tasks) && args.tasks.length > 0) {
        const tasks = args.tasks.slice(0, 4).map((task) => {
          const item = task as Record<string, unknown>;
          return `${full(item?.agent ?? "…")} · ${subagentTaskLabel(task, Infinity)}`;
        });
        const more = args.tasks.length > tasks.length ? `, … +${args.tasks.length - tasks.length}` : "";
        return fit(`subagent launch parallel (${args.tasks.length} tasks): ${tasks.join(", ")}${more}`);
      }
      return fit(`subagent launch ${agent} · ${preview}`);
    }
    case "subagent_status":
      return fit(`subagent status ${args.jobId === undefined ? "all" : `#${full(args.jobId)}`}`);
    case "subagent_peek":
      return fit(`subagent peek ${args.jobId === undefined ? "…" : `#${full(args.jobId)}`}`);
    case "subagent_cancel":
      return fit(`subagent cancel ${args.all || args.jobId === undefined ? "all" : `#${full(args.jobId)}`}`);
    case "subagent_send": {
      const mode = args.deliverAs === "followUp" ? "follow-up" : "steering";
      const message = maxWidth === undefined ? str(args.message ?? "…", 60) : full(args.message ?? "…");
      return fit(`subagent send ${args.jobId === undefined ? "…" : `#${maxWidth === undefined ? str(args.jobId) : full(args.jobId)}`} ${mode} · ${message}`);
    }
    case "subagent_reply": {
      const answer = maxWidth === undefined ? str(args.answer ?? "…", 60) : full(args.answer ?? "…");
      return fit(`subagent reply ${args.jobId === undefined ? "…" : `#${maxWidth === undefined ? str(args.jobId) : full(args.jobId)}`} · ${answer}`);
    }
    default: return fit(`${inlineText(name)} ${maxWidth === undefined ? str(args) : full(args)}`);
  }
}

import type { SubagentUsage } from "./types.ts";

// Coerce empty/whitespace-only/newline-containing titles to undefined so the
// `??` fallbacks at every display site behave uniformly.
export function normalizeTitle(title: string | undefined): string | undefined {
  if (!title) return undefined;
  const cleaned = title.replace(/[\r\n]+/g, " ").trim();
  return cleaned.length > 0 ? cleaned : undefined;
}

export function shortLabel(title: string | undefined, task: string | undefined, max: number): string {
  if (title) return title;
  if (!task) return "...";
  return task.length > max ? `${task.slice(0, max)}…` : task;
}

export function formatTokens(count: number): string {
  if (count < 1000) return count.toString();
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1000000) return `${Math.round(count / 1000)}k`;
  return `${(count / 1000000).toFixed(1)}M`;
}

export function formatUsageStats(usage: SubagentUsage | undefined, model?: string): string {
  if (!usage) return "";
  const parts: string[] = [];
  if (usage.turns > 0) parts.push(`${usage.turns} turn${usage.turns > 1 ? "s" : ""}`);
  if (usage.input > 0) parts.push(`↑${formatTokens(usage.input)}`);
  if (usage.output > 0) parts.push(`↓${formatTokens(usage.output)}`);
  if (usage.cacheRead > 0) parts.push(`R${formatTokens(usage.cacheRead)}`);
  if (usage.cacheWrite > 0) parts.push(`W${formatTokens(usage.cacheWrite)}`);
  if (usage.cost > 0) parts.push(`$${usage.cost < 0.0001 ? usage.cost.toFixed(6) : usage.cost.toFixed(4)}`);
  if (usage.contextTokens > 0) parts.push(`ctx:${formatTokens(usage.contextTokens)}`);
  if (model) parts.push(model);
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
export function toolCallLabel(name: string, args: Record<string, unknown>): string {
  const str = (v: unknown, max = 60): string => {
    const s = typeof v === "string" ? v : JSON.stringify(v);
    if (!s) return "";
    return s.length > max ? `${s.slice(0, max)}…` : s;
  };
  const pathOf = () => str(args.file_path ?? args.path ?? "…");
  switch (name) {
    case "bash": return `$ ${str(args.command ?? "…")}`;
    case "read": {
      const offset = Number(args.offset);
      const limit = Number(args.limit);
      const hasOffset = Number.isFinite(offset);
      const hasLimit = Number.isFinite(limit) && limit > 0;
      if (hasOffset || hasLimit) {
        const start = hasOffset ? offset : 1;
        const end = hasLimit ? start + limit - 1 : "";
        return `read ${pathOf()}:${start}${end ? `-${end}` : ""}`;
      }
      return `read ${pathOf()}`;
    }
    case "write": {
      const lines = typeof args.contentLines === "number" ? args.contentLines : 1;
      return `write ${pathOf()}${lines > 1 ? ` (${lines} lines)` : ""}`;
    }
    case "edit": return `edit ${pathOf()}`;
    case "ls": return `ls ${str(args.path ?? ".")}`;
    case "find": return `find ${str(args.pattern ?? "*")} in ${str(args.path ?? ".")}`;
    case "grep": return `grep /${str(args.pattern ?? "")}/ in ${str(args.path ?? ".")}`;
    default: return `${name} ${str(args)}`;
  }
}

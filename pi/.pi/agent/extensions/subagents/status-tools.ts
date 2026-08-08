import type { ChildProcess } from "node:child_process";
import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { formatUsageStats, shortLabel } from "./format.ts";
import type { JobRegistry } from "./registry.ts";
import { killProcess } from "./runner.ts";

const EmptyParams = Type.Object({});

function cancelAll(procs: Set<ChildProcess>): number {
  const count = procs.size;
  for (const proc of procs) killProcess(proc);
  return count;
}

export function createStatusTool(deps: { registry: JobRegistry }): ToolDefinition<typeof EmptyParams, Record<string, never>> {
  return {
    name: "subagent_status",
    label: "Subagent Status",
    description: "Inspect running and recently completed subagents when needed. Async jobs deliver results automatically; do not poll for normal completion.",
    parameters: EmptyParams,
    async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
      const { registry } = deps;
      const now = Date.now();
      const running = registry.running();
      const recent = registry.recent(20).filter((j) => j.endTime && now - j.endTime < 60000);

      const lines: string[] = [];
      if (running.length > 0) {
        lines.push(`**Running (${running.length}):**`);
        for (const j of running) {
          const elapsed = ((now - j.startTime) / 1000).toFixed(1);
          const progress = j.progress ? ` — ${j.progress}` : "";
          const metadata = formatUsageStats(undefined, j.model, j.thinkingLevel);
          lines.push(`- ◐ ${j.agent} (${elapsed}s${metadata ? ` ${metadata}` : ""}): ${j.title ?? j.task}${progress}`);
        }
      } else {
        lines.push("**Running:** none");
      }
      if (recent.length > 0) {
        lines.push(`\n**Recent (${recent.length}):**`);
        for (const j of recent) {
          const duration = j.endTime ? ((j.endTime - j.startTime) / 1000).toFixed(1) : "?";
          const icon = j.status === "completed" ? "✓" : "✗";
          const usageStr = formatUsageStats(j.usage, j.model, j.thinkingLevel);
          lines.push(`- ${icon} ${j.agent} (${duration}s${usageStr ? ` ${usageStr}` : ""}): ${j.title ?? j.task}`);
        }
      }
      return { content: [{ type: "text", text: lines.join("\n") }], details: {} };
    },
  };
}

export function createCancelTool(deps: { registry: JobRegistry; activeProcs: Set<ChildProcess> }): ToolDefinition<typeof EmptyParams, Record<string, never>> {
  return {
    name: "subagent_cancel",
    label: "Cancel Subagents",
    description: "Cancel all running subagents. Use this to abort long-running or stalled subagents.",
    parameters: EmptyParams,
    async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
      const running = deps.registry.running();
      if (running.length === 0) {
        return { content: [{ type: "text", text: "No subagents are running." }], details: {} };
      }
      const count = cancelAll(deps.activeProcs);
      return { content: [{ type: "text", text: `Cancelling ${count} subagent${count > 1 ? "s" : ""}.` }], details: {} };
    },
  };
}

export function registerStatusCommands(pi: ExtensionAPI, deps: { registry: JobRegistry; activeProcs: Set<ChildProcess> }): void {
  pi.registerCommand("subagents", {
    description: "Browse completed subagent history",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) return;
      const recent = deps.registry.recent(30);
      if (recent.length === 0) {
        ctx.ui.notify("No subagents have completed yet", "info");
        return;
      }
      const items = recent.map((job) => {
        const duration = job.endTime ? ((job.endTime - job.startTime) / 1000).toFixed(1) : "?";
        const icon = job.status === "completed" ? "✓" : "✗";
        const preview = shortLabel(job.title, job.task, 40);
        return `${icon} ${job.agent} (${duration}s) — ${preview}`;
      });
      await ctx.ui.select("Subagent History", items);
    },
  });

  pi.registerCommand("cancel-subagents", {
    description: "Cancel all running subagents",
    handler: async (_args, ctx) => {
      const running = deps.registry.running();
      if (running.length === 0) {
        ctx.ui.notify("No subagents are running", "info");
        return;
      }
      const count = cancelAll(deps.activeProcs);
      ctx.ui.notify(`Cancelling ${count} subagent${count > 1 ? "s" : ""}`, "info");
    },
  });
}

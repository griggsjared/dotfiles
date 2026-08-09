import { randomUUID } from "node:crypto";
import { normalizeTitle } from "./format.ts";
import { EMPTY_USAGE, type CancellationReason, type SubagentResult, type SubagentUsage, type ToolCallInfo } from "./types.ts";

export interface CancellationHandle { cancel(reason: CancellationReason): void; }
export interface Job {
  id: number; agent: string; task: string; title?: string; startTime: number;
  status: "running" | "completed" | "failed" | "cancelled"; endTime?: number;
  text?: string; error?: string; progress?: string; usage: SubagentUsage; toolCalls: ToolCallInfo[];
  model?: string; thinkingLevel?: string; cancellationReason?: CancellationReason;
}
const PRUNE_AFTER_MS = 300_000;
export interface JobRegistry {
  scope: string; jobs: Map<number, Job>;
  add(agent: string, task: string, title?: string, metadata?: { model?: string; thinkingLevel?: string }): number;
  updateLive(id: number, live: { text?: string; progress?: string; usage?: SubagentUsage; toolCalls?: ToolCallInfo[]; model?: string; thinkingLevel?: string }): void;
  complete(id: number, result: SubagentResult): void;
  registerCancellation(id: number, handle: CancellationHandle): void;
  cancel(id: number, reason?: CancellationReason): boolean;
  cancelAll(reason?: CancellationReason): number;
  markCleared(ids: Iterable<number>): void; pendingCompleted(): Job[]; running(): Job[]; recent(limit?: number): Job[]; get(id: number): Job | undefined;
}
export function createJobRegistry(options: { now?: () => number } = {}) {
  const now = options.now ?? Date.now; let nextId = 1; const scope = randomUUID();
  const jobs = new Map<number, Job>(); const clearedIds = new Set<number>(); const handles = new Map<number, CancellationHandle>();
  const add = (agent: string, task: string, title?: string, metadata?: { model?: string; thinkingLevel?: string }): number => {
    const id = nextId++; jobs.set(id, { id, agent, task, title: normalizeTitle(title), startTime: now(), status: "running", usage: { ...EMPTY_USAGE }, toolCalls: [], model: metadata?.model, thinkingLevel: metadata?.thinkingLevel }); return id;
  };
  const updateLive = (id: number, live: { text?: string; progress?: string; usage?: SubagentUsage; toolCalls?: ToolCallInfo[]; model?: string; thinkingLevel?: string }): void => {
    const job = jobs.get(id); if (!job) return;
    if (live.text !== undefined) job.text = live.text; if (live.progress !== undefined) job.progress = live.progress;
    if (live.usage) job.usage = live.usage; if (live.toolCalls) job.toolCalls = live.toolCalls;
    if (live.model !== undefined) job.model = live.model; if (live.thinkingLevel !== undefined) job.thinkingLevel = live.thinkingLevel;
  };
  const registerCancellation = (id: number, handle: CancellationHandle): void => {
    const job = jobs.get(id);
    if (!job || job.status !== "running") {
      handle.cancel(job?.cancellationReason ?? "manual");
      return;
    }
    if (handles.has(id)) {
      handle.cancel(job.cancellationReason ?? "manual");
      return;
    }
    handles.set(id, handle);
    if (job.cancellationReason) handle.cancel(job.cancellationReason);
  };
  const cancel = (id: number, reason: CancellationReason = "manual"): boolean => {
    const job = jobs.get(id); if (!job || job.status !== "running") return false;
    if (job.cancellationReason) return true;
    job.cancellationReason = reason; handles.get(id)?.cancel(reason); return true;
  };
  const cancelAll = (reason: CancellationReason = "manual") => { let count = 0; for (const job of running()) if (cancel(job.id, reason)) count++; return count; };
  const complete = (id: number, result: SubagentResult): void => {
    const job = jobs.get(id); if (!job || job.status !== "running") return;
    handles.delete(id); job.status = result.cancelled || job.cancellationReason ? "cancelled" : result.exitCode === 0 ? "completed" : "failed"; job.endTime = now();
    if (job.status === "cancelled" && !job.cancellationReason) job.cancellationReason = result.cancellationReason ?? "manual";
    job.text = result.text; job.error = result.error; job.progress = undefined; job.usage = result.usage ?? job.usage; job.toolCalls = result.toolCalls ?? job.toolCalls;
    job.model = result.model ?? job.model; job.thinkingLevel = result.thinkingLevel ?? job.thinkingLevel;
    // A cancellation requested through the registry wins any later child
    // result, so reporting remains consistent across races.
    job.cancellationReason = job.cancellationReason ?? result.cancellationReason;
    const cutoff = now() - PRUNE_AFTER_MS; for (const [jid, j] of jobs) if (j.status !== "running" && clearedIds.has(jid) && (j.endTime ?? 0) < cutoff) jobs.delete(jid);
  };
  const markCleared = (ids: Iterable<number>) => { for (const id of ids) clearedIds.add(id); };
  const pendingCompleted = () => Array.from(jobs.values()).filter(j => j.status !== "running" && !clearedIds.has(j.id)).sort((a,b)=>(b.endTime??0)-(a.endTime??0));
  const running = () => Array.from(jobs.values()).filter(j => j.status === "running");
  const recent = (limit = 5) => Array.from(jobs.values()).filter(j => j.status !== "running").sort((a,b)=>(b.endTime??0)-(a.endTime??0)).slice(0, limit);
  const get = (id: number) => jobs.get(id);
  return { scope, jobs, add, updateLive, complete, registerCancellation, cancel, cancelAll, markCleared, pendingCompleted, running, recent, get };
}

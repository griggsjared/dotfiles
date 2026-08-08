import { randomUUID } from "node:crypto";
import { normalizeTitle } from "./format.ts";
import { EMPTY_USAGE, type SubagentResult, type SubagentUsage, type ToolCallInfo } from "./types.ts";

export interface Job {
  id: number;
  agent: string;
  task: string;
  title?: string;
  startTime: number;
  status: "running" | "completed" | "failed";
  endTime?: number;
  text?: string;
  error?: string;
  progress?: string;
  usage: SubagentUsage;
  toolCalls: ToolCallInfo[];
  model?: string;
  thinkingLevel?: string;
}

/** Completed jobs older than this are pruned once their batch summary cleared them. */
const PRUNE_AFTER_MS = 300_000;

export interface JobRegistry {
  scope: string;
  jobs: Map<number, Job>;
  add(agent: string, task: string, title?: string, metadata?: { model?: string; thinkingLevel?: string }): number;
  updateLive(id: number, live: {
    text?: string;
    progress?: string;
    usage?: SubagentUsage;
    toolCalls?: ToolCallInfo[];
    model?: string;
    thinkingLevel?: string;
  }): void;
  complete(id: number, result: SubagentResult): void;
  markCleared(ids: Iterable<number>): void;
  pendingCompleted(): Job[];
  running(): Job[];
  recent(limit?: number): Job[];
}

export function createJobRegistry(options: { now?: () => number } = {}) {
  const now = options.now ?? Date.now;
  let nextId = 1;
  const scope = randomUUID();
  const jobs = new Map<number, Job>();
  const clearedIds = new Set<number>();

  const add = (
    agent: string,
    task: string,
    title?: string,
    metadata?: { model?: string; thinkingLevel?: string },
  ): number => {
    const id = nextId++;
    jobs.set(id, {
      id,
      agent,
      task,
      title: normalizeTitle(title),
      startTime: now(),
      status: "running",
      usage: { ...EMPTY_USAGE },
      toolCalls: [],
      model: metadata?.model,
      thinkingLevel: metadata?.thinkingLevel,
    });
    return id;
  };

  const updateLive = (id: number, live: {
    text?: string;
    progress?: string;
    usage?: SubagentUsage;
    toolCalls?: ToolCallInfo[];
    model?: string;
    thinkingLevel?: string;
  }): void => {
    const job = jobs.get(id);
    if (!job) return;
    if (live.text !== undefined) job.text = live.text;
    if (live.progress !== undefined) job.progress = live.progress;
    if (live.usage) job.usage = live.usage;
    if (live.toolCalls) job.toolCalls = live.toolCalls;
    if (live.model !== undefined) job.model = live.model;
    if (live.thinkingLevel !== undefined) job.thinkingLevel = live.thinkingLevel;
  };

  const complete = (id: number, result: SubagentResult): void => {
    const job = jobs.get(id);
    if (!job) return;
    job.status = result.exitCode === 0 ? "completed" : "failed";
    job.endTime = now();
    job.text = result.text;
    job.error = result.error;
    job.progress = undefined;
    job.usage = result.usage ?? job.usage;
    job.toolCalls = result.toolCalls ?? job.toolCalls;
    job.model = result.model ?? job.model;
    job.thinkingLevel = result.thinkingLevel ?? job.thinkingLevel;
    // Prune only completed jobs whose batch summary already cleared them;
    // anything still on display stays until its batch finishes.
    const cutoff = now() - PRUNE_AFTER_MS;
    for (const [jid, j] of jobs) {
      if (j.status !== "running" && clearedIds.has(jid) && (j.endTime ?? 0) < cutoff) jobs.delete(jid);
    }
  };

  // Completed jobs still on display; cleared once their batch summary is sent.
  const markCleared = (ids: Iterable<number>): void => {
    for (const id of ids) clearedIds.add(id);
  };

  const pendingCompleted = (): Job[] =>
    Array.from(jobs.values())
      .filter((j) => j.status !== "running" && !clearedIds.has(j.id))
      .sort((a, b) => (b.endTime ?? 0) - (a.endTime ?? 0));

  const running = (): Job[] =>
    Array.from(jobs.values()).filter((j) => j.status === "running");

  const recent = (limit = 5): Job[] =>
    Array.from(jobs.values())
      .filter((j) => j.status !== "running")
      .sort((a, b) => (b.endTime ?? 0) - (a.endTime ?? 0))
      .slice(0, limit);

  return { scope, jobs, add, updateLive, complete, markCleared, pendingCompleted, running, recent };
}

import { randomUUID } from "node:crypto";
import { normalizeTitle } from "./format.ts";
import {
  EMPTY_USAGE,
  type CancellationReason,
  type JobEvent,
  type JobEventInput,
  type SubagentDelivery,
  type SubagentQuestion,
  type SubagentResult,
  type SubagentUsage,
  type ToolCallInfo,
} from "./types.ts";

export interface SubagentControl {
  cancel(reason: CancellationReason): void;
  send(message: string, deliverAs: SubagentDelivery): Promise<void>;
  reply(questionId: string, answer: string): Promise<void>;
}
export interface PendingQuestion extends SubagentQuestion { askedAt: number; }
export interface Job {
  id: number; agent: string; task: string; title?: string; startTime: number;
  status: "running" | "completed" | "failed" | "cancelled"; endTime?: number;
  text?: string; error?: string; progress?: string; usage: SubagentUsage; toolCalls: ToolCallInfo[];
  model?: string; thinkingLevel?: string; cancellationReason?: CancellationReason;
  pendingQuestions: PendingQuestion[];
}
const PRUNE_AFTER_MS = 300_000;
const JOB_EVENT_CAPACITY = 100;
interface JobEventRing { events: JobEvent[]; nextSeq: number; }
export interface JobRegistry {
  scope: string; jobs: Map<number, Job>;
  add(agent: string, task: string, title?: string, metadata?: { model?: string; thinkingLevel?: string }): number;
  appendEvent(id: number, event: JobEventInput): boolean;
  readEvents(id: number, options?: { since?: number; limit?: number }): { events: JobEvent[]; nextCursor: number; droppedBefore?: number } | undefined;
  updateLive(id: number, live: { text?: string; progress?: string; usage?: SubagentUsage; toolCalls?: ToolCallInfo[]; model?: string; thinkingLevel?: string }): void;
  complete(id: number, result: SubagentResult): void;
  registerControl(id: number, handle: SubagentControl): void;
  recordQuestion(id: number, question: SubagentQuestion): boolean;
  send(id: number, message: string, deliverAs: SubagentDelivery): Promise<void>;
  reply(id: number, questionId: string, answer: string): Promise<void>;
  cancel(id: number, reason?: CancellationReason): boolean;
  cancelAll(reason?: CancellationReason): number;
  markCleared(ids: Iterable<number>): void; pendingCompleted(): Job[]; running(): Job[]; recent(limit?: number): Job[]; get(id: number): Job | undefined;
}
export function createJobRegistry(options: { now?: () => number } = {}) {
  const now = options.now ?? Date.now; let nextId = 1; const scope = randomUUID();
  const jobs = new Map<number, Job>(); const eventRings = new Map<number, JobEventRing>(); const clearedIds = new Set<number>(); const handles = new Map<number, SubagentControl>(); const replying = new Set<string>();
  const add = (agent: string, task: string, title?: string, metadata?: { model?: string; thinkingLevel?: string }): number => {
    const id = nextId++; jobs.set(id, { id, agent, task, title: normalizeTitle(title), startTime: now(), status: "running", usage: { ...EMPTY_USAGE }, toolCalls: [], model: metadata?.model, thinkingLevel: metadata?.thinkingLevel, pendingQuestions: [] }); eventRings.set(id, { events: [], nextSeq: 1 }); return id;
  };
  const appendEvent = (id: number, event: JobEventInput): boolean => {
    const job = jobs.get(id); if (!job || job.status !== "running") return false;
    const ring = eventRings.get(id); if (!ring) return false;
    ring.events.push({ ...event, seq: ring.nextSeq++, timestamp: now() });
    if (ring.events.length > JOB_EVENT_CAPACITY) ring.events.shift();
    return true;
  };
  const readEvents = (id: number, options: { since?: number; limit?: number } = {}) => {
    const job = jobs.get(id); if (!job) return undefined;
    const ring = eventRings.get(id)!; const since = options.since; const currentSeq = ring.nextSeq - 1;
    if (since !== undefined && since > currentSeq) throw new Error(`Event cursor ${since} is ahead of current sequence ${currentSeq} for subagent #${id}.`);
    const limit = options.limit === undefined ? JOB_EVENT_CAPACITY : Math.max(0, Math.floor(options.limit));
    const oldest = ring.events[0]?.seq;
    const source = since === undefined ? ring.events.slice(Math.max(0, ring.events.length - limit)) : ring.events.filter((event) => event.seq > since).slice(0, limit);
    const events = source.map((event) => ({ ...event }));
    const result: { events: JobEvent[]; nextCursor: number; droppedBefore?: number } = { events, nextCursor: events.at(-1)?.seq ?? (since ?? 0) };
    if (since !== undefined && oldest !== undefined && oldest > 1 && since < oldest) result.droppedBefore = oldest;
    return result;
  };
  const updateLive = (id: number, live: { text?: string; progress?: string; usage?: SubagentUsage; toolCalls?: ToolCallInfo[]; model?: string; thinkingLevel?: string }): void => {
    const job = jobs.get(id); if (!job) return;
    if (live.text !== undefined) job.text = live.text; if (live.progress !== undefined) job.progress = live.progress;
    if (live.usage) job.usage = live.usage; if (live.toolCalls) job.toolCalls = live.toolCalls;
    if (live.model !== undefined) job.model = live.model; if (live.thinkingLevel !== undefined) job.thinkingLevel = live.thinkingLevel;
  };
  const registerControl = (id: number, handle: SubagentControl): void => {
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
  const recordQuestion = (id: number, question: SubagentQuestion): boolean => {
    const job = jobs.get(id);
    if (!job || job.status !== "running" || job.cancellationReason) return false;
    if (job.pendingQuestions.some((pending) => pending.id === question.id)) return false;
    job.pendingQuestions.push({ ...question, askedAt: now() });
    return true;
  };
  const runningControl = (id: number): { job: Job; handle: SubagentControl } => {
    const job = jobs.get(id);
    if (!job) throw new Error(`Unknown subagent job ID: ${id}`);
    if (job.status !== "running") throw new Error(`Subagent #${id} is ${job.status}.`);
    if (job.cancellationReason) throw new Error(`Subagent #${id} is cancelling (${job.cancellationReason}).`);
    const handle = handles.get(id);
    if (!handle) throw new Error(`Subagent #${id} has not started yet.`);
    return { job, handle };
  };
  const send = async (id: number, message: string, deliverAs: SubagentDelivery): Promise<void> => {
    const { handle } = runningControl(id);
    await handle.send(message, deliverAs);
  };
  const reply = async (id: number, questionId: string, answer: string): Promise<void> => {
    const { job, handle } = runningControl(id);
    if (!job.pendingQuestions.some((question) => question.id === questionId)) {
      throw new Error(`Unknown or answered question ${questionId} for subagent #${id}.`);
    }
    const key = `${id}:${questionId}`;
    if (replying.has(key)) throw new Error(`Question ${questionId} for subagent #${id} is already being answered.`);
    replying.add(key);
    try {
      await handle.reply(questionId, answer);
      job.pendingQuestions = job.pendingQuestions.filter((question) => question.id !== questionId);
    } finally {
      replying.delete(key);
    }
  };
  const cancel = (id: number, reason: CancellationReason = "manual"): boolean => {
    const job = jobs.get(id); if (!job || job.status !== "running") return false;
    if (job.cancellationReason) return true;
    job.cancellationReason = reason; job.pendingQuestions = []; handles.get(id)?.cancel(reason); return true;
  };
  const cancelAll = (reason: CancellationReason = "manual") => { let count = 0; for (const job of running()) if (cancel(job.id, reason)) count++; return count; };
  const complete = (id: number, result: SubagentResult): void => {
    const job = jobs.get(id); if (!job || job.status !== "running") return;
    handles.delete(id); job.pendingQuestions = []; job.status = result.cancelled || job.cancellationReason ? "cancelled" : result.exitCode === 0 ? "completed" : "failed"; job.endTime = now();
    if (job.status === "cancelled" && !job.cancellationReason) job.cancellationReason = result.cancellationReason ?? "manual";
    job.text = result.text; job.error = result.error; job.progress = undefined; job.usage = result.usage ?? job.usage; job.toolCalls = result.toolCalls ?? job.toolCalls;
    job.model = result.model ?? job.model; job.thinkingLevel = result.thinkingLevel ?? job.thinkingLevel;
    // A cancellation requested through the registry wins any later child
    // result, so reporting remains consistent across races.
    job.cancellationReason = job.cancellationReason ?? result.cancellationReason;
    const cutoff = now() - PRUNE_AFTER_MS; for (const [jid, j] of jobs) if (j.status !== "running" && clearedIds.has(jid) && (j.endTime ?? 0) < cutoff) { jobs.delete(jid); eventRings.delete(jid); }
  };
  const markCleared = (ids: Iterable<number>) => { for (const id of ids) clearedIds.add(id); };
  const pendingCompleted = () => Array.from(jobs.values()).filter(j => j.status !== "running" && !clearedIds.has(j.id)).sort((a,b)=>(b.endTime??0)-(a.endTime??0));
  const running = () => Array.from(jobs.values()).filter(j => j.status === "running");
  const recent = (limit = 5) => Array.from(jobs.values()).filter(j => j.status !== "running").sort((a,b)=>(b.endTime??0)-(a.endTime??0)).slice(0, limit);
  const get = (id: number) => jobs.get(id);
  return { scope, jobs, add, appendEvent, readEvents, updateLive, complete, registerControl, recordQuestion, send, reply, cancel, cancelAll, markCleared, pendingCompleted, running, recent, get };
}

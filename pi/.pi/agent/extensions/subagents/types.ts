export const ENTRY_TYPE = "subagents";
export const WIDGET_KEY = "subagents";
export const STATUS_KEY = "subagents";

export type ExecutionMode = "async" | "sync";
export type CancellationReason = "manual" | "parent-abort" | "timeout" | "session-shutdown";

export interface SubagentUsage {
  turns: number; input: number; output: number; cacheRead: number; cacheWrite: number; cost: number; contextTokens: number;
}
export const EMPTY_USAGE: SubagentUsage = { turns: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0 };
export interface ToolCallInfo { name: string; args: Record<string, unknown>; }
export interface SubagentResult {
  agent: string; task: string; title?: string; text: string; exitCode: number; error: string;
  usage?: SubagentUsage; toolCalls?: ToolCallInfo[]; model?: string; thinkingLevel?: string;
  cancelled?: boolean; cancellationReason?: CancellationReason;
}
export interface SubagentUpdate { text: string; progress?: string; usage: SubagentUsage; toolCalls: ToolCallInfo[]; model?: string; thinkingLevel?: string; }
export interface SubagentToolDetails {
  agent?: string; task?: string; status: "launched" | "running" | "completed" | "failed" | "cancelled";
  execution?: ExecutionMode; count?: number; skipped?: number; jobIds?: number[]; jobScope?: string;
  cancellationReason?: CancellationReason;
}
export interface SubagentMessageDetails {
  jobId?: number; agent: string; task: string; title?: string;
  status: "completed" | "failed" | "cancelled"; duration: string; icon: string;
  usage?: SubagentUsage; toolCalls?: ToolCallInfo[]; model?: string; thinkingLevel?: string;
  cancellationReason?: CancellationReason;
}

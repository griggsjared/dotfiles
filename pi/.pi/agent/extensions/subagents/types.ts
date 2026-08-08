export const ENTRY_TYPE = "subagents";
export const WIDGET_KEY = "subagents";
export const STATUS_KEY = "subagents";

export type ExecutionMode = "async" | "sync";

export interface SubagentUsage {
  turns: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  contextTokens: number;
}

export const EMPTY_USAGE: SubagentUsage = {
  turns: 0,
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  cost: 0,
  contextTokens: 0,
};

export interface ToolCallInfo {
  name: string;
  args: Record<string, unknown>;
}

export interface SubagentResult {
  agent: string;
  task: string;
  title?: string;
  text: string;
  exitCode: number;
  error: string;
  usage?: SubagentUsage;
  toolCalls?: ToolCallInfo[];
  model?: string;
}

export interface SubagentUpdate {
  text: string;
  progress?: string;
  usage: SubagentUsage;
  toolCalls: ToolCallInfo[];
  model?: string;
}

/** details payload of the subagent tool's AgentToolResult / live updates. */
export interface SubagentToolDetails {
  agent?: string;
  task?: string;
  status: "launched" | "running" | "completed" | "failed";
  execution?: ExecutionMode;
  count?: number;
  skipped?: number;
  jobIds?: number[];
  jobScope?: string;
}

/** details payload of sendMessage()ed result entries (rendered by the message renderer). */
export interface SubagentMessageDetails {
  agent: string;
  task: string;
  title?: string;
  status: "completed" | "failed";
  duration: string;
  icon: string;
  usage?: SubagentUsage;
  toolCalls?: ToolCallInfo[];
  model?: string;
}

import {
  ASK_PARENT_TITLE_PREFIX,
  EMPTY_USAGE,
  type SubagentQuestion,
  type SubagentUsage,
  type ToolCallInfo,
} from "./types.ts";

/** Keep only the most recent tool calls; a long-running agent can accumulate many. */
export const MAX_TOOL_CALLS = 20;

interface UsageInfo {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  totalTokens?: number;
  cost?: number | { total?: number };
}

/** One JSONL line of the child pi --mode json event stream, as far as we consume it. */
export interface StreamEvent {
  type: string;
  message?: {
    role?: string;
    content?: unknown;
    usage?: UsageInfo;
    model?: string;
    responseModel?: string;
  };
  assistantMessageEvent?: {
    type?: string;
    delta?: string;
  };
}

export interface StreamState {
  finalText: string;
  streamedText: string;
  finalThinking: string;
  model: string;
  usage: SubagentUsage;
  toolCalls: ToolCallInfo[];
}

export function createStreamState(model: string): StreamState {
  return {
    finalText: "",
    streamedText: "",
    finalThinking: "",
    model,
    usage: { ...EMPTY_USAGE },
    toolCalls: [],
  };
}

export function parseEventLine(line: string): StreamEvent | undefined {
  if (!line.trim()) return undefined;
  let event: unknown;
  try {
    event = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!event || typeof event !== "object") return undefined;
  const parsed = event as StreamEvent;
  if (parsed.type === "message_update" && parsed.assistantMessageEvent) return parsed;
  if (!parsed.message || parsed.message.role !== "assistant") return undefined;
  return parsed;
}

export function parseParentQuestion(line: string): SubagentQuestion | undefined {
  let event: unknown;
  try {
    event = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!event || typeof event !== "object") return undefined;
  const request = event as {
    type?: unknown;
    id?: unknown;
    method?: unknown;
    title?: unknown;
    placeholder?: unknown;
  };
  if (
    request.type !== "extension_ui_request" ||
    request.method !== "input" ||
    typeof request.id !== "string" ||
    !request.id.trim() ||
    typeof request.title !== "string" ||
    !request.title.startsWith(ASK_PARENT_TITLE_PREFIX)
  ) return undefined;
  const question = request.title.slice(ASK_PARENT_TITLE_PREFIX.length).trim();
  if (!question) return undefined;
  const context = typeof request.placeholder === "string" && request.placeholder.trim()
    ? request.placeholder.trim()
    : undefined;
  return { id: request.id, question, context };
}

interface ToolCallPart {
  name?: unknown;
  toolName?: unknown;
  arguments?: unknown;
  input?: unknown;
}

function isToolCallPart(part: unknown): part is ToolCallPart {
  if (!part || typeof part !== "object" || !("type" in part)) return false;
  const type = (part as { type?: unknown }).type;
  return type === "toolCall" || type === "tool_use";
}

export function assistantText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((p): p is { type: "text"; text: unknown } =>
        !!p && typeof p === "object" && (p as { type?: unknown }).type === "text")
      .map((p) => (typeof p.text === "string" ? p.text : ""))
      .join("\n");
  }
  return "";
}

function thinkingText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .filter((p): p is { thinking?: unknown; text?: unknown } =>
      !!p && typeof p === "object" && (p as { type?: unknown }).type === "thinking")
    .map((p) => (typeof p.thinking === "string" ? p.thinking : typeof p.text === "string" ? p.text : ""))
    .join("\n");
}

export function normalizeToolArgs(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
    } catch { /* not JSON */ }
  }
  return {};
}

// Drop write/edit content bodies (kept as a line count) and truncate long
// string values so tool-call trails stay small in memory and in history.
export function sanitizeToolCallArgs(name: string, args: Record<string, unknown>): Record<string, unknown> {
  if ((name === "write" || name === "edit") && typeof args.content === "string") {
    return { ...args, content: undefined, contentLines: args.content.split("\n").length };
  }
  return args;
}

export function truncateStrings(value: unknown, max = 120): unknown {
  if (typeof value === "string") return value.length > max ? `${value.slice(0, max)}…` : value;
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => truncateStrings(v, max));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value).slice(0, 50)) out[k] = truncateStrings(v, max);
    return out;
  }
  return value;
}

/** Fold one JSONL line into the stream state. Malformed and non-assistant lines are ignored. */
export function accumulateEvent(state: StreamState, line: string): void {
  const event = parseEventLine(line);
  if (!event) return;
  const message = event.message;
  const content = message?.content;

  if (event.type === "message_end" && message) {
    const text = assistantText(content);
    if (text) state.finalText = text;
    const thinking = thinkingText(content);
    if (thinking) state.finalThinking = thinking;
    const info = message.usage;
    if (info) {
      state.usage.turns += 1;
      state.usage.input += info.input ?? 0;
      state.usage.output += info.output ?? 0;
      state.usage.cacheRead += info.cacheRead ?? 0;
      state.usage.cacheWrite += info.cacheWrite ?? 0;
      state.usage.cost += typeof info.cost === "number" ? info.cost : (info.cost?.total ?? 0);
      state.usage.contextTokens = info.totalTokens || state.usage.contextTokens;
    }
    const servedModel = message.model ?? message.responseModel;
    if (servedModel) state.model = servedModel;
    if (Array.isArray(content)) {
      for (const part of content) {
        if (!isToolCallPart(part)) continue;
        const name = String(part.name ?? part.toolName ?? "tool");
        const args = truncateStrings(
          sanitizeToolCallArgs(name, normalizeToolArgs(part.arguments ?? part.input)),
        ) as Record<string, unknown>;
        state.toolCalls.push({ name, args });
      }
      if (state.toolCalls.length > MAX_TOOL_CALLS) {
        state.toolCalls.splice(0, state.toolCalls.length - MAX_TOOL_CALLS);
      }
    }
  } else if (event.type === "message_update") {
    const delta = event.assistantMessageEvent;
    if (delta?.type === "text_delta" && typeof delta.delta === "string") {
      state.streamedText += delta.delta;
    } else if (delta?.type === "thinking_delta" && typeof delta.delta === "string") {
      state.finalThinking += delta.delta;
    } else {
      const text = assistantText(content);
      if (text.length > state.streamedText.length) state.streamedText = text;
    }
  }
}

/** Last-resort text extraction from a child's capped stdout buffer. */
export function extractFinalText(output: string): string {
  const state = createStreamState("");
  for (const line of output.split("\n")) accumulateEvent(state, line);
  return state.finalText || state.streamedText || state.finalThinking || "";
}

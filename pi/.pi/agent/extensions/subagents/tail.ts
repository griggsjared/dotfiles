import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth, visibleWidth, type Component, type TUI } from "@earendil-works/pi-tui";
import type { Job, JobRegistry } from "./registry.ts";
import { normalizeTitle, shortLabel } from "./format.ts";
import type { JobEvent } from "./types.ts";

const MAX_TAIL_EVENTS = 100;
const MAX_VISIBLE_EVENTS = 14;
const POLL_INTERVAL_MS = 250;
const TERMINAL_SEQUENCE = /\x1B\][\s\S]*?(?:\x07|\x1B\\|\x9C)|\x1B[P^_X][\s\S]*?(?:\x1B\\|\x9C)|[\x1B\x9B][[\]()#;?]*(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]/g;
const CONTROL_CHARACTER = /[\x00-\x1F\x7F-\x9F]/g;

function statusColor(status: Job["status"] | "unavailable"): ThemeColor {
  if (status === "completed") return "success";
  if (status === "cancelled") return "warning";
  if (status === "failed" || status === "unavailable") return "error";
  return "accent";
}

export function eventKindLabel(kind: JobEvent["kind"]): string {
  if (kind === "tool-start") return "tool";
  if (kind === "tool-end") return "result";
  return kind;
}

export function eventColor(kind: JobEvent["kind"]): ThemeColor {
  if (kind === "question") return "warning";
  if (kind === "tool-end") return "success";
  if (kind === "tool-start") return "muted";
  if (kind === "state") return "accent";
  return "text";
}

function normalizeLine(text: string): string {
  return text
    .replace(TERMINAL_SEQUENCE, "")
    .replace(CONTROL_CHARACTER, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function contentText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .filter((part): part is { type?: unknown; text?: unknown } => !!part && typeof part === "object")
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text as string)
    .join("\n");
}

function firstLine(text: string): string {
  const line = normalizeLine(text.split(/\r?\n/, 1)[0] ?? text);
  return line.length > 120 ? `${line.slice(0, 119)}…` : line;
}

function compactToolResult(serialized: string, isError: boolean): string {
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    return normalizeLine(serialized);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return normalizeLine(serialized);
  const result = value as Record<string, unknown>;
  const text = contentText(result.content) || (typeof result.text === "string" ? result.text : "");
  if (isError && text) return firstLine(text);
  if (text) {
    const lines = text.trim() ? text.split(/\r?\n/).length : 0;
    if (lines === 0) return "empty result";
    const preview = firstLine(text);
    return `${preview}${preview ? " · " : ""}${lines} line${lines === 1 ? "" : "s"}`;
  }
  return "structured result";
}

export function formatEventSummary(event: Pick<JobEvent, "kind" | "summary">): string {
  const summary = normalizeLine(event.summary);
  if (event.kind !== "tool-end") return summary;
  const match = summary.match(/^(\S+) (success|error): (.+)$/);
  if (!match?.[1] || !match[2] || !match[3]) return summary;
  const detail = compactToolResult(match[3], match[2] === "error");
  return `${match[1]} ${match[2]}: ${detail}`;
}

function jobLabel(job: Job): string {
  return shortLabel(normalizeTitle(job.title), normalizeTitle(job.task), 120);
}

export class SubagentTail implements Component {
  private events: JobEvent[] = [];
  private cursor = 0;
  private droppedBefore?: number;
  private scrollTop = 0;
  private follow = true;
  private timer: ReturnType<typeof setInterval> | undefined;
  private disposed = false;
  private unavailable = false;
  private lastStatus?: Job["status"];
  private lastProgress?: string;
  private lastCancellationReason?: Job["cancellationReason"];
  private readonly tui: Pick<TUI, "requestRender">;
  private readonly theme: Theme;
  private readonly registry: JobRegistry;
  private readonly jobId: number;
  private readonly done: () => void;

  constructor(
    tui: Pick<TUI, "requestRender">,
    theme: Theme,
    registry: JobRegistry,
    jobId: number,
    done: () => void,
  ) {
    this.tui = tui;
    this.theme = theme;
    this.registry = registry;
    this.jobId = jobId;
    this.done = done;
    this.loadInitial();
    if (!this.unavailable) this.timer = setInterval(() => this.poll(), POLL_INTERVAL_MS);
  }

  private loadInitial(): void {
    try {
      const read = this.registry.readEvents(this.jobId, { since: 0, limit: MAX_TAIL_EVENTS });
      if (!read) {
        this.unavailable = true;
        return;
      }
      this.events = read.events;
      this.cursor = read.nextCursor;
      this.droppedBefore = read.droppedBefore;
      this.scrollToBottom();
    } catch {
      this.unavailable = true;
    }
  }

  private poll(): void {
    if (this.disposed || this.unavailable) return;
    try {
      const read = this.registry.readEvents(this.jobId, { since: this.cursor, limit: MAX_TAIL_EVENTS });
      if (!read) {
        this.unavailable = true;
        this.stopPolling();
        this.tui.requestRender();
        return;
      }

      let changed = false;
      if (read.droppedBefore !== undefined) {
        this.events = [];
        this.scrollTop = 0;
        this.droppedBefore = read.droppedBefore;
        changed = true;
      }
      if (read.events.length > 0) {
        const overflow = Math.max(0, this.events.length + read.events.length - MAX_TAIL_EVENTS);
        this.events.push(...read.events);
        if (overflow > 0) {
          this.events.splice(0, overflow);
          if (!this.follow) this.scrollTop = Math.max(0, this.scrollTop - overflow);
        }
        if (this.follow) this.scrollToBottom();
        changed = true;
      }
      this.cursor = read.nextCursor;
      const job = this.registry.get(this.jobId);
      const liveChanged = job?.status !== this.lastStatus ||
        job?.progress !== this.lastProgress ||
        job?.cancellationReason !== this.lastCancellationReason;
      this.lastStatus = job?.status;
      this.lastProgress = job?.progress;
      this.lastCancellationReason = job?.cancellationReason;
      if (job && job.status !== "running") {
        this.stopPolling();
        changed = true;
      }
      if (liveChanged) changed = true;
      if (changed) {
        this.clampScroll();
        this.tui.requestRender();
      }
    } catch {
      this.unavailable = true;
      this.stopPolling();
      this.tui.requestRender();
    }
  }

  private stopPolling(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private maxScroll(): number {
    return Math.max(0, this.events.length - MAX_VISIBLE_EVENTS);
  }

  private clampScroll(): void {
    this.scrollTop = Math.min(this.maxScroll(), Math.max(0, this.scrollTop));
  }

  private scrollToBottom(): void {
    this.scrollTop = this.maxScroll();
    this.follow = true;
  }

  private scrollTo(value: number): void {
    this.scrollTop = Math.min(this.maxScroll(), Math.max(0, value));
    this.follow = this.scrollTop === this.maxScroll();
    this.tui.requestRender();
  }

  private close(): void {
    if (this.disposed) return;
    this.dispose();
    this.done();
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c")) || data === "q" || data === "Q") {
      this.close();
    } else if (matchesKey(data, Key.up)) {
      this.scrollTo(this.scrollTop - 1);
    } else if (matchesKey(data, Key.down)) {
      this.scrollTo(this.scrollTop + 1);
    } else if (matchesKey(data, Key.pageUp)) {
      this.scrollTo(this.scrollTop - MAX_VISIBLE_EVENTS);
    } else if (matchesKey(data, Key.pageDown)) {
      this.scrollTo(this.scrollTop + MAX_VISIBLE_EVENTS);
    } else if (matchesKey(data, Key.home)) {
      this.scrollTo(0);
    } else if (matchesKey(data, Key.end)) {
      this.scrollTo(this.maxScroll());
    }
  }

  render(width: number): string[] {
    const maxWidth = Math.max(1, Math.floor(width));
    const job = this.registry.get(this.jobId);
    const status = job?.status ?? "unavailable";
    const statusLabel = job?.cancellationReason ? `${status} (${job.cancellationReason})` : status;
    const lines: string[] = [
      themeLine(this.theme.fg("accent", this.theme.bold(`Subagent #${this.jobId} ${job?.agent ?? "subagent"}`)), this.theme.fg(statusColor(status), statusLabel)),
      job
        ? this.theme.fg("dim", `Task: ${normalizeLine(jobLabel(job))}`)
        : this.theme.fg("error", "Job is no longer available."),
    ];

    if (job?.progress) lines.push(this.theme.fg("dim", `Progress: ${normalizeLine(job.progress)}`));
    if (this.droppedBefore !== undefined) {
      lines.push(this.theme.fg("warning", `History dropped before event ${this.droppedBefore}.`));
    }

    const start = this.events.length > 0 ? this.scrollTop + 1 : 0;
    const end = Math.min(this.events.length, this.scrollTop + MAX_VISIBLE_EVENTS);
    lines.push(this.theme.fg("dim", `Events ${start}-${end}/${this.events.length} · cursor ${this.cursor}${this.follow ? " · following" : " · paused"}`));

    const visible = this.events.slice(this.scrollTop, this.scrollTop + MAX_VISIBLE_EVENTS);
    if (visible.length === 0) {
      lines.push(this.theme.fg("dim", "No semantic events yet."));
    } else {
      for (const event of visible) {
        const summary = formatEventSummary(event) || "(empty)";
        const label = eventKindLabel(event.kind).padEnd(9);
        lines.push(
          `${this.theme.fg("dim", `[${event.seq}]`)} ${this.theme.fg(eventColor(event.kind), label)} ${this.theme.fg("muted", summary)}`,
        );
      }
    }

    lines.push(this.theme.fg("dim", "↑↓/PgUp/PgDn scroll · Home/End jump · Esc/q close"));
    return this.box(lines, maxWidth);
  }

  private box(lines: string[], width: number): string[] {
    if (width < 3) return lines.map((line) => truncateToWidth(line, width, "", true));
    const innerWidth = width - 2;
    const border = (text: string) => this.theme.fg("border", text);
    const output = [border(`╭${"─".repeat(innerWidth)}╮`)];
    for (const line of lines) {
      const clipped = truncateToWidth(line, innerWidth, "", true);
      const padding = " ".repeat(Math.max(0, innerWidth - visibleWidth(clipped)));
      output.push(`${border("│")}${clipped}${padding}${border("│")}`);
    }
    output.push(border(`╰${"─".repeat(innerWidth)}╯`));
    return output;
  }

  invalidate(): void {}

  dispose(): void {
    this.disposed = true;
    this.stopPolling();
  }
}

function themeLine(left: string, right: string): string {
  return `${left} · ${right}`;
}

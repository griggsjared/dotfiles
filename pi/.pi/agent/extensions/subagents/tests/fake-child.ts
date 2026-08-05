import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";

const SIGNAL_NUMBERS: Record<string, number> = { SIGTERM: 15, SIGHUP: 1, SIGINT: 2 };

/**
 * Minimal stand-in for the child pi process. Models the real contract: the
 * child installs SIGTERM/SIGHUP handlers and exits 128 + signum, so a killed
 * process closes with (143, null); only unhandleable signals (SIGKILL) close
 * with (null, signal).
 */
export class FakeChild extends EventEmitter {
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  stdin = { end: () => {} };
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  killed: string | null = null;
  /** When true, kill() records the signal but never closes (a zombie child). */
  ignoreKill = false;

  kill(signal: NodeJS.Signals): boolean {
    this.killed = signal;
    // A zombie ignores handled signals but SIGKILL always lands.
    if (this.ignoreKill && signal !== "SIGKILL") return true;
    setImmediate(() => {
      if (signal === "SIGKILL") {
        this.signalCode = signal;
        this.emit("close", null, signal);
      } else {
        this.exitCode = 128 + (SIGNAL_NUMBERS[signal] ?? 15);
        this.emit("close", this.exitCode, null);
      }
    });
    return true;
  }

  finish(code: number): void {
    this.exitCode = code;
    this.emit("close", code, null);
  }
}

export interface SpawnCall {
  cmd: string;
  args: string[];
  options: Record<string, unknown>;
}

export function fakeSpawn(child: FakeChild): typeof spawn {
  return (() => child) as unknown as typeof spawn;
}

/** Spawn factory returning a fresh child per call, recording each invocation. */
export function fakeSpawnChildren(children: FakeChild[]): { spawnFn: typeof spawn; calls: SpawnCall[] } {
  const calls: SpawnCall[] = [];
  let index = 0;
  const spawnFn = ((cmd: string, args: string[], options?: Record<string, unknown>) => {
    calls.push({ cmd, args, options: options ?? {} });
    return children[index++] ?? new FakeChild();
  }) as unknown as typeof spawn;
  return { spawnFn, calls };
}

export function endEvent(text: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: "message_end",
    message: {
      role: "assistant",
      content: text,
      usage: { input: 5, output: 3, totalTokens: 8, cost: 0.0001 },
      ...extra,
    },
  }) + "\n";
}

export function updateEvent(text: string): string {
  return JSON.stringify({ type: "message_update", message: { role: "assistant", content: text } }) + "\n";
}

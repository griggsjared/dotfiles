import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { test, type TestContext } from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { CLAUDE_CACHE_TTL_MS, fetchClaudeUsage, normalizeClaudeUsage } from "../providers/claude.ts";
import providerUsage from "../index.ts";

const capturedAt = Date.parse("2026-10-07T16:00:00Z");
const output = [
	"You are currently using your subscription to power your Claude Code usage",
	"Current session: 10% used · resets Oct 7 at 12:59pm (America/Boise)",
	"Current week (all models): 12% used · resets Oct 13 at 4:59am (America/Boise)",
].join("\n");
const context = {} as ExtensionContext;

test("publishes only aggregate Claude CLI quotas and timezone-aware resets", () => {
	assert.deepEqual(normalizeClaudeUsage(`${output}\nCurrent week (Sonnet): 20% used\nTop skills: secret\n50% of your usage was at >150k context`, capturedAt), {
		provider: "claude-bridge", state: "ready", capturedAtMs: capturedAt,
		windows: [
			{ kind: "rolling", label: "5h", usedPercent: 10, resetAtMs: Date.parse("2026-10-07T18:59:00Z") },
			{ kind: "weekly", label: "7d", usedPercent: 12, resetAtMs: Date.parse("2026-10-13T10:59:00Z") },
		],
	});
});

test("handles Claude CLI color, zero usage, and partial quotas without requiring reset text", () => {
	assert.deepEqual(normalizeClaudeUsage("\u001b[32mCurrent session: 0% used\u001b[0m", capturedAt)?.windows, [
		{ kind: "rolling", label: "5h", usedPercent: 0 },
	]);
	assert.deepEqual(normalizeClaudeUsage("Current week (all models): 12.5% used", capturedAt)?.windows, [
		{ kind: "weekly", label: "7d", usedPercent: 12.5 },
	]);
	assert.deepEqual(normalizeClaudeUsage("Current session: -5% used\nCurrent week (all models): 105% used", capturedAt)?.windows, [
		{ kind: "rolling", label: "5h", usedPercent: 0 },
		{ kind: "weekly", label: "7d", usedPercent: 100 },
	]);
});

test("does not mistake Claude local usage insights or unsupported quota output for account limits", () => {
	for (const value of [null, {}, [], "", "You are currently using your subscription", "50% of your usage was at >150k context",
		"Current week (Sonnet): 10% used", "Current session: NaN% used", "Current session: Infinity% used", "Current session: lots% used"]) {
		assert.equal(normalizeClaudeUsage(value, capturedAt), undefined);
	}
});

test("omits invalid Claude CLI resets without losing quota percentages", () => {
	for (const reset of ["not a date", "Oct 7 at 12:59pm (Invalid/Zone)", "Feb 30 at 12:59pm (UTC)",
		"Oct 0 at 12:59pm (UTC)", "Oct 7 at 13:59pm (UTC)", "Oct 7 at 12:60pm (UTC)", "Oct 7 at 0:59am (UTC)"]) {
		assert.deepEqual(normalizeClaudeUsage(`Current session: 10% used · resets ${reset}`, capturedAt)?.windows, [
			{ kind: "rolling", label: "5h", usedPercent: 10 },
		]);
	}
	const spring = Date.parse("2026-03-08T07:00:00Z");
	assert.equal(normalizeClaudeUsage("Current session: 10% used · resets Mar 8 at 2:30am (America/Boise)", spring)?.windows[0]?.resetAtMs, undefined);
});

test("interprets Claude reset dates across daylight saving and year boundaries", () => {
	for (const [now, reset, expected] of [
		["2026-03-08T07:00:00Z", "Mar 8 at 3:30am (America/Boise)", "2026-03-08T09:30:00Z"],
		["2026-12-31T23:00:00Z", "Jan 1 at 12:30am (America/Boise)", "2027-01-01T07:30:00Z"],
		["2027-01-01T03:00:00Z", "Dec 31 at 6:00pm (America/Boise)", "2027-01-01T01:00:00Z"],
	] as const) {
		assert.equal(normalizeClaudeUsage(`Current session: 10% used · resets ${reset}`, Date.parse(now))?.windows[0]?.resetAtMs, Date.parse(expected));
	}
});

test("reads Claude usage through the CLI with closed stdin and bounded execution", async (t) => {
	const calls = mockCli(t, (call) => call.complete(null, output));
	const controller = new AbortController();
	const usage = await fetchClaudeUsage(context, controller.signal);
	assert.deepEqual(usage.windows.map((window) => [window.label, window.usedPercent]), [["5h", 10], ["7d", 12]]);
	assert.equal(calls[0]?.file, "claude");
	assert.deepEqual(calls[0]?.args, [
		"--settings", '{"remoteControlAtStartup":false,"disableAllHooks":true}',
		"--strict-mcp-config", "--tools", "", "--setting-sources", "", "/usage",
	]);
	assert.deepEqual(calls[0]?.options, {
		encoding: "utf8", signal: controller.signal, timeout: 10_000, maxBuffer: 64 * 1024, killSignal: "SIGKILL",
	});
	assert.equal(calls[0]?.stdinClosed, true);
});

test("rejects failed Claude CLI probes and output without quotas without exposing stderr", async (t) => {
	for (const [name, error, stdout] of [
		["nonzero exit", new Error("secret credentials in stderr"), output],
		["missing executable", Object.assign(new Error("missing executable"), { code: "ENOENT" }), ""],
		["output buffer exceeded", Object.assign(new Error("secret output"), { code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" }), ""],
		["no account quota", null, "50% of your usage was at >150k context"],
	] as const) {
		await t.test(name, async (t) => {
			const calls = mockCli(t, (call) => call.complete(error, stdout));
			await assert.rejects(fetchClaudeUsage(context, new AbortController().signal), (error: Error) => {
				assert.doesNotMatch(error.message, /secret|credentials/);
				return true;
			});
			assert.equal(calls[0]?.stdinClosed, true);
		});
	}
});

test("does not start the Claude CLI for an already aborted request", async (t) => {
	const calls = mockCli(t, (call) => call.complete(null, output));
	const controller = new AbortController();
	controller.abort();
	await assert.rejects(fetchClaudeUsage(context, controller.signal), { name: "AbortError" });
	assert.equal(calls.length, 0);
});

test("cancels an in-flight Claude CLI request through its abort signal", async (t) => {
	const calls = mockCli(t, () => {});
	const controller = new AbortController();
	const request = fetchClaudeUsage(context, controller.signal);
	controller.abort();
	await assert.rejects(request, { name: "AbortError" });
	assert.equal(calls[0]?.options.signal.aborted, true);
	assert.equal(calls[0]?.stdinClosed, true);
});

test("Claude wiring caches quotas for five minutes and preserves them on refresh failure", async (t) => {
	let reads = 0;
	mockCli(t, (call) => ++reads === 1 ? call.complete(null, output) : call.complete(new Error("secret CLI failure"), ""));
	const originalNow = Date.now;
	let now = capturedAt;
	const { handlers, context, statuses } = entryContext();
	try {
		Date.now = () => now;
		handlers.get("session_start")?.({}, context);
		assert.equal(JSON.parse(statuses.at(-1)!).state, "unknown");
		await settle();
		const ready = JSON.parse(statuses.at(-1)!);
		assert.equal(ready.provider, "claude-bridge");
		assert.equal(ready.state, "ready");
		now += CLAUDE_CACHE_TTL_MS - 1;
		handlers.get("turn_end")?.({}, context);
		await settle();
		assert.equal(reads, 1);
		now++;
		handlers.get("turn_end")?.({}, context);
		await settle();
		assert.equal(reads, 2);
		assert.deepEqual(JSON.parse(statuses.at(-1)!), ready);
		assert.equal(statuses.some((value) => value?.includes("secret")), false);
	} finally {
		handlers.get("session_shutdown")?.({}, context);
		Date.now = originalNow;
	}
});

test("index timeout cancels a hung Claude CLI request and permits a later refresh", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	let reads = 0;
	const calls = mockCli(t, (call) => { if (++reads > 1) call.complete(null, output); });
	const { handlers, context, statuses } = entryContext();
	try {
		handlers.get("session_start")?.({}, context);
		await settle();
		assert.equal(reads, 1);
		t.mock.timers.tick(10_000);
		await settle();
		assert.equal(calls[0]?.options.signal.aborted, true);
		assert.equal(JSON.parse(statuses.at(-1)!).state, "unknown");
		handlers.get("turn_end")?.({}, context);
		await settle();
		assert.equal(reads, 2);
		assert.equal(JSON.parse(statuses.at(-1)!).state, "ready");
	} finally {
		handlers.get("session_shutdown")?.({}, context);
		t.mock.timers.reset();
	}
});

test("does not publish stale Claude results after selection, reload, or shutdown", async (t) => {
	for (const event of ["model_select", "session_start", "session_shutdown"]) {
		await t.test(event, async (t) => {
			const calls = mockCli(t, () => {});
			const { handlers, context, statuses } = entryContext();
			try {
				handlers.get("session_start")?.({}, context);
				await settle();
				handlers.get(event)?.({ model: context.model }, context);
				await settle();
				assert.equal(calls[0]?.options.signal.aborted, true);
				calls[0]?.complete(null, output);
				await settle();
				assert.equal(statuses.some((value) => value && JSON.parse(value).state === "ready"), false);
				if (event !== "session_shutdown") {
					calls[1]?.complete(null, output);
					await settle();
					assert.equal(JSON.parse(statuses.at(-1)!).state, "ready");
				} else assert.equal(statuses.at(-1), undefined);
			} finally {
				handlers.get("session_shutdown")?.({}, context);
			}
		});
	}
});

type CliCall = {
	file: string;
	args: string[];
	options: { signal: AbortSignal };
	stdinClosed: boolean;
	complete(error: Error | null, stdout: string): void;
};

function mockCli(t: TestContext, load: (call: CliCall) => void): CliCall[] {
	const calls: CliCall[] = [];
	t.mock.method(childProcess, "execFile", (file: string, args: string[], options: any, callback: any) => {
		const call: CliCall = { file, args, options, stdinClosed: false, complete: (error, stdout) => callback(error, stdout, "secret stderr") };
		calls.push(call);
		options.signal.addEventListener("abort", () => call.complete(options.signal.reason, ""), { once: true });
		queueMicrotask(() => load(call));
		return { stdin: { end() { call.stdinClosed = true; } } } as any;
	});
	return calls;
}

function settle(): Promise<void> {
	return new Promise((resolve) => setImmediate(resolve));
}

function entryContext() {
	const handlers = new Map<string, (event: any, context: any) => void>();
	providerUsage({ on(event: string, handler: (event: any, context: any) => void) { handlers.set(event, handler); } } as ExtensionAPI);
	const statuses: Array<string | undefined> = [];
	const context = {
		hasUI: true, model: { provider: "claude-bridge" },
		ui: { setStatus(_key: string, value: string | undefined) { statuses.push(value); } },
	};
	return { handlers, context, statuses };
}

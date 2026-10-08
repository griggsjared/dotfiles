import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { calculateFooterCacheHit, calculateFooterCost, decodeFooterUsageStatus, formatFooterBalance, formatFooterReset, formatFooterUsage, registerStatusline } from "../footer.ts";

test("formats shared usage status", () => {
	assert.equal(formatFooterUsage({
		provider: "openai-codex",
		state: "ready",
		capturedAtMs: 1_000_000_000_000,
		windows: [{ kind: "weekly", label: "7d", usedPercent: 20, resetAtMs: 1_000_000_000_000 }],
	}), "20%(now)");
});

test("rejects malformed status transport and accepts unknown state", () => {
	assert.equal(decodeFooterUsageStatus("not json"), undefined);
	assert.deepEqual(decodeFooterUsageStatus(JSON.stringify({
		provider: "opencode-go",
		state: "unknown",
		capturedAtMs: 1_000,
		windows: [],
	})), {
		provider: "opencode-go",
		state: "unknown",
		capturedAtMs: 1_000,
		windows: [],
	});
});

test("formats reset countdowns compactly", () => {
	const now = 1_000_000_000_000;
	assert.equal(formatFooterReset(now + 30_000, now), "1m");
	assert.equal(formatFooterReset(now + 90_000, now), "1m");
	assert.equal(formatFooterReset(now + 3_600_000, now), "1h");
	assert.equal(formatFooterReset(now + 3_900_000, now), "1h5m");
	assert.equal(formatFooterReset(now + 3 * 86_400_000 + 4 * 3_600_000, now), "3d4h");
	assert.equal(formatFooterReset(now + 20 * 86_400_000 + 4 * 3_600_000, now), "20d");
});

test("orders windows and removes resets on narrow footers", () => {
	const now = 1_000_000_000_000;
	const usage = {
		provider: "openai-codex" as const,
		state: "ready" as const,
		capturedAtMs: now,
		windows: [
			{ kind: "monthly" as const, label: "30d", usedPercent: 30, resetAtMs: now },
			{ kind: "rolling" as const, label: "5h", usedPercent: 10, resetAtMs: now },
			{ kind: "weekly" as const, label: "7d", usedPercent: 20, resetAtMs: now },
		],
	};
	assert.equal(formatFooterUsage(usage, now), "10%(now) 20%(now) 30%(now)");
	assert.equal(formatFooterUsage(usage, now, 21), "10% 20% 30%");
	const narrow = formatFooterUsage(usage, now, 12);
	assert.ok(narrow.length <= 12);
	assert.equal(formatFooterUsage(usage, now, 0), "");
});

test("calculates assistant cost without trusting unrelated entries", () => {
	assert.equal(calculateFooterCost([
		{ type: "message", message: { role: "user", usage: { cost: { total: 99 } } } },
		{ type: "message", message: { role: "assistant", usage: { cost: { total: 1.25 } } } },
		{ type: "branch_summary", message: { role: "assistant", usage: { cost: { total: 50 } } } },
	]), 1.25);
});

test("sums direct billable usage without counting nested calls or details twice", () => {
	const nested = { usage: { cost: { total: 100 } } };
	assert.equal(calculateFooterCost([
		{ type: "message", message: { role: "assistant", usage: { cost: { total: 1 } } } },
		{ type: "message", message: { role: "toolResult", usage: { cost: { total: 2 } }, nestedCalls: { calls: [nested] }, details: nested } },
		{ type: "usage", usage: { cost: { total: 3 } } },
		{ type: "compaction", usage: { cost: { total: 4 } } },
		{ type: "branch_summary", usage: { cost: { total: 5 } } },
		{ type: "message", message: { role: "toolResult", nestedCalls: { calls: [nested] }, details: nested } },
		{ type: "compaction" },
		{ type: "branch_summary" },
		{ type: "custom", usage: { cost: { total: 100 } } },
	]), 15);
});

test("ignores malformed and non-finite direct costs for every billable entry type", () => {
	for (const usage of [undefined, null, "usage", {}, { cost: null }, { cost: "cost" },
		...[undefined, null, "1", NaN, Infinity, -Infinity].map((total) => ({ cost: { total } }))]) {
		assert.equal(calculateFooterCost([
			{ type: "message", message: { role: "assistant", usage } },
			{ type: "message", message: { role: "toolResult", usage } },
			{ type: "usage", usage },
			{ type: "compaction", usage },
			{ type: "branch_summary", usage },
			{ type: "message", message: null },
			{ type: "message", message: "message" },
			{ type: "usage", usage: { cost: { total: 0.25 } } },
		]), 0.25);
	}
});

test("refreshes footer leaf cache for persisted usage and keeps totals branch-local", () => {
	const directory = mkdtempSync(join(tmpdir(), "statusline-cost-"));
	const sessionManager = SessionManager.create(directory, directory);
	const usage = (total: number) => ({
		input: 25, output: 0, cacheRead: 75, cacheWrite: 0, totalTokens: 100,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total },
	});
	const handlers = new Map<string, (event: any, context: any) => void>();
	let footer: any;
	let rendered: any;
	let branchReads = 0;
	registerStatusline({ on(event: string, handler: (event: any, context: any) => void) { handlers.set(event, handler); } } as any);
	const context = {
		model: { name: "model", provider: "deepseek" }, thinkingLevel: "off",
		getContextUsage: () => undefined,
		sessionManager: {
			getLeafId: () => sessionManager.getLeafId(),
			getBranch: () => { branchReads++; return sessionManager.getBranch(); },
		},
		ui: { setFooter(callback: any) { footer = callback; } },
	};
	try {
		sessionManager.appendMessage({ role: "user", content: "test", timestamp: 0 });
		const assistantId = sessionManager.appendMessage({
			role: "assistant", content: [], api: "openai-completions", provider: "deepseek", model: "model",
			usage: usage(1), stopReason: "stop", timestamp: 0,
		});
		handlers.get("session_start")?.({}, context);
		rendered = footer({ invalidate() {} }, { fg: (_color: string, value: string) => value }, { getExtensionStatuses: () => new Map() });
		assert.match(rendered.render(120)[0], /c:75% {2,}deepseek $/);
		assert.equal(calculateFooterCost(sessionManager.getBranch()), 1);
		rendered.render(120);
		assert.equal(branchReads, 1);
		const warm = sessionManager.appendUsage("cache_warm", "deepseek", "model", { ...usage(2), input: 100, cacheRead: 0 });
		assert.equal(sessionManager.getLeafId(), warm.id);
		assert.equal(warm.parentId, assistantId);
		assert.match(rendered.render(120)[0], /c:75% {2,}deepseek $/);
		assert.equal(calculateFooterCost(sessionManager.getBranch()), 3);
		assert.equal(branchReads, 2);
		sessionManager.appendUsage("other", "deepseek", "model", usage(3));
		assert.equal(calculateFooterCost(sessionManager.getBranch()), 6);
		sessionManager.appendMessage({ role: "toolResult", toolCallId: "call", toolName: "tool", content: [], isError: false, timestamp: 0, usage: usage(4) });
		assert.equal(calculateFooterCost(sessionManager.getBranch()), 10);
		sessionManager.appendCompaction("summary", null, 100, undefined, false, usage(5));
		assert.equal(calculateFooterCost(sessionManager.getBranch()), 15);
		const summaryId = sessionManager.branchWithSummary(assistantId, "branch", undefined, false, usage(6));
		assert.match(rendered.render(120)[0], /c:75% {2,}deepseek $/);
		assert.equal(calculateFooterCost(sessionManager.getBranch()), 7);
		assert.equal(calculateFooterCost(sessionManager.getEntries()), 21);
		sessionManager.appendCompaction("legacy", null, 100);
		assert.equal(calculateFooterCost(sessionManager.getBranch()), 7);
		sessionManager.branch(assistantId);
		assert.equal(calculateFooterCost(sessionManager.getBranch()), 1);
		sessionManager.branch(summaryId);
		assert.equal(calculateFooterCost(sessionManager.getBranch()), 7);
		sessionManager.resetLeaf();
		assert.equal(rendered.render(120)[0], " model" + " ".repeat(105) + "deepseek ");
	} finally {
		rendered?.dispose();
		rmSync(directory, { recursive: true, force: true });
	}
});

test("calculates cache hit percentage from assistant usage", () => {
	assert.equal(calculateFooterCacheHit([
		{ type: "message", message: { role: "assistant", usage: { input: 25, cacheRead: 75, cacheWrite: 0 } } },
	]), 75);
	assert.equal(calculateFooterCacheHit([]), undefined);
});

test("formats balances by currency", () => {
	assert.equal(formatFooterBalance({ amount: 110, currency: "USD" }), "b:$110.00");
	assert.equal(formatFooterBalance({ amount: 12.5, currency: "CNY" }), "b:¥12.50");
	assert.equal(formatFooterBalance({ amount: 1, currency: "EUR" }), "b:EUR 1.00");
});

test("right-aligns balance beside DeepSeek", () => {
	const handlers = new Map<string, (event: any, context: any) => void>();
	let footer: ((...args: any[]) => any) | undefined;
	let rendered: any;
	const statuses = new Map([["provider-usage", JSON.stringify({
		provider: "deepseek", state: "ready", capturedAtMs: 0, windows: [], balance: { amount: 42.5, currency: "USD" },
	})]]);
	registerStatusline({ on(event: string, handler: (event: any, context: any) => void) { handlers.set(event, handler); } } as any);
	const context = {
		model: { name: "DeepSeek V4.1 Flash", provider: "deepseek" }, thinkingLevel: "off",
		getContextUsage: () => undefined,
		sessionManager: { getLeafId: () => null, getBranch: () => [{ type: "message", message: { role: "assistant", usage: { cost: { total: 0.042 } } } }] },
		ui: { setFooter(callback: any) { footer = callback; } },
	};
	try {
		handlers.get("session_start")?.({}, context);
		rendered = footer?.({ invalidate() {} }, { fg: (_color: string, value: string) => value, bold: (value: string) => value }, { getExtensionStatuses: () => statuses });
		const line = rendered.render(120)[0];
		assert.match(line, /^ DeepSeek V4\.1 Flash {2,}b:\$42\.50 deepseek $/);
		assert.equal(line.length, 120);
		assert.equal(rendered.render(40)[0], " DeepSeek V4.1 Flash  b:$42.50 deepseek ");
		assert.doesNotMatch(rendered.render(39)[0], /b:/);
		assert.equal(rendered.render(32)[0], " DeepSeek V4.1 Flash   deepseek ");
	} finally {
		rendered?.dispose();
	}
});

test("right-aligns nonquota providers without a balance", () => {
	const handlers = new Map<string, (event: any, context: any) => void>();
	let footer: ((...args: any[]) => any) | undefined;
	let rendered: any;
	const statuses = new Map([["provider-usage", JSON.stringify({ provider: "deepseek", state: "unknown", capturedAtMs: 0, windows: [] })]]);
	registerStatusline({ on(event: string, handler: (event: any, context: any) => void) { handlers.set(event, handler); } } as any);
	const context = {
		model: { name: "DeepSeek V4.1 Flash", provider: "deepseek" }, thinkingLevel: "off",
		getContextUsage: () => undefined,
		sessionManager: { getLeafId: () => null, getBranch: () => [{ type: "message", message: { role: "assistant", usage: { cost: { total: 0.042 } } } }] },
		ui: { setFooter(callback: any) { footer = callback; } },
	};
	try {
		handlers.get("session_start")?.({}, context);
		rendered = footer?.({ invalidate() {} }, { fg: (_color: string, value: string) => value, bold: (value: string) => value }, { getExtensionStatuses: () => statuses });
		for (const provider of ["deepseek", "anthropic"]) {
			context.model.provider = provider;
			const line = rendered.render(120)[0];
			assert.equal(line, " DeepSeek V4.1 Flash" + " ".repeat(118 - context.model.name.length - provider.length) + provider + " ");
			assert.ok(line.endsWith(provider + " "));
			assert.equal(line.length, 120);
			assert.doesNotMatch(line, /quota:\?/);
		}
	} finally {
		rendered?.dispose();
	}
});

test("right-aligns quota windows and the pending marker beside the provider without session cost", () => {
	const handlers = new Map<string, (event: any, context: any) => void>();
	let footer: ((...args: any[]) => any) | undefined;
	let rendered: any;
	const statuses = new Map([
		["provider-usage", JSON.stringify({ provider: "openai-codex", state: "unknown", capturedAtMs: 0, windows: [] })],
		["subagent-profile", "review"],
	]);
	registerStatusline({ on(event: string, handler: (event: any, context: any) => void) { handlers.set(event, handler); } } as any);
	const context = {
		model: { name: "GPT-5.6 Luna", provider: "openai-codex" }, thinkingLevel: "high",
		getContextUsage: () => ({ tokens: 1000, contextWindow: 200000 }),
		sessionManager: { getLeafId: () => null, getBranch: () => [{ type: "message", message: { role: "assistant", usage: { input: 25, cacheRead: 75, cacheWrite: 0, cost: { total: 0.042 } } } }] },
		ui: { setFooter(callback: any) { footer = callback; } },
	};
	try {
		handlers.get("session_start")?.({}, context);
		rendered = footer?.({ invalidate() {} }, { fg: (_color: string, value: string) => value, bold: (value: string) => value }, { getExtensionStatuses: () => statuses });
		const left = "GPT-5.6 Luna high s:review 1.0k/200k c:75%";
		const pending = "quota:? openai-codex";
		const line = rendered.render(120)[0];
		assert.equal(line, ` ${left}` + " ".repeat(118 - left.length - pending.length) + `${pending} `);
		assert.equal(rendered.render(left.length + 4 + pending.length)[0], ` ${left}  ${pending} `);
		assert.doesNotMatch(line, /s:\$/);
		assert.deepEqual(rendered.render(120).slice(1), []);

		statuses.set("provider-usage", JSON.stringify({
			provider: "openai-codex", state: "ready", capturedAtMs: 0,
			windows: [
				{ kind: "monthly", label: "30d", usedPercent: 30, resetAtMs: 1 },
				{ kind: "rolling", label: "5h", usedPercent: 10, resetAtMs: 1 },
				{ kind: "weekly", label: "7d", usedPercent: 20, resetAtMs: 1 },
			],
			balance: { amount: 42.5, currency: "USD" },
		}));
		const right = "10%(now) 20%(now) 30%(now) b:$42.50 openai-codex";
		assert.equal(rendered.render(120)[0], ` ${left}` + " ".repeat(118 - left.length - right.length) + `${right} `);
		assert.deepEqual(rendered.render(120).slice(1), []);
		const compact = "10% 20% 30% openai-codex";
		assert.equal(rendered.render(left.length + 4 + compact.length)[0], ` ${left}  ${compact} `);
		const truncated = "10% openai-codex";
		assert.equal(rendered.render(left.length + 4 + truncated.length)[0].replace(/\x1b\[[0-9;]*m/g, ""), ` ${left}  ${truncated} `);
		for (const width of [0, 1, 2, 4, 20, 40, 80, 120]) {
			assert.ok(visibleWidth(rendered.render(width)[0]) <= width);
			assert.doesNotMatch(rendered.render(width)[0], /s:\$/);
		}
	} finally {
		rendered?.dispose();
	}
});

test("renders Claude unknown quota then 5h and 7d usage resets beside claude-bridge", (t) => {
	const now = 1_000_000_000_000;
	t.mock.method(Date, "now", () => now);
	const handlers = new Map<string, (event: any, context: any) => void>();
	let footer: any;
	let rendered: any;
	const statuses = new Map([["provider-usage", JSON.stringify({
		provider: "claude-bridge", state: "unknown", capturedAtMs: now, windows: [],
	})]]);
	registerStatusline({ on(event: string, handler: (event: any, context: any) => void) { handlers.set(event, handler); } } as any);
	const context = {
		model: { name: "Claude Sonnet", provider: "claude-bridge" }, thinkingLevel: "off",
		getContextUsage: () => undefined,
		sessionManager: { getLeafId: () => null, getBranch: () => [] },
		ui: { setFooter(callback: any) { footer = callback; } },
	};
	try {
		handlers.get("session_start")?.({}, context);
		rendered = footer({ invalidate() {} }, { fg: (_color: string, value: string) => value }, { getExtensionStatuses: () => statuses });
		assert.match(rendered.render(120)[0], /quota:\? claude-bridge $/);
		statuses.set("provider-usage", JSON.stringify({
			provider: "claude-bridge", state: "ready", capturedAtMs: now,
			windows: [
				{ kind: "weekly", label: "7d", usedPercent: 40, resetAtMs: now + 3 * 86_400_000 + 4 * 3_600_000 },
				{ kind: "rolling", label: "5h", usedPercent: 12.5, resetAtMs: now + 3_900_000 },
			],
		}));
		assert.match(rendered.render(120)[0], /13%\(1h5m\) 40%\(3d4h\) claude-bridge $/);
	} finally {
		rendered?.dispose();
	}
});

test("colors each quota window at usage thresholds across footer widths", () => {
	const handlers = new Map<string, (event: any, context: any) => void>();
	let footer: any;
	let rendered: any;
	const statuses = new Map<string, string>();
	registerStatusline({ on(event: string, handler: (event: any, context: any) => void) { handlers.set(event, handler); } } as any);
	const context = {
		model: { name: "model", provider: "openai-codex" }, thinkingLevel: "off",
		getContextUsage: () => undefined,
		sessionManager: { getLeafId: () => null, getBranch: () => [] },
		ui: { setFooter(callback: any) { footer = callback; } },
	};
	try {
		handlers.get("session_start")?.({}, context);
		const ansi = (color: string, value: string) => {
			const codes: Record<string, number> = { error: 31, warning: 33, dim: 2, muted: 90 };
			return `\x1b[${codes[color] ?? 37}m${value}\x1b[0m`;
		};
		rendered = footer({ invalidate() {} }, { fg: ansi }, { getExtensionStatuses: () => statuses });
		for (const [usedPercent, color] of [[89.99, "dim"], [90, "warning"], [94.99, "warning"], [95, "error"], [100, "error"]] as const) {
			statuses.set("provider-usage", JSON.stringify({
				provider: "openai-codex", state: "ready", capturedAtMs: 0,
				windows: [{ kind: "rolling", label: "5h", usedPercent, resetAtMs: 1 }],
			}));
			assert.ok(rendered.render(120)[0].includes(ansi(color, `${Math.round(usedPercent)}%(now)`)));
			assert.ok(rendered.render(26)[0].includes(ansi(color, `${Math.round(usedPercent)}%`)));
		}
		statuses.set("provider-usage", JSON.stringify({
			provider: "openai-codex", state: "ready", capturedAtMs: 0,
			windows: [
				{ kind: "monthly", label: "30d", usedPercent: 20, resetAtMs: 1 },
				{ kind: "rolling", label: "5h", usedPercent: 95, resetAtMs: 1 },
				{ kind: "weekly", label: "7d", usedPercent: 90, resetAtMs: 1 },
			],
		}));
		assert.ok(rendered.render(120)[0].includes(`${ansi("error", "95%(now)")} ${ansi("warning", "90%(now)")} ${ansi("dim", "20%(now)")}`));
		assert.ok(rendered.render(33)[0].includes(`${ansi("error", "95%")} ${ansi("warning", "90%")} ${ansi("dim", "20%")}`));
		assert.ok(rendered.render(25)[0].includes(ansi("error", "95%")));
		for (let width = 0; width <= 120; width++) {
			const line = rendered.render(width)[0];
			assert.ok(visibleWidth(line) <= width);
			if (line.includes("openai-codex")) assert.ok(line.endsWith(ansi("muted", "openai-codex") + " "));
		}
	} finally {
		rendered?.dispose();
	}
});

test("colors dollar balances below one dollar and fifty cents", () => {
	const handlers = new Map<string, (event: any, context: any) => void>();
	let footer: any;
	let rendered: any;
	const statuses = new Map<string, string>();
	registerStatusline({ on(event: string, handler: (event: any, context: any) => void) { handlers.set(event, handler); } } as any);
	const context = {
		model: { name: "model", provider: "deepseek" }, thinkingLevel: "off",
		getContextUsage: () => undefined,
		sessionManager: { getLeafId: () => null, getBranch: () => [] },
		ui: { setFooter(callback: any) { footer = callback; } },
	};
	try {
		handlers.get("session_start")?.({}, context);
		const ansi = (color: string, value: string) => {
			const codes: Record<string, number> = { error: 31, warning: 33, dim: 2, muted: 90 };
			return `\x1b[${codes[color] ?? 37}m${value}\x1b[0m`;
		};
		rendered = footer({ invalidate() {} }, { fg: ansi }, { getExtensionStatuses: () => statuses });
		for (const [amount, color] of [[1, "dim"], [0.99, "warning"], [0.5, "warning"], [0.49, "error"], [0, "error"]] as const) {
			statuses.set("provider-usage", JSON.stringify({
				provider: "deepseek", state: "ready", capturedAtMs: 0, windows: [], balance: { amount, currency: "USD" },
			}));
			const line = rendered.render(120)[0];
			assert.ok(line.endsWith(`${ansi(color, `b:$${amount.toFixed(2)}`)} ${ansi("muted", "deepseek")} `));
			assert.equal(visibleWidth(line), 120);
			const minWidth = 18 + `b:$${amount.toFixed(2)}`.length;
			assert.ok(rendered.render(minWidth)[0].includes(ansi(color, `b:$${amount.toFixed(2)}`)));
			for (let width = 0; width < minWidth; width++) {
				const narrow = rendered.render(width)[0];
				assert.ok(visibleWidth(narrow) <= width);
				assert.doesNotMatch(narrow, /b:/);
			}
		}
		statuses.set("provider-usage", JSON.stringify({
			provider: "deepseek", state: "ready", capturedAtMs: 0, windows: [], balance: { amount: 0.49, currency: "CNY" },
		}));
		assert.ok(rendered.render(120)[0].includes(ansi("dim", "b:¥0.49")));
	} finally {
		rendered?.dispose();
	}
});

test("never clips balance mid-number on narrow footers", () => {
	const handlers = new Map<string, (event: any, context: any) => void>();
	let footer: ((...args: any[]) => any) | undefined;
	let rendered: any;
	const statuses = new Map([["provider-usage", JSON.stringify({
		provider: "deepseek", state: "ready", capturedAtMs: 0, windows: [], balance: { amount: 123456.78, currency: "USD" },
	})]]);
	registerStatusline({ on(event: string, handler: (event: any, context: any) => void) { handlers.set(event, handler); } } as any);
	const context = {
		model: { name: "DeepSeek V4.1 Flash", provider: "deepseek" }, thinkingLevel: "off",
		getContextUsage: () => undefined,
		sessionManager: { getLeafId: () => null, getBranch: () => [{ type: "message", message: { role: "assistant", usage: { cost: { total: 0.042 } } } }] },
		ui: { setFooter(callback: any) { footer = callback; } },
	};
	try {
		handlers.get("session_start")?.({}, context);
		rendered = footer?.({ invalidate() {} }, { fg: (_color: string, value: string) => value, bold: (value: string) => value }, { getExtensionStatuses: () => statuses });
		const wide = rendered.render(120)[0];
		assert.match(wide, /^ DeepSeek V4\.1 Flash {2,}b:\$123456\.78 deepseek $/);
		assert.equal(wide.length, 120);
		const narrow = rendered.render(36)[0].replace(/\x1b\[[0-9;]*m/g, "");
		assert.doesNotMatch(narrow, /b:/);
		assert.match(narrow, /deepseek $/);
		for (let width = 0; width <= 120; width++) {
			const line = rendered.render(width)[0];
			assert.ok(visibleWidth(line) <= width);
			if (line.includes("b:")) assert.match(line, /b:\$123456\.78 deepseek $/);
		}
	} finally {
		rendered?.dispose();
	}
});

test("renders the subagent profile inline and reflects updates without duplicating job rows", () => {
	const handlers = new Map<string, (event: any, context: any) => void>();
	let footer: any;
	let rendered: any;
	const statuses = new Map([["subagents", "jobs:1 running"], ["modes", "plan"], ["other", "other status"]]);
	registerStatusline({ on(event: string, handler: (event: any, context: any) => void) { handlers.set(event, handler); } } as any);
	const context = {
		model: { name: "model", provider: "anthropic" }, thinkingLevel: "high" as string | undefined,
		getContextUsage: () => ({ tokens: 1000, contextWindow: 200000 }),
		sessionManager: { getLeafId: () => null, getBranch: () => [] },
		ui: { setFooter(callback: any) { footer = callback; } },
	};
	try {
		handlers.get("session_start")?.({}, context);
		rendered = footer({ invalidate() {} }, { fg: (_color: string, value: string) => value }, { getExtensionStatuses: () => statuses });
		const absent = rendered.render(120);
		assert.match(absent[0], /^ \[p\] model high 1\.0k\/200k/);
		assert.doesNotMatch(absent[0], /s:/);
		assert.deepEqual(absent.slice(1), [" other status ", " jobs:1 running "]);
		statuses.set("subagent-profile", "review");
		const active = rendered.render(120);
		assert.match(active[0], /^ \[p\] model high s:review 1\.0k\/200k/);
		assert.deepEqual(active.slice(1), [" other status ", " jobs:1 running "]);
		statuses.set("subagent-profile", "implement");
		const updated = rendered.render(120);
		assert.match(updated[0], /^ \[p\] model high s:implement 1\.0k\/200k/);
		assert.doesNotMatch(updated[0], /review/);
		for (const effort of ["off", undefined]) {
			context.thinkingLevel = effort;
			assert.match(rendered.render(120)[0], /^ \[p\] model s:implement 1\.0k\/200k/);
		}
		statuses.delete("subagent-profile");
		const unset = rendered.render(120);
		assert.match(unset[0], /^ \[p\] model 1\.0k\/200k/);
		assert.doesNotMatch(unset[0], /s:/);
		assert.deepEqual(unset.slice(1), [" other status ", " jobs:1 running "]);
	} finally {
		rendered?.dispose();
	}
});

test("renders ANSI-themed footer within a narrow width and disposes its timer", () => {
	const handlers = new Map<string, (event: any, context: any) => void>();
	let footer: any;
	let rendered: any;
	const statuses = new Map([
		["provider-usage", JSON.stringify({ provider: "openai-codex", state: "ready", capturedAtMs: 0, windows: [{ kind: "rolling", label: "5h", usedPercent: 42, resetAtMs: 0 }] })],
		["subagent-profile", "a-very-long-selected-profile-name"],
		["subagents", "jobs:1 running"],
	]);
	registerStatusline({ on(event: string, handler: (event: any, context: any) => void) { handlers.set(event, handler); } } as any);
	let contextTokens = 1000;
	const context = {
		model: { name: "a-very-long-model-name", provider: "openai-codex" }, thinkingLevel: "off",
		getContextUsage: () => ({ tokens: contextTokens, contextWindow: 1000000 }),
		sessionManager: { getLeafId: () => null, getBranch: () => [{ type: "message", message: { role: "assistant", usage: { input: 25, cacheRead: 75, cacheWrite: 0 } } }] },
		ui: { setFooter(callback: any) { footer = callback; } },
	};
	try {
		handlers.get("session_start")?.({}, context);
		const ansi = (color: string, value: string) => {
			const codes: Record<string, number | string> = { accent: "38;2;230;151;92", success: 32, error: 31, warning: 33, borderAccent: 34, dim: 2, muted: 90 };
			return `\x1b[${codes[color] ?? 37}m${value}\x1b[0m`;
		};
		rendered = footer({ invalidate() {} }, { fg: ansi, bold: (value: string) => value }, { getExtensionStatuses: () => statuses });
		assert.match(rendered.render(120)[0], /\x1b\[38;2;230;151;92m s:a-very-long-selected-profile-name\x1b\[0m/);
		assert.match(rendered.render(120)[0], /\x1b\[34m1\.0k\/1m\x1b\[0m/);
		assert.match(rendered.render(120)[0], /\x1b\[33mc:75%\x1b\[0m/);
		const wide = rendered.render(120)[0].replace(/\x1b\[[0-9;]*m/g, "");
		assert.match(wide, /^ a-very-long-model-name s:a-very-long-selected-profile-name 1\.0k\/1m c:75% {2,}42% openai-codex $/);
		assert.equal(wide.length, 120);
		contextTokens = 200000;
		assert.match(rendered.render(120)[0], /\x1b\[31m200k\/1m\x1b\[0m/);
		const lines = rendered.render(20);
		assert.equal(lines.length, 2);
		assert.equal(lines[1], " jobs:1 running ");
		for (const width of [0, 1, 2, 3, 4, 20, 40, 80, 120]) {
			for (const line of rendered.render(width)) {
				assert.ok(visibleWidth(line) <= width);
				if (width >= 3) {
					assert.ok(line.startsWith(" "));
					assert.ok(line.endsWith(" "));
				}
			}
		}
	} finally {
		rendered?.dispose();
	}
});

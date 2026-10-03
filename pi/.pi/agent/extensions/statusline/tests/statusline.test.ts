import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
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
		assert.match(rendered.render(120)[0], /C75%.*s:\$1\.000/);
		rendered.render(120);
		assert.equal(branchReads, 1);
		const warm = sessionManager.appendUsage("cache_warm", "deepseek", "model", { ...usage(2), input: 100, cacheRead: 0 });
		assert.equal(sessionManager.getLeafId(), warm.id);
		assert.equal(warm.parentId, assistantId);
		assert.match(rendered.render(120)[0], /C75%.*s:\$3\.000/);
		assert.equal(branchReads, 2);
		sessionManager.appendUsage("other", "deepseek", "model", usage(3));
		assert.match(rendered.render(120)[0], /s:\$6\.000/);
		sessionManager.appendMessage({ role: "toolResult", toolCallId: "call", toolName: "tool", content: [], isError: false, timestamp: 0, usage: usage(4) });
		assert.match(rendered.render(120)[0], /s:\$10\.000/);
		sessionManager.appendCompaction("summary", null, 100, undefined, false, usage(5));
		assert.match(rendered.render(120)[0], /s:\$15\.000/);
		const summaryId = sessionManager.branchWithSummary(assistantId, "branch", undefined, false, usage(6));
		assert.match(rendered.render(120)[0], /C75%.*s:\$7\.000/);
		assert.equal(calculateFooterCost(sessionManager.getEntries()), 21);
		sessionManager.appendCompaction("legacy", null, 100);
		assert.match(rendered.render(120)[0], /s:\$7\.000/);
		sessionManager.branch(assistantId);
		assert.match(rendered.render(120)[0], /s:\$1\.000/);
		sessionManager.branch(summaryId);
		assert.match(rendered.render(120)[0], /s:\$7\.000/);
		sessionManager.resetLeaf();
		assert.doesNotMatch(rendered.render(120)[0], /s:\$|C75%/);
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

test("shows session cost and remaining balance together for DeepSeek", () => {
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
		assert.match(line, /b:\$42\.50/);
		assert.match(line, /s:\$0\.042/);
	} finally {
		rendered?.dispose();
	}
});

test("shows session cost for a balance provider even when the balance is missing", () => {
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
		const line = rendered.render(120)[0];
		assert.match(line, /s:\$0\.042/);
		assert.doesNotMatch(line, /quota:\?/);
	} finally {
		rendered?.dispose();
	}
});

test("keeps the quota placeholder and hides cost for quota providers", () => {
	const handlers = new Map<string, (event: any, context: any) => void>();
	let footer: ((...args: any[]) => any) | undefined;
	let rendered: any;
	const statuses = new Map([["provider-usage", JSON.stringify({ provider: "openai-codex", state: "unknown", capturedAtMs: 0, windows: [] })]]);
	registerStatusline({ on(event: string, handler: (event: any, context: any) => void) { handlers.set(event, handler); } } as any);
	const context = {
		model: { name: "GPT-5.6 Luna", provider: "openai-codex" }, thinkingLevel: "off",
		getContextUsage: () => undefined,
		sessionManager: { getLeafId: () => null, getBranch: () => [{ type: "message", message: { role: "assistant", usage: { cost: { total: 0.042 } } } }] },
		ui: { setFooter(callback: any) { footer = callback; } },
	};
	try {
		handlers.get("session_start")?.({}, context);
		rendered = footer?.({ invalidate() {} }, { fg: (_color: string, value: string) => value, bold: (value: string) => value }, { getExtensionStatuses: () => statuses });
		const line = rendered.render(120)[0];
		assert.match(line, /quota:\?/);
		assert.doesNotMatch(line, /s:\$/);
	} finally {
		rendered?.dispose();
	}
});

test("never clips balance or cost mid-number on narrow footers", () => {
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
		assert.match(wide, /b:\$123456\.78/);
		assert.match(wide, /s:\$0\.042/);
		const narrow = rendered.render(36)[0].replace(/\x1b\[[0-9;]*m/g, "");
		assert.doesNotMatch(narrow, /b:|s:/);
		assert.match(narrow, /deepseek/);
	} finally {
		rendered?.dispose();
	}
});

test("renders ANSI-themed footer within a narrow width and disposes its timer", () => {
	const handlers = new Map<string, (event: any, context: any) => void>();
	let footer: any;
	let rendered: any;
	const statuses = new Map([["provider-usage", JSON.stringify({ provider: "openai-codex", state: "ready", capturedAtMs: 0, windows: [{ kind: "rolling", label: "5h", usedPercent: 42, resetAtMs: 0 }] })]]);
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
			const codes: Record<string, number> = { success: 32, error: 31, warning: 33, borderAccent: 34, dim: 2, muted: 90 };
			return `\x1b[${codes[color] ?? 37}m${value}\x1b[0m`;
		};
		rendered = footer({ invalidate() {} }, { fg: ansi, bold: (value: string) => value }, { getExtensionStatuses: () => statuses });
		assert.match(rendered.render(120)[0], /\x1b\[34m1\.0k\/1m\x1b\[0m/);
		assert.match(rendered.render(120)[0], /\x1b\[33mC75%\x1b\[0m/);
		contextTokens = 200000;
		assert.match(rendered.render(120)[0], /\x1b\[31m200k\/1m\x1b\[0m/);
		const lines = rendered.render(20);
		assert.equal(lines.length, 1);
		assert.ok([...lines[0]].length >= 0);
		assert.ok(lines[0].replace(/\x1b\[[0-9;]*m/g, "").length <= 20);
	} finally {
		rendered?.dispose();
	}
});

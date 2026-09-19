import assert from "node:assert/strict";
import { test } from "node:test";
import {
	decodeUsageStatus,
	encodeUsageStatus,
	isQuotaProvider,
	isUsageBalance,
	isUsageProvider,
	isUsageStatus,
	isUsageWindow,
	normalizeUsagePercent,
} from "../usage-status.ts";

const readyStatus = {
	provider: "openai-codex" as const,
	state: "ready" as const,
	capturedAtMs: 1_000,
	windows: [{ kind: "rolling" as const, label: "5h", usedPercent: 42.5, resetAtMs: 2_000 }],
};

test("distinguishes quota providers from balance providers", () => {
	assert.equal(isUsageProvider("deepseek"), true);
	assert.equal(isQuotaProvider("deepseek"), false);
	assert.equal(isQuotaProvider("openai-codex"), true);
	assert.equal(isQuotaProvider("opencode-go"), true);
	assert.equal(isQuotaProvider("anthropic"), false);
});

test("validates balances directly", () => {
	assert.equal(isUsageBalance({ amount: 1, currency: "USD" }), true);
	assert.equal(isUsageBalance({ amount: 0, currency: "CNY" }), true);
	assert.equal(isUsageBalance({ amount: 1, currency: "usd" }), false);
	assert.equal(isUsageBalance({ amount: -1, currency: "USD" }), false);
	assert.equal(isUsageBalance({ amount: Number.NaN, currency: "USD" }), false);
	assert.equal(isUsageBalance({ amount: 1 }), false);
});

test("round trips a usage status", () => {
	assert.deepEqual(decodeUsageStatus(encodeUsageStatus(readyStatus)), readyStatus);
	assert.equal(isUsageStatus(readyStatus), true);
});

test("rejects malformed JSON and invalid usage shapes", () => {
	assert.equal(decodeUsageStatus("not json"), undefined);
	assert.equal(isUsageStatus({ ...readyStatus, provider: "other" }), false);
	assert.equal(isUsageStatus({ ...readyStatus, capturedAtMs: -1 }), false);
	assert.equal(isUsageWindow({ ...readyStatus.windows[0], usedPercent: Number.NaN }), false);
	assert.equal(isUsageWindow({ ...readyStatus.windows[0], resetAtMs: Infinity }), false);
});

test("accepts optional reset timestamps and unknown status without windows", () => {
	const unknown = {
		provider: "opencode-go" as const,
		state: "unknown" as const,
		windows: [],
		capturedAtMs: 0,
	};
	const noReset = { ...readyStatus, windows: [{ kind: "weekly" as const, label: "7d", usedPercent: 0 }] };
	assert.equal(isUsageStatus(unknown), true);
	assert.equal(isUsageStatus(noReset), true);
});

test("normalizes percentages and rejects non-numbers", () => {
	assert.equal(normalizeUsagePercent(-10), 0);
	assert.equal(normalizeUsagePercent(125), 100);
	assert.equal(normalizeUsagePercent(42), 42);
	assert.equal(normalizeUsagePercent(Infinity), undefined);
	assert.equal(normalizeUsagePercent("42"), undefined);
});

test("round trips a balance status and rejects invalid balances", () => {
	assert.equal(isUsageProvider("deepseek"), true);
	const balanceStatus = {
		provider: "deepseek" as const,
		state: "ready" as const,
		capturedAtMs: 1_000,
		windows: [],
		balance: { amount: 110, currency: "USD" },
	};
	assert.deepEqual(decodeUsageStatus(encodeUsageStatus(balanceStatus)), balanceStatus);
	assert.equal(isUsageStatus({ ...balanceStatus, balance: { amount: -1, currency: "USD" } }), false);
	assert.equal(isUsageStatus({ ...balanceStatus, balance: { amount: 1, currency: "usd" } }), false);
	assert.equal(isUsageStatus({ ...balanceStatus, balance: { amount: Number.NaN, currency: "USD" } }), false);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { normalizeAnthropicHeaders } from "../providers/anthropic.ts";
import { normalizeCodexUsage } from "../providers/codex.ts";
import { normalizeDeepseekUsage } from "../providers/deepseek.ts";
import { readResponseTextLimited } from "../http.ts";
import providerUsage from "../index.ts";
import { normalizeOpencodeGoUsage } from "../providers/opencode.ts";

const capturedAt = 1_700_000_000_000;

test("entry wiring registers the footer and publishes provider status", async () => {
	const handlers = new Map<string, Array<(event: any, context: any) => void>>();
	providerUsage({ events: { on() { return () => {}; }, emit() {} }, on(event: string, handler: (event: any, context: any) => void) {
		handlers.set(event, [...(handlers.get(event) ?? []), handler]);
	} } as unknown as ExtensionAPI);
	let footerSet = false;
	const statuses: Array<string | undefined> = [];
	const context = {
		hasUI: true,
		model: { provider: "deepseek" },
		modelRegistry: { getProvider: () => undefined, getProviderAuth: async () => undefined },
		getContextUsage: () => undefined,
		sessionManager: { getLeafId: () => null, getBranch: () => [] },
		ui: { setFooter() { footerSet = true; }, setStatus(_key: string, value: string | undefined) { statuses.push(value); } },
	};
	try {
		for (const handler of handlers.get("session_start") ?? []) handler({}, context);
		assert.equal(footerSet, true);
		const decoded = statuses.map((value) => value === undefined ? undefined : JSON.parse(value) as { provider?: string; state?: string });
		assert.equal(decoded.some((value) => value?.provider === "deepseek" && value.state === "unknown"), true);
		await new Promise<void>((resolve) => setImmediate(resolve));
	} finally {
		for (const handler of handlers.get("session_shutdown") ?? []) handler({}, context);
	}
});

test("normalizes Codex field variants and classifies windows", () => {
	const usage = normalizeCodexUsage({ rate_limit: {
		primary_window: { used_percent: 25, limit_window_seconds: 18_000, reset_at: 1_700_000_123 },
		secondary_window: { usedPercent: 50, window_minutes: 10_080, resetAt: 1_700_001_234_000 },
	} }, capturedAt);
	assert.deepEqual(usage, {
		provider: "openai-codex", state: "ready", capturedAtMs: capturedAt,
		windows: [
			{ kind: "rolling", label: "5h", usedPercent: 25, resetAtMs: 1_700_000_123_000 },
			{ kind: "weekly", label: "7d", usedPercent: 50, resetAtMs: 1_700_001_234_000 },
		],
	});
});

test("normalizes DeepSeek balance responses", () => {
	assert.deepEqual(normalizeDeepseekUsage({
		is_available: true,
		balance_infos: [{ currency: "CNY", total_balance: "110.00", granted_balance: "10.00", topped_up_balance: "100.00" }],
	}, capturedAt), {
		provider: "deepseek", state: "ready", capturedAtMs: capturedAt, windows: [], balance: { amount: 110, currency: "CNY" },
	});
	assert.deepEqual(normalizeDeepseekUsage({ balance_infos: [{ currency: "usd", total_balance: "7" }] }, capturedAt)?.balance, { amount: 7, currency: "USD" });
	assert.deepEqual(normalizeDeepseekUsage({
		balance_infos: [{ currency: "CNY", total_balance: "0" }, { currency: "USD", total_balance: "9.50" }],
	}, capturedAt)?.balance, { amount: 9.5, currency: "USD" });
	assert.deepEqual(normalizeDeepseekUsage({
		balance_infos: [{ currency: "USD", total_balance: "-1" }, { currency: "CNY", total_balance: "3" }],
	}, capturedAt)?.balance, { amount: 3, currency: "CNY" });
	for (const total_balance of ["", "  ", "0x10", "1,234.56", "oops"]) {
		assert.equal(normalizeDeepseekUsage({ balance_infos: [{ currency: "USD", total_balance }] }, capturedAt), undefined, total_balance);
	}
	assert.equal(normalizeDeepseekUsage({ balance_infos: [{ currency: "usd", total_balance: "oops" }] }, capturedAt), undefined);
	assert.equal(normalizeDeepseekUsage({ balance_infos: [] }, capturedAt), undefined);
	assert.equal(normalizeDeepseekUsage({}, capturedAt), undefined);
});

test("fetches DeepSeek balance from the fixed endpoint with an auth header", async () => {
	const handlers = new Map<string, (event: any, context: any) => void>();
	providerUsage({ events: { on() { return () => {}; }, emit() {} }, on(event: string, handler: (event: any, context: any) => void) { handlers.set(event, handler); } } as unknown as ExtensionAPI);
	const originalFetch = globalThis.fetch;
	let url: string | undefined;
	let request: RequestInit | undefined;
	globalThis.fetch = async (target, init) => {
		url = String(target);
		request = init;
		return new Response(JSON.stringify({ is_available: true, balance_infos: [{ currency: "USD", total_balance: "42.50" }] }));
	};
	const statuses: Array<string | undefined> = [];
	const context = {
		hasUI: true, model: { provider: "deepseek" },
		modelRegistry: {
			getProvider: () => ({ baseUrl: "https://api.deepseek.com/v1" }),
			getProviderAuth: async () => ({ auth: { apiKey: "sk-test" } }),
		},
		ui: { setStatus(_key: string, value: string | undefined) { statuses.push(value); } },
	};
	try {
		handlers.get("session_start")?.({}, context);
		await new Promise<void>((resolve) => setImmediate(resolve));
		assert.equal(url, "https://api.deepseek.com/user/balance");
		assert.equal(request?.redirect, "error");
		assert.equal((request?.headers as Record<string, string>).Authorization, "Bearer sk-test");
		const published = JSON.parse(statuses.at(-1)!);
		assert.deepEqual(published, {
			provider: "deepseek", state: "ready", capturedAtMs: published.capturedAtMs, windows: [], balance: { amount: 42.5, currency: "USD" },
		});
	} finally {
		handlers.get("session_shutdown")?.({}, context);
		globalThis.fetch = originalFetch;
	}
});

test("answers provider usage requests for non-active providers without touching the footer", async () => {
	const handlers = new Map<string, (event: any, context: any) => void>();
	let request: ((data: unknown) => void) | undefined;
	providerUsage({
		events: { on(channel: string, handler: (data: unknown) => void) { if (channel === "provider-usage:request") request = handler; return () => {}; }, emit() {} },
		on(event: string, handler: (event: any, context: any) => void) { handlers.set(event, handler); },
	} as unknown as ExtensionAPI);
	const originalFetch = globalThis.fetch;
	let calls = 0;
	globalThis.fetch = async () => ++calls === 1
		? new Response(JSON.stringify({ balance_infos: [{ currency: "USD", total_balance: "42.50" }] }))
		: new Response("nope", { status: 503 });
	const statuses: Array<string | undefined> = [];
	const context = {
		hasUI: true, model: { provider: "anthropic" },
		modelRegistry: { getProvider: () => ({ baseUrl: "https://api.deepseek.com" }), getProviderAuth: async () => ({ auth: { apiKey: "sk-test" } }) },
		ui: { setStatus(_key: string, value: string | undefined) { statuses.push(value); } },
	};
	const ask = (provider: string) => new Promise<string | undefined>((resolve) => {
		request?.({ provider, theme: { fg: (_color: string, text: string) => text }, reply: resolve });
	});
	try {
		handlers.get("session_start")?.({}, context);
		await new Promise<void>((resolve) => setImmediate(resolve));
		const footerUpdates = statuses.length;
		assert.equal(await ask("google"), undefined);
		assert.equal(await ask("deepseek"), "b:$42.50");
		assert.equal(await ask("deepseek"), "b:$42.50");
		assert.equal(calls, 1);
		assert.equal(statuses.length, footerUpdates);

		// A new session drops the cache, so the next request refetches and the failure has no stale value.
		handlers.get("session_start")?.({}, context);
		assert.equal(await ask("deepseek"), "quota:?");
		assert.equal(calls, 2);
	} finally {
		handlers.get("session_shutdown")?.({}, context);
		globalThis.fetch = originalFetch;
	}
});

test("rejects DeepSeek balance fetches to non-official endpoints", async () => {
	const originalFetch = globalThis.fetch;
	for (const baseUrl of ["https://api.deepseek.com.evil.tld/v1", "http://api.deepseek.com", "https://api.deepseek.com:8443/v1", "not a url"]) {
		const handlers = new Map<string, (event: any, context: any) => void>();
		providerUsage({ events: { on() { return () => {}; }, emit() {} }, on(event: string, handler: (event: any, context: any) => void) { handlers.set(event, handler); } } as unknown as ExtensionAPI);
		let fetched = false;
		globalThis.fetch = async () => { fetched = true; return new Response("{}"); };
		const statuses: Array<string | undefined> = [];
		const context = {
			hasUI: true, model: { provider: "deepseek" },
			modelRegistry: { getProvider: () => ({ baseUrl }), getProviderAuth: async () => ({ auth: { apiKey: "sk-test" } }) },
			ui: { setStatus(_key: string, value: string | undefined) { statuses.push(value); } },
		};
		try {
			handlers.get("session_start")?.({}, context);
			await new Promise<void>((resolve) => setImmediate(resolve));
			assert.equal(fetched, false, baseUrl);
			assert.equal(JSON.parse(statuses.at(-1)!).state, "unknown", baseUrl);
		} finally {
			handlers.get("session_shutdown")?.({}, context);
		}
	}
	globalThis.fetch = originalFetch;
});

test("does not fetch DeepSeek balance without an API key", async () => {
	const originalFetch = globalThis.fetch;
	for (const auth of [undefined, { auth: {} }]) {
		const handlers = new Map<string, (event: any, context: any) => void>();
		providerUsage({ events: { on() { return () => {}; }, emit() {} }, on(event: string, handler: (event: any, context: any) => void) { handlers.set(event, handler); } } as unknown as ExtensionAPI);
		let fetched = false;
		globalThis.fetch = async () => { fetched = true; return new Response("{}"); };
		const statuses: Array<string | undefined> = [];
		const context = {
			hasUI: true, model: { provider: "deepseek" },
			modelRegistry: { getProvider: () => ({ baseUrl: "https://api.deepseek.com" }), getProviderAuth: async () => auth },
			ui: { setStatus(_key: string, value: string | undefined) { statuses.push(value); } },
		};
		try {
			handlers.get("session_start")?.({}, context);
			await new Promise<void>((resolve) => setImmediate(resolve));
			assert.equal(fetched, false);
			assert.equal(JSON.parse(statuses.at(-1)!).state, "unknown");
		} finally {
			handlers.get("session_shutdown")?.({}, context);
		}
	}
	globalThis.fetch = originalFetch;
});

test("bounds DeepSeek auth resolution so a later refresh can still run", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const handlers = new Map<string, (event: any, context: any) => void>();
	providerUsage({ events: { on() { return () => {}; }, emit() {} }, on(event: string, handler: (event: any, context: any) => void) { handlers.set(event, handler); } } as unknown as ExtensionAPI);
	const originalFetch = globalThis.fetch;
	let fetchCalls = 0;
	let authCalls = 0;
	globalThis.fetch = async () => { fetchCalls++; return new Response(JSON.stringify({ balance_infos: [{ currency: "USD", total_balance: "5.00" }] })); };
	const context = {
		hasUI: true, model: { provider: "deepseek" },
		modelRegistry: {
			getProvider: () => ({ baseUrl: "https://api.deepseek.com" }),
			getProviderAuth: () => { authCalls++; return authCalls === 1 ? new Promise(() => {}) : Promise.resolve({ auth: { apiKey: "sk-test" } }); },
		},
		ui: { setStatus() {} },
	};
	try {
		handlers.get("session_start")?.({}, context);
		await new Promise<void>((resolve) => setImmediate(resolve));
		assert.equal(fetchCalls, 0);
		t.mock.timers.tick(10_000);
		await new Promise<void>((resolve) => setImmediate(resolve));
		handlers.get("turn_end")?.({}, context);
		await new Promise<void>((resolve) => setImmediate(resolve));
		assert.equal(fetchCalls, 1);
	} finally {
		handlers.get("session_shutdown")?.({}, context);
		globalThis.fetch = originalFetch;
		t.mock.timers.reset();
	}
});

test("preserves a cached DeepSeek balance when a refresh fails", async () => {
	const handlers = new Map<string, (event: any, context: any) => void>();
	providerUsage({ events: { on() { return () => {}; }, emit() {} }, on(event: string, handler: (event: any, context: any) => void) { handlers.set(event, handler); } } as unknown as ExtensionAPI);
	const originalFetch = globalThis.fetch;
	const originalNow = Date.now;
	let now = originalNow();
	let calls = 0;
	globalThis.fetch = async () => ++calls === 1
		? new Response(JSON.stringify({ balance_infos: [{ currency: "USD", total_balance: "42.50" }] }))
		: new Response("nope", { status: 503 });
	const statuses: Array<string | undefined> = [];
	const context = {
		hasUI: true, model: { provider: "deepseek" },
		modelRegistry: { getProvider: () => ({ baseUrl: "https://api.deepseek.com" }), getProviderAuth: async () => ({ auth: { apiKey: "sk-test" } }) },
		ui: { setStatus(_key: string, value: string | undefined) { statuses.push(value); } },
	};
	try {
		Date.now = () => now;
		handlers.get("session_start")?.({}, context);
		await new Promise<void>((resolve) => setImmediate(resolve));
		now += 10 * 60_000;
		handlers.get("turn_end")?.({}, context);
		await new Promise<void>((resolve) => setImmediate(resolve));
		assert.equal(calls, 2);
		const last = JSON.parse(statuses.at(-1)!);
		assert.equal(last.state, "ready");
		assert.equal(last.balance.amount, 42.5);
	} finally {
		handlers.get("session_shutdown")?.({}, context);
		Date.now = originalNow;
		globalThis.fetch = originalFetch;
	}
});

test("normalizes Anthropic unified rate-limit headers", () => {
	assert.deepEqual(normalizeAnthropicHeaders({
		"anthropic-ratelimit-unified-5h-utilization": "0.12",
		"anthropic-ratelimit-unified-5h-reset": "1700000000",
		"anthropic-ratelimit-unified-7d-utilization": "0.4",
	}, capturedAt), {
		provider: "anthropic", state: "ready", capturedAtMs: capturedAt,
		windows: [
			{ kind: "rolling", label: "5h", usedPercent: 12, resetAtMs: 1_700_000_000_000 },
			{ kind: "weekly", label: "7d", usedPercent: 40 },
		],
	});
	assert.equal(normalizeAnthropicHeaders({ "anthropic-ratelimit-unified-5h-utilization": "" }, capturedAt), undefined);
	assert.equal(normalizeAnthropicHeaders({ "content-type": "text/event-stream" }, capturedAt), undefined);
});

test("fetches Anthropic plan usage from the OAuth usage endpoint", async () => {
	const handlers = new Map<string, (event: any, context: any) => void>();
	providerUsage({ events: { on() { return () => {}; }, emit() {} }, on(event: string, handler: (event: any, context: any) => void) { handlers.set(event, handler); } } as unknown as ExtensionAPI);
	const originalFetch = globalThis.fetch;
	const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
	globalThis.fetch = async (target, init) => {
		requests.push({ url: String(target), init });
		return new Response(JSON.stringify({
			five_hour: { utilization: 13.0, resets_at: "2026-10-17T20:40:00.085011+00:00" },
			seven_day: { utilization: 19.0, resets_at: "2026-10-18T04:00:00.085037+00:00" },
			seven_day_opus: null,
		}));
	};
	let apiKey = "sk-ant-oat01-test";
	const statuses: Array<string | undefined> = [];
	const context = {
		hasUI: true, model: { provider: "anthropic" },
		modelRegistry: { getProvider: () => undefined, getProviderAuth: async () => ({ auth: { apiKey } }) },
		ui: { setStatus(_key: string, value: string | undefined) { statuses.push(value); } },
	};
	const start = async () => {
		handlers.get("session_start")?.({}, context);
		await new Promise<void>((resolve) => setImmediate(resolve));
		return JSON.parse(statuses.at(-1)!) as { state: string; windows: unknown[] };
	};
	try {
		const usage = await start();
		assert.equal(requests.length, 1);
		assert.equal(requests[0]!.url, "https://api.anthropic.com/api/oauth/usage");
		const headers = requests[0]!.init?.headers as Record<string, string>;
		assert.equal(headers.Authorization, "Bearer sk-ant-oat01-test");
		assert.equal(headers["anthropic-beta"], "oauth-2025-04-20");
		assert.deepEqual(usage.windows, [
			{ kind: "rolling", label: "5h", usedPercent: 13, resetAtMs: Date.parse("2026-10-17T20:40:00.085Z") },
			{ kind: "weekly", label: "7d", usedPercent: 19, resetAtMs: Date.parse("2026-10-18T04:00:00.085Z") },
		]);

		// API keys have no plan quota, so nothing is fetched.
		apiKey = "sk-ant-api03-test";
		const keyUsage = await start();
		assert.equal(requests.length, 1);
		assert.equal(keyUsage.state, "ready");
		assert.deepEqual(keyUsage.windows, []);
	} finally {
		handlers.get("session_shutdown")?.({}, context);
		globalThis.fetch = originalFetch;
	}
});

test("publishes Anthropic usage from response headers", async () => {
	const handlers = new Map<string, (event: any, context: any) => void>();
	providerUsage({ events: { on() { return () => {}; }, emit() {} }, on(event: string, handler: (event: any, context: any) => void) {
		handlers.set(event, handler);
	} } as unknown as ExtensionAPI);
	const statuses: Array<string | undefined> = [];
	let loads = 0;
	const context = {
		hasUI: true,
		model: { provider: "anthropic" },
		modelRegistry: { getProvider: () => { loads++; return undefined; }, getProviderAuth: async () => undefined },
		ui: { setStatus(_key: string, value: string | undefined) { statuses.push(value); } },
	};
	const last = () => JSON.parse(statuses.at(-1)!) as { state: string; windows: Array<{ usedPercent: number }> };
	try {
		handlers.get("session_start")?.({}, context);
		handlers.get("turn_end")?.({}, context);
		await new Promise<void>((resolve) => setImmediate(resolve));
		assert.equal(last().state, "unknown");

		// API-key replies carry no plan headers, so the footer shows no quota placeholder.
		handlers.get("after_provider_response")?.({ status: 200, headers: {} }, context);
		assert.equal(last().state, "ready");
		assert.deepEqual(last().windows, []);

		handlers.get("after_provider_response")?.({ status: 200, headers: { "anthropic-ratelimit-unified-5h-utilization": "0.25" } }, context);
		assert.equal(last().windows[0]?.usedPercent, 25);
		handlers.get("after_provider_response")?.({ status: 500, headers: {} }, context);
		assert.equal(last().windows[0]?.usedPercent, 25);

		// Header data counts as a fresh fetch, so the next turn does not hit the usage endpoint.
		const loadsBefore = loads;
		handlers.get("turn_end")?.({}, context);
		await new Promise<void>((resolve) => setImmediate(resolve));
		assert.equal(loads, loadsBefore);
		assert.equal(last().windows[0]?.usedPercent, 25);
	} finally {
		handlers.get("session_shutdown")?.({}, context);
	}
});

test("does not invent a Codex reset time", () => {
	const usage = normalizeCodexUsage({ rate_limit: { primary_window: { used_percent: 10 } } }, capturedAt);
	assert.equal(usage?.windows[0]?.resetAtMs, undefined);
});

test("parses nested OpenCode Go hydration data", () => {
	const html = `<script>self.__next_f.push([1,"{\\"props\\":{\\"rollingUsage\\":{\\"usagePercent\\":12.5,\\"resetInSec\\":30},\\"nested\\":{\\"weeklyUsage\\":{\\"usagePercent\\":40,\\"resetInSec\\":3600}},\\"monthlyUsage\\":{\\"usagePercent\\":101,\\"resetInSec\\":7200}}}"]);</script>`;
	const usage = normalizeOpencodeGoUsage(html, capturedAt);
	assert.deepEqual(usage?.windows, [
		{ kind: "rolling", label: "5h", usedPercent: 12.5, resetAtMs: capturedAt + 30_000 },
		{ kind: "weekly", label: "7d", usedPercent: 40, resetAtMs: capturedAt + 3_600_000 },
		{ kind: "monthly", label: "30d", usedPercent: 100, resetAtMs: capturedAt + 7_200_000 },
	]);
});

test("parses data-slot usage item HTML fallback", () => {
	const html = `<section data-slot="usage-item"><h2>Rolling Usage</h2><span>12.5%</span><p>resets in 30 minutes</p></section><div data-slot="usage-item"><b>Weekly Usage</b> 40% resets in 2 hours</div>`;
	assert.deepEqual(normalizeOpencodeGoUsage(html, capturedAt)?.windows, [
		{ kind: "rolling", label: "5h", usedPercent: 12.5, resetAtMs: capturedAt + 1_800_000 },
		{ kind: "weekly", label: "7d", usedPercent: 40, resetAtMs: capturedAt + 7_200_000 },
	]);
});

test("parses nested data-slot usage item HTML", () => {
	const html = `<div data-slot="usage-item"><div><strong>Monthly Usage</strong></div><div><span>55%</span><p>resets in 2 days 3 hours</p></div></div>`;
	assert.deepEqual(normalizeOpencodeGoUsage(html, capturedAt)?.windows, [
		{ kind: "monthly", label: "30d", usedPercent: 55, resetAtMs: capturedAt + 183_600_000 },
	]);
});

test("merges fallback windows only when hydration is partial", () => {
	const html = `<script>rollingUsage:{usagePercent:10,resetInSec:30}</script><section data-slot="usage-item"><b>Rolling Usage</b> 99% resets in 1 hour</section><div data-slot="usage-item"><b>Weekly Usage</b> 40% resets in 2 hours</div>`;
	assert.deepEqual(normalizeOpencodeGoUsage(html, capturedAt)?.windows, [
		{ kind: "rolling", label: "5h", usedPercent: 10, resetAtMs: capturedAt + 30_000 },
		{ kind: "weekly", label: "7d", usedPercent: 40, resetAtMs: capturedAt + 7_200_000 },
	]);
});

test("parses Solid Seroval hydration with references and unquoted keys", () => {
	const html = `<script>_$HY.r["lite.subscription.get"]=$R[1]={rollingUsage:$R[2]={status:"ok",resetInSec:30,usagePercent:12.5},weeklyUsage:$R[3]={status:"ok",resetInSec:3600,usagePercent:40},monthlyUsage:$R[4]={status:"rate-limited",resetInSec:7200,usagePercent:50}};</script>`;
	const usage = normalizeOpencodeGoUsage(html, capturedAt);
	assert.deepEqual(usage?.windows, [
		{ kind: "rolling", label: "5h", usedPercent: 12.5, resetAtMs: capturedAt + 30_000 },
		{ kind: "weekly", label: "7d", usedPercent: 40, resetAtMs: capturedAt + 3_600_000 },
		{ kind: "monthly", label: "30d", usedPercent: 50, resetAtMs: capturedAt + 7_200_000 },
	]);
});

test("validates OpenCode reset values", () => {
	assert.equal(normalizeOpencodeGoUsage(`rollingUsage:{usagePercent:10,resetInSec:-1}`, capturedAt), undefined);
	assert.equal(normalizeOpencodeGoUsage(`rollingUsage:{usagePercent:10,resetInSec:1e308}`, capturedAt), undefined);
	assert.equal(normalizeOpencodeGoUsage(`rollingUsage:{usagePercent:10,resetInSec:0}`, capturedAt)?.windows[0]?.resetAtMs, capturedAt);
	assert.equal(normalizeOpencodeGoUsage(`rollingUsage:{usagePercent:10,resetInSec:.5}`, capturedAt)?.windows[0]?.resetAtMs, capturedAt + 500);
});

test("bounds malformed hydration scanning", () => {
	const fragments = Array.from({ length: 300 }, () =>
		`rollingUsage:{${"x".repeat(16_000)}`,
	).join(";");
	const started = performance.now();
	assert.equal(normalizeOpencodeGoUsage(fragments, capturedAt), undefined);
	assert.ok(performance.now() - started < 500, "malformed hydration should be bounded");
});

test("rejects invalid OpenCode fields and omits unrelated secrets", () => {
	assert.equal(normalizeOpencodeGoUsage(`<div>rollingUsage: {"usagePercent":"secret","resetInSec":1}</div>`), undefined);
	const usage = normalizeOpencodeGoUsage(`<div>rollingUsage: {"usagePercent":10,"resetInSec":1,"authCookie":"secret"}</div>`);
	assert.equal(JSON.stringify(usage).includes("secret"), false);
});

test("limits response bodies while streaming", async () => {
	let headerCancelled = false;
	const oversizedHeader = new Response(new ReadableStream({
		start(controller) { controller.enqueue(new Uint8Array([1])); },
		cancel() { headerCancelled = true; },
	}), { headers: { "content-length": "100" } });
	await assert.rejects(readResponseTextLimited(oversizedHeader, 10, "Test"), /too large/);
	assert.equal(headerCancelled, true);

	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(new TextEncoder().encode("123"));
			controller.enqueue(new TextEncoder().encode("456"));
			controller.close();
		},
	});
	await assert.rejects(readResponseTextLimited(new Response(stream), 5, "Test"), /too large/);
});

test("does not expose OpenCode credentials through status or errors", async () => {
	const handlers = new Map<string, (event: any, context: any) => void>();
	providerUsage({ events: { on() { return () => {}; }, emit() {} }, on(event: string, handler: (event: any, context: any) => void) {
		handlers.set(event, handler);
	} } as unknown as ExtensionAPI);
	const originalFetch = globalThis.fetch;
	const originalWorkspace = process.env.OPENCODE_GO_WORKSPACE_ID;
	const originalCookie = process.env.OPENCODE_GO_AUTH_COOKIE;
	const secret = "cookie-that-must-not-leak";
	process.env.OPENCODE_GO_WORKSPACE_ID = "wrk_test";
	process.env.OPENCODE_GO_AUTH_COOKIE = secret;
	globalThis.fetch = async () => new Response("nope", { status: 503 });
	const statuses: Array<string | undefined> = [];
	const context = {
		hasUI: true, model: { provider: "opencode-go" },
		ui: { setStatus(_key: string, value: string | undefined) { statuses.push(value); } },
	};
	try {
		handlers.get("session_start")?.({ type: "session_start" }, context);
		await new Promise<void>((resolve) => setImmediate(resolve));
		assert.equal(statuses.some((status) => status?.includes(secret)), false);
	} finally {
		handlers.get("session_shutdown")?.({ type: "session_shutdown" }, context);
		globalThis.fetch = originalFetch;
		if (originalWorkspace === undefined) delete process.env.OPENCODE_GO_WORKSPACE_ID;
		else process.env.OPENCODE_GO_WORKSPACE_ID = originalWorkspace;
		if (originalCookie === undefined) delete process.env.OPENCODE_GO_AUTH_COOKIE;
		else process.env.OPENCODE_GO_AUTH_COOKIE = originalCookie;
	}
});

test("preserves cached usage when a refresh fails", async () => {
	const handlers = new Map<string, (event: any, context: any) => void>();
	providerUsage({ events: { on() { return () => {}; }, emit() {} }, on(event: string, handler: (event: any, context: any) => void) { handlers.set(event, handler); } } as unknown as ExtensionAPI);
	const originalFetch = globalThis.fetch;
	const originalWorkspace = process.env.OPENCODE_GO_WORKSPACE_ID;
	const originalCookie = process.env.OPENCODE_GO_AUTH_COOKIE;
	process.env.OPENCODE_GO_WORKSPACE_ID = "workspace";
	process.env.OPENCODE_GO_AUTH_COOKIE = "secret";
	let calls = 0;
	globalThis.fetch = async () => ++calls === 1
		? new Response(`rollingUsage:{usagePercent:10,resetInSec:30}`)
		: new Response("nope", { status: 503 });
	const statuses: Array<string | undefined> = [];
	const context = { hasUI: true, model: { provider: "opencode-go" }, ui: { setStatus(_key: string, value: string | undefined) { statuses.push(value); } } };
	const originalNow = Date.now;
	let now = originalNow();
	try {
		Date.now = () => now;
		handlers.get("session_start")?.({}, context);
		await new Promise<void>((resolve) => setImmediate(resolve));
		now += 10 * 60_000;
		handlers.get("turn_end")?.({}, context);
		await new Promise<void>((resolve) => setImmediate(resolve));
		assert.equal(calls, 2);
		assert.equal(JSON.parse(statuses.at(-1)!).state, "ready");
	} finally {
		handlers.get("session_shutdown")?.({}, context);
		Date.now = originalNow;
		globalThis.fetch = originalFetch;
		if (originalWorkspace === undefined) delete process.env.OPENCODE_GO_WORKSPACE_ID; else process.env.OPENCODE_GO_WORKSPACE_ID = originalWorkspace;
		if (originalCookie === undefined) delete process.env.OPENCODE_GO_AUTH_COOKIE; else process.env.OPENCODE_GO_AUTH_COOKIE = originalCookie;
	}
});

test("Codex requests use the fixed endpoint, redirect policy, and auth headers", async () => {
	const handlers = new Map<string, (event: any, context: any) => void>();
	providerUsage({ events: { on() { return () => {}; }, emit() {} }, on(event: string, handler: (event: any, context: any) => void) { handlers.set(event, handler); } } as unknown as ExtensionAPI);
	const originalFetch = globalThis.fetch;
	const account = "acct_test";
	const token = `x.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: account } })).toString("base64url")}.x`;
	let request: RequestInit | undefined;
	globalThis.fetch = async (url, init) => { assert.equal(url, "https://chatgpt.com/backend-api/wham/usage"); request = init; return new Response(JSON.stringify({ rate_limit: { primary_window: { used_percent: 10 } } })); };
	const context = { hasUI: true, model: { provider: "openai-codex" }, modelRegistry: { getProvider: () => ({ baseUrl: "https://chatgpt.com/backend-api" }), getProviderAuth: async () => ({ auth: { baseUrl: "https://chatgpt.com/backend-api", apiKey: token } }) }, ui: { setStatus() {} } };
	try {
		handlers.get("session_start")?.({}, context);
		await new Promise<void>((resolve) => setImmediate(resolve));
		assert.equal(request?.redirect, "error");
		assert.equal((request?.headers as Record<string, string>)["ChatGPT-Account-Id"], account);
		assert.equal((request?.headers as Record<string, string>).Authorization, `Bearer ${token}`);
	} finally {
		handlers.get("session_shutdown")?.({}, context);
		globalThis.fetch = originalFetch;
	}
});

test("same-provider selection aborts the old request", async () => {
	const handlers = new Map<string, (event: any, context: any) => void>();
	providerUsage({ events: { on() { return () => {}; }, emit() {} }, on(event: string, handler: (event: any, context: any) => void) { handlers.set(event, handler); } } as unknown as ExtensionAPI);
	const originalFetch = globalThis.fetch;
	let aborted = false;
	globalThis.fetch = (_url, init) => new Promise<Response>((_, reject) => {
		init?.signal?.addEventListener("abort", () => { aborted = true; reject(new Error("aborted")); }, { once: true });
	});
	const context = { hasUI: true, model: { provider: "opencode-go" }, ui: { setStatus() {} } };
	process.env.OPENCODE_GO_WORKSPACE_ID = "workspace"; process.env.OPENCODE_GO_AUTH_COOKIE = "secret";
	try {
		handlers.get("session_start")?.({}, context);
		handlers.get("model_select")?.({ model: context.model }, context);
		await new Promise<void>((resolve) => setImmediate(resolve));
		assert.equal(aborted, true);
	} finally {
		handlers.get("session_shutdown")?.({}, context);
		globalThis.fetch = originalFetch;
		delete process.env.OPENCODE_GO_WORKSPACE_ID; delete process.env.OPENCODE_GO_AUTH_COOKIE;
	}
});

test("ignores a stale OpenCode response after switching providers", async () => {
	const handlers = new Map<string, (event: any, context: any) => void>();
	providerUsage({
		events: { on() { return () => {}; }, emit() {} },
		on(event: string, handler: (event: any, context: any) => void) {
			handlers.set(event, handler);
		},
	} as unknown as ExtensionAPI);

	let resolveFetch: ((response: Response) => void) | undefined;
	const originalFetch = globalThis.fetch;
	const originalWorkspace = process.env.OPENCODE_GO_WORKSPACE_ID;
	const originalCookie = process.env.OPENCODE_GO_AUTH_COOKIE;
	process.env.OPENCODE_GO_WORKSPACE_ID = "wrk_test";
	process.env.OPENCODE_GO_AUTH_COOKIE = "secret";
	globalThis.fetch = () => new Promise<Response>((resolve) => { resolveFetch = resolve; });

	const statuses: Array<string | undefined> = [];
	const context = {
		hasUI: true,
		model: { provider: "opencode-go" },
		ui: { setStatus(_key: string, value: string | undefined) { statuses.push(value); } },
	};
	try {
		handlers.get("session_start")?.({ type: "session_start" }, context);
		context.model = { provider: "google" };
		handlers.get("model_select")?.({ model: context.model }, context);
		resolveFetch?.(new Response(`rollingUsage:{usagePercent:10,resetInSec:30}`));
		await new Promise<void>((resolve) => setImmediate(resolve));
		assert.equal(statuses.at(-1), undefined);
	} finally {
		handlers.get("session_shutdown")?.({ type: "session_shutdown" }, context);
		globalThis.fetch = originalFetch;
		if (originalWorkspace === undefined) delete process.env.OPENCODE_GO_WORKSPACE_ID;
		else process.env.OPENCODE_GO_WORKSPACE_ID = originalWorkspace;
		if (originalCookie === undefined) delete process.env.OPENCODE_GO_AUTH_COOKIE;
		else process.env.OPENCODE_GO_AUTH_COOKIE = originalCookie;
	}
});

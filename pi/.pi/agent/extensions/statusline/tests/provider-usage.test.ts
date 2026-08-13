import assert from "node:assert/strict";
import { test } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import providerUsage, {
	normalizeCodexUsage,
	normalizeOpencodeGoUsage,
	readResponseTextLimited,
} from "../index.ts";

const capturedAt = 1_700_000_000_000;

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
	providerUsage({ on(event: string, handler: (event: any, context: any) => void) {
		handlers.set(event, handler);
	} } as ExtensionAPI);
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
	providerUsage({ on(event: string, handler: (event: any, context: any) => void) { handlers.set(event, handler); } } as ExtensionAPI);
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
	try {
		Date.now = () => originalNow() + (calls > 1 ? 10 * 60_000 : 0);
		handlers.get("session_start")?.({}, context);
		await new Promise<void>((resolve) => setImmediate(resolve));
		handlers.get("turn_end")?.({}, context);
		await new Promise<void>((resolve) => setImmediate(resolve));
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
	providerUsage({ on(event: string, handler: (event: any, context: any) => void) { handlers.set(event, handler); } } as ExtensionAPI);
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
	providerUsage({ on(event: string, handler: (event: any, context: any) => void) { handlers.set(event, handler); } } as ExtensionAPI);
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
		on(event: string, handler: (event: any, context: any) => void) {
			handlers.set(event, handler);
		},
	} as ExtensionAPI);

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
		context.model = { provider: "anthropic" };
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

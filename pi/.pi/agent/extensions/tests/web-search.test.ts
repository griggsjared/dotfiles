import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import type { ExtensionAPI, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { Check } from "typebox/value";
import webSearch from "../web-search.ts";
const secret = "offline-test-api-key";
const result = { title: "Example & title", url: "https://example.test/page", snippet: "Useful snippet" };
const ddg = `<a class="result-link" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.test%2Fpage&amp;rut=ignored">Example &amp; title</a><td class="result-snippet">Useful snippet</td>`;
const tavily = JSON.stringify({ results: [{ title: ` ${result.title} `, url: ` ${result.url} `, content: ` ${result.snippet} `, score: 1, private: secret }, null, { title: "missing url" }] });
let queryNumber = 0;

function tools() {
	const registered = new Map<string, Parameters<ExtensionAPI["registerTool"]>[0]>();
	webSearch({ registerTool: (definition) => { registered.set(definition.name, definition as Parameters<ExtensionAPI["registerTool"]>[0]); } } as ExtensionAPI);
	return registered;
}
const registered = tools();
const ctx = {} as ExtensionToolContext;

function boundaries(t: TestContext, backend = "", key = "") {
	const original = process.env;
	process.env = { PI_WEB_SEARCH_BACKEND: backend, TAVILY_API_KEY: key };
	t.after(() => { process.env = original; });
	return t.mock.method(globalThis, "fetch", async () => assert.fail("unexpected network request"));
}

function execute(name: string, params: Record<string, string | undefined>, signal?: AbortSignal) {
	return registered.get(name)!.execute("test", params, signal, undefined, ctx);
}

function search(query = `offline query ${++queryNumber}`, signal?: AbortSignal) {
	return execute("web_search", { query }, signal);
}

function valid(name: string, response: Awaited<ReturnType<typeof execute>>) {
	const schema = registered.get(name)!.outputSchema;
	assert.ok(schema, "output schema is declared");
	assert.ok(Check(schema, response.structuredContent), "structured result matches declared schema");
	assert.deepEqual(JSON.parse(JSON.stringify(response.structuredContent)), response.structuredContent);
	assert.equal(response.isError, undefined);
	assert.equal(response.content.length, 1);
	assert.equal(response.content[0].type, "text");
	return response.content[0].type === "text" ? response.content[0].text : "";
}

function page(response: Awaited<ReturnType<typeof execute>>) {
	valid("web_fetch", response);
	const payload = response.structuredContent as { backend: string; url: string; title: string; description: string; text: string; charCount: number; truncated: boolean };
	const { text, ...details } = payload;
	assert.deepEqual(response.details, details);
	assert.equal(valid("web_fetch", response), `${payload.title ? `Title: ${payload.title}\n` : ""}URL: ${payload.url}\n${payload.description ? `Description: ${payload.description}\n` : ""}\n${text}`);
	return payload;
}

for (const backend of ["duckduckgo-lite", "tavily"]) {
	test(`${backend} success preserves text/details and exposes only public fields`, async (t) => {
		const fetch = boundaries(t, backend === "tavily" ? " TaViLy " : "", secret);
		fetch.mock.mockImplementation(async (input, init) => {
			if (backend === "tavily") {
				assert.equal(input, "https://api.tavily.com/search");
				assert.equal(init?.method, "POST");
				assert.equal(new Headers(init?.headers).get("Authorization"), `Bearer ${secret}`);
				assert.deepEqual(JSON.parse(String(init?.body)), { query: `${backend} success`, search_depth: "basic", max_results: 10 });
				return new Response(tavily);
			}
			assert.equal(String(input), `https://lite.duckduckgo.com/lite/?q=${backend}+success`);
			return new Response(ddg);
		});
		const response = await search(` ${backend} success `);
		assert.equal(valid("web_search", response), `1 results for "${backend} success":\n1. ${result.title}\n   ${result.url}\n   ${result.snippet}`);
		assert.deepEqual(response.details, { backend, query: `${backend} success`, results: [result] });
		assert.deepEqual(response.structuredContent, response.details);
		assert.ok(!JSON.stringify(response).includes(secret));
		const cached = await search(`${backend} success`);
		valid("web_search", cached);
		assert.deepEqual(cached, response);
		assert.equal(fetch.mock.callCount(), 1);
	});

	test(`${backend} empty results are schema-valid and do not trigger fallback`, async (t) => {
		const fetch = boundaries(t, backend === "tavily" ? "tavily" : "", secret);
		fetch.mock.mockImplementation(async () => new Response(backend === "tavily" ? '{"results":[]}' : "<html>No matches</html>"));
		const query = `${backend} empty`;
		const response = await search(query);
		assert.equal(valid("web_search", response), `No results found for "${query}".`);
		assert.deepEqual(response.structuredContent, { backend, query, results: [] });
		assert.deepEqual(response.details, response.structuredContent);
		assert.equal(fetch.mock.callCount(), 1);
	});
}

test("DDG failure falls back to Tavily without exposing the first failure", async (t) => {
	const fetch = boundaries(t, "unknown", secret);
	fetch.mock.mockImplementation(async (input) => String(input).includes("duckduckgo") ? new Response("captcha", { status: 400 }) : new Response(tavily));
	const response = await search();
	valid("web_search", response);
	assert.deepEqual((response.structuredContent as { results: unknown }).results, [result]);
	assert.equal((response.details as { backend: string }).backend, "tavily");
	assert.equal(fetch.mock.callCount(), 2);
});

test("DDG retries a blocked request before succeeding", async (t) => {
	const fetch = boundaries(t);
	let calls = 0;
	fetch.mock.mockImplementation(async () => ++calls === 1 ? new Response("captcha", { status: 429 }) : new Response(ddg));
	valid("web_search", await search());
	assert.equal(fetch.mock.callCount(), 2);
});

test("DDG failure without a key still throws its original error", async (t) => {
	const fetch = boundaries(t);
	fetch.mock.mockImplementation(async () => new Response(secret, { status: 500 }));
	await assert.rejects(search(), { message: "DuckDuckGo request failed with HTTP 500." });
	assert.equal(fetch.mock.callCount(), 1);
});

test("both backends failing retains the combined error without response secrets", async (t) => {
	const fetch = boundaries(t, "", secret);
	fetch.mock.mockImplementation(async (input) => new Response(secret, { status: String(input).includes("duckduckgo") ? 500 : 401 }));
	await assert.rejects(search(), { message: "Search failed. DuckDuckGo: DuckDuckGo request failed with HTTP 500. Tavily: Tavily rejected the API key. Check TAVILY_API_KEY." });
	assert.equal(fetch.mock.callCount(), 2);
});

for (const [body, status, message] of [
	[secret, 401, "Tavily rejected the API key. Check TAVILY_API_KEY."],
	[secret, 429, "Tavily rate limit or credit limit reached."],
	[secret, 500, "Tavily request failed with HTTP 500."],
	["invalid JSON", 200, "Tavily returned invalid JSON."],
	['{"results":null}', 200, "Tavily returned an unreadable response."],
] as const) {
	test(`forced Tavily failure: ${message}`, async (t) => {
		const fetch = boundaries(t, "tavily", secret);
		fetch.mock.mockImplementation(async () => new Response(body, { status }));
		await assert.rejects(search(), { message });
		assert.equal(fetch.mock.callCount(), 1);
	});
}

test("missing Tavily key, blank query, and cancelled search never use network", async (t) => {
	const fetch = boundaries(t, "tavily");
	await assert.rejects(search(), /TAVILY_API_KEY is not set/);
	await assert.rejects(search("  "), /Query must not be empty/);
	process.env.PI_WEB_SEARCH_BACKEND = "";
	await assert.rejects(search(undefined, AbortSignal.abort()), /Search cancelled/);
	assert.equal(fetch.mock.callCount(), 0);
});

for (const [contentType, body] of [
	["text/plain", " plain text "],
	["text/markdown", "# Heading\n\nMarkdown text"],
	["application/json", '{"ok":true,"value":42}'],
	["application/xml", "<document>XML text</document>"],
	["application/octet-stream", "text without a textual media type"],
	["image/svg+xml", '<svg><text>Textual SVG</text></svg>'],
] as const) {
	test(`web_fetch preserves ${contentType} directly`, async (t) => {
		const fetch = boundaries(t);
		fetch.mock.mockImplementation(async (input, init) => {
			assert.equal(input, "https://example.test/text");
			assert.equal(init?.redirect, "follow");
			return new Response(body, { headers: { "content-type": contentType } });
		});
		assert.deepEqual(page(await execute("web_fetch", { url: " https://example.test/text " })), {
			backend: "http", url: "https://example.test/text", title: "", description: "", text: body.trim(), charCount: body.trim().length, truncated: false,
		});
	});
}

for (const contentType of ["text/html", "application/xhtml+xml", "text/plain"]) {
	test(`web_fetch HTML extraction with ${contentType} preserves metadata and final URL`, async (t) => {
		const fetch = boundaries(t);
		const text = "A readable article with enough content to avoid the weak-content check.\nAnother paragraph & more.";
		fetch.mock.mockImplementation(async () => {
			const response = new Response('<html><head><title>Title &amp; more</title><meta name="description" content="A &amp; B"></head><body><nav>ignored</nav><article><p>A readable article with enough content to avoid the weak-content check.</p><p>Another paragraph &amp; more.</p><script>ignored</script></article></body></html>', { headers: { "content-type": contentType } });
			Object.defineProperty(response, "url", { value: "https://example.test/final" });
			return response;
		});
		assert.deepEqual(page(await execute("web_fetch", { url: "https://example.test/start" })), {
			backend: "http", url: "https://example.test/final", title: "Title & more", description: "A & B", text, charCount: text.length, truncated: false,
		});
	});
}

for (const html of [false, true]) {
	for (const count of [4000, 4001]) {
		test(`web_fetch ${html ? "HTML" : "text"} truncation boundary ${count}`, async (t) => {
			const fetch = boundaries(t);
			const text = "x".repeat(count);
			fetch.mock.mockImplementation(async () => new Response(html ? `<html><article>${text}</article></html>` : text, { headers: { "content-type": html ? "text/html" : "text/plain" } }));
			const payload = page(await execute("web_fetch", { url: "https://example.test/long" }));
			assert.equal(payload.charCount, count);
			assert.equal(payload.truncated, count > 4000);
			assert.equal(payload.text, count > 4000 ? `${text.slice(0, 4000)}\n…[truncated at ${count} characters]` : text);
		});
	}
}

test("web_fetch honors charset decoding", async (t) => {
	const fetch = boundaries(t);
	fetch.mock.mockImplementation(async () => new Response(new Uint8Array([0xff, 0xfe, 0x68, 0, 0x69, 0]), { headers: { "content-type": "text/plain" } }));
	assert.equal(page(await execute("web_fetch", { url: "https://example.test/utf16" })).text, "hi");
});

for (const [body, status, contentType, message] of [
	[secret, 403, "text/plain", "Fetch blocked or rate-limited (HTTP 403). Try the page later or rely on web_search snippets."],
	[secret, 429, "text/plain", "Fetch blocked or rate-limited (HTTP 429). Try the page later or rely on web_search snippets."],
	[secret, 500, "text/plain", "Fetch failed with HTTP 500."],
	["binary", 200, "application/pdf", 'Unsupported binary content type "application/pdf".'],
	["a\0b", 200, "application/octet-stream", 'Unsupported content type "application/octet-stream" — the response appears to be binary.'],
	["   ", 200, "text/plain", "The response contains no readable text."],
	["<html><body>short</body></html>", 200, "text/html", "Page content is not readable (requires JavaScript or is empty). Rely on web_search snippets instead."],
	["text", 200, "text/plain; charset=invalid-charset", 'Unsupported content type "text/plain" — the response is not decodable text.'],
] as const) {
	test(`web_fetch still throws: ${message}`, async (t) => {
		const fetch = boundaries(t);
		fetch.mock.mockImplementation(async () => new Response(body, { status, headers: { "content-type": contentType } }));
		await assert.rejects(execute("web_fetch", { url: "https://example.test/error" }), { message });
	});
}

test("web_fetch invalid arguments reject without network", async (t) => {
	const fetch = boundaries(t);
	await assert.rejects(execute("web_fetch", { url: " " }), /URL must not be empty/);
	await assert.rejects(execute("web_fetch", { url: "not-a-url" }), /Invalid URL: not-a-url/);
	await assert.rejects(execute("web_fetch", { url: "file:///tmp/example" }), /Unsupported protocol file:/);
	assert.equal(fetch.mock.callCount(), 0);
});

for (const name of ["web_search", "web_fetch"]) {
	test(`${name} network timeout and cancellation preserve thrown failures`, async (t) => {
		const fetch = boundaries(t, "tavily", secret);
		fetch.mock.mockImplementation(async () => { throw new DOMException("offline timeout", "TimeoutError"); });
		const params = name === "web_search" ? { query: "offline timeout" } : { url: "https://example.test/timeout" };
		await assert.rejects(execute(name, params), name === "web_search" ? /Tavily request timed out after 15 seconds/ : /Fetch timed out after 15 seconds/);
		await assert.rejects(execute(name, params, AbortSignal.abort()), name === "web_search" ? /Search cancelled/ : /Fetch cancelled/);
		fetch.mock.mockImplementation(async () => { throw new Error("offline transport failure"); });
		await assert.rejects(execute(name, params), name === "web_search" ? /Tavily request failed: offline transport failure/ : /Fetch failed: offline transport failure/);
	});
}

test("output schemas reject missing fields and invalid backend/type values", () => {
	const searchSchema = registered.get("web_search")!.outputSchema!;
	const fetchSchema = registered.get("web_fetch")!.outputSchema!;
	assert.equal(Check(searchSchema, { backend: "unknown", query: "query", results: [] }), false);
	assert.equal(Check(searchSchema, { backend: "tavily", query: "query", results: [{ title: "t", url: "u" }] }), false);
	assert.equal(Check(fetchSchema, { backend: "http", url: "u", title: "", description: "", charCount: 0, truncated: false }), false);
	assert.equal(Check(fetchSchema, { backend: "http", url: "u", title: "", description: "", text: "x", charCount: -1, truncated: "false" }), false);
});

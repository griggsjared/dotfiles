import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const USER_AGENT =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const CACHE_TTL_MS = 30_000;

type SearchResult = { title: string; url: string; snippet: string };
type FetchedPage = {
	url: string;
	title: string;
	description: string;
	text: string;
	charCount: number;
	truncated: boolean;
};

const NAMED_ENTITIES: Record<string, string> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
	nbsp: " ",
	rsquo: "\u2019",
	lsquo: "\u2018",
	rdquo: "\u201D",
	ldquo: "\u201C",
	ndash: "\u2013",
	mdash: "\u2014",
	hellip: "\u2026",
	bull: "\u2022",
	middot: "\u00B7",
	deg: "\u00B0",
	copy: "\u00A9",
	times: "\u00D7",
};

// Single-pass decoder: a '&' produced by decoding '&amp;' is never re-scanned,
// matching cheerio semantics (no double-decode).
export function decodeEntities(text: string): string {
	return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
		if (entity.startsWith("#x") || entity.startsWith("#X")) {
			const value = parseInt(entity.slice(2), 16);
			return Number.isNaN(value) ? match : String.fromCodePoint(value);
		}
		if (entity.startsWith("#")) {
			const value = parseInt(entity.slice(1), 10);
			return Number.isNaN(value) ? match : String.fromCodePoint(value);
		}
		return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
	});
}

function stripTags(text: string): string {
	return text.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

// DuckDuckGo lite wraps real URLs in //duckduckgo.com/l/?uddg=<encoded>&rut=... redirects.
// The href is entity-decoded first so the uddg value is bounded at a real '&', then
// percent-decoded exactly once (no URLSearchParams implicit decode).
export function extractTargetUrl(rawHref: string): string {
	const href = decodeEntities(rawHref);
	const url = href.startsWith("//") ? `https:${href}` : href;
	try {
		const parsed = new URL(url);
		if (parsed.hostname !== "duckduckgo.com" || parsed.pathname !== "/l/") return url;
		const uddgMatch = parsed.search.match(/[?&]uddg=([^&]+)/);
		if (!uddgMatch) return url;
		try {
			return decodeURIComponent(uddgMatch[1] ?? "");
		} catch {
			return url;
		}
	} catch {
		return url;
	}
}

export function parseDuckDuckGoLite(html: string): SearchResult[] {
	const results: SearchResult[] = [];
	const anchorRe = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
	let match: RegExpExecArray | null;
	while ((match = anchorRe.exec(html)) !== null) {
		const tag = match[1] ?? "";
		if (!/class=['"]result-link['"]/.test(tag)) continue;
		const href = tag.match(/href=['"]([^'"]+)['"]/);
		if (!href) continue;
		const title = decodeEntities(stripTags(match[2] ?? ""));
		const url = extractTargetUrl(href[1] ?? "");
		const rest = html.slice(match.index + match[0].length);
		const snippetMatch = rest.match(/<td[^>]*class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/i);
		const snippet = snippetMatch ? decodeEntities(stripTags(snippetMatch[1] ?? "")) : "";
		if (title && url) results.push({ title, url, snippet });
	}
	return results;
}

export function looksLikeErrorPage(body: string): boolean {
	const text = body.toLowerCase();
	return (
		text.includes("if this persists") ||
		text.includes("error-lite") ||
		text.includes("captcha") ||
		text.includes("unusual traffic") ||
		text.includes("are you a robot") ||
		text.includes("verify you are human")
	);
}

export function classifySearchFailure(status: number, body: string): string {
	const text = body.toLowerCase();
	const blocked =
		status === 403 ||
		status === 429 ||
		text.includes("if this persists") ||
		text.includes("error-lite") ||
		text.includes("captcha") ||
		text.includes("unusual traffic") ||
		text.includes("are you a robot") ||
		text.includes("verify you are human");
	if (blocked) {
		return "DuckDuckGo blocked or rate-limited the request. Try again shortly or rephrase the query.";
	}
	if (status >= 400) return `DuckDuckGo request failed with HTTP ${status}.`;
	return "DuckDuckGo returned an unreadable response.";
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function searchDuckDuckGo(query: string, signal?: AbortSignal): Promise<SearchResult[]> {
	const endpoint = `https://lite.duckduckgo.com/lite/?${new URLSearchParams({ q: query }).toString()}`;
	for (let attempt = 0; attempt < 2; attempt++) {
		if (signal?.aborted) throw new Error("Search cancelled.");
		let response: Response;
		try {
			response = await fetch(endpoint, {
				headers: { "User-Agent": USER_AGENT },
				signal,
			});
		} catch (error) {
			if (signal?.aborted) throw new Error("Search cancelled.");
			if (attempt === 0) {
				await wait(1500);
				continue;
			}
			throw new Error(`DuckDuckGo request failed: ${error instanceof Error ? error.message : String(error)}`);
		}
		const body = await response.text();
		if (!response.ok || looksLikeErrorPage(body)) {
			const retriable = response.status === 403 || response.status === 429 || response.status === 503;
			if (retriable && attempt === 0) {
				await wait(1500);
				continue;
			}
			throw new Error(classifySearchFailure(response.status, body));
		}
		return parseDuckDuckGoLite(body);
	}
	throw new Error("DuckDuckGo request failed after retries.");
}

const cache = new Map<string, { expires: number; results: SearchResult[] }>();

function getCached(query: string): SearchResult[] | undefined {
	const entry = cache.get(query);
	if (!entry) return undefined;
	if (entry.expires < Date.now()) {
		cache.delete(query);
		return undefined;
	}
	return entry.results;
}

function setCached(query: string, results: SearchResult[]): void {
	cache.set(query, { expires: Date.now() + CACHE_TTL_MS, results });
}

function formatResults(query: string, results: SearchResult[]): string {
	if (results.length === 0) return `No results found for "${query}".`;
	const lines = [`${results.length} results for "${query}":`];
	for (let index = 0; index < results.length; index++) {
		const result = results[index]!;
		lines.push(`${index + 1}. ${result.title}`);
		lines.push(`   ${result.url}`);
		if (result.snippet) lines.push(`   ${result.snippet}`);
	}
	return lines.join("\n");
}

const BLOCK_END_TAGS =
	/<\/(p|h1|h2|h3|h4|h5|h6|li|tr|td|th|dt|dd|blockquote|pre|ul|ol|dl|nav|header|footer|section|aside)>/gi;
const MAX_TEXT_CHARS = 4000;

// Longest <tag>...</tag> region wins: pages nest <article> inside <main>, and
// both may appear multiple times (widgets, comments) — the biggest is the content.
function longestRegion(html: string, tag: string): string | undefined {
	const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi");
	let best: string | undefined;
	let match: RegExpExecArray | null;
	while ((match = re.exec(html)) !== null) {
		const content = match[1] ?? "";
		if (!best || content.length > best.length) best = content;
	}
	return best;
}

export function extractRegion(stripped: string): string {
	const article = longestRegion(stripped, "article");
	if (article) return article;
	const main = longestRegion(stripped, "main");
	if (main) return main;
	const body = stripped.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
	return body ? (body[1] ?? "") : stripped;
}

// Drop a leading run of nav/boilerplate lines (language lists, TOC entries, nav
// items — all under ~45 chars, unlike real sentences) only when there are 5+ of
// them and the remaining text is non-trivial, so short intros are never eaten.
export function stripBoilerplatePrefix(text: string): string {
	const lines = text.split("\n");
	let skip = 0;
	while (skip < lines.length && (lines[skip] ?? "").length < 45) skip++;
	if (skip < 5) return text;
	const remaining = lines.slice(skip).join("\n").trim();
	return remaining.length < 40 ? text : remaining;
}

// Zero-dependency readability extraction: prefers <article>/<main>, falls back
// to <body>, strips scripts/styles/svg/comments, and keeps paragraph breaks.
export function extractReadableContent(html: string): {
	title: string;
	description: string;
	text: string;
	charCount: number;
	truncated: boolean;
} {
	const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
	const title = titleMatch ? decodeEntities(stripTags(titleMatch[1] ?? "")) : "";
	let description = "";
	const metaRe = /<meta\b[^>]*>/gi;
	for (const meta of html.matchAll(metaRe)) {
		if (!/name=["']description["']/i.test(meta[0]!)) continue;
		const content = meta[0]!.match(/content=["']([^"']*)["']/i);
		if (content) description = decodeEntities(content[1] ?? "");
		break;
	}
	const stripped = html
		.replace(/<script[\s\S]*?<\/script>/gi, " ")
		.replace(/<style[\s\S]*?<\/style>/gi, " ")
		.replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
		.replace(/<template[\s\S]*?<\/template>/gi, " ")
		.replace(/<svg[\s\S]*?<\/svg>/gi, " ")
		.replace(/<!--[\s\S]*?-->/g, " ");
	const region = extractRegion(stripped);
	const text = decodeEntities(
		region
			.replace(BLOCK_END_TAGS, "\n")
			.replace(/<br\s*\/?>/gi, "\n")
			.replace(/<[^>]*>/g, "")
			.replace(/[^\S\n]+/g, " ")
			.replace(/ *\n */g, "\n")
			.replace(/\n{2,}/g, "\n")
			.trim(),
	);
	const cleaned = stripBoilerplatePrefix(text);
	const charCount = cleaned.length;
	let truncated = false;
	let finalText = cleaned;
	if (cleaned.length > MAX_TEXT_CHARS) {
		truncated = true;
		finalText = cleaned.slice(0, MAX_TEXT_CHARS);
		const lastSpace = finalText.lastIndexOf(" ");
		if (lastSpace > MAX_TEXT_CHARS * 0.75) finalText = finalText.slice(0, lastSpace);
		finalText = `${finalText.trimEnd()}\n…[truncated at ${charCount} characters]`;
	}
	return { title, description, text: finalText, charCount, truncated };
}

export function isWeakContent(html: string, text: string): boolean {
	if (text.length < 40) return true;
	const lower = html.toLowerCase();
	const jsShell =
		lower.includes("<script") && /id=["'](root|app|__next|__nuxt)["']/.test(lower);
	return (
		(jsShell && text.length < 200) ||
		/enable javascript|javascript required|please turn on javascript/i.test(html)
	);
}

async function fetchPage(url: string, signal?: AbortSignal): Promise<FetchedPage> {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		throw new Error(`Invalid URL: ${url}`);
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		throw new Error(`Unsupported protocol ${parsed.protocol} — only http and https can be fetched.`);
	}
	const timeoutSignal = AbortSignal.timeout(15000);
	const combined = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
	let response: Response;
	try {
		response = await fetch(url, {
			headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml" },
			redirect: "follow",
			signal: combined,
		});
	} catch (error) {
		if (signal?.aborted) throw new Error("Fetch cancelled.");
		const err = error as Error;
		if (err.name === "TimeoutError") throw new Error(`Fetch timed out after 15 seconds: ${url}`);
		throw new Error(`Fetch failed: ${err.message}`);
	}
	if (!response.ok) {
		const blocked = response.status === 403 || response.status === 429;
		throw new Error(
			blocked
				? `Fetch blocked or rate-limited (HTTP ${response.status}). Try the page later or rely on web_search snippets.`
				: `Fetch failed with HTTP ${response.status}.`,
		);
	}
	const contentType = response.headers?.get?.("content-type") ?? "";
	if (!contentType.includes("text/html")) {
		throw new Error(
			`Unsupported content type "${contentType.split(";")[0] ?? contentType}" — only HTML pages are readable. Use web_search snippets instead.`,
		);
	}
	const html = await response.text();
	const extracted = extractReadableContent(html);
	if (isWeakContent(html, extracted.text)) {
		throw new Error("Page content is not readable (requires JavaScript or is empty). Rely on web_search snippets instead.");
	}
	return { url: response.url || url, ...extracted };
}

function formatPage(url: string, page: FetchedPage): string {
	const lines: string[] = [];
	if (page.title) lines.push(`Title: ${page.title}`);
	lines.push(`URL: ${page.url}`);
	if (page.description) lines.push(`Description: ${page.description}`);
	lines.push("");
	lines.push(page.text || "(no readable text)");
	return lines.join("\n");
}

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "web_search",
		label: "Web Search",
		description:
			"Search the web via DuckDuckGo (no API key) and return ranked results with titles, URLs, and snippets. Use for current, external, or factual information not in the conversation or codebase.",
		promptSnippet: "Search the web for current or external information",
		promptGuidelines: [
			"Use web_search for questions needing current, external, or factual information that is not in the conversation or codebase.",
			"Use web_fetch to read the full content of a specific page (found via web_search or given by the user).",
			"Prefer web_search and web_fetch over shell/network commands (curl, Invoke-WebRequest, npm view/search/pack, direct HTTP URLs) for web research.",
		],
		parameters: Type.Object({
			query: Type.String({ description: "Search query." }),
		}),
		async execute(_toolCallId, params, signal) {
			const query = params.query.trim();
			if (!query) throw new Error("Query must not be empty.");
			const cached = getCached(query);
			const results = cached ?? (await searchDuckDuckGo(query, signal));
			if (!cached) setCached(query, results);
			return {
				content: [{ type: "text", text: formatResults(query, results) }],
				details: { backend: "duckduckgo-lite", query, results },
			};
		},
	});
	pi.registerTool({
		name: "web_fetch",
		label: "Web Fetch",
		description:
			"Fetch a URL and return its readable text content (title, description, and body text, truncated at 4000 characters). Use to read a specific page found via web_search or given by the user. Only HTML pages are readable; JavaScript-rendered, PDF, and other non-HTML content fails with a clear error.",
		promptSnippet: "Read the text content of a web page",
		promptGuidelines: [
			"Use web_fetch to read a specific page when its full content matters; combine with web_search to discover pages first.",
		],
		parameters: Type.Object({
			url: Type.String({ description: "URL of the page to fetch and read." }),
		}),
		async execute(_toolCallId, params, signal) {
			const url = params.url.trim();
			if (!url) throw new Error("URL must not be empty.");
			const page = await fetchPage(url, signal);
			return {
				content: [{ type: "text", text: formatPage(url, page) }],
				details: {
					backend: "http",
					url: page.url,
					title: page.title,
					description: page.description,
					charCount: page.charCount,
					truncated: page.truncated,
				},
			};
		},
	});
}

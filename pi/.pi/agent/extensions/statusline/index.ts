import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { ANTHROPIC_PROVIDER, normalizeAnthropicHeaders } from "./providers/anthropic.ts";
import { CLAUDE_CACHE_TTL_MS, CLAUDE_PROVIDER, fetchClaudeUsage } from "./providers/claude.ts";
import { CODEX_CACHE_TTL_MS, CODEX_PROVIDER, fetchCodexUsage } from "./providers/codex.ts";
import { DEEPSEEK_CACHE_TTL_MS, DEEPSEEK_PROVIDER, fetchDeepseekUsage } from "./providers/deepseek.ts";
import { formatFooterBalance, formatFooterUsage, registerStatusline } from "./footer.ts";
import { REQUEST_TIMEOUT_MS } from "./http.ts";
import { OPENCODE_CACHE_TTL_MS, OPENCODE_PROVIDER, fetchOpencodeUsage } from "./providers/opencode.ts";
import {
	encodeUsageStatus,
	isUsageProvider,
	USAGE_STATUS_KEY,
	type UsageProvider,
	type UsageStatus,
} from "./usage-status.ts";

const REFRESH_INTERVAL_MS = 60_000;

type UsageAdapter = {
	cacheTtlMs: number;
	load(ctx: ExtensionContext, signal: AbortSignal): Promise<UsageStatus>;
};

// Anthropic has no adapter: its usage arrives on response headers instead.
const USAGE_ADAPTERS: Partial<Record<UsageProvider, UsageAdapter>> = {
	[CLAUDE_PROVIDER]: { cacheTtlMs: CLAUDE_CACHE_TTL_MS, load: fetchClaudeUsage },
	[CODEX_PROVIDER]: { cacheTtlMs: CODEX_CACHE_TTL_MS, load: fetchCodexUsage },
	[OPENCODE_PROVIDER]: { cacheTtlMs: OPENCODE_CACHE_TTL_MS, load: (_ctx, signal) => fetchOpencodeUsage(signal) },
	[DEEPSEEK_PROVIDER]: { cacheTtlMs: DEEPSEEK_CACHE_TTL_MS, load: fetchDeepseekUsage },
};

type ProviderUsageRequest = {
	provider: string;
	theme: Pick<Theme, "fg">;
	reply: (text: string | undefined) => void;
};

const isProviderUsageRequest = (value: unknown): value is ProviderUsageRequest => {
	if (!value || typeof value !== "object") return false;
	const { provider, theme, reply } = value as Record<string, unknown>;
	return typeof provider === "string" && typeof reply === "function" &&
		!!theme && typeof theme === "object" && typeof (theme as { fg?: unknown }).fg === "function";
};

// Mirrors the footer's right-hand usage text, without width limits.
const formatRequestedUsage = (usage: UsageStatus | undefined, theme: Pick<Theme, "fg">): string => {
	if (usage?.state !== "ready") return theme.fg("dim", "quota:?");
	const parts = usage.windows.length > 0 ? [formatFooterUsage(usage, Date.now(), Infinity, theme)] : [];
	if (usage.balance) {
		const color = usage.balance.currency === "USD" && usage.balance.amount < 0.5 ? "error"
			: usage.balance.currency === "USD" && usage.balance.amount < 1 ? "warning" : "dim";
		parts.push(theme.fg(color, formatFooterBalance(usage.balance)));
	}
	return parts.length > 0 ? parts.join(" ") : theme.fg("dim", "no quota");
};

export default function providerUsage(pi: ExtensionAPI): void {
	registerStatusline(pi);
	let activeContext: ExtensionContext | undefined;
	let activeProvider: string | undefined;
	let latestUsage: UsageStatus | undefined;
	let lastFetchedAt = 0;
	let generation = 0;
	let refreshPromise: Promise<void> | undefined;
	let requestController: AbortController | undefined;
	let refreshTimer: ReturnType<typeof setInterval> | undefined;
	let sessionActive = false;
	// Usage for non-active providers, fetched on request and never published to the footer.
	let sessionGeneration = 0;
	const providerCache = new Map<UsageProvider, { status: UsageStatus; fetchedAt: number }>();
	const providerRequests = new Map<UsageProvider, { controller: AbortController; promise: Promise<UsageStatus | undefined> }>();

	const supported = (provider: string | undefined): provider is UsageProvider =>
		isUsageProvider(provider);

	const clearRequest = (): void => {
		requestController?.abort();
		requestController = undefined;
		refreshPromise = undefined;
	};

	const clearProviderUsage = (): void => {
		sessionGeneration++;
		for (const { controller } of providerRequests.values()) controller.abort();
		providerRequests.clear();
		providerCache.clear();
	};

	const clearUsage = (ctx: ExtensionContext): void => {
		latestUsage = undefined;
		lastFetchedAt = 0;
		if (ctx.hasUI) ctx.ui.setStatus(USAGE_STATUS_KEY, undefined);
	};

	const publish = (ctx: ExtensionContext, usage: UsageStatus | undefined): void => {
		if (!ctx.hasUI) return;
		if (usage) {
			ctx.ui.setStatus(USAGE_STATUS_KEY, encodeUsageStatus(usage));
			return;
		}
		const provider = ctx.model?.provider;
		if (!provider || !supported(provider)) {
			ctx.ui.setStatus(USAGE_STATUS_KEY, undefined);
			return;
		}
		ctx.ui.setStatus(USAGE_STATUS_KEY, encodeUsageStatus({
			provider,
			state: "unknown",
			windows: [],
			capturedAtMs: Date.now(),
		}));
	};

	const refresh = (ctx: ExtensionContext): Promise<void> => {
		const provider = ctx.model?.provider;
		if (!ctx.hasUI || !supported(provider)) {
			if (ctx.hasUI && supported(activeProvider)) clearUsage(ctx);
			return Promise.resolve();
		}

		const adapter = USAGE_ADAPTERS[provider];
		if (!adapter) return Promise.resolve();
		if (latestUsage?.provider === provider && Date.now() - lastFetchedAt < adapter.cacheTtlMs) {
			publish(ctx, latestUsage);
			return Promise.resolve();
		}
		if (refreshPromise) return refreshPromise;

		const requestGeneration = generation;
		const controller = new AbortController();
		requestController = controller;
		const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
		const promise = (async () => {
			try {
				const usage = await adapter.load(ctx, controller.signal);
				if (!sessionActive || requestGeneration !== generation || ctx.model?.provider !== activeProvider) return;
				latestUsage = usage;
				lastFetchedAt = Date.now();
				publish(ctx, usage);
			} catch {
				if (!sessionActive || requestGeneration !== generation || ctx.model?.provider !== provider) return;
				if (latestUsage?.provider === provider) publish(ctx, latestUsage);
				else publish(ctx, undefined);
			} finally {
				clearTimeout(timeout);
				if (requestController === controller) requestController = undefined;
			}
		})();
		refreshPromise = promise;
		promise.then(
			() => {
				if (refreshPromise === promise) refreshPromise = undefined;
			},
			() => {
				if (refreshPromise === promise) refreshPromise = undefined;
			},
		);
		return promise;
	};

	const fetchProviderUsage = (provider: UsageProvider, adapter: UsageAdapter, ctx: ExtensionContext): Promise<UsageStatus | undefined> => {
		const cached = providerCache.get(provider);
		if (cached && Date.now() - cached.fetchedAt < adapter.cacheTtlMs) return Promise.resolve(cached.status);
		const inFlight = providerRequests.get(provider);
		if (inFlight) return inFlight.promise;

		const requestGeneration = sessionGeneration;
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
		const promise = (async () => {
			try {
				const usage = await adapter.load(ctx, controller.signal);
				if (requestGeneration !== sessionGeneration) return undefined;
				providerCache.set(provider, { status: usage, fetchedAt: Date.now() });
				return usage;
			} catch {
				return requestGeneration === sessionGeneration ? providerCache.get(provider)?.status : undefined;
			} finally {
				clearTimeout(timeout);
			}
		})();
		providerRequests.set(provider, { controller, promise });
		void promise.then(() => {
			if (providerRequests.get(provider)?.promise === promise) providerRequests.delete(provider);
		});
		return promise;
	};

	pi.events.on("provider-usage:request", (data) => {
		if (!isProviderUsageRequest(data)) return;
		const { provider, theme, reply } = data;
		const ctx = activeContext;
		if (!sessionActive || !ctx || !supported(provider)) {
			reply(undefined);
			return;
		}
		const latestFor = () => latestUsage?.provider === provider ? latestUsage : undefined;
		const adapter = USAGE_ADAPTERS[provider];
		if (!adapter) {
			reply(formatRequestedUsage(latestFor(), theme));
		} else if (provider === activeProvider) {
			void refresh(ctx).then(() => reply(formatRequestedUsage(latestFor(), theme)));
		} else {
			void fetchProviderUsage(provider, adapter, ctx).then((usage) => reply(formatRequestedUsage(usage, theme)));
		}
	});

	pi.on("session_start", (_event, ctx) => {
		// A reload can start a new runtime without delivering the old shutdown
		// event. Do not let an in-flight request or cached quota cross sessions.
		generation++;
		clearRequest();
		clearProviderUsage();
		if (refreshTimer) clearInterval(refreshTimer);
		refreshTimer = undefined;
		latestUsage = undefined;
		lastFetchedAt = 0;
		sessionActive = true;
		activeContext = ctx;
		activeProvider = ctx.model?.provider;
		if (ctx.hasUI && supported(activeProvider)) publish(ctx, undefined);
		else if (ctx.hasUI) clearUsage(ctx);
		if (ctx.hasUI && !refreshTimer) {
			refreshTimer = setInterval(() => {
				if (activeContext && supported(activeProvider)) void refresh(activeContext);
			}, REFRESH_INTERVAL_MS);
		}
		void refresh(ctx);
	});

	pi.on("model_select", (event, ctx) => {
		activeContext = ctx;
		const provider = event.model.provider;
		if (provider !== activeProvider) {
			generation++;
			clearRequest();
			activeProvider = provider;
			clearUsage(ctx);
		} else if (supported(provider)) {
			// A same-provider model selection can refresh credentials; invalidate
			// any request and cached quota associated with the old credentials.
			generation++;
			clearRequest();
			clearUsage(ctx);
		}
		if (supported(provider)) {
			publish(ctx, latestUsage?.provider === provider ? latestUsage : undefined);
			void refresh(ctx);
		}
	});

	pi.on("after_provider_response", (event, ctx) => {
		if (!sessionActive || !ctx.hasUI || ctx.model?.provider !== ANTHROPIC_PROVIDER) return;
		const usage = normalizeAnthropicHeaders(event.headers);
		if (usage) {
			latestUsage = usage;
			publish(ctx, usage);
		} else if (event.status < 400 && latestUsage?.provider !== ANTHROPIC_PROVIDER) {
			// A successful reply without plan headers means an API key, which has no quota to show.
			publish(ctx, { provider: ANTHROPIC_PROVIDER, state: "ready", windows: [], capturedAtMs: Date.now() });
		}
	});

	pi.on("turn_end", (_event, ctx) => {
		activeContext = ctx;
		if (supported(ctx.model?.provider)) void refresh(ctx);
	});

	pi.on("session_shutdown", (_event, ctx) => {
		sessionActive = false;
		generation++;
		clearRequest();
		clearProviderUsage();
		if (refreshTimer) clearInterval(refreshTimer);
		refreshTimer = undefined;
		activeContext = undefined;
		activeProvider = undefined;
		latestUsage = undefined;
		lastFetchedAt = 0;
		if (ctx.hasUI) ctx.ui.setStatus(USAGE_STATUS_KEY, undefined);
	});
}

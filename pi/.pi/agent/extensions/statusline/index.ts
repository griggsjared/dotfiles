import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { CODEX_CACHE_TTL_MS, CODEX_PROVIDER, fetchCodexUsage } from "./providers/codex.ts";
import { DEEPSEEK_CACHE_TTL_MS, DEEPSEEK_PROVIDER, fetchDeepseekUsage } from "./providers/deepseek.ts";
import { registerStatusline } from "./footer.ts";
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

const USAGE_ADAPTERS: Record<UsageProvider, UsageAdapter> = {
	[CODEX_PROVIDER]: { cacheTtlMs: CODEX_CACHE_TTL_MS, load: fetchCodexUsage },
	[OPENCODE_PROVIDER]: { cacheTtlMs: OPENCODE_CACHE_TTL_MS, load: (_ctx, signal) => fetchOpencodeUsage(signal) },
	[DEEPSEEK_PROVIDER]: { cacheTtlMs: DEEPSEEK_CACHE_TTL_MS, load: fetchDeepseekUsage },
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

	const supported = (provider: string | undefined): provider is UsageProvider =>
		isUsageProvider(provider);

	const clearRequest = (): void => {
		requestController?.abort();
		requestController = undefined;
		refreshPromise = undefined;
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

	pi.on("session_start", (_event, ctx) => {
		// A reload can start a new runtime without delivering the old shutdown
		// event. Do not let an in-flight request or cached quota cross sessions.
		generation++;
		clearRequest();
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

	pi.on("turn_end", (_event, ctx) => {
		activeContext = ctx;
		if (supported(ctx.model?.provider)) void refresh(ctx);
	});

	pi.on("session_shutdown", (_event, ctx) => {
		sessionActive = false;
		generation++;
		clearRequest();
		if (refreshTimer) clearInterval(refreshTimer);
		refreshTimer = undefined;
		activeContext = undefined;
		activeProvider = undefined;
		latestUsage = undefined;
		lastFetchedAt = 0;
		if (ctx.hasUI) ctx.ui.setStatus(USAGE_STATUS_KEY, undefined);
	});
}

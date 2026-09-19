import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { asNumber, asObject, readJson } from "../http.ts";
import type { UsageStatus } from "../usage-status.ts";
import { resolveProviderAuth } from "./auth.ts";

export const DEEPSEEK_PROVIDER = "deepseek";
export const DEEPSEEK_CACHE_TTL_MS = 55_000;

const DEEPSEEK_BALANCE_ORIGIN = "https://api.deepseek.com";

export function normalizeDeepseekUsage(payload: unknown, capturedAt = Date.now()): UsageStatus | undefined {
	const infos = asObject(payload)?.balance_infos;
	if (!Array.isArray(infos)) return undefined;
	const candidates: Array<{ amount: number; currency: string }> = [];
	for (const info of infos) {
		const object = asObject(info);
		const rawAmount = object?.total_balance;
		const amount = typeof rawAmount === "string"
			? (/^\d+(?:\.\d+)?$/.test(rawAmount.trim()) ? Number(rawAmount.trim()) : undefined)
			: asNumber(rawAmount);
		const currency = typeof object?.currency === "string" ? object.currency.toUpperCase() : undefined;
		if (amount === undefined || !Number.isFinite(amount) || amount < 0) continue;
		if (currency === undefined || !/^[A-Z]{3}$/.test(currency)) continue;
		candidates.push({ amount, currency });
	}
	const balance = candidates.find((entry) => entry.amount > 0 && entry.currency === "USD")
		?? candidates.find((entry) => entry.amount > 0)
		?? candidates.find((entry) => entry.currency === "USD")
		?? candidates[0];
	if (!balance) return undefined;
	return { provider: DEEPSEEK_PROVIDER, state: "ready", windows: [], balance, capturedAtMs: capturedAt };
}

function deepseekOrigin(baseUrl: string | undefined): string | undefined {
	if (!baseUrl) return DEEPSEEK_BALANCE_ORIGIN;
	try {
		const url = new URL(baseUrl);
		return url.protocol === "https:" && url.hostname === "api.deepseek.com" && url.port === "" ? url.origin : undefined;
	} catch {
		return undefined;
	}
}

export async function fetchDeepseekUsage(ctx: ExtensionContext, signal: AbortSignal): Promise<UsageStatus> {
	const provider = ctx.modelRegistry.getProvider(DEEPSEEK_PROVIDER);
	const origin = deepseekOrigin(provider?.baseUrl);
	if (!origin) throw new Error("DeepSeek provider endpoint is not official");
	const resolved = await resolveProviderAuth(ctx, DEEPSEEK_PROVIDER, signal);
	const token = resolved?.auth.apiKey;
	if (!token) throw new Error("DeepSeek API key is unavailable");
	const response = await fetch(`${origin}/user/balance`, {
		headers: {
			Accept: "application/json",
			Authorization: `Bearer ${token}`,
		},
		signal,
		redirect: "error",
	});
	const usage = normalizeDeepseekUsage(await readJson(response, "DeepSeek"));
	if (!usage) throw new Error("DeepSeek balance response is invalid");
	return usage;
}

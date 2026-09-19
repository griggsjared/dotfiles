import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { REQUEST_TIMEOUT_MS } from "../http.ts";

export async function resolveProviderAuth(ctx: ExtensionContext, provider: string, signal: AbortSignal): Promise<Awaited<ReturnType<ExtensionContext["modelRegistry"]["getProviderAuth"]>>> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(() => reject(new Error(`${provider} auth resolution timed out`)), REQUEST_TIMEOUT_MS);
	});
	const aborted = new Promise<never>((_, reject) => {
		if (signal.aborted) reject(new Error(`${provider} auth resolution aborted`));
		else signal.addEventListener("abort", () => reject(new Error(`${provider} auth resolution aborted`)), { once: true });
	});
	try {
		return await Promise.race([ctx.modelRegistry.getProviderAuth(provider), timeout, aborted]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}

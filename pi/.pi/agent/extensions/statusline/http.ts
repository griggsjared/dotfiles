export const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 64 * 1024;

type ObjectValue = Record<string, unknown>;

export function asObject(value: unknown): ObjectValue | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? value as ObjectValue
		: undefined;
}

export function asNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export async function cancelResponseBody(response: Response): Promise<void> {
	if (!response.body) return;
	try {
		await response.body.cancel();
	} catch {
		// The response is already unusable; there is nothing safe to report.
	}
}

export async function readResponseTextLimited(response: Response, maxBytes: number, name: string): Promise<string> {
	const contentLength = Number(response.headers.get("content-length"));
	if (Number.isFinite(contentLength) && contentLength > maxBytes) {
		await cancelResponseBody(response);
		throw new Error(`${name} usage response is too large`);
	}
	if (!response.body) {
		const body = await response.text();
		if (Buffer.byteLength(body) > maxBytes) throw new Error(`${name} usage response is too large`);
		return body;
	}

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let bytes = 0;
	let body = "";
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			bytes += value.byteLength;
			if (bytes > maxBytes) {
				await reader.cancel();
				throw new Error(`${name} usage response is too large`);
			}
			body += decoder.decode(value, { stream: true });
		}
		body += decoder.decode();
		return body;
	} finally {
		reader.releaseLock();
	}
}

export async function readJson(response: Response, name: string): Promise<unknown> {
	if (!response.ok) {
		await cancelResponseBody(response);
		throw new Error(`${name} usage request failed (${response.status})`);
	}
	const body = await readResponseTextLimited(response, MAX_RESPONSE_BYTES, name);
	try {
		return JSON.parse(body);
	} catch {
		throw new Error(`${name} usage response is invalid`);
	}
}

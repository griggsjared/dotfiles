import type { ExtensionAPI, ProviderConfig, ProviderModelConfig } from "@earendil-works/pi-coding-agent";

const OLLAMA_URL = "http://127.0.0.1:11434";
const TIMEOUT_MS = 3_000;
const CONTEXT_LIMIT = 131_072;

type OllamaModel = { name: string };
type OllamaShow = {
	capabilities?: string[];
	model_info?: Record<string, unknown>;
};

function displayName(id: string): string {
	return id.split(":")[0]!
		.replace(/(?:-(?:mlx|gguf|q\d+(?:_[a-z0-9]+)*|(?:nv)?fp(?:4|8|16|32)|bf16|int[248]|\d+(?:\.\d+)?b|e\d+b))+$/i, "")
		.replace(/([a-z])(\d)/gi, "$1 $2")
		.replace(/[-_:]+/g, " ")
		.replace(/\b\w/g, (char) => char.toUpperCase());
}

async function request<T>(path: string, signal: AbortSignal, body?: object): Promise<T> {
	const response = await fetch(`${OLLAMA_URL}${path}`, {
		method: body ? "POST" : "GET",
		headers: body ? { "Content-Type": "application/json" } : undefined,
		body: body ? JSON.stringify(body) : undefined,
		signal: AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]),
	});
	if (!response.ok) throw new Error(`Ollama ${path}: HTTP ${response.status}`);
	return response.json() as Promise<T>;
}

async function models(signal: AbortSignal): Promise<ProviderModelConfig[]> {
	const { models: installed } = await request<{ models: OllamaModel[] }>("/api/tags", signal);
	return Promise.all(installed.map(async ({ name }): Promise<ProviderModelConfig | null> => {
		const { capabilities = [], model_info = {} } = await request<OllamaShow>("/api/show", signal, { model: name });
		if (capabilities.length && !capabilities.includes("completion")) return null;
		const architecture = model_info["general.architecture"];
		const reportedContext = typeof architecture === "string" ? model_info[`${architecture}.context_length`] : undefined;
		const contextWindow = typeof reportedContext === "number" && reportedContext > 0
			? Math.min(reportedContext, CONTEXT_LIMIT) : 4096;
		return {
			id: name,
			name: displayName(name),
			reasoning: capabilities.includes("thinking"),
			input: capabilities.includes("vision") ? ["text", "image"] : ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow,
			maxTokens: contextWindow,
			compat: { supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: false, maxTokensField: "max_tokens" as const },
		};
	})).then((found) => found.filter((model): model is ProviderModelConfig => model !== null));
}

export default async function ollama(pi: ExtensionAPI) {
	let initial: ProviderModelConfig[] = [];
	try {
		initial = await models(AbortSignal.timeout(TIMEOUT_MS));
	} catch {
		// Ollama may not be running when Pi starts; /model retries discovery.
	}
	pi.registerProvider("ollama", {
		baseUrl: `${OLLAMA_URL}/v1`,
		apiKey: "ollama",
		authHeader: false,
		api: "openai-completions",
		models: initial,
		refreshModels: ({ signal }) => models(signal),
	} satisfies ProviderConfig);
}

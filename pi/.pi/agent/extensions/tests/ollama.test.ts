import assert from "node:assert/strict";
import { test } from "node:test";
import type { ExtensionAPI, ProviderConfig } from "@earendil-works/pi-coding-agent";
import ollama from "../ollama.ts";

const gemma = {
	capabilities: ["completion", "vision", "tools", "thinking"],
	model_info: { "general.architecture": "gemma4", "gemma4.context_length": 131072 },
};
const embed = { capabilities: ["embedding"], model_info: {} };

test("discovers installed Ollama models at startup and refreshes additions and removals", async (t) => {
	let installed = ["gemma4:e4b-mlx", "muse-glimmer:30b-mlx", "qwen3.8:27b-mlx", "other-8b-q4_k_m", "embed:latest"];
	const requests: string[] = [];
	t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
		const path = new URL(input.toString()).pathname;
		requests.push(path);
		if (path === "/api/tags") return Response.json({ models: installed.map((name) => ({ name })) });
		assert.equal(init?.method, "POST");
		const { model } = JSON.parse(init.body as string);
		return Response.json(model === "gemma4:e4b-mlx" ? gemma : model === "embed:latest" ? embed : { capabilities: ["completion"], model_info: {} });
	});

	let config: ProviderConfig | undefined;
	await ollama({ registerProvider(name, provider) {
		assert.equal(name, "ollama");
		config = provider as ProviderConfig;
	} } as ExtensionAPI);
	assert.ok(config);
	assert.equal(config.baseUrl, "http://127.0.0.1:11434/v1");
	assert.equal(config.api, "openai-completions");
	assert.equal(config.authHeader, false);
	assert.deepEqual(config.models?.map(({ id }) => id), ["gemma4:e4b-mlx", "muse-glimmer:30b-mlx", "qwen3.8:27b-mlx", "other-8b-q4_k_m"]);
	assert.deepEqual(config.models?.map(({ name }) => name), ["Gemma 4", "Muse Glimmer", "Qwen 3.8", "Other"]);
	const model = config.models?.[0];
	assert.ok(model && (model.type === undefined || model.type === "chat"));
	assert.deepEqual(model.input, ["text", "image"]);
	assert.equal(model.contextWindow, 131072);
	assert.equal(model.reasoning, true);
	assert.equal(model.cost.input, 0);

	installed = ["other:latest"];
	const refreshed = await config.refreshModels!({ signal: new AbortController().signal } as Parameters<NonNullable<ProviderConfig["refreshModels"]>>[0]);
	assert.deepEqual(refreshed.map(({ id }) => id), ["other:latest"]);
	const refreshedModel = refreshed[0];
	assert.ok(refreshedModel && (refreshedModel.type === undefined || refreshedModel.type === "chat"));
	assert.equal(refreshedModel.name, "Other");
	assert.deepEqual(refreshedModel.input, ["text"]);
	assert.equal(refreshedModel.contextWindow, 4096);
	assert.equal(refreshedModel.reasoning, false);
	assert.equal(requests.filter((path) => path === "/api/tags").length, 2);
});

test("starts without Ollama and reports refresh failures instead of replacing the catalog", async (t) => {
	let available = false;
	t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
		if (!available) return new Response(null, { status: 503 });
		return Response.json(new URL(input.toString()).pathname === "/api/tags"
			? { models: [{ name: "gemma4:e4b-mlx" }] }
			: gemma);
	});
	let config: ProviderConfig | undefined;
	await ollama({ registerProvider(_name, provider) { config = provider as ProviderConfig; } } as ExtensionAPI);
	assert.ok(config);
	assert.deepEqual(config.models, []);
	await assert.rejects(config.refreshModels!({ signal: new AbortController().signal } as Parameters<NonNullable<ProviderConfig["refreshModels"]>>[0]), /Ollama \/api\/tags: HTTP 503/);
	available = true;
	assert.deepEqual((await config.refreshModels!({ signal: new AbortController().signal } as Parameters<NonNullable<ProviderConfig["refreshModels"]>>[0])).map(({ id }) => id), ["gemma4:e4b-mlx"]);
});

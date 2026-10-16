import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createAssistantMessageEventStream, getCurrentSystemPrompt, getCurrentTools, Type, type AssistantMessage } from "@earendil-works/pi-ai";
import type { Model } from "@earendil-works/pi-ai/compat";
import { createAgentSession, createEventBus, DefaultResourceLoader, SessionManager, SettingsManager, type ContextWithSystemEvent, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import agentsLocal from "../agents-local.ts";

test("reports complete parent-first local paths at startup, clearing removals and propagating read errors", async (t) => {
	const events: ExtensionAPI["events"] = createEventBus();
	const reports: unknown[] = [];
	events.on("context:files", (data) => { reports.push(data); });
	let handler: ((event: unknown, ctx: { cwd: string }) => Promise<void>) | undefined;
	agentsLocal({ events, on(event, callback) { if (event === "session_start") handler = callback as typeof handler; } } as ExtensionAPI);
	assert.ok(handler);

	const root = await mkdtemp(join(tmpdir(), "pi-agents-local-startup-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const child = join(root, "child");
	await mkdir(child);
	const event = { type: "session_start", reason: "startup" };
	assert.equal(await handler(event, { cwd: child }), undefined);
	assert.deepEqual(reports, [{ source: "agents-local", paths: [] }]);

	const parentFile = join(root, "AGENTS.local.md");
	const childFile = join(child, "AGENTS.local.md");
	await writeFile(parentFile, "parent");
	await writeFile(childFile, "child");
	await handler(event, { cwd: child });
	assert.deepEqual(reports.at(-1), { source: "agents-local", paths: [parentFile, childFile] });

	await rm(childFile);
	await handler(event, { cwd: child });
	assert.deepEqual(reports.at(-1), { source: "agents-local", paths: [parentFile] });
	await rm(parentFile);
	await handler(event, { cwd: child });
	assert.deepEqual(reports.at(-1), { source: "agents-local", paths: [] });

	await writeFile(childFile, "child");
	await mkdir(parentFile);
	await assert.rejects(handler(event, { cwd: child }), { code: "EISDIR" });
	assert.equal(reports.length, 4);
});

test("loads and keeps a session snapshot of local instructions alongside shared context", async (t) => {
	type ContextFile = { path: string; content: string };
	const events: ExtensionAPI["events"] = createEventBus();
	const reports: unknown[] = [];
	events.on("context:files", (data) => { reports.push(data); });
	let start: ((event: unknown, ctx: { cwd: string }) => Promise<void>) | undefined;
	let handler: ((event: { systemPromptOptions: { contextFiles: ContextFile[] } }, ctx: { cwd: string }) => void) | undefined;
	agentsLocal({ events, on(event, callback) {
		if (event === "session_start") start = callback as typeof start;
		if (event === "before_agent_start") handler = callback as typeof handler;
	} } as ExtensionAPI);
	assert.ok(start);
	assert.ok(handler);

	const root = await mkdtemp(join(tmpdir(), "pi-agents-local-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const child = join(root, "child");
	await mkdir(child);
	const parentFile = join(root, "AGENTS.local.md");
	const childFile = join(child, "AGENTS.local.md");
	const event = () => ({ systemPromptOptions: { contextFiles: [{ path: "AGENTS.md", content: "shared" }] } });

	await start({ type: "session_start", reason: "startup" }, { cwd: child });
	let current = event();
	handler(current, { cwd: child });
	assert.deepEqual(current.systemPromptOptions.contextFiles, [{ path: "AGENTS.md", content: "shared" }]);

	await writeFile(parentFile, "parent");
	await writeFile(childFile, "child");
	await start({ type: "session_start", reason: "reload" }, { cwd: child });
	current = event();
	handler(current, { cwd: child });
	assert.deepEqual(current.systemPromptOptions.contextFiles.slice(1), [
		{ path: parentFile, content: "parent" },
		{ path: childFile, content: "child" },
	]);

	await writeFile(childFile, "updated");
	current = event();
	handler(current, { cwd: child });
	assert.equal(current.systemPromptOptions.contextFiles.at(-1)?.content, "child");

	await rm(childFile);
	await mkdir(childFile);
	current = event();
	handler(current, { cwd: child });
	assert.equal(current.systemPromptOptions.contextFiles.at(-1)?.content, "child");
	await assert.rejects(start({ type: "session_start", reason: "reload" }, { cwd: child }), { code: "EISDIR" });
	current = event();
	handler(current, { cwd: child });
	assert.deepEqual(current.systemPromptOptions.contextFiles, [{ path: "AGENTS.md", content: "shared" }]);
	assert.deepEqual(reports, [
		{ source: "agents-local", paths: [] },
		{ source: "agents-local", paths: [parentFile, childFile] },
	]);
});

test("keeps extension-triggered turns on the session snapshot until reload", async (t) => {
	const events: ExtensionAPI["events"] = createEventBus();
	const reports: unknown[] = [];
	events.on("context:files", (data) => { reports.push(data); });
	let start: ((event: unknown, ctx: { cwd: string }) => Promise<void>) | undefined;
	let handler: ((event: ContextWithSystemEvent, ctx: { cwd: string }) => { messages: ContextWithSystemEvent["messages"] } | undefined) | undefined;
	agentsLocal({ events, on(event, callback) {
		if (event === "session_start") start = callback as typeof start;
		if (event === "context_with_system") handler = callback as typeof handler;
	} } as ExtensionAPI);
	assert.ok(start);
	assert.ok(handler);
	const root = await mkdtemp(join(tmpdir(), "pi-agents-local-request-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const localFile = join(root, "AGENTS.local.md");
	await writeFile(localFile, "request-local-marker-v1");
	await start({ type: "session_start", reason: "startup" }, { cwd: root });
	const event: ContextWithSystemEvent = {
		type: "context_with_system",
		messages: [{
			role: "system", content: "shared-instruction-marker",
			toolsAdded: [{ name: "noop", description: "Test tool", parameters: Type.Object({}) }], timestamp: 0,
		}, { role: "user", content: "test", timestamp: 0 }],
	};
	const repaired = handler(event, { cwd: root });
	assert.ok(repaired);
	assert.match(getCurrentSystemPrompt(repaired.messages), /shared-instruction-marker/);
	assert.equal(getCurrentSystemPrompt(repaired.messages).split("request-local-marker-v1").length - 1, 1);
	assert.deepEqual(getCurrentTools(repaired.messages).map(({ name }) => name), ["noop"]);
	assert.equal(handler({ ...event, messages: repaired.messages }, { cwd: root }), undefined);

	await writeFile(localFile, "request-local-marker-v2");
	assert.equal(handler({ ...event, messages: repaired.messages }, { cwd: root }), undefined);
	await start({ type: "session_start", reason: "reload" }, { cwd: root });
	const updated = handler({ ...event, messages: repaired.messages }, { cwd: root });
	assert.ok(updated);
	assert.doesNotMatch(getCurrentSystemPrompt(updated.messages), /request-local-marker-v1/);
	assert.match(getCurrentSystemPrompt(updated.messages), /request-local-marker-v2/);
	assert.deepEqual(getCurrentTools(updated.messages).map(({ name }) => name), ["noop"]);

	await rm(localFile);
	assert.equal(handler({ ...event, messages: updated.messages }, { cwd: root }), undefined);
	await start({ type: "session_start", reason: "reload" }, { cwd: root });
	const removed = handler({ ...event, messages: updated.messages }, { cwd: root });
	assert.ok(removed);
	assert.doesNotMatch(getCurrentSystemPrompt(removed.messages), /request-local-marker/);
	assert.match(getCurrentSystemPrompt(removed.messages), /shared-instruction-marker/);
	assert.deepEqual(getCurrentTools(removed.messages).map(({ name }) => name), ["noop"]);
	assert.deepEqual(reports, [
		{ source: "agents-local", paths: [localFile] },
		{ source: "agents-local", paths: [localFile] },
		{ source: "agents-local", paths: [] },
	]);
});

test("keeps the session snapshot in custom-message turns and their tool continuations", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "pi-agents-local-runtime-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const agentDir = join(root, "agent");
	const cwd = join(root, "child");
	await mkdir(agentDir);
	await mkdir(cwd);
	await writeFile(join(root, "AGENTS.md"), "shared-instruction-marker");
	const parentFile = join(root, "AGENTS.local.md");
	const localFile = join(cwd, "AGENTS.local.md");
	await writeFile(parentFile, "local-parent-marker");
	await writeFile(localFile, "local-request-marker-v1");
	const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false }, cacheWarming: "off" });
	const eventBus = createEventBus();
	const reports: unknown[] = [];
	eventBus.on("context:files", (data) => { reports.push(data); });
	const resourceLoader = new DefaultResourceLoader({
		cwd, agentDir, settingsManager, eventBus,
		noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true,
		extensionFactories: [agentsLocal],
		agentsFilesOverride: ({ agentsFiles }) => ({ agentsFiles: [...agentsFiles, { path: "/virtual/OTHER.md", content: "other-instruction-marker" }] }),
	});
	await resourceLoader.reload();
	const model: Model<"openai-completions"> = {
		id: "test", name: "test", api: "openai-completions", provider: "openai", baseUrl: "http://unused",
		reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200000, maxTokens: 128,
	};
	const { session } = await createAgentSession({
		cwd, agentDir, model, resourceLoader, settingsManager,
		tools: ["noop"], sessionManager: SessionManager.inMemory(cwd),
		customTools: [{
			name: "noop", label: "noop", description: "Test tool", parameters: Type.Object({}),
			execute: async () => ({ content: [{ type: "text", text: "done" }], details: undefined }),
		}],
	});
	t.after(() => session.dispose());
	const requests: Array<{ prompt: string; tools: string[] }> = [];
	session.agent.streamFunction = (_model, context) => {
		requests.push({ prompt: getCurrentSystemPrompt(context.messages), tools: getCurrentTools(context.messages).map(({ name }) => name) });
		const toolUse = requests.length === 2;
		const message: AssistantMessage = {
			role: "assistant", api: model.api, provider: model.provider, model: model.id,
			content: toolUse ? [{ type: "toolCall", id: "noop-1", name: "noop", arguments: {} }] : [{ type: "text", text: "OK" }],
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
			stopReason: toolUse ? "toolUse" : "stop", timestamp: Date.now(),
		};
		const stream = createAssistantMessageEventStream();
		queueMicrotask(() => { stream.push({ type: "done", reason: message.stopReason as "stop" | "toolUse", message }); stream.end(); });
		return stream;
	};
	await session.modelRuntime.setRuntimeApiKey("openai", "test");
	await session.bindExtensions({ mode: "print" });
	assert.deepEqual(reports, [{ source: "agents-local", paths: [parentFile, localFile] }]);
	assert.equal(requests.length, 0);
	assert.doesNotMatch(session.systemPrompt, /local-parent-marker|local-request-marker/);
	await session.prompt("test");
	await session.sendCustomMessage({ customType: "follow-up", content: "continue", display: false }, { triggerTurn: true });
	assert.equal(requests.length, 3);
	for (const { prompt } of requests) {
		assert.equal(prompt.split("local-parent-marker").length - 1, 1);
		assert.equal(prompt.split("local-request-marker-v1").length - 1, 1);
		assert.ok(prompt.indexOf("local-parent-marker") < prompt.indexOf("local-request-marker-v1"));
	}

	await writeFile(localFile, "local-request-marker-v2");
	await session.sendCustomMessage({ customType: "follow-up", content: "updated", display: false }, { triggerTurn: true });
	assert.equal(requests[3]!.prompt, requests[2]!.prompt);

	await rm(parentFile);
	await rm(localFile);
	await session.sendCustomMessage({ customType: "follow-up", content: "removed", display: false }, { triggerTurn: true });
	assert.equal(requests.length, 5);
	assert.equal(requests[4]!.prompt, requests[3]!.prompt);
	assert.deepEqual(reports, [{ source: "agents-local", paths: [parentFile, localFile] }]);
	for (const { prompt, tools } of requests) {
		assert.match(prompt, /shared-instruction-marker/);
		assert.match(prompt, /other-instruction-marker/);
		assert.deepEqual(tools, ["noop"]);
	}
});

import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import agentsLocal from "../agents-local.ts";

test("loads local instructions alongside shared context, in parent order, on each run", async (t) => {
	type ContextFile = { path: string; content: string };
	let handler: ((event: { systemPromptOptions: { contextFiles: ContextFile[] } }, ctx: { cwd: string }) => Promise<void>) | undefined;
	agentsLocal({ on(_event, callback) { handler = callback as typeof handler; } } as ExtensionAPI);
	assert.ok(handler);

	const root = await mkdtemp(join(tmpdir(), "pi-agents-local-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	const child = join(root, "child");
	await mkdir(child);
	const event = () => ({ systemPromptOptions: { contextFiles: [{ path: "AGENTS.md", content: "shared" }] } });

	let current = event();
	await handler(current, { cwd: child });
	assert.deepEqual(current.systemPromptOptions.contextFiles.filter(({ path }) => path.startsWith(root)), []);
	assert.deepEqual(current.systemPromptOptions.contextFiles[0], { path: "AGENTS.md", content: "shared" });

	const parentFile = join(root, "AGENTS.local.md");
	const childFile = join(child, "AGENTS.local.md");
	await writeFile(parentFile, "parent");
	await writeFile(childFile, "child");
	current = event();
	await handler(current, { cwd: child });
	assert.deepEqual(current.systemPromptOptions.contextFiles.filter(({ path }) => path.startsWith(root)), [
		{ path: parentFile, content: "parent" },
		{ path: childFile, content: "child" },
	]);

	await writeFile(childFile, "updated");
	current = event();
	await handler(current, { cwd: child });
	assert.equal(current.systemPromptOptions.contextFiles.at(-1)?.content, "updated");

	await rm(childFile);
	await mkdir(childFile);
	await assert.rejects(handler(event(), { cwd: child }), { code: "EISDIR" });
});

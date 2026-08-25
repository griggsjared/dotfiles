import assert from "node:assert/strict";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import workspaceGuard, { registerWorkspaceGuard } from "../index.ts";
import { SandboxDependencyUnavailableError } from "../sandbox.ts";

type Handler = (event: any, ctx: any) => any;

class FakeSandbox {
	isReady = false;
	error: string | undefined;
	roots: string[][] = [];
	bashCwds: string[] = [];
	failReconfigure = false;
	initializeError: Error | undefined;

	async initialize(roots: readonly string[]) {
		if (this.initializeError) throw this.initializeError;
		this.roots.push([...roots]);
		this.isReady = true;
	}

	async reconfigure(roots: readonly string[]) {
		if (this.failReconfigure) throw new Error("reconfigure failed");
		this.roots.push([...roots]);
	}

	operations() {
		const bashCwds = this.bashCwds;
		return {
			async exec(_command: string, cwd: string) {
				bashCwds.push(cwd);
				return { exitCode: 0 };
			},
		};
	}

	async dispose() {
		this.isReady = false;
	}
}

function register(sandbox = new FakeSandbox(), environment: NodeJS.ProcessEnv = {}) {
	const handlers = new Map<string, Handler>();
	const tools = new Map<string, any>();
	const commands = new Map<string, any>();
	const api = {
		on(name: string, handler: Handler) { handlers.set(name, handler); },
		registerTool(tool: { name: string }) { tools.set(tool.name, tool); },
		registerCommand(name: string, command: unknown) { commands.set(name, command); },
	} as unknown as ExtensionAPI;
	registerWorkspaceGuard(api, {
		sandbox,
		environment,
		extensionPath: "/guard/index.ts",
	});
	return { commands, environment, handlers, sandbox, tools };
}

function createContext(cwd: string, options: { confirm?: boolean; hasUI?: boolean } = {}) {
	const notices: Array<{ message: string; type?: string }> = [];
	return {
		notices,
		ctx: {
			cwd,
			hasUI: options.hasUI ?? true,
			mode: "tui",
			sessionManager: {
				getSessionId() { return "test-session"; },
				getSessionFile() { return undefined; },
			},
			ui: {
				async confirm() { return options.confirm ?? true; },
				notify(message: string, type?: string) { notices.push({ message, type }); },
				setStatus() {},
			},
		},
	};
}

async function emit(handlers: Map<string, Handler>, name: string, event: Record<string, unknown>, ctx: unknown) {
	return handlers.get(name)?.(event, ctx);
}

test("default extension bypasses the workspace guard", () => {
	const registrations: string[] = [];
	const api = {
		on() { registrations.push("handler"); },
		registerTool() { registrations.push("tool"); },
		registerCommand() { registrations.push("command"); },
	} as unknown as ExtensionAPI;

	workspaceGuard(api);

	assert.deepEqual(registrations, []);
});

async function withDirectories(run: (paths: { root: string; workspace: string; outside: string }) => Promise<void>) {
	const root = await mkdtemp(join(tmpdir(), "workspace-guard-test-"));
	const workspace = join(root, "workspace");
	const outside = join(root, "outside");
	await mkdir(workspace);
	await mkdir(outside);
	await writeFile(join(workspace, "inside.txt"), "inside");
	await writeFile(join(outside, "outside.txt"), "outside");
	try {
		await run({
			root,
			workspace: await realpath(workspace),
			outside: await realpath(outside),
		});
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

test("blocks external direct tools and allows the workspace", async () => {
	await withDirectories(async ({ workspace, outside }) => {
		const registration = register();
		const { ctx } = createContext(workspace);
		await emit(registration.handlers, "session_start", { reason: "startup" }, ctx);

		const insideEvent = {
			type: "tool_call",
			toolCallId: "inside",
			toolName: "read",
			input: { path: join(workspace, "inside.txt") },
		};
		const inside = await emit(registration.handlers, "tool_call", insideEvent, ctx);
		await emit(registration.handlers, "tool_execution_end", {
			type: "tool_execution_end",
			toolCallId: "inside",
			toolName: "read",
			result: {},
			isError: false,
		}, ctx);
		const blocked = await emit(registration.handlers, "tool_call", {
			type: "tool_call",
			toolCallId: "outside",
			toolName: "read",
			input: { path: join(outside, "outside.txt") },
		}, ctx);

		assert.equal(inside, undefined);
		assert.equal(insideEvent.input.path, join(workspace, "inside.txt"));
		assert.equal(blocked.block, true);
		assert.match(blocked.reason, /request_directory_access/);
		await emit(registration.handlers, "session_shutdown", { reason: "quit" }, ctx);
	});
});

test("normalizes empty optional search paths to the workspace", async () => {
	await withDirectories(async ({ workspace }) => {
		const registration = register();
		const { ctx } = createContext(workspace);
		await emit(registration.handlers, "session_start", { reason: "startup" }, ctx);

		for (const toolName of ["grep", "find", "ls"]) {
			const event = {
				type: "tool_call",
				toolCallId: `empty-${toolName}`,
				toolName,
				input: { path: "" },
			};
			assert.equal(await emit(registration.handlers, "tool_call", event, ctx), undefined);
			assert.equal(event.input.path, workspace);
			await emit(registration.handlers, "tool_execution_end", {
				type: "tool_execution_end",
				toolCallId: event.toolCallId,
				toolName,
				result: {},
				isError: false,
			}, ctx);
		}
		await emit(registration.handlers, "session_shutdown", { reason: "quit" }, ctx);
	});
});

test("missing sandbox dependency disables the guard with an alert", async () => {
	await withDirectories(async ({ workspace, outside }) => {
		const sandbox = new FakeSandbox();
		sandbox.initializeError = new SandboxDependencyUnavailableError("missing package");
		const registration = register(sandbox);
		const { ctx, notices } = createContext(workspace);
		await emit(registration.handlers, "session_start", { reason: "startup" }, ctx);

		assert.match(notices.at(-1)?.message ?? "", /running with unrestricted default tools/);
		assert.equal(notices.at(-1)?.type, "warning");
		assert.equal(registration.environment.PI_WORKSPACE_GUARD_EXTENSION, undefined);
		const checked = await emit(registration.handlers, "tool_call", {
			type: "tool_call",
			toolCallId: "unrestricted",
			toolName: "read",
			input: { path: join(outside, "outside.txt") },
		}, ctx);
		assert.equal(checked, undefined);
		const bashResult = await registration.tools.get("bash").execute(
			"default-bash",
			{ command: "printf default-behavior" },
			undefined,
			undefined,
			ctx,
		);
		assert.match(bashResult.content[0].text, /default-behavior/);
		assert.deepEqual(sandbox.bashCwds, []);
		await emit(registration.handlers, "session_shutdown", { reason: "quit" }, ctx);
	});
});

test("guarded Bash executes from the tool context workspace", async () => {
	await withDirectories(async ({ workspace }) => {
		const registration = register();
		const { ctx } = createContext(workspace);
		await emit(registration.handlers, "session_start", { reason: "startup" }, ctx);
		await registration.tools.get("bash").execute(
			"bash",
			{ command: "pwd" },
			undefined,
			undefined,
			ctx,
		);

		assert.deepEqual(registration.sandbox.bashCwds, [workspace]);
		await emit(registration.handlers, "session_shutdown", { reason: "quit" }, ctx);
	});
});

test("guarded Bash waits for an active filesystem tool", async () => {
	await withDirectories(async ({ workspace }) => {
		const registration = register();
		const { ctx } = createContext(workspace);
		await emit(registration.handlers, "session_start", { reason: "startup" }, ctx);
		await emit(registration.handlers, "tool_call", {
			type: "tool_call",
			toolCallId: "active-read",
			toolName: "read",
			input: { path: join(workspace, "inside.txt") },
		}, ctx);

		const bash = registration.tools.get("bash").execute(
			"waiting-bash",
			{ command: "pwd" },
			undefined,
			undefined,
			ctx,
		);
		await Promise.resolve();
		assert.deepEqual(registration.sandbox.bashCwds, []);
		await emit(registration.handlers, "tool_execution_end", {
			type: "tool_execution_end",
			toolCallId: "active-read",
			toolName: "read",
			result: {},
			isError: false,
		}, ctx);
		await bash;
		assert.deepEqual(registration.sandbox.bashCwds, [workspace]);
		await emit(registration.handlers, "session_shutdown", { reason: "quit" }, ctx);
	});
});

test("approval grants every guarded path tool for the session", async () => {
	await withDirectories(async ({ workspace, outside }) => {
		const registration = register();
		const { ctx } = createContext(workspace, { confirm: true });
		await emit(registration.handlers, "session_start", { reason: "startup" }, ctx);
		const request = registration.tools.get("request_directory_access");
		const response = await request.execute(
			"request",
			{ path: outside, reason: "Read shared fixtures" },
			undefined,
			undefined,
			ctx,
		);

		assert.match(response.content[0].text, /Access granted/);
		assert.deepEqual(registration.sandbox.roots.at(-1), [workspace, outside]);
		assert.equal(registration.environment.PI_WORKSPACE_GUARD_EXTENSION, "/guard/index.ts");
		assert.deepEqual(JSON.parse(registration.environment.PI_WORKSPACE_GUARD_ROOTS ?? "[]"), [workspace, outside]);
		for (const toolName of ["read", "write", "edit", "grep", "find", "ls"]) {
			const checked = await emit(registration.handlers, "tool_call", {
				type: "tool_call",
				toolCallId: toolName,
				toolName,
				input: { path: join(outside, "outside.txt") },
			}, ctx);
			assert.equal(checked, undefined, `${toolName} should be allowed`);
			await emit(registration.handlers, "tool_execution_end", {
				type: "tool_execution_end",
				toolCallId: toolName,
				toolName,
				result: {},
				isError: false,
			}, ctx);
		}
		await emit(registration.handlers, "session_shutdown", { reason: "quit" }, ctx);
	});
});

test("concurrent approvals preserve every grant", async () => {
	await withDirectories(async ({ root, workspace, outside }) => {
		const otherPath = join(root, "other");
		await mkdir(otherPath);
		const other = await realpath(otherPath);
		const registration = register();
		const { ctx } = createContext(workspace);
		await emit(registration.handlers, "session_start", { reason: "startup" }, ctx);
		const request = registration.tools.get("request_directory_access");

		await Promise.all([
			request.execute("first", { path: outside, reason: "First grant" }, undefined, undefined, ctx),
			request.execute("second", { path: other, reason: "Second grant" }, undefined, undefined, ctx),
		]);

		const roots = JSON.parse(registration.environment.PI_WORKSPACE_GUARD_ROOTS ?? "[]") as string[];
		assert.equal(roots.length, 3);
		assert.deepEqual(new Set(roots), new Set([workspace, outside, other]));
		await emit(registration.handlers, "session_shutdown", { reason: "quit" }, ctx);
	});
});

test("scope reset waits for active tools and blocks future access", async () => {
	await withDirectories(async ({ workspace, outside }) => {
		const registration = register();
		const { ctx } = createContext(workspace);
		await emit(registration.handlers, "session_start", { reason: "startup" }, ctx);
		await registration.tools.get("request_directory_access").execute(
			"grant",
			{ path: outside, reason: "Temporary access" },
			undefined,
			undefined,
			ctx,
		);
		await emit(registration.handlers, "tool_call", {
			type: "tool_call",
			toolCallId: "active-outside-read",
			toolName: "read",
			input: { path: join(outside, "outside.txt") },
		}, ctx);

		const reset = registration.commands.get("scope-reset").handler("", ctx);
		await Promise.resolve();
		assert.deepEqual(registration.sandbox.roots.at(-1), [workspace, outside]);
		await emit(registration.handlers, "tool_execution_end", {
			type: "tool_execution_end",
			toolCallId: "active-outside-read",
			toolName: "read",
			result: {},
			isError: false,
		}, ctx);
		await reset;

		assert.deepEqual(registration.sandbox.roots.at(-1), [workspace]);
		assert.deepEqual(JSON.parse(registration.environment.PI_WORKSPACE_GUARD_ROOTS ?? "[]"), [workspace]);
		const blocked = await emit(registration.handlers, "tool_call", {
			type: "tool_call",
			toolCallId: "future-outside-read",
			toolName: "read",
			input: { path: join(outside, "outside.txt") },
		}, ctx);
		assert.equal(blocked.block, true);
		await emit(registration.handlers, "session_shutdown", { reason: "quit" }, ctx);
	});
});

test("denied approval does not add a grant", async () => {
	await withDirectories(async ({ workspace, outside }) => {
		const registration = register();
		const { ctx } = createContext(workspace, { confirm: false });
		await emit(registration.handlers, "session_start", { reason: "startup" }, ctx);
		const response = await registration.tools.get("request_directory_access").execute(
			"request",
			{ path: outside, reason: "Denied request" },
			undefined,
			undefined,
			ctx,
		);

		assert.match(response.content[0].text, /Access denied/);
		assert.deepEqual(registration.sandbox.roots, [[workspace]]);
		assert.deepEqual(JSON.parse(registration.environment.PI_WORKSPACE_GUARD_ROOTS ?? "[]"), [workspace]);
		await emit(registration.handlers, "session_shutdown", { reason: "quit" }, ctx);
	});
});

test("sandbox reconfiguration failure does not add a grant", async () => {
	await withDirectories(async ({ workspace, outside }) => {
		const sandbox = new FakeSandbox();
		const registration = register(sandbox);
		const { ctx } = createContext(workspace);
		await emit(registration.handlers, "session_start", { reason: "startup" }, ctx);
		sandbox.failReconfigure = true;
		const response = await registration.tools.get("request_directory_access").execute(
			"request",
			{ path: outside, reason: "Unsafe request" },
			undefined,
			undefined,
			ctx,
		);

		assert.match(response.content[0].text, /was not granted/);
		assert.deepEqual(JSON.parse(registration.environment.PI_WORKSPACE_GUARD_ROOTS ?? "[]"), [workspace]);
		sandbox.failReconfigure = false;
		await emit(registration.handlers, "session_shutdown", { reason: "quit" }, ctx);
	});
});

test("noninteractive children cannot add grants", async () => {
	await withDirectories(async ({ workspace, outside }) => {
		const environment = { PI_WORKSPACE_GUARD_CHILD: "1" };
		const registration = register(new FakeSandbox(), environment);
		const { ctx } = createContext(workspace, { hasUI: false });
		await emit(registration.handlers, "session_start", { reason: "startup" }, ctx);
		const request = registration.tools.get("request_directory_access");
		const response = await request.execute(
			"request",
			{ path: outside, reason: "Try to escape" },
			undefined,
			undefined,
			ctx,
		);

		assert.match(response.content[0].text, /approval requires an interactive parent session/);
		assert.equal(response.details.granted, false);
		await emit(registration.handlers, "session_shutdown", { reason: "quit" }, ctx);
	});
});

test("child sessions inherit parent grants without gaining approval UI", async () => {
	await withDirectories(async ({ workspace, outside }) => {
		const environment = {
			PI_WORKSPACE_GUARD_CHILD: "1",
			PI_WORKSPACE_GUARD_ROOTS: JSON.stringify([workspace, outside]),
		};
		const registration = register(new FakeSandbox(), environment);
		const { ctx } = createContext(workspace, { hasUI: false });
		await emit(registration.handlers, "session_start", { reason: "startup" }, ctx);

		assert.deepEqual(registration.sandbox.roots.at(-1), [workspace, outside]);
		const checked = await emit(registration.handlers, "tool_call", {
			type: "tool_call",
			toolCallId: "inherited",
			toolName: "read",
			input: { path: join(outside, "outside.txt") },
		}, ctx);
		assert.equal(checked, undefined);
		await emit(registration.handlers, "tool_execution_end", {
			type: "tool_execution_end",
			toolCallId: "inherited",
			toolName: "read",
			result: {},
			isError: false,
		}, ctx);
		await emit(registration.handlers, "session_shutdown", { reason: "quit" }, ctx);
	});
});

test("reload preserves grants and a new session clears them", async () => {
	await withDirectories(async ({ workspace, outside }) => {
		const first = register();
		const { ctx } = createContext(workspace);
		await emit(first.handlers, "session_start", { reason: "startup" }, ctx);
		await first.tools.get("request_directory_access").execute(
			"request",
			{ path: outside, reason: "Shared files" },
			undefined,
			undefined,
			ctx,
		);
		await emit(first.handlers, "session_shutdown", { reason: "reload" }, ctx);

		const reloaded = register();
		await emit(reloaded.handlers, "session_start", { reason: "reload" }, ctx);
		assert.deepEqual(reloaded.sandbox.roots.at(-1), [workspace, outside]);
		await emit(reloaded.handlers, "session_shutdown", { reason: "new" }, ctx);

		const next = register();
		await emit(next.handlers, "session_start", { reason: "new" }, ctx);
		assert.deepEqual(next.sandbox.roots.at(-1), [workspace]);
		await emit(next.handlers, "session_shutdown", { reason: "quit" }, ctx);
	});
});

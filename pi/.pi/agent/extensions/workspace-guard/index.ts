import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ToolCallEvent } from "@earendil-works/pi-coding-agent";
import {
	createBashToolDefinition,
	isToolCallEventType,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
	compactGrantRoots,
	isAllowedPath,
	resolveGrantDirectory,
	resolveToolPath,
} from "./policy.ts";
import { SandboxController, SandboxDependencyUnavailableError } from "./sandbox.ts";

const BYPASS_WORKSPACE_GUARD = true;
const REGISTRY_KEY = "__pi_workspace_guard_scope__";
const BOOTSTRAP_EXTENSION = "PI_WORKSPACE_GUARD_EXTENSION";
const BOOTSTRAP_ROOTS = "PI_WORKSPACE_GUARD_ROOTS";
const BOOTSTRAP_CHILD = "PI_WORKSPACE_GUARD_CHILD";

interface ScopeRegistry {
	workspace?: string;
	grants: string[];
	generation?: symbol;
}

interface SandboxApi {
	readonly isReady: boolean;
	readonly error: string | undefined;
	initialize(roots: readonly string[]): Promise<void>;
	reconfigure(roots: readonly string[]): Promise<void>;
	operations(): ReturnType<SandboxController["operations"]>;
	dispose(): Promise<void>;
}

export interface WorkspaceGuardDependencies {
	sandbox?: SandboxApi;
	environment?: NodeJS.ProcessEnv;
	extensionPath?: string;
}

const RequestParams = Type.Object({
	path: Type.String({ minLength: 1 }),
	reason: Type.String({ minLength: 1, maxLength: 1000 }),
});

function getRegistry(): ScopeRegistry {
	const globals = globalThis as typeof globalThis & { [REGISTRY_KEY]?: ScopeRegistry };
	globals[REGISTRY_KEY] ??= { grants: [] };
	return globals[REGISTRY_KEY];
}

function rootsFor(registry: ScopeRegistry): string[] {
	return registry.workspace ? [registry.workspace, ...registry.grants] : [];
}

function requestedPath(event: ToolCallEvent): string | undefined {
	if (isToolCallEventType("read", event)) return event.input.path;
	if (isToolCallEventType("write", event)) return event.input.path;
	if (isToolCallEventType("edit", event)) return event.input.path;
	if (isToolCallEventType("grep", event)) return event.input.path;
	if (isToolCallEventType("find", event)) return event.input.path;
	if (isToolCallEventType("ls", event)) return event.input.path;
	return undefined;
}

function isGuardedPathTool(event: ToolCallEvent): boolean {
	return ["read", "write", "edit", "grep", "find", "ls"].includes(event.toolName);
}

function usesOptionalPath(event: ToolCallEvent): boolean {
	return ["grep", "find", "ls"].includes(event.toolName);
}

function setRequestedPath(event: ToolCallEvent, path: string): void {
	(event.input as { path: string }).path = path;
}

function result(text: string, details: Record<string, unknown> = {}) {
	return {
		content: [{ type: "text" as const, text }],
		details,
	};
}

async function loadChildGrants(workspace: string, environment: NodeJS.ProcessEnv): Promise<string[]> {
	if (environment[BOOTSTRAP_CHILD] !== "1") return [];
	let values: unknown;
	try {
		values = JSON.parse(environment[BOOTSTRAP_ROOTS] ?? "[]");
	} catch {
		return [];
	}
	if (!Array.isArray(values)) return [];
	const grants: string[] = [];
	for (const value of values) {
		if (typeof value !== "string") continue;
		try {
			const resolved = await resolveGrantDirectory(value, workspace, [workspace, ...grants]);
			if (!resolved.alreadyAllowed) grants.push(resolved.directory);
		} catch {
			continue;
		}
	}
	return compactGrantRoots(workspace, grants);
}

export function registerWorkspaceGuard(pi: ExtensionAPI, dependencies: WorkspaceGuardDependencies = {}) {
	const sandbox = dependencies.sandbox ?? new SandboxController();
	const environment = dependencies.environment ?? process.env;
	const extensionPath = dependencies.extensionPath ?? fileURLToPath(import.meta.url);
	const registry = getRegistry();
	let active = false;
	let guardEnabled = true;
	let generation: symbol | undefined;
	let policyTail: Promise<void> = Promise.resolve();
	let executionTail: Promise<void> = Promise.resolve();
	const executionReleases = new Map<string, () => void>();

	async function acquireExecution(): Promise<() => void> {
		let release = () => {};
		const ticket = new Promise<void>((resolve) => { release = resolve; });
		const previous = executionTail;
		executionTail = previous.then(() => ticket);
		await previous;
		return release;
	}

	async function exclusiveExecution<T>(operation: () => Promise<T>): Promise<T> {
		const release = await acquireExecution();
		try {
			return await operation();
		} finally {
			release();
		}
	}

	function releaseExecutions(): void {
		for (const release of executionReleases.values()) release();
		executionReleases.clear();
	}

	function exclusivePolicy<T>(operation: () => Promise<T>): Promise<T> {
		const execution = policyTail.then(operation, operation);
		policyTail = execution.then(() => undefined, () => undefined);
		return execution;
	}

	function updateBootstrap(): void {
		if (!registry.workspace) return;
		environment[BOOTSTRAP_EXTENSION] = extensionPath;
		environment[BOOTSTRAP_ROOTS] = JSON.stringify(rootsFor(registry));
	}

	function clearBootstrap(): void {
		delete environment[BOOTSTRAP_EXTENSION];
		delete environment[BOOTSTRAP_ROOTS];
		delete environment[BOOTSTRAP_CHILD];
	}

	const bashOperations = sandbox.operations();
	const bash = createBashToolDefinition(process.cwd(), { operations: bashOperations });
	pi.registerTool({
		...bash,
		label: "bash (workspace guarded)",
		description: `${bash.description} Filesystem access outside the current workspace requires request_directory_access approval.`,
		execute(toolCallId, params, signal, onUpdate, ctx) {
			const definition = guardEnabled
				? createBashToolDefinition(ctx.cwd, { operations: bashOperations })
				: createBashToolDefinition(ctx.cwd);
			if (!guardEnabled) return definition.execute(toolCallId, params, signal, onUpdate, ctx);
			return exclusiveExecution(() => definition.execute(toolCallId, params, signal, onUpdate, ctx));
		},
	});

	pi.registerTool({
		name: "request_directory_access",
		label: "Request Directory Access",
		description: "Ask the user to grant read, write, search, edit, and agent Bash access to one external directory for the current Pi session.",
		promptSnippet: "Request session access to an external directory",
		promptGuidelines: [
			"Before accessing a path outside the current workspace, call request_directory_access with an existing directory and a short reason.",
			"A denied filesystem operation or Bash EPERM outside the workspace means you must request its directory, then retry in a later tool call.",
		],
		parameters: RequestParams,
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			return exclusivePolicy(async () => {
				const requestGeneration = generation;
				if (!guardEnabled) {
					return result("Workspace Guard is disabled because sandbox-runtime is unavailable. Pi is using unrestricted default tools.", { granted: false });
				}
				if (!active || !registry.workspace || registry.generation !== requestGeneration) {
					return result("Directory access denied: Workspace Guard is not initialized.", { granted: false });
				}
				if (!ctx.hasUI || environment[BOOTSTRAP_CHILD] === "1") {
					return result("Directory access denied: approval requires an interactive parent session.", { granted: false });
				}
				let resolution;
				try {
					resolution = await resolveGrantDirectory(params.path, ctx.cwd, rootsFor(registry));
				} catch (error) {
					return result(`Directory access denied: ${error instanceof Error ? error.message : String(error)}`, { granted: false });
				}
				if (resolution.alreadyAllowed) {
					return result(`Access is already allowed for ${resolution.directory}.`, {
						granted: true,
						path: resolution.directory,
					});
				}
				const approved = await ctx.ui.confirm(
					"Allow workspace access?",
					[
						`Requested: ${JSON.stringify(resolution.requestedPath)}`,
						`Canonical: ${JSON.stringify(resolution.directory)}`,
						`Workspace: ${JSON.stringify(registry.workspace)}`,
						"",
						"This grants read, write, edit, search, and agent Bash access to the entire directory for this session.",
						...(resolution.directory === "/" ? ["WARNING: This grants access to the entire filesystem."] : []),
						"",
						`Reason: ${JSON.stringify(params.reason)}`,
					].join("\n"),
					{ signal },
				);
				if (!approved) {
					return result(`Access denied for ${resolution.directory}.`, {
						granted: false,
						path: resolution.directory,
					});
				}
				if (!active || registry.generation !== requestGeneration) {
					return result("Access was not granted because the session changed while approval was pending.", { granted: false });
				}
				const grants = compactGrantRoots(registry.workspace, [...registry.grants, resolution.directory]);
				try {
					await sandbox.reconfigure([registry.workspace, ...grants]);
				} catch (error) {
					return result(`Access was not granted because Bash sandbox reconfiguration failed: ${error instanceof Error ? error.message : String(error)}`, {
						granted: false,
						path: resolution.directory,
					});
				}
				if (!active || registry.generation !== requestGeneration) {
					return result("Access was not granted because the session changed during sandbox reconfiguration.", { granted: false });
				}
				registry.grants = grants;
				updateBootstrap();
				return result(`Access granted for ${resolution.directory} until this session ends.`, {
					granted: true,
					path: resolution.directory,
				});
			});
		},
	});

	pi.on("tool_call", async (event, ctx) => {
		if (!guardEnabled || !isGuardedPathTool(event)) return;
		const release = await acquireExecution();
		if (!active || !registry.workspace || registry.generation !== generation) {
			release();
			return { block: true, reason: "Workspace Guard is not initialized." };
		}
		const requested = requestedPath(event);
		const input = usesOptionalPath(event) && !requested ? "." : requested;
		if (!input) {
			release();
			return { block: true, reason: "Workspace Guard could not validate an empty path." };
		}
		try {
			const resolved = await resolveToolPath(input, ctx.cwd, event.toolName === "read");
			if (isAllowedPath(resolved.canonicalPath, rootsFor(registry))) {
				setRequestedPath(event, resolved.canonicalPath);
				executionReleases.set(event.toolCallId, release);
				return;
			}
			release();
			return {
				block: true,
				reason: `${resolved.canonicalPath} is outside the current workspace. Call request_directory_access for its directory and explain why access is needed.`,
			};
		} catch (error) {
			release();
			return {
				block: true,
				reason: `Workspace Guard could not validate the path: ${error instanceof Error ? error.message : String(error)}`,
			};
		}
	});

	pi.on("tool_execution_end", async (event) => {
		const release = executionReleases.get(event.toolCallId);
		if (!release) return;
		executionReleases.delete(event.toolCallId);
		release();
	});

	pi.on("session_start", async (event, ctx) => {
		releaseExecutions();
		ctx.ui.setStatus("workspace-guard", undefined);
		guardEnabled = true;
		const workspace = (await resolveToolPath(".", ctx.cwd)).canonicalPath;
		if (event.reason !== "reload" || registry.workspace !== workspace) {
			registry.workspace = workspace;
			registry.grants = await loadChildGrants(workspace, environment);
		}
		generation = Symbol("workspace-guard-generation");
		registry.generation = generation;
		active = true;
		try {
			await sandbox.initialize(rootsFor(registry));
			updateBootstrap();
		} catch (error) {
			if (error instanceof SandboxDependencyUnavailableError) {
				guardEnabled = false;
				clearBootstrap();
				ctx.ui.notify(
					"Workspace Guard disabled: sandbox-runtime is not installed. Pi is running with unrestricted default tools.",
					"warning",
				);
			} else {
				updateBootstrap();
				ctx.ui.notify(`Workspace Guard Bash unavailable: ${error instanceof Error ? error.message : String(error)}`, "error");
			}
		}
	});

	pi.on("session_shutdown", async (event, ctx) => {
		active = false;
		releaseExecutions();
		ctx.ui.setStatus("workspace-guard", undefined);
		if (registry.generation !== generation) return;
		registry.generation = undefined;
		generation = undefined;
		try {
			await sandbox.dispose();
		} catch {
			ctx.ui.notify("Workspace Guard could not fully clean up its Bash sandbox.", "warning");
		}
		if (event.reason !== "reload") {
			registry.workspace = undefined;
			registry.grants = [];
			clearBootstrap();
		}
	});

	pi.registerCommand("scope", {
		description: "Show the current workspace and session directory grants",
		handler: async (_args, ctx) => {
			const lines = [
				`Workspace Guard: ${guardEnabled ? "active" : "disabled (unrestricted default tools)"}`,
				`Workspace: ${registry.workspace ?? "not initialized"}`,
				`Bash sandbox: ${sandbox.isReady ? "active" : `unavailable${sandbox.error ? ` (${sandbox.error})` : ""}`}`,
				"Session grants:",
				...(registry.grants.length > 0 ? registry.grants.map((grant) => `- ${JSON.stringify(grant)}`) : ["- none"]),
			];
			ctx.ui.notify(lines.join("\n"), sandbox.isReady ? "info" : "warning");
		},
	});

	pi.registerCommand("scope-reset", {
		description: "Revoke every external Workspace Guard grant",
		handler: async (_args, ctx) => exclusivePolicy(() => exclusiveExecution(async () => {
			const resetGeneration = generation;
			if (!registry.workspace || registry.grants.length === 0) {
				ctx.ui.notify("Workspace Guard has no external grants.", "info");
				return;
			}
			if (!ctx.hasUI || !await ctx.ui.confirm("Reset workspace access?", "Revoke every external directory grant for this session?")) return;
			if (!active || registry.generation !== resetGeneration) return;
			try {
				await sandbox.reconfigure([registry.workspace]);
			} catch (error) {
				ctx.ui.notify(`Could not revoke grants safely: ${error instanceof Error ? error.message : String(error)}`, "error");
				return;
			}
			if (!active || registry.generation !== resetGeneration) return;
			registry.grants = [];
			updateBootstrap();
			ctx.ui.notify("External directory grants revoked.", "info");
		})),
	});
}

export default function workspaceGuard(pi: ExtensionAPI) {
	if (BYPASS_WORKSPACE_GUARD) {
		delete process.env[BOOTSTRAP_EXTENSION];
		delete process.env[BOOTSTRAP_ROOTS];
		delete process.env[BOOTSTRAP_CHILD];
		return;
	}
	registerWorkspaceGuard(pi);
}

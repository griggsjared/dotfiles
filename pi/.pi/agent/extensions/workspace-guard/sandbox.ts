import { existsSync, realpathSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { SandboxRuntimeConfig } from "@anthropic-ai/sandbox-runtime";
import {
	type BashOperations,
	createLocalBashOperations,
} from "@earendil-works/pi-coding-agent";

type SandboxManagerType = (typeof import("@anthropic-ai/sandbox-runtime"))["SandboxManager"];
type SandboxRuntime = Pick<
	SandboxManagerType,
	| "checkDependenciesAsync"
	| "cleanupAfterCommand"
	| "initialize"
	| "isSandboxingEnabled"
	| "reset"
	| "wrapWithSandbox"
>;

const DEFAULT_SHELL_PATH = process.env.SHELL || "/bin/bash";

export class SandboxDependencyUnavailableError extends Error {}

const HOST_SCRATCH_PATHS = [
	"/tmp/claude",
	"/private/tmp/claude",
	join(homedir(), ".npm", "_logs"),
	join(homedir(), ".claude", "debug"),
];

function existingPaths(paths: string[]): string[] {
	const result = new Set<string>();
	for (const path of paths) {
		if (!existsSync(path)) continue;
		result.add(path);
		try {
			result.add(realpathSync(path));
		} catch {}
	}
	return [...result];
}

export function getRuntimeReadPaths(shellPath = DEFAULT_SHELL_PATH): string[] {
	const platformPaths = process.platform === "darwin"
		? ["/bin", "/sbin", "/usr", "/System", "/Library", "/dev", "/etc", "/opt/homebrew", "/private/var/select"]
		: ["/bin", "/sbin", "/usr", "/lib", "/lib64", "/etc", "/dev", "/proc"];
	return existingPaths([
		...platformPaths,
		dirname(process.execPath),
		dirname(shellPath),
	]);
}

export function buildSandboxConfig(roots: readonly string[], scratchPath: string, shellPath = DEFAULT_SHELL_PATH): SandboxRuntimeConfig {
	return {
		network: {
			allowedDomains: [],
			deniedDomains: [],
			strictAllowlist: false,
		},
		filesystem: {
			denyRead: ["/"],
			allowRead: [...new Set([...roots, scratchPath, ...getRuntimeReadPaths(shellPath)])],
			allowWrite: [...new Set([...roots, scratchPath])],
			denyWrite: HOST_SCRATCH_PATHS,
			allowGitConfig: true,
		},
	};
}

export class SandboxController {
	private readonly localOperations: BashOperations;
	private tail: Promise<void> = Promise.resolve();
	private roots: string[] = [];
	private scratchPath: string | undefined;
	private ready = false;
	private failure: string | undefined;

	private runtime: SandboxRuntime | undefined;
	private readonly shellPath: string;

	constructor(runtime?: SandboxRuntime, shellPath = DEFAULT_SHELL_PATH, localOperations?: BashOperations) {
		this.runtime = runtime;
		this.shellPath = shellPath;
		this.localOperations = localOperations ?? createLocalBashOperations({ shellPath });
	}

	get isReady(): boolean {
		return this.ready;
	}

	get error(): string | undefined {
		return this.failure;
	}

	async initialize(roots: readonly string[]): Promise<void> {
		await this.exclusive(async () => {
			if (process.platform !== "darwin" && process.platform !== "linux") {
				throw new Error(`Workspace Guard Bash sandbox is not supported on ${process.platform}`);
			}
			this.scratchPath ??= realpathSync(await mkdtemp(join(tmpdir(), "pi-workspace-guard-")));
			await this.initializeRuntime(roots);
		});
	}

	async reconfigure(roots: readonly string[]): Promise<void> {
		await this.exclusive(async () => {
			if (!this.scratchPath || !this.runtime) throw new Error("Workspace Guard Bash sandbox is not initialized");
			const runtime = this.runtime;
			const previousRoots = this.roots;
			try {
				await runtime.reset();
				await this.initializeRuntime(roots);
			} catch (error) {
				this.ready = false;
				try {
					await runtime.reset();
					await this.initializeRuntime(previousRoots);
				} catch {
					this.ready = false;
				}
				throw error;
			}
		});
	}

	operations(): BashOperations {
		return {
			exec: (command, cwd, options) => this.exclusive(async () => {
				if (!this.ready || !this.scratchPath || !this.runtime) {
					throw new Error(this.failure ?? "Workspace Guard Bash sandbox is unavailable");
				}
				const runtime = this.runtime;
				const previousTmpdir = process.env.CLAUDE_CODE_TMPDIR;
				process.env.CLAUDE_CODE_TMPDIR = this.scratchPath;
				let wrapped: string;
				try {
					wrapped = await runtime.wrapWithSandbox(command, this.shellPath, undefined, options.signal);
				} catch (error) {
					runtime.cleanupAfterCommand();
					throw error;
				} finally {
					if (previousTmpdir === undefined) delete process.env.CLAUDE_CODE_TMPDIR;
					else process.env.CLAUDE_CODE_TMPDIR = previousTmpdir;
				}
				try {
					const env: NodeJS.ProcessEnv = {
						...options.env,
						GIT_CONFIG_GLOBAL: "/dev/null",
						NODE_DISABLE_COMPILE_CACHE: "1",
					};
					delete env.NODE_COMPILE_CACHE;
					return await this.localOperations.exec(wrapped, cwd, { ...options, env });
				} finally {
					runtime.cleanupAfterCommand();
				}
			}),
		};
	}

	async dispose(): Promise<void> {
		await this.exclusive(async () => {
			this.ready = false;
			const scratchPath = this.scratchPath;
			this.scratchPath = undefined;
			this.roots = [];
			try {
				if (this.runtime) await this.runtime.reset();
			} finally {
				if (scratchPath) await rm(scratchPath, { recursive: true, force: true });
			}
		});
	}

	private async initializeRuntime(roots: readonly string[]): Promise<void> {
		if (!this.scratchPath) throw new Error("Workspace Guard scratch directory is unavailable");
		try {
			if (!this.runtime) {
				try {
					this.runtime = (await import("@anthropic-ai/sandbox-runtime")).SandboxManager;
				} catch (error) {
					throw new SandboxDependencyUnavailableError(
						`@anthropic-ai/sandbox-runtime is unavailable: ${error instanceof Error ? error.message : String(error)}`,
					);
				}
			}
			const runtime = this.runtime;
			const dependencies = await runtime.checkDependenciesAsync();
			if (dependencies.errors.length > 0) throw new Error(dependencies.errors.join("; "));
			const normalizedRoots = [...new Set(roots)];
			const config = buildSandboxConfig(normalizedRoots, this.scratchPath, this.shellPath);
			await runtime.initialize(config, async () => true, false);
			if (!runtime.isSandboxingEnabled()) throw new Error("Sandbox runtime did not enable enforcement");
			this.roots = normalizedRoots;
			this.ready = true;
			this.failure = undefined;
		} catch (error) {
			this.ready = false;
			this.failure = error instanceof Error ? error.message : String(error);
			throw error;
		}
	}

	private async exclusive<T>(operation: () => Promise<T>): Promise<T> {
		const result = this.tail.then(operation, operation);
		this.tail = result.then(() => undefined, () => undefined);
		return result;
	}
}

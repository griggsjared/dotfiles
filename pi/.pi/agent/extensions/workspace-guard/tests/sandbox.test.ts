import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { SandboxManager, type SandboxRuntimeConfig } from "@anthropic-ai/sandbox-runtime";
import type { BashOperations } from "@earendil-works/pi-coding-agent";
import { buildSandboxConfig, SandboxController } from "../sandbox.ts";

function createRuntime() {
	const configs: SandboxRuntimeConfig[] = [];
	const calls: string[] = [];
	let enabled = false;
	return {
		configs,
		calls,
		runtime: {
			async checkDependenciesAsync() { return { warnings: [] as string[], errors: [] as string[] }; },
			cleanupAfterCommand() { calls.push("cleanup"); },
			async initialize(config: SandboxRuntimeConfig) {
				configs.push(config);
				enabled = true;
			},
			isSandboxingEnabled() { return enabled; },
			async reset() {
				calls.push("reset");
				enabled = false;
			},
			async wrapWithSandbox(command: string) {
				calls.push(`wrap:${command}`);
				return `sandbox:${command}`;
			},
		},
	};
}

function createLocalOperations(commands: string[], environments: NodeJS.ProcessEnv[] = []): BashOperations {
	return {
		async exec(command, _cwd, options) {
			commands.push(command);
			environments.push(options.env ?? {});
			return { exitCode: 0 };
		},
	};
}

test("builds a deny-root policy with explicit read and write roots", () => {
	const config = buildSandboxConfig(["/workspace", "/grant"], "/scratch");
	assert.deepEqual(config.filesystem?.denyRead, ["/"]);
	assert.ok(config.filesystem?.allowRead?.includes("/workspace"));
	assert.ok(config.filesystem?.allowRead?.includes("/grant"));
	assert.ok(config.filesystem?.allowRead?.includes("/scratch"));
	assert.deepEqual(config.filesystem?.allowWrite, ["/workspace", "/grant", "/scratch"]);
	assert.ok(config.filesystem?.denyWrite.includes("/tmp/claude"));
	assert.equal(config.filesystem?.allowGitConfig, true);
	assert.equal(config.network?.strictAllowlist, false);
	assert.notEqual(config.network?.allowAllUnixSockets, true);
	assert.notEqual(config.network?.allowLocalBinding, true);
});

test("blocks execution until sandbox initialization succeeds", async () => {
	const { runtime } = createRuntime();
	const commands: string[] = [];
	const controller = new SandboxController(runtime, "/bin/bash", createLocalOperations(commands));

	await assert.rejects(
		controller.operations().exec("pwd", "/workspace", { onData() {} }),
		/ unavailable/,
	);
	assert.deepEqual(commands, []);
	await controller.dispose();
});

test("wraps execution and applies reconfigured roots", async () => {
	const { runtime, configs, calls } = createRuntime();
	const commands: string[] = [];
	const environments: NodeJS.ProcessEnv[] = [];
	const controller = new SandboxController(runtime, "/bin/bash", createLocalOperations(commands, environments));

	await controller.initialize(["/workspace"]);
	assert.equal(controller.isReady, true);
	await controller.operations().exec("pwd", "/workspace", { onData() {} });
	await controller.reconfigure(["/workspace", "/grant"]);

	assert.deepEqual(commands, ["sandbox:pwd"]);
	assert.equal(environments[0]?.GIT_CONFIG_GLOBAL, "/dev/null");
	assert.equal(environments[0]?.NODE_DISABLE_COMPILE_CACHE, "1");
	assert.equal(environments[0]?.NODE_COMPILE_CACHE, undefined);
	assert.ok(calls.includes("wrap:pwd"));
	assert.ok(calls.includes("cleanup"));
	assert.deepEqual(configs.at(-1)?.filesystem?.allowWrite?.slice(0, 2), ["/workspace", "/grant"]);
	await controller.dispose();
});

test("reports dependency failures without enabling execution", async () => {
	const { runtime } = createRuntime();
	runtime.checkDependenciesAsync = async () => ({ warnings: [], errors: ["missing sandbox"] });
	const controller = new SandboxController(runtime, "/bin/bash", createLocalOperations([]));

	await assert.rejects(controller.initialize(["/workspace"]), /missing sandbox/);
	assert.equal(controller.isReady, false);
	await assert.rejects(
		controller.operations().exec("pwd", "/workspace", { onData() {} }),
		/missing sandbox/,
	);
	await controller.dispose();
});

test("OS sandbox denies external reads and writes until the directory is granted", async (context) => {
	if (process.env.PI_WORKSPACE_GUARD_EXTENSION) {
		context.skip("nested sandbox execution is blocked by Workspace Guard");
		return;
	}
	if (process.platform !== "darwin" && process.platform !== "linux") {
		context.skip(`unsupported platform: ${process.platform}`);
		return;
	}
	const dependencies = await SandboxManager.checkDependenciesAsync();
	if (dependencies.errors.length > 0) {
		context.skip(dependencies.errors.join("; "));
		return;
	}
	const root = await mkdtemp(join(tmpdir(), "workspace-guard-integration-"));
	const workspacePath = join(root, "workspace");
	const outsidePath = join(root, "outside");
	await mkdir(workspacePath);
	await mkdir(outsidePath);
	await writeFile(join(workspacePath, "inside.txt"), "inside");
	await writeFile(join(outsidePath, "outside.txt"), "outside");
	await writeFile(join(outsidePath, "outside-script"), "#!/bin/sh\nprintf '%s' \"$1\"\n");
	await chmod(join(outsidePath, "outside-script"), 0o755);
	await symlink(outsidePath, join(workspacePath, "outside-link"));
	const workspace = await realpath(workspacePath);
	const outside = await realpath(outsidePath);
	const controller = new SandboxController();
	const run = async (command: string) => {
		let output = "";
		const execution = await controller.operations().exec(command, workspace, {
			onData(data) { output += data.toString(); },
			timeout: 20,
		});
		return { ...execution, output };
	};

	try {
		await controller.initialize([workspace]);
		assert.equal((await run("cat inside.txt")).exitCode, 0);
		const temporary = await run("node -e 'const fs = require(\"node:fs\"); const path = require(\"node:path\"); const directory = fs.mkdtempSync(path.join(process.env.TMPDIR, \"probe-\")); const file = path.join(directory, \"file\"); fs.writeFileSync(file, \"temporary\"); process.stdout.write(fs.readFileSync(file, \"utf8\") + \"\\n\" + file)' ");
		assert.equal(temporary.exitCode, 0, temporary.output);
		assert.match(temporary.output, /temporary\n.*pi-workspace-guard-/);
		assert.notEqual((await run(`cat '${outside}/outside.txt'`)).exitCode, 0);
		assert.notEqual((await run("cat outside-link/outside.txt")).exitCode, 0);
		assert.notEqual((await run(`node -e 'require("node:fs").readFileSync("${outside}/outside.txt")'`)).exitCode, 0);
		assert.notEqual((await run(`'${outside}/outside-script' escaped`)).exitCode, 0);
		assert.notEqual((await run(`printf denied > '${outside}/denied.txt'`)).exitCode, 0);
		assert.notEqual((await run("printf denied > outside-link/denied.txt")).exitCode, 0);
		await controller.reconfigure([workspace, outside]);
		assert.equal((await run(`cat '${outside}/outside.txt'`)).exitCode, 0);
		assert.equal((await run(`'${outside}/outside-script' granted`)).exitCode, 0);
		assert.equal((await run(`printf granted > '${outside}/granted.txt'`)).exitCode, 0);
	} finally {
		await controller.dispose();
		await rm(root, { recursive: true, force: true });
	}
});

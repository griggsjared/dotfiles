import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import {
	compactGrantRoots,
	isAllowedPath,
	isWithinRoot,
	normalizeInputPath,
	resolveGrantDirectory,
	resolveToolPath,
} from "../policy.ts";

async function withWorkspace(run: (paths: {
	root: string;
	workspace: string;
	outside: string;
}) => Promise<void>): Promise<void> {
	const root = await mkdtemp(join(tmpdir(), "workspace-policy-test-"));
	const workspace = join(root, "workspace");
	const outside = join(root, "outside");
	await mkdir(workspace);
	await mkdir(outside);
	try {
		await run({ root, workspace, outside });
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

test("normalizes relative and @ paths and rejects empty or NUL input", async () => {
	const cwd = "/workspace/project";
	assert.equal(normalizeInputPath("src/index.ts", cwd), resolve(cwd, "src/index.ts"));
	assert.equal(normalizeInputPath("@src/index.ts", cwd), resolve(cwd, "src/index.ts"));
	assert.equal(normalizeInputPath("~/.ssh", cwd), join(homedir(), ".ssh"));
	assert.equal(normalizeInputPath(pathToFileURL("/outside/file").href, cwd), "/outside/file");
	assert.equal(normalizeInputPath("src\u202Ffile", cwd), resolve(cwd, "src file"));
	assert.throws(() => normalizeInputPath("", cwd), /empty/);
	assert.throws(() => normalizeInputPath("@", cwd), /empty/);
	assert.throws(() => normalizeInputPath("src\0index.ts", cwd), /NUL/);
});

test("resolves relative paths, parent traversal, and prefix collisions", async () => {
	await withWorkspace(async ({ workspace, outside }) => {
		const result = await resolveToolPath("inside.txt", workspace);
		assert.equal(result.absolutePath, join(workspace, "inside.txt"));
		assert.equal(result.canonicalPath, join(await realpath(workspace), "inside.txt"));
		assert.equal(result.exists, false);
		assert.equal(isWithinRoot(workspace, join(workspace, "nested")), true);
		assert.equal(isWithinRoot(workspace, `${workspace}-sibling`), false);
		assert.equal(isWithinRoot(workspace, join(workspace, "..", "outside")), false);
		assert.equal(isAllowedPath(join(workspace, "nested"), [workspace]), true);
		assert.equal(isAllowedPath(outside, [workspace]), false);
	});
});

test("resolves existing internal and external symlinks canonically", async () => {
	await withWorkspace(async ({ workspace, outside }) => {
		const internal = join(workspace, "internal");
		const external = join(outside, "external.txt");
		await writeFile(internal, "internal");
		await writeFile(external, "external");
		const internalLink = join(workspace, "internal-link");
		const externalLink = join(workspace, "external-link");
		await symlink(internal, internalLink);
		await symlink(external, externalLink);

		const internalResult = await resolveToolPath(internalLink, workspace);
		assert.equal(internalResult.exists, true);
		assert.equal(internalResult.canonicalPath, await realpath(internal));

		const externalResult = await resolveToolPath(externalLink, workspace);
		assert.equal(externalResult.exists, true);
		assert.equal(externalResult.canonicalPath, await realpath(external));
	});
});

test("resolves dangling symlink targets before authorizing writes", async () => {
	await withWorkspace(async ({ workspace, outside }) => {
		const canonicalOutside = await realpath(outside);
		const danglingFileTarget = join(canonicalOutside, "new.txt");
		await symlink(danglingFileTarget, join(workspace, "dangling-file"));
		const file = await resolveToolPath("dangling-file", workspace);
		assert.equal(file.exists, false);
		assert.equal(file.canonicalPath, danglingFileTarget);
		assert.equal(isAllowedPath(file.canonicalPath, [workspace]), false);

		const danglingDirectoryTarget = join(canonicalOutside, "new-directory");
		await symlink(danglingDirectoryTarget, join(workspace, "dangling-directory"));
		const nested = await resolveToolPath("dangling-directory/file.txt", workspace);
		assert.equal(nested.exists, false);
		assert.equal(nested.canonicalPath, join(danglingDirectoryTarget, "file.txt"));
		assert.equal(isAllowedPath(nested.canonicalPath, [workspace]), false);
	});
});

test("matches read-tool fallback variants before authorizing a missing path", async () => {
	await withWorkspace(async ({ workspace, outside }) => {
		const outsideFile = join(outside, "file.txt");
		await writeFile(outsideFile, "outside");
		await symlink(outsideFile, join(workspace, "outside’link"));

		const normal = await resolveToolPath("outside'link", workspace);
		assert.equal(normal.exists, false);
		const readVariant = await resolveToolPath("outside'link", workspace, true);
		assert.equal(readVariant.exists, true);
		assert.equal(readVariant.canonicalPath, await realpath(outsideFile));
	});
});

test("resolves missing paths through internal and symlink ancestors", async () => {
	await withWorkspace(async ({ workspace, outside }) => {
		const internalMissing = await resolveToolPath("new/deep/file", workspace);
		assert.equal(internalMissing.exists, false);
		assert.equal(internalMissing.canonicalPath, join(await realpath(workspace), "new/deep/file"));

		const outsideDirectory = join(outside, "directory");
		await mkdir(outsideDirectory);
		const ancestor = join(workspace, "outside-link");
		await symlink(outsideDirectory, ancestor);
		const throughLink = await resolveToolPath("outside-link/new/file", workspace);
		assert.equal(throughLink.exists, false);
		assert.equal(throughLink.canonicalPath, join(await realpath(outsideDirectory), "new/file"));
	});
});

test("grants the parent directory for files and rejects nonexistent paths", async () => {
	await withWorkspace(async ({ workspace, outside }) => {
		const file = join(outside, "file.txt");
		await writeFile(file, "file");
		const grant = await resolveGrantDirectory(file, workspace, [workspace]);
		assert.equal(grant.requestedPath, file);
		assert.equal(grant.directory, await realpath(outside));
		assert.equal(grant.alreadyAllowed, false);

		await assert.rejects(
			resolveGrantDirectory(join(outside, "missing"), workspace, [workspace]),
			/does not exist/,
		);
	});
});

test("compacts duplicate, parent, child, and workspace grants", () => {
	const workspace = "/workspace/project";
	const grants = compactGrantRoots(workspace, [
		"/shared/child",
		"/shared",
		"/shared",
		"/workspace/project/cache",
		"/workspace/project-other",
	]);
	assert.deepEqual(grants, ["/shared", "/workspace/project-other"]);
});

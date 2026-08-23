import { lstat, readlink, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const UNICODE_SPACES = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g;
const NARROW_NO_BREAK_SPACE = "\u202F";

export interface ResolvedToolPath {
	requestedPath: string;
	absolutePath: string;
	canonicalPath: string;
	exists: boolean;
}

export interface GrantResolution {
	requestedPath: string;
	directory: string;
	alreadyAllowed: boolean;
}

export function normalizeInputPath(input: string, cwd: string): string {
	let value = (input.startsWith("@") ? input.slice(1) : input).replace(UNICODE_SPACES, " ");
	if (value.length === 0 || value.includes("\0")) throw new Error("Path must not be empty or contain NUL");
	if (value === "~") value = homedir();
	else if (value.startsWith("~/")) value = join(homedir(), value.slice(2));
	if (/^file:\/\//.test(value)) value = fileURLToPath(value);
	return resolve(cwd, value);
}

async function resolveMissingPath(absolutePath: string): Promise<string> {
	let candidate = absolutePath;
	const suffix: string[] = [];

	while (true) {
		try {
			const canonical = await realpath(candidate);
			return suffix.reduceRight((path, part) => resolve(path, part), canonical);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			try {
				const info = await lstat(candidate);
				if (!info.isSymbolicLink()) throw error;
				const target = resolve(dirname(candidate), await readlink(candidate));
				const targetWithSuffix = suffix.reduceRight((path, part) => resolve(path, part), target);
				return resolveMissingPath(targetWithSuffix);
			} catch (linkError) {
				if ((linkError as NodeJS.ErrnoException).code !== "ENOENT") throw linkError;
			}
			const parent = dirname(candidate);
			if (parent === candidate) throw error;
			suffix.push(basename(candidate));
			candidate = parent;
		}
	}
}

export async function resolveToolPath(input: string, cwd: string, tryReadVariants = false): Promise<ResolvedToolPath> {
	const absolutePath = normalizeInputPath(input, cwd);
	const requestedPath = input.startsWith("@") ? input.slice(1) : input;
	try {
		return {
			requestedPath,
			absolutePath,
			canonicalPath: await realpath(absolutePath),
			exists: true,
		};
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	if (tryReadVariants) {
		const nfdPath = absolutePath.normalize("NFD");
		const variants = [
			absolutePath.replace(/ (AM|PM)\./gi, `${NARROW_NO_BREAK_SPACE}$1.`),
			nfdPath,
			absolutePath.replace(/'/g, "’"),
			nfdPath.replace(/'/g, "’"),
		];
		for (const variant of variants) {
			if (variant === absolutePath) continue;
			try {
				return {
					requestedPath,
					absolutePath: variant,
					canonicalPath: await realpath(variant),
					exists: true,
				};
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			}
		}
	}
	return {
		requestedPath,
		absolutePath,
		canonicalPath: await resolveMissingPath(absolutePath),
		exists: false,
	};
}

export async function resolveGrantDirectory(
	input: string,
	cwd: string,
	roots: readonly string[],
): Promise<GrantResolution> {
	const resolved = await resolveToolPath(input, cwd);
	if (!resolved.exists) throw new Error(`Path does not exist: ${resolved.absolutePath}`);
	const info = await stat(resolved.canonicalPath);
	const directory = info.isDirectory() ? resolved.canonicalPath : dirname(resolved.canonicalPath);
	return {
		requestedPath: resolved.requestedPath,
		directory,
		alreadyAllowed: isAllowedPath(directory, roots),
	};
}

export function isWithinRoot(root: string, target: string): boolean {
	const path = relative(root, target);
	return path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

export function isAllowedPath(target: string, roots: readonly string[]): boolean {
	return roots.some((root) => isWithinRoot(root, target));
}

export function compactGrantRoots(workspace: string, grants: readonly string[]): string[] {
	const normalizedWorkspace = resolve(workspace);
	const candidates = [...new Set(grants.map((grant) => resolve(grant)))]
		.filter((grant) => !isWithinRoot(normalizedWorkspace, grant))
		.sort((left, right) => left.length - right.length);
	const compacted: string[] = [];
	for (const grant of candidates) {
		if (!compacted.some((root) => isWithinRoot(root, grant))) compacted.push(grant);
	}
	return compacted;
}

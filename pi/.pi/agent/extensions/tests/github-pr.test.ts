import assert from "node:assert/strict";
import { readFile, rm, stat } from "node:fs/promises";
import { test, type TestContext } from "node:test";
import type { ExtensionAPI, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import githubPr from "../github-pr.ts";

const host = "github.com";
const repo = "team/project";
const repoArg = `${host}/${repo}`;
const repoUrl = `https://${repoArg}`;
const cwd = "/offline/worktree";
const pullRequest = { number: 42, title: "Read-only inspection", body: "PR body", url: `${repoUrl}/pull/42`, baseRefName: "main", headRefName: "feature/local" };
type Tool = Parameters<ExtensionAPI["registerTool"]>[0];
type Command = { command: string; args: string[] };
type Result = { code: number; stdout: string; stderr: string; killed: boolean };
type Failure = "gh" | "remote" | "auth" | "repo";
const ok = (value: unknown): Result => ({ code: 0, stdout: typeof value === "string" ? value : JSON.stringify(value), stderr: "", killed: false });
const failed: Result = { code: 1, stdout: "", stderr: "offline unavailable", killed: false };
const flag = (args: string[], name: string) => args[args.indexOf(name) + 1];
const field = (args: string[], name: string) => args.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);
const threadPage = (nodes: unknown[]) => [{ data: { repository: { pullRequest: { reviewThreads: { nodes, pageInfo: { hasNextPage: false, endCursor: null } } } } } }];

function harness(t: TestContext) {
	const originalEnv = process.env;
	process.env = { ...originalEnv, GH_REPO: "unrelated.example.test/other/repository", GH_HOST: "unrelated.example.test" };
	t.after(() => { process.env = originalEnv; });
	t.mock.method(globalThis, "fetch", async () => assert.fail("unexpected network request"));
	const calls: Command[] = [];
	const tools: Tool[] = [];
	const handlers = new Map<string, (event: unknown, ctx: ExtensionToolContext) => Promise<unknown>>();
	const state = {
		failure: undefined as Failure | undefined,
		remote: `origin\tgit@${host}:${repo}.git (fetch)\norigin\tgit@${host}:${repo}.git (push)\n`,
		pr: pullRequest,
		override: undefined as ((call: Command) => Result | undefined) | undefined,
	};
	const api: Pick<ExtensionAPI, "registerTool" | "on" | "setActiveTools" | "exec"> = {
		registerTool(definition) { tools.push(definition as Tool); },
		on(event, handler) {
			handlers.set(event, handler as (event: unknown, ctx: ExtensionToolContext) => Promise<unknown>);
			return () => { handlers.delete(event); };
		},
		setActiveTools() { assert.fail("availability must not overwrite the user's active tool selection"); },
		async exec(command, args, options) {
			assert.equal(options?.cwd, cwd);
			const call = { command, args };
			calls.push(call);
			const overridden = state.override?.(call);
			if (overridden) return overridden;
			if (command === "which") {
				assert.deepEqual(args, ["gh"]);
				return state.failure === "gh" ? failed : ok("/offline/bin/gh");
			}
			if (command === "git" && args[0] === "remote") return state.failure === "remote" ? ok("") : ok(state.remote);
			if (command === "git" && args[0] === "branch") return ok("feature/local\n");
			assert.equal(command, "gh", "only mocked git/gh commands are allowed");
			if (args[0] === "auth") return state.failure === "auth" ? failed : ok("");
			if (args[0] === "repo") return state.failure === "repo" ? failed : ok({ nameWithOwner: repo, url: repoUrl });
			if (args[0] === "pr" && args[1] === "view") return ok(state.pr);
			if (args[0] === "pr" && args[1] === "checks") return ok([]);
			if (args[0] === "api" && args.includes("graphql")) return ok(threadPage([]));
			if (args[0] === "api" && args.some((arg) => arg.startsWith(`repos/${repo}/`))) return ok([]);
			assert.fail(`unexpected command: ${command} ${args.join(" ")}`);
		},
	};
	githubPr(api as ExtensionAPI);
	return {
		state, calls, tools,
		get tool() { return tools.at(-1)!; },
		async lifecycle(event = "session_start") {
			assert.ok(handlers.has(event), `${event} revalidates availability`);
			await handlers.get(event)!({}, { cwd } as ExtensionToolContext);
		},
		execute(params: Record<string, unknown> = {}) {
			return tools.at(-1)!.execute("offline", params, undefined, undefined, { cwd } as ExtensionToolContext);
		},
	};
}

function payload(result: Awaited<ReturnType<ReturnType<typeof harness>["execute"]>>) {
	assert.equal(result.content[0].type, "text");
	return JSON.parse(result.content[0].type === "text" ? result.content[0].text : "") as Record<string, any>;
}

function exposure(tool: Tool) {
	return (tool as Tool & { exposure?: string }).exposure;
}

for (const failure of ["gh", "remote"] as const) {
	test(`github_pr stays hidden when ${failure} capability is unavailable`, async (t) => {
		const h = harness(t);
		assert.equal(exposure(h.tool), "hidden");
		h.state.failure = failure;
		await h.lifecycle();
		assert.equal(exposure(h.tool), "hidden");
		await h.lifecycle("before_agent_start");
		assert.equal(exposure(h.tool), "hidden");
		assert.ok(!h.calls.some(({ args }) => args[0] === "pr" || args[0] === "api"));
	});
}

test("lifecycle availability uses only PATH and local remotes, hiding the tool when the remote disappears", async (t) => {
	const h = harness(t);
	h.state.failure = "auth";
	await h.lifecycle();
	assert.equal(exposure(h.tool), "direct");
	await h.lifecycle("before_agent_start");
	assert.equal(exposure(h.tool), "direct");
	assert.ok(h.calls.every(({ command, args }) => command === "which" || (command === "git" && args[0] === "remote")));
	h.state.failure = "remote";
	await h.lifecycle("before_agent_start");
	assert.equal(exposure(h.tool), "hidden");
	const result = await h.execute({ action: "view" });
	assert.equal((result.details as { available: boolean }).available, false);
	assert.ok(!h.calls.some(({ args }) => args[0] === "pr"));
});

for (const failure of ["auth", "repo"] as const) {
	test(`tool execution reports ${failure} failure without hiding a locally available tool`, async (t) => {
		const h = harness(t);
		h.state.failure = failure;
		await h.lifecycle();
		const result = payload(await h.execute({ action: "view" }));
		assert.equal(result.available, false);
		assert.match(result.reason, failure === "auth" ? /not authenticated/ : /cannot access/);
		assert.equal(exposure(h.tool), "direct");
		assert.ok(!h.calls.some(({ args }) => args[0] === "pr" || args[0] === "api"));
	});
}

test("an HTTPS GitHub remote exposes the local repository", async (t) => {
	const h = harness(t);
	h.state.remote = `origin\t${repoUrl}.git (fetch)\n`;
	await h.lifecycle();
	assert.equal(exposure(h.tool), "direct");
	assert.equal(payload(await h.execute({ action: "status" })).repo, repo);
});

test("a GitHub SSH upstream remains available when origin is not on GitHub", async (t) => {
	const h = harness(t);
	h.state.remote = `origin\thttps://gitlab.example.test/team/project.git (fetch)\nupstream\tssh://git@${host}/${repo}.git (fetch)\n`;
	await h.lifecycle();
	assert.equal(exposure(h.tool), "direct");
	const status = payload(await h.execute({ action: "status" }));
	assert.equal(status.repo, repo);
	assert.equal(status.hostname, host);
});

test("non-github.com remotes do not expose the tool or trigger GitHub requests", async (t) => {
	const h = harness(t);
	h.state.remote = "origin\thttps://gitlab.example.test/team/project.git (fetch)\n";
	await h.lifecycle();
	await h.lifecycle("before_agent_start");
	assert.equal(exposure(h.tool), "hidden");
	assert.equal(payload(await h.execute({ action: "status" })).available, false);
	assert.ok(!h.calls.some(({ command }) => command === "gh"));
});

test("GH_REPO cannot provide capability outside a local Git repository", async (t) => {
	const h = harness(t);
	h.state.override = ({ command }) => command === "git" ? failed : undefined;
	await h.lifecycle();
	assert.equal(exposure(h.tool), "hidden");
	assert.equal(((await h.execute({ action: "status" })).details as { available: boolean }).available, false);
	assert.ok(!h.calls.some(({ args }) => args[0] === "repo" || args[0] === "pr" || args[0] === "api"));
});

test("all actions use explicit local repository and host, with current branch isolated from GH_REPO", async (t) => {
	const h = harness(t);
	await h.lifecycle();
	assert.equal(exposure(h.tool), "direct");
	const status = payload(await h.execute({ action: "status" }));
	assert.equal(status.available, true);
	assert.equal(status.repo, repo);
	assert.equal(status.hostname, host);
	const view = payload(await h.execute({ action: "view" }));
	assert.equal(view.repository, repo);
	assert.equal(view.number, 42);
	await h.execute({ action: "checks" });
	await h.execute();
	assert.ok(h.calls.some(({ command, args }) => command === "git" && args.includes("--show-current")));
	for (const { command, args } of h.calls) {
		if (command === "git") {
			assert.ok(args[0] === "remote" || args[0] === "branch");
			continue;
		}
		if (command === "which") continue;
		if (args[0] === "auth") {
			assert.equal(args[1], "status");
			assert.equal(flag(args, "--hostname"), host);
		} else if (args[0] === "repo") {
			assert.equal(args[1], "view");
			assert.ok(args.includes(repoArg));
		} else if (args[0] === "pr") {
			assert.ok(["view", "checks"].includes(args[1]), "PR operations are read-only");
			assert.equal(flag(args, "--repo"), repoArg);
			assert.ok(args.includes(args[1] === "view" ? "feature/local" : "42"));
		} else {
			assert.equal(args[0], "api");
			assert.equal(flag(args, "--hostname"), host);
			if (args.includes("graphql")) {
				assert.match(field(args, "query")!, /^\s*query\b/);
				assert.equal(field(args, "owner"), "team");
				assert.equal(field(args, "repo"), "project");
			} else {
				assert.ok(args.some((arg) => [`repos/${repo}/issues/42/comments`, `repos/${repo}/pulls/42/reviews`].includes(arg)));
				assert.ok(!args.includes("--method") || flag(args, "--method") === "GET");
			}
		}
	}
	assert.equal(h.tool.annotations?.readOnlyHint, true);
});

for (const mismatch of ["request", "response"] as const) {
	test(`cross-repository PR ${mismatch} is rejected before discussion requests`, async (t) => {
		const h = harness(t);
		await h.lifecycle();
		if (mismatch === "response") h.state.pr = { ...pullRequest, url: `https://${host}/other/repository/pull/42` };
		await assert.rejects(h.execute({ action: "feedback", pr: mismatch === "request" ? `https://${host}/other/repository/pull/42` : "42" }), /repository|match|local|different/i);
		assert.ok(!h.calls.some(({ args }) => args[0] === "api"));
	});
}

test("a killed command with exit code zero cannot expose the tool or return successful PR data", async (t) => {
	const h = harness(t);
	h.state.override = ({ command }) => command === "which" ? { ...ok("/offline/bin/gh"), killed: true } : undefined;
	await h.lifecycle();
	assert.equal(exposure(h.tool), "hidden");
	h.state.override = undefined;
	await h.lifecycle();
	h.state.override = ({ args }) => args[0] === "pr" ? { ...ok(pullRequest), killed: true } : undefined;
	await assert.rejects(h.execute({ action: "view", pr: "42" }), /killed|cancel|timeout|timed out|load/i);
});

test("feedback combines conversation comments and reviews across REST pages", async (t) => {
	const h = harness(t);
	h.state.override = ({ args }) => {
		if (args.some((arg) => arg.endsWith("/comments"))) return ok('[{"id":1,"author":"alice","body":"first comment"}]\n[{"id":2,"author":"bob","body":"second comment"}]');
		if (args.some((arg) => arg.endsWith("/reviews"))) return ok('[{"id":3,"author":"alice","body":"review feedback","state":"CHANGES_REQUESTED"}]\n[]');
		return undefined;
	};
	const result = payload(await h.execute({ pr: "42" }));
	assert.equal(result.summary.conversationComments, 2);
	assert.equal(result.summary.reviews, 1);
	assert.deepEqual(result.conversationComments.map(({ author, body }: { author: string; body: string }) => ({ author, body })), [{ author: "alice", body: "first comment" }, { author: "bob", body: "second comment" }]);
	assert.equal(result.reviews[0].body, "review feedback");
	assert.equal(result.reviews[0].state, "CHANGES_REQUESTED");
	assert.equal(result.errors, undefined);
});

test("killed discussion requests report errors instead of returning partial pages as complete", async (t) => {
	const h = harness(t);
	h.state.override = ({ args }) => args.some((arg) => arg.endsWith("/comments")) ? { ...ok('[{"id":1,"body":"partial comment"}]'), killed: true } : undefined;
	const result = payload(await h.execute({ pr: "42" }));
	assert.deepEqual(result.conversationComments, []);
	assert.equal(result.errors.length, 1);
	assert.match(result.errors[0], /Conversation comments could not be loaded/);
});

test("malformed REST pagination is reported rather than silently discarding pages", async (t) => {
	const h = harness(t);
	h.state.override = ({ args }) => {
		if (args.some((arg) => arg.endsWith("/comments"))) return ok('[{"id":1,"body":"first page"}]\nnot-json');
		if (args.some((arg) => arg.endsWith("/reviews"))) return ok('{"unexpected":"object instead of array"}');
		return undefined;
	};
	const result = payload(await h.execute({ pr: "42" }));
	assert.equal(result.errors.length, 2);
	assert.ok(result.errors.some((error: string) => /conversation.*invalid|invalid.*conversation/i.test(error)));
	assert.ok(result.errors.some((error: string) => /review.*invalid|invalid.*review/i.test(error)));
});

test("feedback fetches replies beyond 100 and preserves original and ranged diff locations", async (t) => {
	const h = harness(t);
	const comments = Array.from({ length: 101 }, (_, index) => ({ id: `comment-${index}`, body: `reply ${index}`, author: { login: "reviewer" }, createdAt: "2026-01-01T00:00:00Z", url: `${repoUrl}/pull/42#discussion-${index}` }));
	const thread = {
		id: "thread-1", isResolved: false, isOutdated: true, path: "src/example.ts",
		line: null, startLine: null, originalLine: 24, originalStartLine: 20, diffSide: "LEFT", startDiffSide: "LEFT",
		comments: { nodes: comments.slice(0, 100), commentsPageInfo: { hasNextPage: true, endCursor: "reply-page-2" } },
	};
	h.state.override = ({ args }) => {
		if (!args.includes("graphql")) return undefined;
		if (/node\s*\(/.test(field(args, "query")!)) {
			assert.equal(field(args, "id"), thread.id);
			assert.equal(field(args, "endCursor"), "reply-page-2");
			assert.equal(flag(args, "--hostname"), host);
			return ok({ data: { node: { comments: { nodes: comments.slice(100), pageInfo: { hasNextPage: false, endCursor: null } } } } });
		}
		for (const name of ["originalLine", "originalStartLine", "startLine", "diffSide", "startDiffSide"]) assert.ok(field(args, "query")!.includes(name));
		assert.match(field(args, "query")!, /commentsPageInfo:\s*pageInfo/, "gh pagination must use the outer thread cursor, not a reply cursor");
		return ok([...threadPage([thread]), ...threadPage([{ ...thread, id: "resolved-thread", isResolved: true, line: 30, startLine: 28, comments: { nodes: [], commentsPageInfo: { hasNextPage: false, endCursor: null } } }])]);
	};
	const result = payload(await h.execute({ pr: "42" }));
	assert.equal(result.summary.inlineThreads, 2);
	assert.equal(result.summary.resolvedThreads, 1);
	assert.equal(result.inlineThreads.length, 1);
	const returned = result.inlineThreads[0];
	assert.equal(returned.comments.length, 101);
	assert.equal(returned.comments[100].body, "reply 100");
	assert.equal(returned.comments[100].author, "reviewer");
	assert.equal(returned.commentsTruncated, false);
	assert.equal(returned.line, null, "outdated original positions must not become current positions");
	assert.equal(returned.startLine, null);
	assert.equal(returned.originalLine, 24);
	assert.equal(returned.originalStartLine, 20);
	assert.equal(returned.diffSide, "LEFT");
	assert.equal(returned.startDiffSide, "LEFT");
	const included = payload(await h.execute({ pr: "42", includeResolved: true }));
	assert.equal(included.inlineThreads.length, 2);
	assert.equal(included.inlineThreads[1].line, 30);
	assert.equal(included.inlineThreads[1].startLine, 28);
});

for (const [code, buckets, pending] of [[0, ["pending", "pass"], true], [8, ["pending"], true], [1, ["fail", "cancel"], false]] as const) {
	test(`checks derive pending from buckets for exit ${code}`, async (t) => {
		const h = harness(t);
		const checks = buckets.map((bucket) => ({ name: `check-${bucket}`, bucket, state: bucket === "pending" ? "IN_PROGRESS" : "COMPLETED" }));
		h.state.override = ({ args }) => args[0] === "pr" && args[1] === "checks" ? { ...ok(checks), code } : undefined;
		const result = await h.execute({ action: "checks", pr: "feature/explicit" });
		assert.equal(payload(result).pending, pending);
		assert.equal((result.details as { pending: boolean }).pending, pending);
		const call = h.calls.find(({ args }) => args[0] === "pr" && args[1] === "checks")!;
		assert.ok(call.args.includes("42"), "checks use the validated PR number, not the original branch selector");
		assert.equal(flag(call.args, "--repo"), repoArg);
	});
}

for (const [code, buckets] of [[1, ["pass"]], [8, ["pass"]]] as const) {
	test(`checks reject inconsistent exit ${code} rather than reporting successful data`, async (t) => {
		const h = harness(t);
		h.state.override = ({ args }) => args[0] === "pr" && args[1] === "checks" ? { ...ok(buckets.map((bucket) => ({ name: "check", bucket }))), code } : undefined;
		await assert.rejects(h.execute({ action: "checks", pr: "42" }), /check|pending|invalid/i);
	});
}

test("truncated output spills full content to a private file", async (t) => {
	const h = harness(t);
	const body = "private review body\n".repeat(4000);
	h.state.pr = { ...pullRequest, body };
	const result = await h.execute({ action: "view", pr: "42" });
	const details = result.details as { truncated: boolean; fullOutputPath: string };
	assert.equal(details.truncated, true);
	const path = details.fullOutputPath;
	assert.equal(typeof path, "string");
	t.after(async () => { await rm(path, { force: true }); });
	assert.equal((await stat(path)).mode & 0o777, 0o600);
	const full = await readFile(path, "utf8");
	assert.equal(JSON.parse(full).body, body);
	assert.equal(JSON.parse(full).number, 42);
	assert.ok(full.length > (result.content[0].type === "text" ? result.content[0].text.length : 0));
	assert.ok(result.content[0].type === "text" && result.content[0].text.includes(path));
});

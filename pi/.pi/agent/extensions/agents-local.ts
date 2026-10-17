import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

async function readLocalFiles(cwd: string): Promise<Array<{ path: string; content: string }>> {
	const files: Array<{ path: string; content: string }> = [];

	for (let dir = cwd; ; dir = dirname(dir)) {
		const path = join(dir, "AGENTS.local.md");
		try {
			files.unshift({ path, content: await readFile(path, "utf8") });
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
		if (dir === dirname(dir)) break;
	}

	return files;
}

export default function agentsLocal(pi: ExtensionAPI) {
	let sessionFiles: Array<{ path: string; content: string }> = [];

	pi.on("session_start", async (_event, ctx) => {
		sessionFiles = [];
		sessionFiles = await readLocalFiles(ctx.cwd);
		pi.events.emit("context:files", { source: "agents-local", paths: sessionFiles.map(({ path }) => path) });
	});

	pi.on("before_agent_start", (event) => {
		event.systemPromptOptions.contextFiles.push(...sessionFiles);
	});
}

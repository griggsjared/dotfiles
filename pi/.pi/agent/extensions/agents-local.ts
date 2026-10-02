import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function agentsLocal(pi: ExtensionAPI) {
	pi.on("before_agent_start", async (event, ctx) => {
		const files: Array<{ path: string; content: string }> = [];

		for (let dir = ctx.cwd; ; dir = dirname(dir)) {
			const path = join(dir, "AGENTS.local.md");
			try {
				files.unshift({ path, content: await readFile(path, "utf8") });
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			}
			if (dir === dirname(dir)) break;
		}

		event.systemPromptOptions.contextFiles.push(...files);
	});
}

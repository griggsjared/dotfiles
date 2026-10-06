import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getCurrentSystemMessage, type SystemMessage } from "@earendil-works/pi-ai";
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
	pi.on("session_start", async (_event, ctx) => {
		const files = await readLocalFiles(ctx.cwd);
		pi.events.emit("context:files", { source: "agents-local", paths: files.map(({ path }) => path) });
	});

	pi.on("before_agent_start", async (event, ctx) => {
		const files = await readLocalFiles(ctx.cwd);
		pi.events.emit("context:files", { source: "agents-local", paths: files.map(({ path }) => path) });
		event.systemPromptOptions.contextFiles.push(...files);
	});

	// Extension-triggered turns can bypass before_agent_start.
	pi.on("context_with_system", async (event, ctx) => {
		const files = await readLocalFiles(ctx.cwd);
		pi.events.emit("context:files", { source: "agents-local", paths: files.map(({ path }) => path) });

		const system = getCurrentSystemMessage(event.messages);
		const projectContext = system?.sections?.project_context ?? "";
		const instructions = files
			.filter(({ path }) => !projectContext.includes(`<project_instructions path="${path}">`))
			.map(({ path, content }) => `<project_instructions path="${path}">\n${content}\n</project_instructions>`)
			.join("\n\n");
		const section = instructions ? `<agents_local>\n${instructions}\n</agents_local>` : null;
		if ((system?.sections?.agents_local ?? null) === section) return;

		const message: SystemMessage = {
			role: "system",
			content: "",
			sections: { agents_local: section },
			timestamp: Date.now(),
		};
		return {
			messages: event.messages[0]?.role === "system" ? [...event.messages, message] : [message, ...event.messages],
		};
	});
}

/**
 * Installer-style Pi startup header.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { loadProjectContextFiles, VERSION, type BeforeAgentStartEvent, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

export default function (pi: ExtensionAPI) {
	let contextPaths: string[] = [];
	let promptOptions: BeforeAgentStartEvent["systemPromptOptions"] | undefined;
	let requestRender: (() => void) | undefined;
	const reportedContextPaths = new Map<string, string[]>();

	pi.events.on("context:files", (data) => {
		const { source, paths } = data as { source: string; paths: string[] };
		reportedContextPaths.set(source, paths);
		requestRender?.();
	});

	pi.on("session_start", (_event, ctx) => {
		contextPaths = [];
		promptOptions = undefined;
		requestRender = undefined;
		if (ctx.mode !== "tui") return;

		const agentDir = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
		contextPaths = loadProjectContextFiles({ cwd: ctx.cwd, agentDir }).map(({ path }) => path);
		ctx.ui.setHeader((tui, theme) => {
			requestRender = () => tui.requestRender();
			return {
				invalidate() {},
				render(width: number): string[] {
					const logo = [
						`  ${theme.fg("accent", "██████████")}`,
						`  ${theme.fg("error", "██")}      ${theme.fg("success", "██")}`,
						`  ${theme.fg("error", "██")}      ${theme.fg("success", "██")}`,
						`  ${theme.fg("error", "██")}      ${theme.fg("success", "██")}`,
					];
					const title = `${theme.bold("  π")}${theme.fg("dim", ` v${VERSION}`)}`;
					const paths = [...new Set([...contextPaths, ...Array.from(reportedContextPaths.values()).flat()])];
					const agents = theme.fg(
						"dim",
						`  Context: ${paths
							.map((path) => path.startsWith(`${homedir()}/`) ? `~/${path.slice(homedir().length + 1)}` : path)
							.join(" · ") || "none"}`,
					);

					return [
						"",
						...logo.map((line) => truncateToWidth(line, width, "")),
						"",
						truncateToWidth(title, width),
						...wrapTextWithAnsi(agents, Math.max(1, width)).map((line) => truncateToWidth(line, width, "")),
						"",
					];
				},
			};
		});
	});

	pi.on("before_agent_start", (event, ctx) => {
		if (ctx.mode !== "tui") return;
		promptOptions = event.systemPromptOptions;
	});

	pi.on("agent_start", () => {
		if (!promptOptions) return;
		contextPaths = promptOptions.contextFiles.map(({ path }) => path);
		promptOptions = undefined;
		requestRender?.();
	});
}

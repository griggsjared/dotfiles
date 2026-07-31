/**
 * Installer-style Pi startup header.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { loadProjectContextFiles, VERSION, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";

export default function (pi: ExtensionAPI) {
	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;

		ctx.ui.setHeader((_tui, theme) => ({
			invalidate() {},
			render(width: number): string[] {
				const logo = [
					`  ${theme.fg("accent", "██████")}`,
					`  ${theme.fg("error", "██")}  ${theme.fg("accent", "██")}`,
					`  ${theme.fg("error", "████")}  ${theme.fg("success", "██")}`,
					`  ${theme.fg("error", "██")}    ${theme.fg("success", "██")}`,
				];
				const title = `${theme.bold("  Pi")}${theme.fg("dim", ` v${VERSION}`)}`;
				const agentDir = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
				const contextFiles = loadProjectContextFiles({ cwd: ctx.cwd, agentDir });
				const agents = theme.fg(
					"dim",
					`  Context: ${contextFiles
						.map(({ path }) => path.startsWith(`${homedir()}/`) ? `~/${path.slice(homedir().length + 1)}` : path)
						.join(" · ") || "none"}`,
				);

				return [
					"",
					...logo.map((line) => truncateToWidth(line, width, "")),
					"",
					truncateToWidth(title, width),
					truncateToWidth(agents, width),
					"",
				];
			},
		}));
	});
}

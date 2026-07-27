/**
 * Installer-style Pi startup header.
 */
import { VERSION, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
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
				const tagline = theme.fg("muted", "  There are many agent harnesses but this one is yours");

				return [
					"",
					...logo.map((line) => truncateToWidth(line, width, "")),
					"",
					truncateToWidth(title, width),
					truncateToWidth(tagline, width),
					"",
				];
			},
		}));
	});
}

/**
 * opencode-style modes for pi: build, plan, ask.
 *
 * - /mode [build|plan|ask] switches mode (no arg opens a picker)
 * - alt+m cycles modes, like opencode's Tab
 * - plan/ask are read-only: edit/write tools are disabled and bash is
 *   restricted to an allowlist of read-only commands
 * - mode instructions are injected before each agent run
 * - current mode survives session resume
 */

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key } from "@earendil-works/pi-tui";

const MODES = ["build", "plan", "ask"] as const;
type Mode = (typeof MODES)[number];

const WRITE_TOOLS = new Set(["edit", "write"]);
const READ_TOOLS = ["read", "grep", "find", "ls"];

const MODE_CONTEXT_TYPE = "mode-context";
const MODE_TAG = /\[MODE:(\w+)\]/;

const MODE_PROMPTS: Record<Exclude<Mode, "build">, string> = {
	plan: `[MODE:plan]
You are in plan mode - read-only exploration and planning.

Restrictions:
- edit and write tools are disabled
- bash is restricted to an allowlist of read-only commands
- do not modify files, install packages, or change the system

Analyze the codebase and propose a detailed plan. Do not implement it.`,
	ask: `[MODE:ask]
You are in ask mode - read-only Q&A.

Restrictions:
- edit and write tools are disabled
- bash is restricted to an allowlist of read-only commands

Answer the user's questions directly and concisely. Do not modify files
and do not produce implementation plans unless asked.`,
};

// Destructive commands blocked in plan/ask mode
const DESTRUCTIVE_PATTERNS = [
	/\brm\b/i,
	/\brmdir\b/i,
	/\bmv\b/i,
	/\bcp\b/i,
	/\bmkdir\b/i,
	/\btouch\b/i,
	/\bchmod\b/i,
	/\bchown\b/i,
	/\bchgrp\b/i,
	/\bln\b/i,
	/\btee\b/i,
	/\btruncate\b/i,
	/\bdd\b/i,
	/\bshred\b/i,
	/(^|[^<])>(?!>)/,
	/>>/,
	/\bnpm\s+(install|uninstall|update|ci|link|publish)/i,
	/\byarn\s+(add|remove|install|publish)/i,
	/\bpnpm\s+(add|remove|install|publish)/i,
	/\bpip\s+(install|uninstall)/i,
	/\bapt(-get)?\s+(install|remove|purge|update|upgrade)/i,
	/\bbrew\s+(install|uninstall|upgrade)/i,
	/\bgit\s+(add|commit|push|pull|merge|rebase|reset|checkout|branch\s+-[dD]|stash|cherry-pick|revert|tag|init|clone)/i,
	/\bsudo\b/i,
	/\bsu\b/i,
	/\bkill\b/i,
	/\bpkill\b/i,
	/\bkillall\b/i,
	/\breboot\b/i,
	/\bshutdown\b/i,
	/\bsystemctl\s+(start|stop|restart|enable|disable)/i,
	/\bservice\s+\S+\s+(start|stop|restart)/i,
	/\b(vim?|nano|emacs|code|subl)\b/i,
];

// Safe read-only commands allowed in plan/ask mode
const SAFE_PATTERNS = [
	/^\s*cat\b/,
	/^\s*head\b/,
	/^\s*tail\b/,
	/^\s*less\b/,
	/^\s*more\b/,
	/^\s*grep\b/,
	/^\s*find\b/,
	/^\s*ls\b/,
	/^\s*pwd\b/,
	/^\s*echo\b/,
	/^\s*printf\b/,
	/^\s*wc\b/,
	/^\s*sort\b/,
	/^\s*uniq\b/,
	/^\s*diff\b/,
	/^\s*file\b/,
	/^\s*stat\b/,
	/^\s*du\b/,
	/^\s*df\b/,
	/^\s*tree\b/,
	/^\s*which\b/,
	/^\s*whereis\b/,
	/^\s*type\b/,
	/^\s*env\b/,
	/^\s*printenv\b/,
	/^\s*uname\b/,
	/^\s*whoami\b/,
	/^\s*id\b/,
	/^\s*date\b/,
	/^\s*cal\b/,
	/^\s*uptime\b/,
	/^\s*ps\b/,
	/^\s*top\b/,
	/^\s*htop\b/,
	/^\s*free\b/,
	/^\s*git\s+(status|log|diff|show|branch|remote|config\s+--get)/i,
	/^\s*git\s+ls-/i,
	/^\s*npm\s+(list|ls|view|info|search|outdated|audit)/i,
	/^\s*yarn\s+(list|info|why|audit)/i,
	/^\s*node\s+--version/i,
	/^\s*python\s+--version/i,
	/^\s*curl\s/i,
	/^\s*wget\s+-O\s*-/i,
	/^\s*jq\b/,
	/^\s*sed\s+-n/i,
	/^\s*awk\b/,
	/^\s*rg\b/,
	/^\s*fd\b/,
	/^\s*bat\b/,
	/^\s*eza\b/,
];

function isSafeCommand(command: string): boolean {
	const isDestructive = DESTRUCTIVE_PATTERNS.some((p) => p.test(command));
	const isSafe = SAFE_PATTERNS.some((p) => p.test(command));
	return !isDestructive && isSafe;
}

function isMode(value: string): value is Mode {
	return (MODES as readonly string[]).includes(value);
}

function isModeContextMessage(message: unknown): boolean {
	return (message as { customType?: string }).customType === MODE_CONTEXT_TYPE;
}

function modeTagMatches(message: unknown, expected: Mode): boolean {
	const content = typeof (message as { content?: unknown }).content === "string"
		? ((message as { content: string }).content)
		: "";
	const match = content.match(MODE_TAG);
	return match?.[1] === expected;
}

function restrictedTools(active: string[]): string[] {
	return [...new Set([...active.filter((t) => !WRITE_TOOLS.has(t)), ...READ_TOOLS])];
}

export default function (pi: ExtensionAPI): void {
	let mode: Mode = "build";
	let toolsBeforeRestricted: string[] | undefined;

	function applyMode(ctx: ExtensionContext): void {
		if (mode === "build") {
			if (toolsBeforeRestricted) {
				pi.setActiveTools(toolsBeforeRestricted);
				toolsBeforeRestricted = undefined;
			}
			ctx.ui.setStatus("modes", ctx.ui.theme.fg("error", "build"));
			return;
		}

		if (!toolsBeforeRestricted) {
			toolsBeforeRestricted = pi.getActiveTools();
		}
		pi.setActiveTools(restrictedTools(toolsBeforeRestricted));
		const color = mode === "plan" ? "borderAccent" : "accent";
		ctx.ui.setStatus("modes", ctx.ui.theme.fg(color, mode));
	}

	function setMode(next: Mode, ctx: ExtensionContext, notify = true): void {
		if (next === mode) return;
		mode = next;
		applyMode(ctx);
		if (notify) {
			ctx.ui.notify(`Mode: ${mode}`, "info");
		}
		pi.appendEntry("modes-state", { mode });
	}

	function cycleMode(ctx: ExtensionContext): void {
		const idx = MODES.indexOf(mode);
		setMode(MODES[(idx + 1) % MODES.length], ctx);
	}

	pi.registerCommand("mode", {
		description: "Switch mode: build (default), plan (read-only), ask (read-only Q&A)",
		getArgumentCompletions: (prefix: string) => {
			const items = MODES.filter((m) => m.startsWith(prefix)).map((m) => ({ value: m, label: m }));
			return items.length > 0 ? items : null;
		},
		handler: async (args, ctx) => {
			const want = args.trim().toLowerCase();
			if (isMode(want)) {
				setMode(want, ctx);
				return;
			}
			if (!ctx.hasUI) {
				ctx.ui.notify("Usage: /mode build|plan|ask", "error");
				return;
			}
			const choice = await ctx.ui.select("Switch mode", [...MODES]);
			if (choice && isMode(choice)) {
				setMode(choice, ctx);
			}
		},
	});

	pi.registerShortcut(Key.tab, {
		description: "Cycle modes (build -> plan -> ask)",
		handler: async (ctx) => cycleMode(ctx),
	});

	pi.registerShortcut(Key.alt("m"), {
		description: "Cycle modes (build -> plan -> ask)",
		handler: async (ctx) => cycleMode(ctx),
	});

	// Block non-allowlisted bash commands in plan/ask mode
	pi.on("tool_call", async (event) => {
		if (mode === "build" || event.toolName !== "bash") return;

		const command = event.input.command as string;
		if (!isSafeCommand(command)) {
			return {
				block: true,
				reason: `${mode} mode: command blocked (not allowlisted). Switch to build mode with /mode build or alt+m first.\nCommand: ${command}`,
			};
		}
	});

	// Inject mode instructions before each agent run
	pi.on("before_agent_start", async () => {
		if (mode === "build") return;

		return {
			message: {
				customType: MODE_CONTEXT_TYPE,
				content: MODE_PROMPTS[mode],
				display: false,
			},
		};
	});

	// Strip stale mode instructions from context: keep only the newest one,
	// and only if it matches the current mode
	pi.on("context", async (event) => {
		let kept = false;
		return {
			messages: event.messages.filter((m) => {
				if (!isModeContextMessage(m)) return true;
				if (kept) return false;
				if (mode === "build" || !modeTagMatches(m, mode)) return false;
				kept = true;
				return true;
			}),
		};
	});

	// Restore mode and tool restrictions on session start/resume
	pi.on("session_start", async (_event, ctx) => {
		const entries = ctx.sessionManager.getEntries();
		const saved = entries
			.filter((e: { type: string; customType?: string }) => e.type === "custom" && e.customType === "modes-state")
			.pop() as { data?: { mode: Mode } } | undefined;

		if (saved?.data && isMode(saved.data.mode)) {
			mode = saved.data.mode;
		}
		applyMode(ctx);
	});
}

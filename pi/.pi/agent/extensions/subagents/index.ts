import { join } from "node:path";
import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { discoverAgents, loadSubagentSettings, OFF_PROFILE_NAME, resolveExtensionPaths, type SubagentSettings } from "./agents.ts";
import { refreshUi, registerRenderers, type UiContext } from "./render.ts";
import { createJobRegistry } from "./registry.ts";
import {
  confirmSubagentProfile,
  createCancelTool,
  createPeekTool,
  createReplyTool,
  createSendTool,
  createStatusTool,
  registerStatusCommands,
} from "./status-tools.ts";
import { createSubagentTool } from "./tools.ts";
import { PROFILE_ENTRY_TYPE, STATUS_KEY, WIDGET_KEY } from "./types.ts";

export function restoreActiveProfile(entries: readonly unknown[], settings: SubagentSettings): string | undefined {
  const models = new Set<string>();
  let choice: unknown;
  let found = false;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index] as { type?: unknown; customType?: unknown; provider?: unknown; modelId?: unknown; data?: { name?: unknown } } | undefined;
    if (entry?.type === "model_change") {
      models.add(`${String(entry.provider)}\0${String(entry.modelId)}`);
      if (found) break;
    } else if (!found && entry?.type === "custom" && entry.customType === PROFILE_ENTRY_TYPE) {
      choice = entry.data?.name;
      found = true;
    }
  }
  // Off survives model switches live, so it does here too.
  if (choice === OFF_PROFILE_NAME) return choice;
  // `models` holds the model in use when the choice was made plus any later ones. A switch to another
  // model cleared the profile at that switch, as it does live. pi also writes model_change when the
  // same model is picked again, so only a different model counts.
  if (models.size <= 1 && typeof choice === "string" && Object.hasOwn(settings.profiles, choice)) return choice;
  const names = Object.keys(settings.profiles);
  return names.length === 1 ? names[0] : undefined;
}

export default async function (pi: ExtensionAPI) {
  pi.registerFlag("subagent-profile", {
    description: "Subagent profile to use",
    type: "string",
  });
  const [agents, settings] = await Promise.all([
    discoverAgents(__dirname),
    loadSubagentSettings(),
  ]);
  // Children run with --no-extensions, so AGENTS.local.md loading must be re-added by path.
  const extensionPaths = [join(__dirname, "..", "agents-local.ts"), ...await resolveExtensionPaths(settings.extensions)];
  const registry = createJobRegistry();
  const activeTickers = new Set<ReturnType<typeof setInterval>>();
  let activeProfile = restoreActiveProfile([], settings);
  let lastUiContext: UiContext | undefined;

  const profileDeps = {
    settings,
    discover: () => discoverAgents(__dirname),
    getActiveProfile: () => activeProfile,
    setActiveProfile: (name: string) => {
      activeProfile = name;
      if (lastUiContext?.hasUI) lastUiContext.ui.setStatus(PROFILE_ENTRY_TYPE, activeProfile);
    },
    needsConfirmation: () => activeProfile === undefined,
    requestUsage: (provider: string, theme: Theme) => new Promise<string | undefined>((resolve) =>
      pi.events.emit("provider-usage:request", { provider, theme, reply: resolve })),
  };

  registerRenderers(pi);

  pi.registerTool(createSubagentTool({
    pi,
    agents,
    settings,
    getActiveProfile: () => activeProfile,
    confirmProfile: async (ctx, onPause) => {
      if (activeProfile !== undefined && activeProfile !== OFF_PROFILE_NAME && !Object.hasOwn(settings.profiles, activeProfile)) {
        throw new Error(`Unknown subagent profile "${activeProfile}". Available: ${Object.keys(settings.profiles).join(", ") || "none"}`);
      }
      return confirmSubagentProfile(pi, profileDeps, ctx, onPause);
    },
    discover: () => discoverAgents(__dirname),
    registry,
    activeTickers,
    bridgeExtensionPath: join(__dirname, "child-bridge.ts"),
    extensionPaths,
    onUiContext: ({ hasUI, ui }) => {
      // Only hasUI/ui are used later; keep just that subset so the full
      // context isn't pinned for the session.
      lastUiContext = { hasUI, ui };
    },
    refresh: (ctx) => refreshUi(ctx, registry),
  }));
  pi.registerTool(createStatusTool({ registry }));
  pi.registerTool(createPeekTool({ registry }));
  pi.registerTool(createCancelTool({ registry }));
  pi.registerTool(createSendTool({ registry }));
  pi.registerTool(createReplyTool({ registry }));
  registerStatusCommands(pi, {
    registry,
    profiles: profileDeps,
  });

  pi.on("session_start", (_event, ctx) => {
    const requested = pi.getFlag("subagent-profile");
    activeProfile = typeof requested === "string"
      ? requested
      : restoreActiveProfile(ctx.mode === "tui" ? ctx.sessionManager.getEntries() : [], settings);
    const { hasUI, ui } = ctx;
    lastUiContext = { hasUI, ui };
    if (hasUI) ui.setStatus(PROFILE_ENTRY_TYPE, activeProfile);
  });

  pi.on("model_select", () => {
    // An explicit --subagent-profile holds for the whole run.
    if (typeof pi.getFlag("subagent-profile") === "string") return;
    if (activeProfile !== undefined && activeProfile !== OFF_PROFILE_NAME && Object.keys(settings.profiles).length > 1) {
      activeProfile = undefined;
      if (lastUiContext?.hasUI) lastUiContext.ui.setStatus(PROFILE_ENTRY_TYPE, undefined);
      pi.sendMessage({
        customType: PROFILE_ENTRY_TYPE,
        content: "The main model changed, so the subagent profile was cleared. The next subagent launch asks the user to choose one.",
        display: true,
      });
    }
  });

  pi.on("session_shutdown", () => {
    for (const id of activeTickers) clearInterval(id);
    activeTickers.clear();
    registry.cancelAll("session-shutdown");
    if (lastUiContext?.hasUI) {
      lastUiContext.ui.setWidget(WIDGET_KEY, []);
      lastUiContext.ui.setStatus(STATUS_KEY, undefined);
      lastUiContext.ui.setStatus(PROFILE_ENTRY_TYPE, undefined);
    }
  });
}

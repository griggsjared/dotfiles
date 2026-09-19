import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { discoverAgents, loadSubagentSettings, resolveExtensionPaths, type SubagentSettings } from "./agents.ts";
import { refreshUi, registerRenderers, type UiContext } from "./render.ts";
import { createJobRegistry } from "./registry.ts";
import {
  createCancelTool,
  createPeekTool,
  createReplyTool,
  createSendTool,
  createStatusTool,
  registerStatusCommands,
} from "./status-tools.ts";
import { createSubagentTool } from "./tools.ts";
import { PROFILE_ENTRY_TYPE, STATUS_KEY, WIDGET_KEY } from "./types.ts";

export function restoreActiveProfile(entries: readonly unknown[], settings: SubagentSettings): string {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index] as { type?: unknown; customType?: unknown; data?: { name?: unknown } } | undefined;
    const name = entry?.data?.name;
    if (entry?.type === "custom" && entry.customType === PROFILE_ENTRY_TYPE && typeof name === "string" && settings.profiles[name]) {
      return name;
    }
  }
  return settings.defaultProfile;
}

export default async function (pi: ExtensionAPI) {
  const [agents, settings] = await Promise.all([
    discoverAgents(__dirname),
    loadSubagentSettings(),
  ]);
  const extensionPaths = await resolveExtensionPaths(settings.extensions);
  const registry = createJobRegistry();
  const activeTickers = new Set<ReturnType<typeof setInterval>>();
  let activeProfile = settings.defaultProfile;
  let lastUiContext: UiContext | undefined;

  registerRenderers(pi);

  pi.registerTool(createSubagentTool({
    pi,
    agents,
    settings,
    getActiveProfile: () => activeProfile,
    discover: () => discoverAgents(__dirname),
    registry,
    activeTickers,
    bridgeExtensionPath: join(__dirname, "child-bridge.ts"),
    extensionPaths,
    onUiContext: ({ hasUI, ui }) => {
      // Only hasUI/ui are used later (session_shutdown widget clearing); keep
      // just that subset so the full context isn't pinned for the session.
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
    profiles: {
      settings,
      getActiveProfile: () => activeProfile,
      setActiveProfile: (name) => { activeProfile = name; },
    },
  });

  pi.on("session_start", (_event, ctx) => {
    activeProfile = restoreActiveProfile(ctx.sessionManager.getEntries(), settings);
  });

  pi.on("session_shutdown", () => {
    for (const id of activeTickers) clearInterval(id);
    activeTickers.clear();
    registry.cancelAll("session-shutdown");
    if (lastUiContext?.hasUI) {
      try {
        lastUiContext.ui.setWidget(WIDGET_KEY, []);
        lastUiContext.ui.setStatus(STATUS_KEY, undefined);
      } catch { /* stale ctx after session change */ }
    }
  });
}

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { discoverAgents, loadSubagentSettings } from "./agents.ts";
import { refreshUi, registerRenderers, type UiContext } from "./render.ts";
import { createJobRegistry } from "./registry.ts";
import { createCancelTool, createStatusTool, registerStatusCommands } from "./status-tools.ts";
import { createSubagentTool } from "./tools.ts";
import { STATUS_KEY, WIDGET_KEY } from "./types.ts";

export default async function (pi: ExtensionAPI) {
  const [agents, settings] = await Promise.all([
    discoverAgents(__dirname),
    loadSubagentSettings(),
  ]);
  const registry = createJobRegistry();
  const activeTickers = new Set<ReturnType<typeof setInterval>>();
  let lastUiContext: UiContext | undefined;

  registerRenderers(pi);

  pi.registerTool(createSubagentTool({
    pi,
    agents,
    settings,
    discover: () => discoverAgents(__dirname),
    registry,
    activeTickers,
    onUiContext: ({ hasUI, ui }) => {
      // Only hasUI/ui are used later (session_shutdown widget clearing); keep
      // just that subset so the full context isn't pinned for the session.
      lastUiContext = { hasUI, ui };
    },
    refresh: (ctx) => refreshUi(ctx, registry),
  }));
  pi.registerTool(createStatusTool({ registry }));
  pi.registerTool(createCancelTool({ registry }));
  registerStatusCommands(pi, { registry });

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

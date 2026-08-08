import { readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, parse } from "node:path";

const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

export interface AgentSettings {
  model?: string;
  thinkingLevel?: string;
}

export interface SubagentSettings {
  defaults: AgentSettings;
  agents: Record<string, AgentSettings>;
}

export interface AgentConfig {
  name: string;
  description: string;
  model?: string;
  thinkingLevel?: string;
  tools?: string[];
  systemPrompt: string;
  maxRuntimeMs?: number;
}

const EMPTY_SETTINGS: SubagentSettings = { defaults: {}, agents: {} };

function validModel(value: unknown): value is string {
  return typeof value === "string" && /^[^\s\x00-\x1F\x7F]+$/.test(value);
}

function validThinkingLevel(value: unknown): value is string {
  return typeof value === "string" && THINKING_LEVELS.has(value);
}

function parseAgentSettings(value: unknown): AgentSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const settings = value as Record<string, unknown>;
  return {
    ...(validModel(settings.model) ? { model: settings.model } : {}),
    ...(validThinkingLevel(settings.thinkingLevel) ? { thinkingLevel: settings.thinkingLevel } : {}),
  };
}

export function parseSubagentSettings(value: unknown): SubagentSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) return EMPTY_SETTINGS;
  const subagents = (value as Record<string, unknown>).subagents;
  if (!subagents || typeof subagents !== "object" || Array.isArray(subagents)) return EMPTY_SETTINGS;
  const config = subagents as Record<string, unknown>;
  const agents: Record<string, AgentSettings> = {};
  if (config.agents && typeof config.agents === "object" && !Array.isArray(config.agents)) {
    for (const [name, settings] of Object.entries(config.agents)) {
      const parsed = parseAgentSettings(settings);
      if (parsed.model || parsed.thinkingLevel) agents[name] = parsed;
    }
  }
  return { defaults: parseAgentSettings(config.defaults), agents };
}

export async function loadSubagentSettings(path = join(homedir(), ".pi", "agent", "settings.json")): Promise<SubagentSettings> {
  try {
    return parseSubagentSettings(JSON.parse(await readFile(path, "utf8")));
  } catch {
    return EMPTY_SETTINGS;
  }
}

export function resolveAgentSettings(agent: AgentConfig, settings: SubagentSettings): AgentConfig {
  const local = settings.agents[agent.name] ?? {};
  return {
    ...agent,
    model: local.model ?? agent.model ?? settings.defaults.model,
    thinkingLevel: local.thinkingLevel ?? agent.thinkingLevel ?? settings.defaults.thinkingLevel,
  };
}

export function parseFrontmatter(text: string): { meta: Record<string, string>; body: string } {
  const match = text.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: text.trim() };

  const metaBlock = match[1] ?? "";
  const bodyBlock = match[2] ?? "";
  const meta: Record<string, string> = {};
  for (const line of metaBlock.split("\n")) {
    const idx = line.indexOf(":");
    if (idx > 0) {
      meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    }
  }
  return { meta, body: bodyBlock.trim() };
}

export async function loadAgentFile(path: string): Promise<AgentConfig | undefined> {
  try {
    const text = await readFile(path, "utf8");
    const { meta, body } = parseFrontmatter(text);
    const name = meta.name || parse(path).name;
    if (!name) return undefined;

    const maxRuntime = parseInt(meta.maxRuntimeMs ?? "", 10);

    return {
      name,
      description: meta.description || "",
      model: meta.model,
      thinkingLevel: validThinkingLevel(meta.thinkingLevel) ? meta.thinkingLevel : undefined,
      tools: meta.tools?.split(",").map((s) => s.trim()).filter(Boolean),
      systemPrompt: body,
      maxRuntimeMs: Number.isFinite(maxRuntime) && maxRuntime > 0 ? maxRuntime : undefined,
    };
  } catch {
    return undefined;
  }
}

export async function discoverAgents(extensionDir: string): Promise<AgentConfig[]> {
  const agents: AgentConfig[] = [];
  const agentsDir = join(extensionDir, "agents");

  try {
    const files = await readdir(agentsDir);
    for (const file of files) {
      if (!file.endsWith(".md")) continue;
      const agent = await loadAgentFile(join(agentsDir, file));
      if (agent) agents.push(agent);
    }
  } catch {
    // agents directory may not exist yet
  }

  return agents;
}

import { readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, parse } from "node:path";

const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

export interface AgentSettings {
  model?: string;
  thinkingLevel?: string;
}

export interface SubagentProfile {
  defaults: AgentSettings;
  agents: Record<string, AgentSettings>;
}

export interface SubagentSettings {
  defaultProfile: string;
  profiles: Record<string, SubagentProfile>;
  extensions: string[];
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

const EMPTY_PROFILE: SubagentProfile = { defaults: {}, agents: {} };
const EMPTY_SETTINGS: SubagentSettings = { defaultProfile: "default", profiles: { default: EMPTY_PROFILE }, extensions: [] };
const PACKAGE_SPEC = /^npm:(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;

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

export function isValidProfileName(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value);
}

function parsePackageSpecs(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === "string" && PACKAGE_SPEC.test(item)))];
}

/**
 * Children run with --no-extensions, so packages that register providers must
 * be re-added by path. Entry points differ per package, so read each manifest
 * rather than assuming a layout.
 */
export async function resolveExtensionPaths(
  specs: readonly string[],
  packageDir = process.env.PI_PACKAGE_DIR || join(homedir(), ".pi", "agent", "npm"),
): Promise<string[]> {
  const paths: string[] = [];
  for (const spec of specs) {
    const root = join(packageDir, "node_modules", spec.slice("npm:".length));
    try {
      const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as { pi?: { extensions?: unknown } };
      const entries = manifest.pi?.extensions;
      if (!Array.isArray(entries)) continue;
      for (const entry of entries) {
        if (typeof entry === "string") paths.push(join(root, entry));
      }
    } catch { /* package not installed */ }
  }
  return paths;
}

function parseProfile(value: unknown): SubagentProfile | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const config = value as Record<string, unknown>;
  const agents: Record<string, AgentSettings> = {};
  if (config.agents && typeof config.agents === "object" && !Array.isArray(config.agents)) {
    for (const [name, settings] of Object.entries(config.agents)) {
      const parsed = parseAgentSettings(settings);
      if (parsed.model || parsed.thinkingLevel) agents[name] = parsed;
    }
  }
  return { defaults: parseAgentSettings(config.defaults), agents };
}

export function parseSubagentSettings(value: unknown): SubagentSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) return EMPTY_SETTINGS;
  const subagents = (value as Record<string, unknown>).subagents;
  if (!subagents || typeof subagents !== "object" || Array.isArray(subagents)) return EMPTY_SETTINGS;
  const config = subagents as Record<string, unknown>;
  const extensions = parsePackageSpecs(config.extensions);
  const profiles: Record<string, SubagentProfile> = {};

  if (config.profiles && typeof config.profiles === "object" && !Array.isArray(config.profiles)) {
    for (const [name, profile] of Object.entries(config.profiles)) {
      if (!isValidProfileName(name)) continue;
      const parsed = parseProfile(profile);
      if (parsed) profiles[name] = parsed;
    }
  }

  // Accept the original unprofiled shape as the default profile.
  if (Object.keys(profiles).length === 0 && (config.defaults !== undefined || config.agents !== undefined)) {
    const legacy = parseProfile(config);
    if (legacy) profiles.default = legacy;
  }
  if (Object.keys(profiles).length === 0) return { ...EMPTY_SETTINGS, extensions };

  const requested = config.defaultProfile;
  const defaultProfile = isValidProfileName(requested) && profiles[requested]
    ? requested
    : profiles.default ? "default" : Object.keys(profiles)[0]!;
  return { defaultProfile, profiles, extensions };
}

export async function loadSubagentSettings(path = join(homedir(), ".pi", "agent", "settings.json")): Promise<SubagentSettings> {
  try {
    return parseSubagentSettings(JSON.parse(await readFile(path, "utf8")));
  } catch {
    return EMPTY_SETTINGS;
  }
}

export function getSubagentProfile(settings: SubagentSettings, profileName = settings.defaultProfile): SubagentProfile {
  return settings.profiles[profileName] ?? settings.profiles[settings.defaultProfile] ?? EMPTY_PROFILE;
}

export function resolveAgentSettings(agent: AgentConfig, settings: SubagentSettings, profileName?: string): AgentConfig {
  const profile = getSubagentProfile(settings, profileName);
  const local = profile.agents[agent.name] ?? {};
  return {
    ...agent,
    model: local.model ?? agent.model ?? profile.defaults.model,
    thinkingLevel: local.thinkingLevel ?? agent.thinkingLevel ?? profile.defaults.thinkingLevel,
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

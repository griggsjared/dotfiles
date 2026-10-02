import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  discoverAgents,
  loadAgentFile,
  loadSubagentSettings,
  getSubagentProfile,
  parseFrontmatter,
  parseSubagentSettings,
  resolveAgentSettings,
  resolveExtensionPaths,
} from "../agents.ts";

test("parseFrontmatter extracts meta and body", () => {
  const { meta, body } = parseFrontmatter("---\nname: scout\ndescription: Fast\n---\n\nBody text");
  assert.deepEqual(meta, { name: "scout", description: "Fast" });
  assert.equal(body, "Body text");
});

test("parseFrontmatter handles missing frontmatter", () => {
  const { meta, body } = parseFrontmatter("just body");
  assert.deepEqual(meta, {});
  assert.equal(body, "just body");
});

test("parseFrontmatter skips lines without a colon", () => {
  const { meta } = parseFrontmatter("---\nnot a key value pair\nname: x\n---\nbody");
  assert.deepEqual(meta, { name: "x" });
});

test("loadAgentFile parses fields", async () => {
  const dir = await mkdtemp(join(tmpdir(), "subagents-test-"));
  const file = join(dir, "worker.md");
  await writeFile(file, [
    "---",
    "name: worker",
    "description: Implements things",
    "model: opencode-go/deepseek-v4-pro",
    "thinkingLevel: high",
    "tools: read, grep, bash, edit",
    "maxRuntimeMs: 300000",
    "---",
    "You are a worker.",
  ].join("\n"));
  try {
    const agent = await loadAgentFile(file);
    assert.equal(agent?.name, "worker");
    assert.equal(agent?.description, "Implements things");
    assert.equal(agent?.model, "opencode-go/deepseek-v4-pro");
    assert.equal(agent?.thinkingLevel, "high");
    assert.deepEqual(agent?.tools, ["read", "grep", "bash", "edit"]);
    assert.equal(agent?.maxRuntimeMs, 300000);
    assert.equal(agent?.systemPrompt, "You are a worker.");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadAgentFile falls back to filename and tolerates invalid maxRuntimeMs", async () => {
  const dir = await mkdtemp(join(tmpdir(), "subagents-test-"));
  const file = join(dir, "fallback.md");
  await writeFile(file, "---\ndescription: no name\nmaxRuntimeMs: banana\n---\nbody");
  try {
    const agent = await loadAgentFile(file);
    assert.equal(agent?.name, "fallback");
    assert.equal(agent?.maxRuntimeMs, undefined);
    assert.equal(agent?.description, "no name");
    assert.equal(agent?.systemPrompt, "body");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadAgentFile returns undefined for unreadable files", async () => {
  assert.equal(await loadAgentFile(join(tmpdir(), "does-not-exist-xyz.md")), undefined);
});

test("discoverAgents loads only .md files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "subagents-test-"));
  const agentsDir = join(dir, "agents");
  await mkdir(agentsDir);
  try {
    await writeFile(join(agentsDir, "a.md"), "---\nname: alpha\n---\nprompt");
    await writeFile(join(agentsDir, "b.md"), "---\ndescription: no name\n---\nprompt");
    await writeFile(join(agentsDir, "ignore.txt"), "not an agent");
    const agents = await discoverAgents(dir);
    assert.deepEqual(agents.map((a) => a.name), ["alpha", "b"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("discoverAgents tolerates a missing agents dir", async () => {
  const dir = await mkdtemp(join(tmpdir(), "subagents-test-"));
  try {
    assert.deepEqual(await discoverAgents(dir), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});


test("parseSubagentSettings accepts only valid model and thinking settings", () => {
  const settings = parseSubagentSettings({
    subagents: {
      defaults: { model: "gpt-5", thinkingLevel: "max", tools: ["edit"] },
      agents: {
        scout: { model: "sonnet:high", thinkingLevel: "high" },
        invalid: { model: "openai/gpt\u0000", thinkingLevel: "maximum" },
      },
    },
  });
  assert.equal(getSubagentProfile(settings), settings.profiles.default);
  assert.deepEqual(settings.profiles.default!.defaults, { model: "gpt-5", thinkingLevel: "max" });
  assert.deepEqual(settings.profiles.default!.agents.scout, { model: "sonnet:high", thinkingLevel: "high" });
  assert.equal(settings.profiles.default!.agents.invalid, undefined);
});

test("loadSubagentSettings ignores malformed files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "subagents-test-"));
  const file = join(dir, "settings.json");
  try {
    await writeFile(file, "{");
    assert.deepEqual(await loadSubagentSettings(file), {
      profiles: {},
      extensions: [],
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("parseSubagentSettings keeps only well-formed npm package specs", () => {
  const settings = parseSubagentSettings({
    subagents: {
      extensions: [
        "npm:pi-claude-bridge",
        "npm:@scope/pkg",
        "npm:pi-claude-bridge",
        "pi-claude-bridge",
        "npm:../escape",
        "npm:has space",
        42,
      ],
      defaults: { model: "gpt-5" },
    },
  });
  assert.deepEqual(settings.extensions, ["npm:pi-claude-bridge", "npm:@scope/pkg"]);
});

test("parseSubagentSettings keeps extensions when no profiles are defined", () => {
  const settings = parseSubagentSettings({ subagents: { extensions: ["npm:pi-claude-bridge"] } });
  assert.deepEqual(settings.extensions, ["npm:pi-claude-bridge"]);
  assert.deepEqual(settings.profiles, {});
  assert.deepEqual(getSubagentProfile(settings), { defaults: {}, agents: {} });
});

test("resolveExtensionPaths reads entry points from each package manifest", async () => {
  const dir = await mkdtemp(join(tmpdir(), "subagents-test-"));
  try {
    const bridge = join(dir, "node_modules", "pi-claude-bridge");
    await mkdir(bridge, { recursive: true });
    await writeFile(join(bridge, "package.json"), JSON.stringify({ pi: { extensions: ["./src/index.ts"] } }));

    const noPi = join(dir, "node_modules", "pi-plain");
    await mkdir(noPi, { recursive: true });
    await writeFile(join(noPi, "package.json"), JSON.stringify({ name: "pi-plain" }));

    const paths = await resolveExtensionPaths(
      ["npm:pi-claude-bridge", "npm:pi-plain", "npm:pi-missing"],
      dir,
    );
    assert.deepEqual(paths, [join(bridge, "src", "index.ts")]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("resolveAgentSettings gives local overrides precedence over frontmatter and defaults", () => {
  const settings = parseSubagentSettings({
    subagents: {
      defaults: { model: "default/model", thinkingLevel: "low" },
      agents: { scout: { model: "local/model", thinkingLevel: "high" } },
    },
  });
  const agent = resolveAgentSettings({
    name: "scout", description: "", model: "frontmatter/model", thinkingLevel: "medium",
    tools: ["read"], systemPrompt: "",
  }, settings);
  assert.equal(agent.model, "local/model");
  assert.equal(agent.thinkingLevel, "high");
  assert.deepEqual(agent.tools, ["read"]);

  const defaults = resolveAgentSettings({ name: "worker", description: "", systemPrompt: "" }, settings);
  assert.equal(defaults.model, "default/model");
  assert.equal(defaults.thinkingLevel, "low");
});

test("parseSubagentSettings validates profiles and ignores defaultProfile", () => {
  const settings = parseSubagentSettings({
    subagents: {
      defaultProfile: "fast",
      profiles: {
        fast: { defaults: { model: "fast/model" } },
        slow: { defaults: { model: "slow/model" } },
        "not valid": { defaults: { model: "ignored/model" } },
        broken: null,
      },
    },
  });
  assert.equal("defaultProfile" in settings, false);
  assert.deepEqual(Object.keys(settings.profiles), ["fast", "slow"]);
  assert.deepEqual(getSubagentProfile(settings), { defaults: {}, agents: {} });
  assert.equal(getSubagentProfile(settings, "fast"), settings.profiles.fast);
  assert.equal(getSubagentProfile(settings, "slow"), settings.profiles.slow);
});

test("parseSubagentSettings enables profiles unless enabled is explicitly false", () => {
  for (const enabled of [undefined, true, "false", 0, null]) {
    const settings = parseSubagentSettings({
      subagents: {
        defaultProfile: "disabled",
        profiles: {
          disabled: { enabled: false, defaults: { model: "disabled/model" } },
          active: { enabled, defaults: { model: "active/model" } },
        },
      },
    });
    assert.deepEqual(Object.keys(settings.profiles), ["active"]);
    assert.equal(getSubagentProfile(settings), settings.profiles.active);
    assert.deepEqual(getSubagentProfile(settings, "disabled"), { defaults: {}, agents: {} });
  }
});

test("parseSubagentSettings does not privilege a profile named default or a former defaultProfile", () => {
  const settings = parseSubagentSettings({
    subagents: {
      defaultProfile: "disabled",
      profiles: {
        disabled: { enabled: false },
        backup: { defaults: { model: "backup/model" } },
        default: { defaults: { model: "default/model" } },
      },
    },
  });
  assert.deepEqual(Object.keys(settings.profiles), ["backup", "default"]);
  assert.deepEqual(getSubagentProfile(settings), { defaults: {}, agents: {} });
  assert.equal(getSubagentProfile(settings, "default"), settings.profiles.default);
  assert.equal(getSubagentProfile(settings, "backup"), settings.profiles.backup);
  assert.deepEqual(getSubagentProfile(settings, "disabled"), { defaults: {}, agents: {} });
});

test("loadSubagentSettings leaves disabled profile configuration in the file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "subagents-test-"));
  const file = join(dir, "settings.json");
  const config = {
    subagents: {
      profiles: {
        active: {},
        disabled: {
          enabled: false,
          defaults: { model: "saved/model", thinkingLevel: "low" },
          agents: { scout: { thinkingLevel: "high" } },
        },
      },
    },
  };
  const text = JSON.stringify(config);
  try {
    await writeFile(file, text);
    assert.deepEqual(Object.keys((await loadSubagentSettings(file)).profiles), ["active"]);
    assert.equal(await readFile(file, "utf8"), text);

    config.subagents.profiles.disabled.enabled = true;
    const restored = parseSubagentSettings(config);
    assert.deepEqual(restored.profiles.disabled, {
      defaults: { model: "saved/model", thinkingLevel: "low" },
      agents: { scout: { thinkingLevel: "high" } },
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("parseSubagentSettings uses the unconfigured fallback when every profile is disabled", () => {
  const extensions = ["npm:pi-claude-bridge"];
  const settings = parseSubagentSettings({
    subagents: {
      defaultProfile: "disabled",
      extensions,
      profiles: {
        disabled: { enabled: false, defaults: { model: "disabled/model", thinkingLevel: "low" } },
        default: { enabled: false, agents: { scout: { model: "saved/model" } } },
      },
    },
  });
  assert.deepEqual(settings.profiles, {});
  assert.deepEqual(settings.extensions, extensions);
  assert.deepEqual(settings, parseSubagentSettings({ subagents: { extensions } }));
  const agent = { name: "scout", description: "", thinkingLevel: "high", systemPrompt: "" };
  const resolved = resolveAgentSettings(agent, settings);
  assert.equal(resolved.model, undefined);
  assert.equal(resolved.thinkingLevel, "high");
});

test("resolveAgentSettings can resolve an explicitly selected profile", () => {
  const settings = parseSubagentSettings({
    subagents: {
      defaultProfile: "fast",
      profiles: {
        fast: { defaults: { model: "fast/model" } },
        slow: { defaults: { model: "slow/model" } },
      },
    },
  });
  const agent = { name: "worker", description: "", systemPrompt: "" };
  assert.equal(resolveAgentSettings(agent, settings).model, undefined);
  assert.equal(resolveAgentSettings(agent, settings, "fast").model, "fast/model");
  assert.equal(resolveAgentSettings(agent, settings, "slow").model, "slow/model");
  assert.equal(resolveAgentSettings(agent, settings, "missing").model, undefined);
});

test("getSubagentProfile uses an explicit enabled profile, otherwise only a sole enabled profile", () => {
  const empty = { defaults: {}, agents: {} };
  const none = parseSubagentSettings({ subagents: { profiles: {}, defaultProfile: "default" } });
  assert.deepEqual(none.profiles, {});
  assert.deepEqual(getSubagentProfile(none), empty);
  assert.deepEqual(getSubagentProfile(none, "default"), empty);
  assert.deepEqual(getSubagentProfile(none, "constructor"), empty);

  const one = parseSubagentSettings({
    subagents: {
      defaultProfile: "missing",
      profiles: { only: { defaults: { model: "only/model" } } },
    },
  });
  assert.equal(getSubagentProfile(one), one.profiles.only);
  assert.equal(getSubagentProfile(one, "only"), one.profiles.only);
  assert.deepEqual(getSubagentProfile(one, "missing"), empty);

  const many = parseSubagentSettings({
    subagents: {
      defaultProfile: "default",
      profiles: {
        default: { defaults: { model: "default/model" } },
        other: { defaults: { model: "other/model" } },
      },
    },
  });
  assert.deepEqual(Object.keys(many.profiles), ["default", "other"]);
  assert.deepEqual(getSubagentProfile(many), empty);
  assert.equal(getSubagentProfile(many, "default"), many.profiles.default);
  assert.equal(getSubagentProfile(many, "other"), many.profiles.other);
  assert.deepEqual(getSubagentProfile(many, "unknown"), empty);
  assert.deepEqual(getSubagentProfile(many, "constructor"), empty);
});

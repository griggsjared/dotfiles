import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  discoverAgents,
  loadAgentFile,
  loadSubagentSettings,
  parseFrontmatter,
  parseSubagentSettings,
  resolveAgentSettings,
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
  assert.deepEqual(settings.defaults, { model: "gpt-5", thinkingLevel: "max" });
  assert.deepEqual(settings.agents.scout, { model: "sonnet:high", thinkingLevel: "high" });
  assert.equal(settings.agents.invalid, undefined);
});

test("loadSubagentSettings ignores malformed files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "subagents-test-"));
  const file = join(dir, "settings.json");
  try {
    await writeFile(file, "{");
    assert.deepEqual(await loadSubagentSettings(file), { defaults: {}, agents: {} });
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

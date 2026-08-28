import { test } from "node:test";
import assert from "node:assert/strict";
import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import childBridge from "../child-bridge.ts";
import { ASK_PARENT_TITLE_PREFIX } from "../types.ts";

function registeredTool() {
  let tool: ToolDefinition | undefined;
  childBridge({
    registerTool(definition: ToolDefinition) {
      tool = definition;
    },
  } as unknown as ExtensionAPI);
  assert.ok(tool);
  return tool;
}

test("child bridge registers ask_parent with prompt guidance", () => {
  const tool = registeredTool();
  assert.equal(tool.name, "ask_parent");
  assert.ok(tool.promptGuidelines?.some((line) => line.includes("only when")));
  const properties = (tool.parameters as { properties: Record<string, unknown> }).properties;
  assert.deepEqual(Object.keys(properties), ["question", "context"]);
});

test("ask_parent forwards question, context, and signal", async () => {
  const tool = registeredTool();
  const controller = new AbortController();
  const calls: unknown[][] = [];
  const ctx = {
    ui: {
      input: async (...args: unknown[]) => {
        calls.push(args);
        return "Use the existing API.";
      },
    },
  };

  const result = await tool.execute(
    "call-1",
    { question: "Which API?", context: "There are two options." },
    controller.signal,
    undefined,
    ctx as never,
  );

  assert.deepEqual(calls, [[
    `${ASK_PARENT_TITLE_PREFIX}Which API?`,
    "There are two options.",
    { signal: controller.signal },
  ]]);
  assert.equal((result.content[0] as { text: string }).text, "Use the existing API.");
  assert.deepEqual(result.details, { answered: true });
});

test("ask_parent rejects a blank question before opening RPC input", async () => {
  const tool = registeredTool();
  let opened = false;
  await assert.rejects(
    tool.execute(
      "call-1",
      { question: "   " },
      undefined,
      undefined,
      { ui: { input: async () => { opened = true; return "answer"; } } } as never,
    ),
    /cannot be empty/,
  );
  assert.equal(opened, false);
});

test("ask_parent reports a cancelled response", async () => {
  const tool = registeredTool();
  const result = await tool.execute(
    "call-1",
    { question: "Continue?" },
    undefined,
    undefined,
    { ui: { input: async () => undefined } } as never,
  );

  assert.match((result.content[0] as { text: string }).text, /did not answer/);
  assert.deepEqual(result.details, { answered: false });
});

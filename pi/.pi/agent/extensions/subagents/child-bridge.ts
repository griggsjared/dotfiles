import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { ASK_PARENT_TITLE_PREFIX } from "./types.ts";

const AskParentParams = Type.Object({
  question: Type.String({ minLength: 1, maxLength: 4000, description: "One concise question for the parent agent" }),
  context: Type.Optional(Type.String({ maxLength: 8000, description: "Optional context the parent needs to answer" })),
});

export default function (pi: ExtensionAPI): void {
  pi.registerTool({
    name: "ask_parent",
    label: "Ask Parent",
    description: "Ask the parent agent one blocking question and wait for its answer.",
    promptGuidelines: [
      "Use ask_parent only when missing context or a decision blocks the task.",
      "Ask one concise question at a time, then continue after the parent answers.",
    ],
    parameters: AskParentParams,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const question = params.question.trim();
      if (!question) throw new Error("Parent question cannot be empty.");
      const context = params.context?.trim() || undefined;
      const answer = await ctx.ui.input(
        `${ASK_PARENT_TITLE_PREFIX}${question}`,
        context,
        { signal },
      );
      if (answer === undefined) {
        return {
          content: [{ type: "text", text: "The parent did not answer this question." }],
          details: { answered: false },
        };
      }
      return {
        content: [{ type: "text", text: answer }],
        details: { answered: true },
      };
    },
  });
}

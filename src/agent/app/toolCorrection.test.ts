import { expect, test } from "bun:test";
import type { AgentModelClient } from "./modelClient";
import type { Sandbox } from "../sandbox";
import { runAgentLoop } from "./agentLoop";
import { ToolRegistry } from "../tools/registry";

test("a rejected argument reaches the model before a corrected invocation runs exactly once", async () => {
  const registry = new ToolRegistry();
  const executions: number[] = [];
  registry.register<{ id: number }>({
    name: "Read",
    toolset: "fixture",
    description: "Read by numeric id",
    readOnly: true,
    parameters: {
      type: "object",
      properties: { id: { type: "integer" } },
      required: ["id"],
    },
    async handler({ id }) {
      executions.push(id);
      return { content: "found" };
    },
  });
  let turns = 0;
  const client: AgentModelClient = {
    complete: async () => {
      throw new Error("unexpected compaction");
    },
    async stream(body) {
      const turn = ++turns;
      if (turn === 2) {
        expect(body.messages.at(-1)?.content).toContain("Invalid arguments");
        expect(body.messages.at(-1)).toMatchObject({
          role: "tool",
          tool_call_id: "call1",
        });
      }
      if (turn === 3)
        expect(body.messages.at(-1)).toMatchObject({
          role: "tool",
          tool_call_id: "call2",
          content: "found",
        });
      const delta =
        turn === 3
          ? { content: "done" }
          : {
              tool_calls: [
                {
                  index: 0,
                  id: "call" + turn,
                  type: "function" as const,
                  function: {
                    name: "Read",
                    arguments: JSON.stringify({ id: turn === 1 ? "7" : 7 }),
                  },
                },
              ],
            };
      return (async function* () {
        yield {
          id: "fixture",
          object: "chat.completion.chunk" as const,
          created: 0,
          model: "fixture",
          choices: [{ index: 0, delta, finish_reason: null }],
        };
      })();
    },
  };
  const result = await runAgentLoop({
    client,
    model: "fixture",
    maxContext: 8192,
    maxIterations: 4,
    temperature: 0,
    systemPrompt: "fixture",
    messages: [{ role: "user", content: "read 7" }],
    sandbox: { fs: {} } as Sandbox,
    registry,
    emit() {},
    requestInteraction: async () => null,
    permissionMode: "default",
    inputProjectPaths: new Set(),
  });
  expect(result.assistantText).toBe("done");
  expect(executions).toEqual([7]);
});

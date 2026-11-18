import { expect, test } from "bun:test";
import { runAgentLoop } from "../app/agentLoop";
import type { AgentModelClient } from "../app/modelClient";
import type { Sandbox } from "../sandbox";
import { ToolRegistry } from "../tools/registry";
import { AgentTool } from "./tools";

test("plan-mode research overlaps, isolates child failures and joins ordered results in the parent turn", async () => {
  const registry = new ToolRegistry();
  registry.register(AgentTool);
  let release!: () => void;
  const bothStarted = new Promise<void>((resolve) => {
    release = resolve;
  });
  let children = 0;
  const client: AgentModelClient = {
    async complete() {
      throw new Error("unexpected compaction");
    },
    async stream({ messages }) {
      const last = messages.at(-1);
      let delta;
      if (last?.content === "parent") {
        delta = {
          tool_calls: ["frontend", "backend"].map((prompt, index) => ({
            index,
            id: prompt,
            type: "function" as const,
            function: {
              name: "call_dynamic_tool",
              arguments: JSON.stringify({
                tool_name: "Agent",
                arguments: { prompt },
              }),
            },
          })),
        };
      } else if (last?.role === "user") {
        if (++children === 2) release();
        await bothStarted;
        if (last.content === "backend") throw new Error("backend unavailable");
        delta = { content: "frontend evidence" };
      } else {
        expect(messages.at(-2)?.content).toBe("frontend evidence");
        expect(messages.at(-1)?.content).toContain("backend unavailable");
        delta = { content: "summary" };
      }
      return (async function* () {
        yield {
          id: "test",
          object: "chat.completion.chunk" as const,
          created: 0,
          model: "test",
          choices: [{ index: 0, delta, finish_reason: null }],
        };
      })();
    },
  };
  const result = await runAgentLoop({
    client,
    registry,
    messages: [{ role: "user", content: "parent" }],
    model: "test",
    maxContext: 8192,
    maxIterations: 3,
    temperature: 0,
    permissionMode: "plan",
    sandbox: { fs: {} } as Sandbox,
    systemPrompt: "test",
    emit() {},
    requestInteraction: async () => null,
    inputProjectPaths: new Set(),
  });
  expect(children).toBe(2);
  expect(result.assistantText).toBe("summary");
});

test("research children can discover Read and cannot dispatch mutation or nested delegation", async () => {
  const registry = new ToolRegistry();
  registry.register(AgentTool);
  for (const name of ["Read", "Write", "compile_project"]) {
    registry.register({
      name,
      toolset: "test",
      description: name,
      readOnly: name !== "Write",
      parameters: { type: "object", properties: {} },
      handler: async () => ({ content: name }),
    });
  }
  const child = {
    sandbox: {} as Sandbox,
    permissionMode: "plan",
    isSubagent: true,
    toolUseId: "child",
    emit() {},
    requestInteraction: async () => null,
  };
  expect(registry.available(child).map((tool) => tool.name)).toEqual(["Read"]);
  for (const name of ["Write", "compile_project", "Agent"]) {
    expect((await registry.dispatch(name, {}, child)).isError).toBe(true);
  }
});

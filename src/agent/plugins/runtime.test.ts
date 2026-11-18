import { describe, expect, test } from "bun:test";
import { PluginRuntime } from "./runtime";
import type { AgentPlugin } from "./types";
import type { ToolContext, ToolDefinition } from "../tools/types";

const tool: ToolDefinition = {
  name: "example",
  toolset: "example",
  description: "example",
  parameters: { type: "object", properties: {} },
  handler: async () => ({ content: "executed" }),
};
const plugin = (
  id: string,
  setup: AgentPlugin["setup"],
  defaultEnabled = true,
): AgentPlugin => ({
  manifest: { id, version: "1", description: id, defaultEnabled },
  setup,
});
const context = {
  permissionMode: "default",
  emit() {},
  requestInteraction: async () => null,
} as unknown as ToolContext;

describe("request-owned plugins", () => {
  test("opt-in and deny-list control execution, with no cross-run registration", async () => {
    const extension = plugin(
      "extension",
      (ctx) => ctx.registerTool(tool),
      false,
    );
    const disabled = await PluginRuntime.create([extension]);
    const enabled = await PluginRuntime.create([extension], {
      enabled: ["extension"],
    });
    const denied = await PluginRuntime.create([extension], {
      enabled: ["extension"],
      disabled: ["extension"],
    });
    expect(disabled.registry.list()).toHaveLength(0);
    expect(denied.registry.list()).toHaveLength(0);
    expect(
      (await enabled.registry.dispatch("example", {}, context)).content,
    ).toBe("executed");
    expect(
      (await denied.registry.dispatch("example", {}, context)).isError,
    ).toBe(true);
    await Promise.all([
      disabled.dispose(),
      enabled.dispose(),
      denied.dispose(),
    ]);
  });

  test("setup failure unwinds resources in reverse order, including failing plugin", async () => {
    const disposed: string[] = [];
    await expect(
      PluginRuntime.create([
        plugin("first", (ctx) => {
          ctx.registerTool(tool);
          ctx.onDispose(() => {
            disposed.push("first");
          });
        }),
        plugin("second", (ctx) => {
          ctx.onDispose(() => {
            disposed.push("second");
          });
          ctx.registerTool({ ...tool, name: "EXAMPLE" });
        }),
      ]),
    ).rejects.toThrow("Duplicate tool");
    expect(disposed).toEqual(["second", "first"]);
  });

  test("disposal runs once and continues after one cleanup fails", async () => {
    let cleaned = 0;
    const runtime = await PluginRuntime.create([
      plugin("resources", (ctx) => {
        ctx.onDispose(() => {
          cleaned++;
        });
        ctx.onDispose(() => {
          throw new Error("cleanup failure fixture");
        });
      }),
    ]);
    await runtime.dispose();
    await runtime.dispose();
    expect(cleaned).toBe(1);
  });

  test("availability, plan mode and cancellation are enforced at dispatch", async () => {
    let calls = 0;
    const runtime = await PluginRuntime.create([
      plugin("tools", (ctx) => {
        ctx.registerTool({
          ...tool,
          handler: async () => {
            calls++;
            return { content: "executed" };
          },
        });
        ctx.registerTool({
          ...tool,
          name: "unavailable",
          isAvailable: () => false,
        });
      }),
    ]);
    expect(
      runtime.registry.available({ ...context, permissionMode: "plan" }),
    ).toHaveLength(0);
    for (const args of ["null", "[]", "12"]) {
      expect(
        (await runtime.registry.dispatch("example", args, context)).isError,
      ).toBe(true);
    }
    expect(
      (
        await runtime.registry.dispatch(
          "example",
          {},
          { ...context, permissionMode: "plan" },
        )
      ).isError,
    ).toBe(true);
    expect(
      (await runtime.registry.dispatch("unavailable", {}, context)).isError,
    ).toBe(true);
    expect(
      (
        await runtime.registry.dispatch(
          "example",
          {},
          { ...context, signal: AbortSignal.abort() },
        )
      ).isError,
    ).toBe(true);
    expect(calls).toBe(0);
  });
});

test("plugins namespace skills, defer bodies and gate prompt contributions on available tools", async () => {
  const runtime = await PluginRuntime.create([
    plugin("reports", (ctx) => {
      ctx.registerSkill({
        name: "summary",
        content:
          "---\nname: summary\ndescription: Summarize reports\n---\nPrivate instructions",
      });
      ctx.registerPrompt((tools) =>
        tools.has("example") ? "Use example for reports" : undefined,
      );
    }),
  ]);
  expect(runtime.skills[0].name).toBe("reports:summary");
  expect(runtime.skills[0].description).toBe("Summarize reports");
  expect(runtime.instructionSkills(new Set())).toEqual([]);
  expect(runtime.instructionSkills(new Set(["example"]))[0].content).toBe("Use example for reports");
});

 test("plugin instructions stay out of manifests and remain request-owned", async () => {
  const { createSkillCatalog } = await import("../skills/catalog");
  const sandbox = { fs: { readdir: async () => [] } } as unknown as ToolContext["sandbox"];
  const extension = plugin("finance", ctx => {
    ctx.registerPrompt(names => names.has("example") ? "PRIVATE SOP: inspect invoice before approval" : undefined);
    ctx.registerTool(tool);
  });
  const first = await PluginRuntime.create([extension]);
  const second = await PluginRuntime.create([extension]);
  const instructions = first.instructionSkills(new Set(["example"]));
  expect(instructions[0].tools).toEqual(["example"]);
  const catalog = createSkillCatalog(sandbox, instructions);
  expect(JSON.stringify(await catalog.list())).not.toContain("PRIVATE SOP");
  expect((await catalog.load(instructions[0].name))?.content).toContain("PRIVATE SOP");
  first.registry.get("example")!.instructionSkills = [instructions[0].name];
  expect(second.registry.get("example")!.instructionSkills).toBeUndefined();
  expect(tool.instructionSkills).toBeUndefined();
  await first.dispose();
  await second.dispose();
});

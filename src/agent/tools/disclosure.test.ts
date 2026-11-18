import { expect, test } from "bun:test";
import { ToolRegistry } from "./registry";
import { createToolDisclosure } from "./disclosure";
import type { ToolContext } from "./types";
const context = { sandbox: {}, permissionMode: "default", toolUseId: "test", emit() {}, requestInteraction: async () => null } as unknown as ToolContext;

test("instruction skill references accompany both core and deferred tools without SOP bodies", async () => {
  const registry = new ToolRegistry();
  for (const name of ["Read", "invoice"]) registry.register({ name, toolset: "fixture", description: "Fixture tool", instructionSkills: ["fixture:instructions-1"], parameters: { type: "object", properties: {} }, handler: async () => ({ content: "ok" }) });
  const disclosure = createToolDisclosure(registry, context);
  expect(disclosure.get("Read")?.description).toContain("fixture:instructions-1");
  const result = JSON.parse((await disclosure.dispatch("search_tools", { query: "invoice" }, context)).content);
  expect(result.matches[0].instructionSkills).toEqual(["fixture:instructions-1"]);
  expect(registry.get("Read")?.description).toBe("Fixture tool");
});

test("large catalogs keep constant wire schemas and discover exact tools", async () => {
  const registry = new ToolRegistry();
  for (let i = 0; i < 1000; i++) registry.register({ name: `invoice_${i}`, toolset: "finance", description: "Read invoice", readOnly: true, parameters: { type: "object", properties: {} }, handler: async () => ({ content: String(i) }) });
  const disclosure = createToolDisclosure(registry, context);
  const before = JSON.stringify(disclosure.toOpenAITools(disclosure.available(context)));
  expect(disclosure.list().length).toBe(2);
  const result = await disclosure.dispatch("search_tools", { query: "invoice_999" }, context);
  expect(JSON.parse(result.content).matches[0].name).toBe("invoice_999");
  expect((await disclosure.dispatch("call_dynamic_tool", { tool_name: "invoice_999", arguments: {} }, context)).content).toBe("999");
  expect(JSON.stringify(disclosure.toOpenAITools(disclosure.available(context)))).toBe(before);
});

test("discovery and generic execution cannot bypass plan or subagent restrictions", async () => {
  const registry = new ToolRegistry();
  registry.register({ name: "delete_invoice", toolset: "finance", description: "Delete invoice", parameters: { type: "object", properties: {} }, handler: async () => { throw new Error("must not execute"); } });
  const plan = { ...context, permissionMode: "plan" };
  const disclosure = createToolDisclosure(registry, plan);
  expect(JSON.parse((await disclosure.dispatch("search_tools", { query: "delete_invoice" }, plan)).content).matches).toEqual([]);
  expect((await disclosure.dispatch("call_dynamic_tool", { tool_name: "delete_invoice", arguments: {} }, plan)).isError).toBe(true);
});

test("discovered tool arguments are validated before execution", async () => {
  const registry = new ToolRegistry();
  let executed = false;
  registry.register({ name: "invoice", toolset: "finance", description: "Read invoice", readOnly: true,
    parameters: { type: "object", properties: { id: { type: "integer", minimum: 1 }, state: { type: "string", enum: ["open"] } }, required: ["id"], additionalProperties: false },
    handler: async () => { executed = true; return { content: "ok" }; } });
  const exposed = createToolDisclosure(registry, context);
  for (const args of [{ id: "1" }, { id: -1 }, { id: 1, state: "closed" }, { id: 1, secret: true }]) {
    expect((await exposed.dispatch("call_dynamic_tool", { tool_name: "invoice", arguments: args }, context)).isError).toBe(true);
  }
  expect(executed).toBe(false);
  const found = JSON.parse((await exposed.dispatch("search_tools", { query: "查询发票" }, context)).content);
  expect(found.matches[0].name).toBe("invoice");
});

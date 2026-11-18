import { test, expect } from "bun:test";
import { createSkillCatalog } from "./catalog";
import type { Sandbox } from "../sandbox";
import { SkillTool } from "../tools/builtin/skillTool";
import type { ToolContext } from "../tools/types";

test("plugin skills disclose reference names without their bodies, then read selected lines", async () => {
  const sandbox = { fs: { readdir: async () => [] } } as unknown as Sandbox;
  const catalog = createSkillCatalog(sandbox, [{ name: "finance:invoice", description: "Invoices", path: "plugin:finance/invoice/SKILL.md", content: "Invoice instructions", tools: ["invoice_lookup"], resources: { "tax.json": "secret first line\nsecond line" } }]);
  const loaded = await catalog.load("finance:invoice");
  expect(loaded?.references).toEqual(["tax.json"]);
  expect(loaded?.content).not.toContain("secret");
  const ctx = { sandbox, skills: catalog } as ToolContext;
  const result = await SkillTool.handler({ skill: "finance:invoice", resource: "tax.json", offset: 2, limit: 1 }, ctx);
  expect(result.content).toContain("2: second line");
  expect(result.content).not.toContain("secret");
  expect(catalog.readReference!("finance:invoice", "../private")).rejects.toThrow("Invalid");
});

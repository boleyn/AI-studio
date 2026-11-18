import { expect, test } from "bun:test";
import { goalStatusTool, resumeGoal } from "./goal";
import type { ToolContext } from "../tools/types";

test("goal survives follow-ups and blockers until completion; a new objective can then start", async () => {
  const goal = resumeGoal(undefined, "Verify release 41");
  const updates: string[] = [];
  const tool = goalStatusTool(goal, async state => { updates.push(state.status); });
  const ctx: ToolContext = { sandbox: {} as ToolContext["sandbox"], toolUseId: "goal", permissionMode: "goal", emit() {}, requestInteraction: async () => null };
  expect((await tool.handler({ status: "complete", evidence: " " }, ctx)).isError).toBe(true);
  expect((await tool.handler({ status: "complete", evidence: "child answer" }, { ...ctx, isSubagent: true })).isError).toBe(true);
  await tool.handler({ status: "blocked", evidence: "Need target environment" }, ctx);
  expect(resumeGoal(goal, "Use staging").objective).toBe("Verify release 41");
  await tool.handler({ status: "complete", evidence: "Staging release manifest verified" }, ctx);
  expect(updates).toEqual(["blocked", "complete"]);
  expect(resumeGoal(goal, "Verify release 42").objective).toBe("Verify release 42");
});

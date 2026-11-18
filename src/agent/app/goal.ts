import { defineTool } from "../tools/types";

export type SessionGoal = {
  objective: string;
  status: "active" | "complete" | "blocked";
  evidence?: string;
};

export function resumeGoal(
  previous: SessionGoal | undefined,
  objective: string,
): SessionGoal {
  if (previous && previous.status !== "complete")
    return { objective: previous.objective, status: "active" };
  return { objective, status: "active" };
}

export function goalStatusTool(
  goal: SessionGoal,
  persist?: (state: SessionGoal) => Promise<void>,
) {
  return defineTool<{ status: "complete" | "blocked"; evidence: string }>({
    name: "update_goal",
    toolset: "goal",
    readOnly: true,
    description:
      "Close the current objective with verified evidence, or identify the specific blocker requiring user input.",
    parameters: {
      type: "object",
      properties: {
        status: { enum: ["complete", "blocked"] },
        evidence: { type: "string", minLength: 1 },
      },
      required: ["status", "evidence"],
    },
    async handler({ status, evidence }, ctx) {
      if (ctx.isSubagent || !evidence.trim())
        return { content: "Parent verification required.", isError: true };
      ctx.signal?.throwIfAborted();
      await persist?.({ ...goal, status, evidence: evidence.trim() });
      goal.status = status;
      goal.evidence = evidence.trim();
      ctx.emit("status", { phase: "goal_status", ...goal });
      return {
        content:
          "Goal status saved. Report the outcome in the user's language.",
      };
    },
  });
}

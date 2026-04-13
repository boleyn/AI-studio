import type { AgentToolDefinition } from "@server/agent/tools/types";

const toString = (value: unknown) => (typeof value === "string" ? value.trim() : "");

export const derivePlanModeState = (
  messages: Array<{ additional_kwargs?: Record<string, unknown> | undefined }>
) => {
  let active = false;
  for (const message of messages) {
    const kwargs =
      message.additional_kwargs && typeof message.additional_kwargs === "object"
        ? (message.additional_kwargs as Record<string, unknown>)
        : null;
    if (!kwargs) continue;
    const explicitState = kwargs.planModeState;
    if (typeof explicitState === "boolean") {
      active = explicitState;
      continue;
    }
    const approvalResponse =
      kwargs.planModeApprovalResponse && typeof kwargs.planModeApprovalResponse === "object"
        ? (kwargs.planModeApprovalResponse as Record<string, unknown>)
        : null;
    if (!approvalResponse) continue;
    if (approvalResponse.decision !== "approve") continue;
    if (approvalResponse.action === "enter") active = true;
    if (approvalResponse.action === "exit") active = false;
  }
  return active;
};

const buildApprovalPayload = (action: "enter" | "exit", rationale?: string) => ({
  ok: true,
  requiresPlanModeApproval: true,
  approval: {
    action,
    title: action === "enter" ? "进入计划模式审批" : "退出计划模式审批",
    description:
      action === "enter"
        ? "模型请求切换到计划模式（只读规划）。是否批准？"
        : "模型请求退出计划模式并开始执行。是否批准？",
    rationale,
    options: [
      { label: "批准", value: "approve" },
      { label: "拒绝", value: "reject" },
    ],
  },
});

export const createPlanPermissionTools = (): AgentToolDefinition[] => [
  {
    name: "enter_plan_mode",
    description: "Request user approval before entering plan mode.",
    parameters: {
      type: "object",
      properties: {
        rationale: { type: "string" },
      },
    },
    run: async (input) => {
      const payload = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
      return buildApprovalPayload("enter", toString(payload.rationale) || undefined);
    },
  },
  {
    name: "exit_plan_mode",
    description: "Request user approval before exiting plan mode.",
    parameters: {
      type: "object",
      properties: {
        rationale: { type: "string" },
      },
    },
    run: async (input) => {
      const payload = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
      return buildApprovalPayload("exit", toString(payload.rationale) || undefined);
    },
  },
];


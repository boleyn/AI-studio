import { defineTool } from "../tools/types";
import { delegationRole } from "./roles";

/**
 * 子 Agent 委派工具（对应 Hermes delegate_tool）。
 * 工具名保持 `Agent` 以兼容前端 Timeline 卡片渲染。
 */
export const AgentTool = defineTool<{
  prompt: string;
  description?: string;
  subagent_type?: string;
  background?: boolean;
}>({
  name: "Agent",
  readOnly: true, // Plan-mode children are restricted by the registry.
  toolset: "delegation",
  description:
    "Delegate a focused subtask to an isolated subagent sharing the same workspace sandbox. " +
    "Use this for parallel research, independent edits, or verification without polluting the main context.",
  parameters: {
    type: "object",
    properties: {
      background: {
        type: "boolean",
        description:
          "Run independently in the background. Returns a task ID; use AgentTask to inspect or cancel. Results are delivered at the next user turn.",
      },
      description: {
        type: "string",
        description: "Short 3-5 word summary of the delegated task",
      },
      prompt: {
        type: "string",
        description:
          "Detailed instructions and expected output for the subagent",
      },
      subagent_type: {
        type: "string",
        description:
          "Use explore for read-only research, review for read-only defect analysis, or general-purpose for edits. Plan mode always restricts children to research.",
      },
    },
    required: ["prompt"],
  },
  async handler(input, ctx) {
    if (!ctx.runSubagent) {
      return {
        content: "Subagent delegation is not available in this context.",
        isError: true,
      };
    }
    if (ctx.isSubagent) {
      return {
        content: "Nested subagent delegation is disabled to prevent recursion.",
        isError: true,
      };
    }
    const prompt = String(input.prompt || "").trim();
    if (!prompt) return { content: "prompt is required", isError: true };
    const role = delegationRole(input.subagent_type, ctx.permissionMode);
    if (input.background) {
      if (!ctx.backgroundTasks)
        return { content: "Background tasks unavailable", isError: true };
      return {
        content: JSON.stringify(await ctx.backgroundTasks.start(prompt, role, ctx.permissionMode)),
      };
    }
    const description =
      typeof input.description === "string"
        ? input.description.trim()
        : undefined;

    ctx.emit("stream_event", {
      subtype: "agent_start",
      id: ctx.toolUseId,
      agent_type: role,
      ...(description ? { description } : {}),
      prompt,
    });

    const result = await ctx.runSubagent({
      toolUseId: ctx.toolUseId,
      prompt,
      description,
      subagentType: role,
      signal: ctx.signal,
    });
    return { content: result || "(subagent returned empty response)" };
  },
});

export const AgentTaskTool = defineTool<{
  action: "list" | "get" | "wait" | "cancel";
  id?: string;
}>({
  name: "AgentTask",
  toolset: "delegation",
  readOnly: true,
  description:
    "Wait for a background result in this turn, inspect status/results, or cancel a running task. Results also arrive at the next turn; do not busy-poll. Cancel is not allowed in plan mode.",
  parameters: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["list", "get", "wait", "cancel"] },
      id: { type: "string" },
    },
    required: ["action"],
  },
  async handler(input, ctx) {
    if (!ctx.backgroundTasks)
      return { content: "Background tasks unavailable", isError: true };
    if (input.action === "cancel" && ctx.permissionMode === "plan")
      return {
        content: "Cancellation is disabled in plan mode",
        isError: true,
      };
    if (input.action === "list")
      return { content: JSON.stringify(await ctx.backgroundTasks.list()) };
    if (!input.id) return { content: "id is required", isError: true };
    if (input.action === "wait")
      return {
        content: JSON.stringify(
          await ctx.backgroundTasks.wait(input.id, ctx.signal),
        ),
      };
    return {
      content:
        JSON.stringify(await ctx.backgroundTasks[input.action](input.id)) ||
        "Task not found",
    };
  },
});

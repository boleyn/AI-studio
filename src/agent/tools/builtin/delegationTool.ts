import { defineTool } from "../types";

/**
 * 子 Agent 委派工具（对应 Hermes delegate_tool）。
 * 工具名保持 `Agent` 以兼容前端 Timeline 卡片渲染。
 */
export const AgentTool = defineTool<{ prompt: string; description?: string; subagent_type?: string; background?: boolean }>({
  name: "Agent",
  toolset: "delegation",
  description:
    "Delegate a focused subtask to an isolated subagent sharing the same workspace sandbox. " +
    "Use this for parallel research, independent edits, or verification without polluting the main context.",
  parameters: {
    type: "object",
    properties: {
      background: { type: "boolean", description: "Run independently in the background. Returns a task ID; use AgentTask to inspect or cancel. Results are delivered at the next user turn." },
      description: { type: "string", description: "Short 3-5 word summary of the delegated task" },
      prompt: { type: "string", description: "Detailed instructions and expected output for the subagent" },
      subagent_type: { type: "string", description: "Optional role hint, e.g. general-purpose, explore, review" },
    },
    required: ["prompt"],
  },
  async handler(input, ctx) {
    if (!ctx.runSubagent) {
      return { content: "Subagent delegation is not available in this context.", isError: true };
    }
    if (ctx.isSubagent) {
      return { content: "Nested subagent delegation is disabled to prevent recursion.", isError: true };
    }
    const prompt = String(input.prompt || "").trim();
    if (!prompt) return { content: "prompt is required", isError: true };
    if (input.background) {
      if (!ctx.backgroundTasks) return { content: "Background tasks unavailable", isError: true };
      return { content: JSON.stringify(await ctx.backgroundTasks.start(prompt)) };
    }
    const description = typeof input.description === "string" ? input.description.trim() : undefined;
    const subagentType = typeof input.subagent_type === "string" ? input.subagent_type.trim() : undefined;

    ctx.emit("stream_event", {
      subtype: "agent_start",
      id: ctx.toolUseId,
      ...(subagentType ? { agent_type: subagentType } : {}),
      ...(description ? { description } : {}),
      prompt,
    });

    const result = await ctx.runSubagent({
      toolUseId: ctx.toolUseId,
      prompt,
      description,
      subagentType,
      signal: ctx.signal,
    });
    return { content: result || "(subagent returned empty response)" };
  },
});

export const AgentTaskTool = defineTool<{ action: "list" | "get" | "cancel"; id?: string }>({
  name: "AgentTask", toolset: "delegation", readOnly: true,
  description: "Inspect background task status/results, or cancel a running task. Results also arrive at the next turn; do not busy-poll. Cancel is not allowed in plan mode.",
  parameters: { type: "object", properties: { action: { type: "string", enum: ["list", "get", "cancel"] }, id: { type: "string" } }, required: ["action"] },
  async handler(input, ctx) {
    if (!ctx.backgroundTasks) return { content: "Background tasks unavailable", isError: true };
    if (input.action === "cancel" && ctx.permissionMode === "plan") return { content: "Cancellation is disabled in plan mode", isError: true };
    if (input.action === "list") return { content: JSON.stringify(await ctx.backgroundTasks.list()) };
    if (!input.id) return { content: "id is required", isError: true };
    return { content: JSON.stringify(await ctx.backgroundTasks[input.action](input.id)) || "Task not found" };
  },
});

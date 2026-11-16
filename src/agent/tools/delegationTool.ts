import { registry } from "./registry";

/**
 * 子 Agent 委派工具（对应 Hermes delegate_tool）。
 * 工具名保持 `Agent` 以兼容前端 Timeline 卡片渲染。
 */
registry.register<{ prompt: string; description?: string; subagent_type?: string }>({
  name: "Agent",
  toolset: "delegation",
  description:
    "Delegate a focused subtask to an isolated subagent sharing the same workspace sandbox. " +
    "Use this for parallel research, independent edits, or verification without polluting the main context.",
  parameters: {
    type: "object",
    properties: {
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

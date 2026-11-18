import type { ToolContext, ToolDefinition } from "./types";
import { rankTools } from "./search";
import { ToolRegistry } from "./registry";

// Keep wire schemas stable. Deferred schemas travel in tool results, never at
// the front of the next request. Execution still uses the authoritative registry.
const CORE = new Set(["Read", "Bash", "Skill", "update_goal"]);

export function createToolDisclosure(registry: ToolRegistry, access: Pick<ToolContext, "sandbox" | "projectToken" | "permissionMode" | "isSubagent">): ToolRegistry {
  const exposed = new ToolRegistry();
  for (const tool of registry.available(access)) {
    if (CORE.has(tool.name)) exposed.register({
      ...tool,
      description: tool.description + (tool.instructionSkills?.length
        ? ` Before use, load these instruction skills with Skill: ${tool.instructionSkills.join(", ")}.`
        : ""),
    });
  }
  const searchable = () => registry.available(access).filter((tool) => !CORE.has(tool.name));
  const search: ToolDefinition<{ query: string; toolset?: string; limit?: number }> = {
    name: "search_tools", toolset: "discovery", readOnly: true,
    description: "Discover tools by task, exact name, or capability/toolset. Empty query lists capability groups. Returns full schemas for up to 5 matching tools; invoke them with call_dynamic_tool. Search again if results are unrelated.",
    parameters: { type: "object", properties: {
      query: { type: "string" }, toolset: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 5 },
    }, required: ["query"] },
    async handler(args) {
      const all = searchable();
      if (!String(args.query || "").trim() && !args.toolset) {
        const groups = new Map<string, number>();
        for (const tool of all) groups.set(tool.toolset, (groups.get(tool.toolset) || 0) + 1);
        return { content: JSON.stringify({ capabilities: [...groups].sort().map(([name, count]) => ({ name, count })) }) };
      }
      const query = String(args.query || "").toLowerCase();
      const candidates = all.filter(tool => !args.toolset || tool.toolset === args.toolset);
      const ranked = query ? rankTools(candidates, query) : candidates.map(tool => ({ tool, score: 1 }));
      const limit = Math.max(1, Math.min(5, Math.floor(Number(args.limit) || 5)));
      return { content: JSON.stringify({ matches: ranked.slice(0, limit).map(({ tool }) => ({ name: tool.name, toolset: tool.toolset, description: tool.description, parameters: tool.parameters, ...(tool.instructionSkills?.length ? { instructionSkills: tool.instructionSkills } : {}) })), total: ranked.length }) };
    },
  };
  exposed.register(search);
  exposed.register({
    name: "call_dynamic_tool", toolset: "discovery", readOnly: true,
    description: "Execute a tool discovered with search_tools using its exact name and schema. Permissions are checked again on the underlying tool. Never invent tool names or arguments.",
    parameters: { type: "object", properties: { tool_name: { type: "string" }, arguments: { type: "object", additionalProperties: true } }, required: ["tool_name", "arguments"] },
    async handler(args: { tool_name: string; arguments: Record<string, unknown> }, ctx) {
      return registry.dispatch(args.tool_name, args.arguments, ctx);
    },
  });
  return exposed;
}

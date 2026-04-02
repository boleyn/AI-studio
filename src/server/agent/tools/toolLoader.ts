import type { AgentToolDefinition } from "./types";

export const mergeAgentTools = ({
  codingCoreTools,
  bashTool,
  extraTools = [],
  mcpTools = [],
}: {
  codingCoreTools: AgentToolDefinition[];
  bashTool?: AgentToolDefinition | null;
  extraTools?: AgentToolDefinition[];
  mcpTools?: AgentToolDefinition[];
}): AgentToolDefinition[] => {
  const ordered = [
    ...codingCoreTools,
    ...(bashTool ? [bashTool] : []),
    ...extraTools,
    ...mcpTools,
  ];

  const deduped: AgentToolDefinition[] = [];
  const seen = new Set<string>();
  for (const tool of ordered) {
    const name = (tool?.name || "").trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    deduped.push(tool);
  }
  return deduped;
};

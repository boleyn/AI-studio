import { builtinTools } from "../tools/builtins";
import { McpClientManager, type McpServerConfig } from "../mcp";
import { ToolRegistry } from "../tools/registry";
import type { AgentPlugin } from "./types";

/** Static imports allow Next.js to trace every bundled implementation. */
export const builtinPlugins: AgentPlugin[] = [
  ...new Set(builtinTools.map((tool) => tool.toolset)),
].map((toolset) => ({
  manifest: {
    id: toolset,
    version: "1.0.0",
    description: `Built-in ${toolset} tools`,
    defaultEnabled: true,
  },
  setup(context) {
    for (const tool of builtinTools.filter(
      (item) => item.toolset === toolset,
    )) {
      context.registerTool(
        tool as import("../tools/types").ToolDefinition<any>,
      );
    }
  },
}));

export const createMcpPlugin = (configs: McpServerConfig[]): AgentPlugin => ({
  manifest: {
    id: "mcp",
    version: "1.0.0",
    description: "Configured MCP servers",
    defaultEnabled: true,
  },
  async setup(context) {
    const manager = new McpClientManager();
    context.onDispose(() => manager.closeAll());
    const registry = new ToolRegistry();
    await manager.connectAll(configs, registry);
    for (const tool of registry.list()) context.registerTool(tool);
  },
});

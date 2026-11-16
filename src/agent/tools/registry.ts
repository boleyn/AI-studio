import type { ChatCompletionTool } from "openai/resources/chat/completions";
import type { ToolContext, ToolDefinition, ToolResult } from "./types";

/**
 * 工具注册中心（对应 Hermes tools/registry.py）。
 * 每个工具模块在导入时调用 registry.register 完成自注册。
 */
export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition<any>>();

  register<I>(tool: ToolDefinition<I>): void {
    this.tools.set(tool.name, tool as ToolDefinition<any>);
  }

  unregister(name: string): void {
    this.tools.delete(name);
  }

  get(name: string): ToolDefinition<any> | undefined {
    return this.tools.get(name) ?? [...this.tools.values()].find((t) => t.name.toLowerCase() === name.toLowerCase());
  }

  list(filter?: (tool: ToolDefinition<any>) => boolean): ToolDefinition<any>[] {
    const all = [...this.tools.values()];
    return filter ? all.filter(filter) : all;
  }

  /** 复制一个注册表（用于每次运行附加 MCP 等动态工具而不污染全局） */
  fork(): ToolRegistry {
    const next = new ToolRegistry();
    for (const tool of this.tools.values()) next.register(tool);
    return next;
  }

  toOpenAITools(tools: ToolDefinition<any>[]): ChatCompletionTool[] {
    return tools.map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters as unknown as Record<string, unknown>,
      },
    }));
  }

  async dispatch(name: string, rawArgs: string | Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const tool = this.get(name);
    if (!tool) return { content: `Unknown tool: ${name}`, isError: true };
    let args: Record<string, unknown>;
    try {
      args = typeof rawArgs === "string" ? (rawArgs.trim() ? JSON.parse(rawArgs) : {}) : rawArgs;
    } catch (error) {
      return { content: `Invalid JSON arguments for ${name}: ${(error as Error).message}`, isError: true };
    }
    const missing = (tool.parameters.required || []).filter((key) => args[key] === undefined || args[key] === null);
    if (missing.length > 0) {
      return { content: `Missing required parameter(s) for ${name}: ${missing.join(", ")}`, isError: true };
    }
    try {
      return await tool.handler(args, ctx);
    } catch (error) {
      return { content: `${name} failed: ${error instanceof Error ? error.message : String(error)}`, isError: true };
    }
  }
}

export const registry = new ToolRegistry();

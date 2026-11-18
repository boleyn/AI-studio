import Ajv, { type ValidateFunction } from "ajv";
import type { ChatCompletionTool } from "openai/resources/chat/completions";
import type { ToolContext, ToolDefinition, ToolResult } from "./types";

type ToolAccessContext = Pick<ToolContext, "sandbox" | "projectToken" | "permissionMode" | "isSubagent">;

/**
 * 工具注册中心（对应 Hermes tools/registry.py）。
 * Registries belong to one run; built-ins and plugins contribute explicitly.
 */
export class ToolRegistry {
  private readonly validator = new Ajv({ strict: false, allErrors: true, validateFormats: false });
  private readonly schemas = new Map<string, ValidateFunction>();
  private readonly tools = new Map<string, ToolDefinition<any>>();

  register<I>(tool: ToolDefinition<I>): void {
    if (this.get(tool.name)) throw new Error(`Duplicate tool: ${tool.name}`);
    this.tools.set(tool.name, tool as ToolDefinition<any>);
  }

  get(name: string): ToolDefinition<any> | undefined {
    return this.tools.get(name) ?? [...this.tools.values()].find((t) => t.name.toLowerCase() === name.toLowerCase());
  }

  list(filter?: (tool: ToolDefinition<any>) => boolean): ToolDefinition<any>[] {
    const all = [...this.tools.values()];
    return filter ? all.filter(filter) : all;
  }

  /** The same policy guards discovery and dispatch, including direct plugin calls. */
  available(ctx: ToolAccessContext): ToolDefinition<any>[] {
    return this.list((tool) => !this.accessError(tool, ctx));
  }

  private accessError(tool: ToolDefinition<any>, ctx: ToolAccessContext): string | undefined {
    if (ctx.permissionMode === "plan" && !tool.readOnly) return `Tool "${tool.name}" is disabled in plan mode (read-only).`;
    if (ctx.isSubagent && ["AskUserQuestion", "ExitPlanMode"].includes(tool.name)) return "Subagents must report questions to the parent instead of opening user interactions.";
    if (ctx.isSubagent && tool.toolset === "delegation") return "Nested subagent delegation is disabled.";
    if (tool.isAvailable && !tool.isAvailable(ctx)) return `Tool "${tool.name}" is unavailable in this context.`;
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
    if (ctx.signal?.aborted) return { content: "Tool call cancelled.", isError: true };
    const denied = this.accessError(tool, ctx);
    if (denied) return { content: denied, isError: true };
    let args: Record<string, unknown>;
    try {
      args = typeof rawArgs === "string" ? (rawArgs.trim() ? JSON.parse(rawArgs) : {}) : rawArgs;
    } catch (error) {
      return { content: `Invalid JSON arguments for ${name}: ${(error as Error).message}`, isError: true };
    }
    if (!args || typeof args !== "object" || Array.isArray(args)) {
      return { content: `Arguments for ${name} must be a JSON object.`, isError: true };
    }
    let validate = this.schemas.get(tool.name);
    try {
      if (!validate) {
        validate = this.validator.compile(tool.parameters);
        this.schemas.set(tool.name, validate);
      }
    } catch {
      return { content: `Invalid tool schema for ${tool.name}; execution refused.`, isError: true };
    }
    if (!validate(args)) return { content: `Invalid arguments for ${tool.name}: ${this.validator.errorsText(validate.errors)}`, isError: true };
    try {
      return await tool.handler(args, ctx);
    } catch (error) {
      return { content: `${name} failed: ${error instanceof Error ? error.message : String(error)}`, isError: true };
    }
  }
}

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { JsonSchema, ToolDefinition } from "../tools/types";
import type { ToolRegistry } from "../tools/registry";

export type McpServerConfig =
  | {
      name: string;
      transport: "stdio";
      command: string;
      args?: string[];
      env?: Record<string, string>;
      cwd?: string;
    }
  | {
      name: string;
      transport: "http" | "sse";
      url: string;
      headers?: Record<string, string>;
    };

/**
 * 基于公开包 `@modelcontextprotocol/sdk` 的 MCP 客户端管理器。
 * 连接配置中的 MCP Server，并将它们的工具动态注册到本次运行的 ToolRegistry。
 */
export class McpClientManager {
  private readonly clients: Array<{ name: string; client: Client }> = [];

  async connectAll(
    configs: McpServerConfig[],
    registry: ToolRegistry,
  ): Promise<void> {
    for (const cfg of configs) {
      try {
        await this.connectOne(cfg, registry);
      } catch (error) {
        console.warn(
          `[mcp] failed to connect "${cfg.name}":`,
          error instanceof Error ? error.message : String(error),
        );
      }
    }
  }

  private async connectOne(
    cfg: McpServerConfig,
    registry: ToolRegistry,
  ): Promise<void> {
    const client = new Client({
      name: "aistudio-hermes-agent",
      version: "1.0.0",
    });
    const transport =
      cfg.transport === "stdio"
        ? new StdioClientTransport({
            command: cfg.command,
            args: cfg.args,
            env: cfg.env,
            cwd: cfg.cwd,
          })
        : cfg.transport === "sse"
          ? new SSEClientTransport(
              new URL(cfg.url),
              cfg.headers
                ? { requestInit: { headers: cfg.headers } }
                : undefined,
            )
          : new StreamableHTTPClientTransport(
              new URL(cfg.url),
              cfg.headers
                ? { requestInit: { headers: cfg.headers } }
                : undefined,
            );

    try {
      await client.connect(transport);
      const contributions: ToolDefinition<any>[] = [];
      const cursors = new Set<string>();
      let cursor: string | undefined;
      do {
        const listed = await client.listTools(cursor ? { cursor } : undefined);
        for (const tool of listed.tools || []) {
          const registeredName = `mcp__${cfg.name}__${tool.name}`;
          const schema = (tool.inputSchema || {
            type: "object",
            properties: {},
          }) as JsonSchema;
          contributions.push({
            name: registeredName,
            toolset: "mcp",
            description:
              tool.description || `MCP tool ${tool.name} from ${cfg.name}`,
            readOnly: tool.annotations?.readOnlyHint === true,
            parameters: {
              ...schema,
              type: "object",
              properties: schema.properties || {},
              ...(Array.isArray(schema.required)
                ? { required: schema.required }
                : {}),
            },
            async handler(input, ctx) {
              const result = await client.callTool(
                {
                  name: tool.name,
                  arguments: input as Record<string, unknown>,
                },
                undefined,
                { signal: ctx.signal },
              );
              const text = Array.isArray(result.content)
                ? result.content
                    .map((block: unknown) => {
                      if (!block || typeof block !== "object")
                        return String(block ?? "");
                      const record = block as Record<string, unknown>;
                      if (
                        record.type === "text" &&
                        typeof record.text === "string"
                      )
                        return record.text;
                      return JSON.stringify(record);
                    })
                    .join("\n")
                : JSON.stringify(result.content ?? "");
              return {
                content: text || "(empty mcp result)",
                isError: Boolean(result.isError),
              };
            },
          });
        }
        cursor = listed.nextCursor;
        if (cursor && cursors.has(cursor))
          throw new Error(`Repeated MCP tools cursor from ${cfg.name}`);
        if (cursor) cursors.add(cursor);
      } while (cursor);
      const names = new Set<string>();
      for (const tool of contributions) {
        const key = tool.name.toLowerCase();
        if (registry.get(tool.name) || names.has(key))
          throw new Error(`Duplicate MCP tool: ${tool.name}`);
        names.add(key);
      }
      for (const tool of contributions) registry.register(tool);
      this.clients.push({ name: cfg.name, client });
    } catch (error) {
      await client.close().catch(() => {});
      throw error;
    }
  }

  async closeAll(): Promise<void> {
    await Promise.allSettled(this.clients.map((entry) => entry.client.close()));
    this.clients.length = 0;
  }
}

/** 从环境变量 `AGENT_MCP_SERVERS` 或 `MCP_SERVER_URLS` 读取外部 MCP Server 配置 */
export const loadMcpConfigsFromEnv = (): McpServerConfig[] => {
  const configs: McpServerConfig[] = [];
  for (const envKey of ["AGENT_MCP_SERVERS", "MCP_SERVER_URLS"]) {
    const raw = (process.env[envKey] || "").trim();
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) continue;
      for (const item of parsed) {
        if (!item || typeof item !== "object") continue;
        const record = item as Record<string, unknown>;
        if (
          record.transport === "stdio" &&
          typeof record.command === "string"
        ) {
          configs.push(record as McpServerConfig);
        } else if (typeof record.url === "string" && record.url.trim()) {
          const url = record.url.trim();
          const transport =
            record.transport === "sse" || record.transport === "http"
              ? record.transport
              : url.toLowerCase().endsWith("/sse")
                ? "sse"
                : "http";
          configs.push({
            name:
              typeof record.name === "string" && record.name.trim()
                ? record.name.trim()
                : "mcp",
            transport,
            url,
            ...(record.headers && typeof record.headers === "object"
              ? { headers: record.headers as Record<string, string> }
              : {}),
          });
        }
      }
    } catch {
      // ignore invalid JSON
    }
  }
  return configs;
};

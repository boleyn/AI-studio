import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { AgentToolDefinition } from "./tools/types";

export type MCPServerConfig = {
  name: string;
  url: string;
  headers?: Record<string, string>;
};

type MCPToolMeta = {
  mcpName: string;
  toolName: string;
  description: string;
  parameters: Record<string, unknown>;
};

type MCPServerConnection = {
  client: Client;
  tools: MCPToolMeta[];
  fetchedAt: number;
};

const CACHE_TTL_MS = 60 * 1000;
const MAX_TOOL_NAME_LENGTH = 64;

const globalCache = globalThis as typeof globalThis & {
  __mcpConnectionCache?: Map<string, MCPServerConnection>;
};

const mcpConnectionCache =
  globalCache.__mcpConnectionCache ||
  (globalCache.__mcpConnectionCache = new Map<string, MCPServerConnection>());

const toSafeName = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, "_").replace(/_+/g, "_");

const tinyHash = (value: string) => {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16);
};

const buildOpenAIToolName = (serverName: string, toolName: string) => {
  const raw = `mcp_${toSafeName(serverName)}__${toSafeName(toolName)}`;
  if (raw.length <= MAX_TOOL_NAME_LENGTH) return raw;

  const suffix = `_${tinyHash(raw).slice(0, 8)}`;
  return `${raw.slice(0, MAX_TOOL_NAME_LENGTH - suffix.length)}${suffix}`;
};

function parseServers(raw: string | undefined): MCPServerConfig[] {
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return parsed
        .map((entry, index): MCPServerConfig | null => {
          if (typeof entry === "string") {
            const url = entry.trim();
            if (!url) return null;
            return { name: `mcp-${index + 1}`, url };
          }

          if (!entry || typeof entry !== "object") return null;
          const config = entry as Record<string, unknown>;
          const url = typeof config.url === "string" ? config.url.trim() : "";
          if (!url) return null;

          const name =
            typeof config.name === "string" && config.name.trim()
              ? config.name.trim()
              : `mcp-${index + 1}`;

          const headers =
            config.headers && typeof config.headers === "object"
              ? Object.fromEntries(
                  Object.entries(config.headers as Record<string, unknown>).filter(
                    (item): item is [string, string] => typeof item[0] === "string" && typeof item[1] === "string"
                  )
                )
              : undefined;

          return {
            name,
            url,
            headers: headers && Object.keys(headers).length > 0 ? headers : undefined,
          };
        })
        .filter((entry): entry is MCPServerConfig => Boolean(entry));
    }
  } catch {
    // fallback to comma-separated list
  }

  return raw
    .split(",")
    .map((entry, index) => ({
      name: `mcp-${index + 1}`,
      url: entry.trim(),
    }))
    .filter((entry) => entry.url.length > 0);
}

const toHeaders = (headers?: Record<string, string>) => {
  if (!headers) return undefined;
  const sanitized = Object.fromEntries(
    Object.entries(headers).filter(
      (item): item is [string, string] => Boolean(item[0] && item[1])
    )
  );
  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
};

const createClient = async (server: MCPServerConfig) => {
  const url = new URL(server.url);
  const headers = toHeaders(server.headers);

  const client = new Client(
    {
      name: "nextjs-ai-studio",
      version: "0.0.1",
    },
    {
      capabilities: {},
    }
  );

  const transport = new SSEClientTransport(url, {
    eventSourceInit: headers
      ? {
          fetch: (requestUrl, init) =>
            fetch(requestUrl, {
              ...init,
              headers: {
                ...(init.headers || {}),
                ...headers,
              },
            }),
        }
      : undefined,
    requestInit: headers
      ? {
          headers,
        }
      : undefined,
  });

  await client.connect(transport);
  return client;
};

const loadServerTools = async (server: MCPServerConfig): Promise<MCPServerConnection> => {
  const cacheKey = `${server.name}::${server.url}`;
  const cached = mcpConnectionCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached;
  }

  const client = await createClient(server);
  const listResult = await client.listTools();
  const tools: MCPToolMeta[] = (listResult.tools || []).map((tool) => ({
    mcpName: tool.name,
    toolName: buildOpenAIToolName(server.name, tool.name),
    description: tool.description || `MCP tool from ${server.name}: ${tool.name}`,
    parameters:
      tool.inputSchema && typeof tool.inputSchema === "object"
        ? (tool.inputSchema as Record<string, unknown>)
        : {
            type: "object",
            properties: {},
          },
  }));

  const nextConnection: MCPServerConnection = {
    client,
    tools,
    fetchedAt: Date.now(),
  };

  mcpConnectionCache.set(cacheKey, nextConnection);
  return nextConnection;
};

const formatToolResult = (result: unknown) => {
  if (!result || typeof result !== "object") {
    return typeof result === "string" ? result : JSON.stringify(result);
  }

  const record = result as Record<string, unknown>;
  const content = Array.isArray(record.content) ? record.content : [];
  const parts: string[] = [];

  for (const item of content) {
    if (!item || typeof item !== "object") continue;
    const block = item as Record<string, unknown>;
    const type = typeof block.type === "string" ? block.type : "";

    if (type === "text" && typeof block.text === "string") {
      parts.push(block.text);
      continue;
    }

    if (type === "resource" && block.resource && typeof block.resource === "object") {
      const resource = block.resource as Record<string, unknown>;
      const text = typeof resource.text === "string" ? resource.text : undefined;
      const uri = typeof resource.uri === "string" ? resource.uri : "resource";
      parts.push(text ? `${uri}\n${text}` : uri);
      continue;
    }

    if (type === "resource_link") {
      const name = typeof block.name === "string" ? block.name : "resource";
      const uri = typeof block.uri === "string" ? block.uri : "";
      parts.push(uri ? `${name}: ${uri}` : name);
      continue;
    }
  }

  if (record.structuredContent && typeof record.structuredContent === "object") {
    parts.push(JSON.stringify(record.structuredContent, null, 2));
  }

  if (parts.length > 0) {
    return parts.join("\n\n");
  }

  return JSON.stringify(result);
};

export async function loadMcpTools(): Promise<AgentToolDefinition[]> {
  const servers = parseServers(process.env.MCP_SERVER_URLS || process.env.MCP_SERVERS);
  if (servers.length === 0) return [];

  const definitions = await Promise.all(
    servers.map(async (server) => {
      try {
        const connection = await loadServerTools(server);
        return connection.tools.map<AgentToolDefinition>((tool) => ({
          name: tool.toolName,
          description: tool.description,
          parameters: tool.parameters,
          run: async (input) => {
            const latest = await loadServerTools(server);
            const rawResult = await latest.client.callTool({
              name: tool.mcpName,
              arguments: input && typeof input === "object" ? (input as Record<string, unknown>) : {},
            });

            const isError =
              rawResult &&
              typeof rawResult === "object" &&
              "isError" in rawResult &&
              Boolean((rawResult as { isError?: unknown }).isError);

            const output = formatToolResult(rawResult);
            if (isError) {
              throw new Error(output || `MCP tool error: ${tool.mcpName}`);
            }

            return output;
          },
        }));
      } catch (error) {
        console.warn(
          `[mcp] failed to load tools from ${server.name} (${server.url}):`,
          error instanceof Error ? error.message : error
        );
        return [];
      }
    })
  );

  return definitions.flat();
}

import OpenAI from "openai";

export type AgentRuntimeConfig = {
  provider: "openai" | string;
  toolCallModel: string;
  normalModel: string;
  temperature: number;
  recursionLimit: number;
  maxContext?: number;
  apiKey?: string;
  baseUrl?: string;
  memoryEnabled: boolean;
};

const DEFAULT_RECURSION_LIMIT = 24;

export const getAgentRuntimeConfig = (): AgentRuntimeConfig => {
  const aiproxyEndpoint = process.env.AIPROXY_API_ENDPOINT;
  const baseUrl = aiproxyEndpoint
    ? `${aiproxyEndpoint.replace(/\/$/, "")}/v1`
    : process.env.OPENAI_BASE_URL;
  const apiKey = process.env.AIPROXY_API_TOKEN || process.env.CHAT_API_KEY || process.env.OPENAI_API_KEY;

  const parsedRecursionLimit = process.env.AI_RECURSION_LIMIT
    ? Number.parseInt(process.env.AI_RECURSION_LIMIT, 10)
    : undefined;
  const parsedMaxContext = process.env.AI_MAX_CONTEXT
    ? Number.parseInt(process.env.AI_MAX_CONTEXT, 10)
    : undefined;

  return {
    provider: "openai",
    toolCallModel: process.env.TOOL_CALL_MODEL || "",
    normalModel: process.env.NORMAL_MODEL || "",
    temperature: Number.parseFloat(process.env.AI_TEMPERATURE || "0.2"),
    recursionLimit:
      Number.isFinite(parsedRecursionLimit) && (parsedRecursionLimit as number) > 0
        ? (parsedRecursionLimit as number)
        : DEFAULT_RECURSION_LIMIT,
    maxContext: Number.isFinite(parsedMaxContext) ? parsedMaxContext : undefined,
    apiKey,
    baseUrl,
    memoryEnabled: process.env.AI_MEMORY_ENABLED !== "0",
  };
};

let cachedClient: OpenAI | null = null;

export function getOpenAIClient(options?: {
  maxRetries?: number;
  fetchOverride?: typeof fetch;
  baseURL?: string;
  apiKey?: string;
}): OpenAI {
  const isCustom = Boolean(options?.baseURL || options?.apiKey || options?.fetchOverride);
  if (cachedClient && !isCustom) return cachedClient;

  const cfg = getAgentRuntimeConfig();
  const apiKey = options?.apiKey || cfg.apiKey || "";
  const baseURL = options?.baseURL || cfg.baseUrl;

  const client = new OpenAI({
    apiKey,
    ...(baseURL ? { baseURL } : {}),
    maxRetries: options?.maxRetries ?? 1,
    timeout: Number.parseInt(process.env.API_TIMEOUT_MS || String(600 * 1000), 10),
    dangerouslyAllowBrowser: true,
    ...(options?.fetchOverride ? { fetch: options.fetchOverride } : {}),
  });

  if (!isCustom) cachedClient = client;
  return client;
}

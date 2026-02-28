export type AgentRuntimeConfig = {
  provider: "openai" | string;
  toolCallModel: string;
  normalModel: string;
  temperature: number;
  recursionLimit?: number;
  maxContext?: number;
  apiKey?: string;
  baseUrl?: string;
};

const DEFAULT_TOOL_CALL_MODEL = "";
const DEFAULT_NORMAL_MODEL = "";
const DEFAULT_RECURSION_LIMIT = 100;

export const getAgentRuntimeConfig = (): AgentRuntimeConfig => {
  const provider = "openai";
  const aiproxyEndpoint = process.env.AIPROXY_API_ENDPOINT;
  const baseUrl = aiproxyEndpoint ? `${aiproxyEndpoint.replace(/\/$/, "")}/v1` : process.env.OPENAI_BASE_URL;
  const apiKey = process.env.AIPROXY_API_TOKEN || process.env.CHAT_API_KEY;

  const toolCallModel = process.env.TOOL_CALL_MODEL || DEFAULT_TOOL_CALL_MODEL;
  const normalModel = process.env.NORMAL_MODEL || DEFAULT_NORMAL_MODEL;

  const parsedRecursionLimit = process.env.AI_RECURSION_LIMIT
    ? Number.parseInt(process.env.AI_RECURSION_LIMIT, 10)
    : undefined;
  const parsedMaxContext = process.env.AI_MAX_CONTEXT
    ? Number.parseInt(process.env.AI_MAX_CONTEXT, 10)
    : undefined;

  return {
    provider,
    toolCallModel,
    normalModel,
    temperature: Number.parseFloat(process.env.AI_TEMPERATURE || "0.2"),
    recursionLimit: Number.isFinite(parsedRecursionLimit)
      ? parsedRecursionLimit
      : DEFAULT_RECURSION_LIMIT,
    maxContext: Number.isFinite(parsedMaxContext) ? parsedMaxContext : undefined,
    apiKey,
    baseUrl,
  };
};

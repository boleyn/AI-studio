import OpenAI from "@aistudio/ai/compat/global/core/ai";
import type { OpenaiAccountType } from "@aistudio/ai/compat/global/support/user/team/type";

const aiProxyBaseUrl = process.env.AIPROXY_API_ENDPOINT
  ? `${process.env.AIPROXY_API_ENDPOINT.replace(/\/$/, "")}/v1`
  : undefined;
const openaiBaseUrl = aiProxyBaseUrl || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
const openaiBaseKey = process.env.AIPROXY_API_TOKEN || process.env.CHAT_API_KEY || "";

export const getAIApi = (props?: { userKey?: OpenaiAccountType; timeout?: number }) => {
  const { userKey, timeout } = props || {};
  const baseUrl = userKey?.baseUrl || openaiBaseUrl;
  const apiKey = userKey?.key || openaiBaseKey;

  if (!baseUrl) {
    throw new Error("AIPROXY_API_ENDPOINT/OPENAI_BASE_URL 未配置");
  }
  if (!apiKey) {
    throw new Error("AIPROXY_API_TOKEN/CHAT_API_KEY 未配置");
  }

  return new OpenAI({
    baseURL: baseUrl,
    apiKey,
    timeout,
    maxRetries: 2,
  });
};

export const getAxiosConfig = (props?: { userKey?: OpenaiAccountType }) => {
  const { userKey } = props || {};
  const baseUrl = userKey?.baseUrl || openaiBaseUrl;
  const apiKey = userKey?.key || openaiBaseKey;
  if (!baseUrl) {
    throw new Error("AIPROXY_API_ENDPOINT/OPENAI_BASE_URL 未配置");
  }
  if (!apiKey) {
    throw new Error("AIPROXY_API_TOKEN/CHAT_API_KEY 未配置");
  }
  return {
    baseUrl,
    authorization: `Bearer ${apiKey}`,
  };
};

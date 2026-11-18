import { getContextWindowForModel } from "../app/context";
import {
  getChatModelCatalog,
  getChatModelProfile,
} from "@server/aiProxy/catalogStore";
import type { AgentModelConnection } from "../app/modelClient";
import { getAgentRuntimeConfig } from "../app/config";

/** Resolve both system-catalog and user-owned models before acquiring run resources. */
export async function resolveModelConnection(
  model: string,
  override?: AgentModelConnection,
): Promise<AgentModelConnection | undefined> {
  if (override) return override;
  await getChatModelCatalog();
  const profile = getChatModelProfile(model);
  if (!profile) return;
  const config = getAgentRuntimeConfig();
  const protocol =
    typeof profile.protocol === "string"
      ? profile.protocol.toLowerCase()
      : "openai";
  if (
    protocol !== "openai" &&
    protocol !== "anthropic" &&
    protocol !== "google"
  )
    throw new Error(`Unsupported model protocol: ${protocol}`);
  const baseURL =
    typeof profile.baseUrl === "string" && profile.baseUrl.trim()
      ? profile.baseUrl.trim()
      : config.baseUrl;
  const apiKey =
    typeof profile.key === "string" && profile.key.trim()
      ? profile.key.trim()
      : config.apiKey;
  if (!baseURL || !apiKey) {
    if (protocol === "openai" && !baseURL && apiKey) return;
    throw new Error("模型连接配置不完整，请设置 Base URL 和 API Key。");
  }
  return {
    protocol,
    baseURL,
    apiKey,
    maxContext:
      typeof profile.maxContext === "number" ? profile.maxContext : undefined,
    maxTemperature:
      typeof profile.maxTemperature === "number"
        ? profile.maxTemperature
        : undefined,
    reasoning: profile.reasoning === true,
    vision: profile.vision === true,
  };
}

export function getConfiguredContextWindow(model: string): number {
  const configured = getChatModelProfile(model)?.maxContext;
  return typeof configured === "number" &&
    Number.isFinite(configured) &&
    configured > 0
    ? Math.floor(configured)
    : getContextWindowForModel(model);
}

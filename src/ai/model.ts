import { getAgentRuntimeConfig } from '@aistudio/server/agent/runtimeConfig';
import { getChatModelProfile } from '@aistudio/server/aiProxy/catalogStore';

import type { LLMModelItemType } from './compat/global/core/ai/model.d';

const DEFAULT_MAX_RESPONSE = 8192;
const DEFAULT_QUOTE_MAX_TOKEN = 2000;
const normalizeString = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
};

const resolveModelId = (input: string | LLMModelItemType | undefined, fallback: string): string => {
  if (typeof input === 'string' && input.trim()) return input.trim();
  if (input && typeof input === 'object' && typeof input.model === 'string' && input.model.trim()) {
    return input.model.trim();
  }
  return fallback;
};

export const getLLMModel = (input: string | LLMModelItemType): LLMModelItemType => {
  const config = getAgentRuntimeConfig();
  const model = resolveModelId(input, config.toolCallModel);
  const profile = getChatModelProfile(model) as Record<string, unknown> | undefined;

  const maxContext =
    (typeof profile?.maxContext === 'number' && Number.isFinite(profile.maxContext)
      ? profile.maxContext
      : undefined) ||
    config.maxContext ||
    16000;

  const maxResponse =
    (typeof profile?.maxResponse === 'number' && Number.isFinite(profile.maxResponse)
      ? profile.maxResponse
      : undefined) ||
    DEFAULT_MAX_RESPONSE;

  const quoteMaxToken =
    (typeof profile?.quoteMaxToken === 'number' && Number.isFinite(profile.quoteMaxToken)
      ? profile.quoteMaxToken
      : undefined) ||
    DEFAULT_QUOTE_MAX_TOKEN;

  const profileProtocol = normalizeString(profile?.protocol)?.toLowerCase();
  const protocol =
    !profileProtocol || profileProtocol === "openai" ? "openai" : profileProtocol;
  const baseUrl = normalizeString(profile?.baseUrl);
  const key = normalizeString(profile?.key);

  return {
    provider: config.provider,
    model,
    name: model,
    protocol,
    baseUrl,
    key,
    type: 'llm',
    maxContext,
    maxResponse,
    quoteMaxToken,
    maxTemperature:
      typeof profile?.maxTemperature === 'number' && Number.isFinite(profile.maxTemperature)
        ? profile.maxTemperature
        : undefined,
    reasoning: typeof profile?.reasoning === 'boolean' ? profile.reasoning : undefined,
    toolChoice: true,
    functionCall: true,
    defaultConfig:
      profile?.defaultConfig && typeof profile.defaultConfig === 'object' && !Array.isArray(profile.defaultConfig)
        ? (profile.defaultConfig as Record<string, unknown>)
        : undefined,
    fieldMap:
      profile?.fieldMap && typeof profile.fieldMap === 'object' && !Array.isArray(profile.fieldMap)
        ? (profile.fieldMap as Record<string, string>)
        : undefined
  } as LLMModelItemType;
};

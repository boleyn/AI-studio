import { getAgentRuntimeConfig } from '@aistudio/server/agent/runtimeConfig';
import {
  getChatModelProfile,
} from '@aistudio/server/aiProxy/catalogStore';

import type { LLMModelItemType } from './compat/global/core/ai/model.d';

const FALLBACK_MAX_CONTEXT = 192000;
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
    FALLBACK_MAX_CONTEXT;

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

export const getModelToolChoiceMode = (
  input: string | LLMModelItemType | undefined
): "auto" | "required" | "none" | undefined => {
  const config = getAgentRuntimeConfig();
  const model = resolveModelId(input, config.toolCallModel);
  const profile = getChatModelProfile(model) as Record<string, unknown> | undefined;
  const modeRaw =
    normalizeString(profile?.toolChoiceMode) ||
    normalizeString(profile?.toolChoice) ||
    normalizeString(profile?.forceToolChoice);
  if (!modeRaw) return undefined;
  const normalized = modeRaw.toLowerCase();
  if (normalized === "auto" || normalized === "required" || normalized === "none") {
    return normalized;
  }
  return undefined;
};

export type UserModelConfig = {
  id: string;
  label?: string;
  icon?: string;
  protocol?: string;
  baseUrl?: string;
  key?: string;
  maxContext?: number;
  maxTemperature?: number;
  reasoning?: boolean;
  vision?: boolean;
  visionModel?: string;
  toolChoice?: string;
  toolChoiceMode?: string;
  forceToolChoice?: string;
  defaultConfig?: Record<string, unknown>;
  fieldMap?: Record<string, unknown>;
};

const trimOrUndefined = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
};

const numberOrUndefined = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
};

const booleanOrUndefined = (value: unknown): boolean | undefined => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return undefined;
};

const objectOrUndefined = (value: unknown): Record<string, unknown> | undefined => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
};

const normalizeSingle = (value: unknown): UserModelConfig | undefined => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const id = trimOrUndefined(record.id);
  if (!id) return undefined;

  const normalized: UserModelConfig = {
    id,
    label: trimOrUndefined(record.label),
    icon: trimOrUndefined(record.icon),
    protocol: trimOrUndefined(record.protocol),
    baseUrl: trimOrUndefined(record.baseUrl),
    key: trimOrUndefined(record.key),
    maxContext: numberOrUndefined(record.maxContext),
    maxTemperature: numberOrUndefined(record.maxTemperature),
    reasoning: booleanOrUndefined(record.reasoning),
    vision: booleanOrUndefined(record.vision),
    visionModel: trimOrUndefined(record.visionModel),
    toolChoice: trimOrUndefined(record.toolChoice),
    toolChoiceMode: trimOrUndefined(record.toolChoiceMode),
    forceToolChoice: trimOrUndefined(record.forceToolChoice),
    defaultConfig: objectOrUndefined(record.defaultConfig),
    fieldMap: objectOrUndefined(record.fieldMap),
  };

  return normalized;
};

export const normalizeUserModelConfigs = (value: unknown): UserModelConfig[] => {
  if (!Array.isArray(value)) return [];
  const deduped = new Map<string, UserModelConfig>();
  value.forEach((item) => {
    const normalized = normalizeSingle(item);
    if (!normalized) return;
    if (!deduped.has(normalized.id)) {
      deduped.set(normalized.id, normalized);
    }
  });
  return Array.from(deduped.values());
};

export const getUserModelConfigsFromUser = (
  user: { customModels?: unknown } | null | undefined
) => {
  return normalizeUserModelConfigs(user?.customModels);
};

export const toUserModelProfileMap = (models: UserModelConfig[]) => {
  const map = new Map<string, Record<string, unknown>>();
  models.forEach((model) => {
    map.set(model.id, {
      protocol: model.protocol,
      baseUrl: model.baseUrl,
      key: model.key,
      maxContext: model.maxContext,
      maxTemperature: model.maxTemperature,
      reasoning: model.reasoning,
      vision: model.vision,
      visionModel: model.visionModel,
      toolChoice: model.toolChoice,
      toolChoiceMode: model.toolChoiceMode,
      forceToolChoice: model.forceToolChoice,
      defaultConfig: model.defaultConfig,
      fieldMap: model.fieldMap,
    });
  });
  return map;
};

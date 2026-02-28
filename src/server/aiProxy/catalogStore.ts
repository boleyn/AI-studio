import { getAgentRuntimeConfig } from "@server/agent/runtimeConfig";
import { promises as fs } from "fs";
import JSON5 from "json5";
import path from "path";

export interface ChatModelOption {
  id: string;
  label: string;
  channel: string;
  source: "aiproxy" | "env";
}

export interface ChatModelChannel {
  id: string;
  label: string;
  source: "aiproxy" | "env";
}

export interface ChatModelCatalog {
  models: ChatModelOption[];
  channels: ChatModelChannel[];
  defaultChannel: string;
  defaultModel: string;
  toolCallModel: string;
  normalModel: string;
  source: "aiproxy" | "env";
  fetchedAt: string;
  warning?: string;
  catalogKey: string;
}

type ConfigModelItem = {
  id?: unknown;
  label?: unknown;
  maxContext?: unknown;
  maxResponse?: unknown;
  quoteMaxToken?: unknown;
  maxTemperature?: unknown;
  reasoning?: unknown;
  defaultConfig?: unknown;
  fieldMap?: unknown;
};

type ConfigFileShape = {
  defaultKey?: unknown;
  model?: unknown;
  [key: string]: unknown;
};

const DEFAULT_CONFIG_FILE = "config/config.json";
const DEFAULT_CHANNEL = "aiproxy";
const DEFAULT_CATALOG_KEY = "default";

let catalogCache:
  | {
      defaultKey: string;
      catalogs: Record<string, ChatModelCatalog>;
      profiles: Record<string, Map<string, Record<string, unknown>>>;
    }
  | undefined;

const resolveConfigFilePath = () => {
  const configured = process.env.CHAT_MODEL_CONFIG_FILE?.trim();
  const relativePath = configured || DEFAULT_CONFIG_FILE;
  return path.isAbsolute(relativePath) ? relativePath : path.join(process.cwd(), relativePath);
};

const toNumber = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
};

const toBoolean = (value: unknown): boolean | undefined => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return undefined;
};

const parseModels = (value: unknown) => {
  if (!Array.isArray(value)) {
    return [] as Array<{ id: string; label: string; profile?: Record<string, unknown> }>;
  }

  const normalized = value.reduce<Array<{ id: string; label: string; profile?: Record<string, unknown> }>>(
    (acc, item) => {
      if (!item || typeof item !== "object") return acc;
      const record = item as ConfigModelItem;

      const idRaw = record.id;
      const id = typeof idRaw === "string" ? idRaw.trim() : "";
      if (!id) return acc;

      const labelRaw = record.label;
      const label = typeof labelRaw === "string" && labelRaw.trim() ? labelRaw.trim() : id;

      const profile: Record<string, unknown> = {
        maxContext: toNumber(record.maxContext),
        maxResponse: toNumber(record.maxResponse),
        quoteMaxToken: toNumber(record.quoteMaxToken),
        maxTemperature: toNumber(record.maxTemperature),
        reasoning: toBoolean(record.reasoning),
        defaultConfig:
          record.defaultConfig && typeof record.defaultConfig === "object" && !Array.isArray(record.defaultConfig)
            ? record.defaultConfig
            : undefined,
        fieldMap: record.fieldMap && typeof record.fieldMap === "object" && !Array.isArray(record.fieldMap)
          ? record.fieldMap
          : undefined,
      };

      acc.push({ id, label, profile });
      return acc;
    },
    []
  );

  const deduped = new Map<string, { id: string; label: string; profile?: Record<string, unknown> }>();
  normalized.forEach((item) => {
    if (!deduped.has(item.id)) deduped.set(item.id, item);
  });

  return Array.from(deduped.values());
};

const buildCatalog = (params: {
  models: Array<{ id: string; label: string; profile?: Record<string, unknown> }>;
  warning?: string;
}): ChatModelCatalog => {
  const runtime = getAgentRuntimeConfig();

  const modelList =
    params.models.length > 0
      ? params.models
      : [{ id: runtime.toolCallModel || "agent", label: runtime.toolCallModel || "agent", profile: undefined }];

  const defaultModel =
    modelList.find((item) => item.id === runtime.toolCallModel)?.id ||
    modelList.find((item) => item.id === runtime.normalModel)?.id ||
    modelList[0]?.id ||
    "agent";

  return {
    models: modelList.map((item) => ({
      id: item.id,
      label: item.label,
      channel: DEFAULT_CHANNEL,
      source: "aiproxy" as const,
    })),
    channels: [
      {
        id: DEFAULT_CHANNEL,
        label: DEFAULT_CHANNEL,
        source: "aiproxy" as const,
      },
    ],
    defaultChannel: DEFAULT_CHANNEL,
    defaultModel,
    toolCallModel: runtime.toolCallModel,
    normalModel: runtime.normalModel,
    source: "aiproxy",
    fetchedAt: new Date().toISOString(),
    warning: params.warning,
    catalogKey: DEFAULT_CATALOG_KEY,
  };
};

export const warmupChatModelCatalogs = async () => {
  const filePath = resolveConfigFilePath();

  try {
    const rawText = await fs.readFile(filePath, "utf8");
    const parsed = JSON5.parse(rawText) as ConfigFileShape;
    const parsedEntries = (() => {
      if (Array.isArray(parsed?.model)) {
        return { default: parsed.model } as Record<string, unknown>;
      }

      const entries = Object.entries(parsed || {}).reduce<Record<string, unknown>>((acc, [key, value]) => {
        if (key === "defaultKey") return acc;
        if (!value || typeof value !== "object" || Array.isArray(value)) return acc;
        const modelList = (value as { model?: unknown }).model;
        if (!Array.isArray(modelList)) return acc;
        acc[key] = modelList;
        return acc;
      }, {});

      if (Object.keys(entries).length === 0 && parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const modelList = (parsed as { model?: unknown }).model;
        if (Array.isArray(modelList)) {
          entries.default = modelList;
        }
      }

      return entries;
    })();

    const catalogs = Object.entries(parsedEntries).reduce<Record<string, ChatModelCatalog>>((acc, [key, value]) => {
      const models = parseModels(value);
      acc[key] = {
        ...buildCatalog({ models }),
        catalogKey: key,
      };
      return acc;
    }, {});

    const profiles = Object.entries(parsedEntries).reduce<Record<string, Map<string, Record<string, unknown>>>>(
      (acc, [key, value]) => {
        const models = parseModels(value);
        acc[key] = new Map(models.map((item) => [item.id, item.profile || {}]));
        return acc;
      },
      {}
    );

    const keys = Object.keys(catalogs);
    const configuredDefaultKey = typeof parsed?.defaultKey === "string" ? parsed.defaultKey.trim() : "";
    const defaultKey =
      (configuredDefaultKey && catalogs[configuredDefaultKey] ? configuredDefaultKey : undefined) ||
      (catalogs.default ? "default" : undefined) ||
      keys[0] ||
      DEFAULT_CATALOG_KEY;

    if (keys.length === 0) {
      catalogs[DEFAULT_CATALOG_KEY] = buildCatalog({ models: [], warning: `config_models_empty:${filePath}` });
      profiles[DEFAULT_CATALOG_KEY] = new Map();
    }

    catalogCache = {
      defaultKey,
      catalogs,
      profiles,
    };
    return catalogCache;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error ?? "unknown");
    catalogCache = {
      defaultKey: DEFAULT_CATALOG_KEY,
      catalogs: {
        [DEFAULT_CATALOG_KEY]: buildCatalog({
          models: [],
          warning: `config_load_failed:${message}`,
        }),
      },
      profiles: {
        [DEFAULT_CATALOG_KEY]: new Map(),
      },
    };
    return catalogCache;
  }
};

const resolveKey = (requestedKey: string | undefined) => {
  if (requestedKey && requestedKey.trim()) return requestedKey.trim();
  return undefined;
};

export const getChatModelProfile = (modelId: string, key?: string) => {
  if (!modelId || !catalogCache) return undefined;
  const resolvedKey = resolveKey(key) || catalogCache.defaultKey;
  const selectedProfileMap =
    (resolvedKey && catalogCache.profiles[resolvedKey] ? catalogCache.profiles[resolvedKey] : undefined) ||
    catalogCache.profiles[catalogCache.defaultKey];
  return selectedProfileMap?.get(modelId);
};

export const getChatModelCatalog = async (options?: {
  forceRefresh?: boolean;
  key?: string;
}): Promise<ChatModelCatalog> => {
  if (!catalogCache || options?.forceRefresh) {
    await warmupChatModelCatalogs();
  }

  const cache = catalogCache as NonNullable<typeof catalogCache>;
  const requestedKey = resolveKey(options?.key);
  const selectedKey =
    (requestedKey && cache.catalogs[requestedKey] ? requestedKey : undefined) ||
    cache.defaultKey ||
    DEFAULT_CATALOG_KEY;

  const selected = cache.catalogs[selectedKey] || cache.catalogs[cache.defaultKey];

  if (requestedKey && requestedKey !== selectedKey) {
    return {
      ...selected,
      warning: [selected.warning, `catalog_key_not_found:${requestedKey}`].filter(Boolean).join(";"),
    };
  }

  return selected;
};

void warmupChatModelCatalogs().catch((error) => {
  console.error("[chat-model-catalog] warmup failed", error);
});

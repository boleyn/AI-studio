import { promises as fs } from "fs";
import JSON5 from "json5";
import path from "path";
import { warmupChatModelCatalogs } from "./catalogStore";

export type EditableModelConfig = {
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

const DEFAULT_CONFIG_FILE = "config/config.json";
const MODEL_ICON_DIR = path.join(process.cwd(), "public/icons/llms");

const resolveConfigFilePath = () => {
  const configured = process.env.CHAT_MODEL_CONFIG_FILE?.trim();
  const relativePath = configured || DEFAULT_CONFIG_FILE;
  return path.isAbsolute(relativePath) ? relativePath : path.join(process.cwd(), relativePath);
};

const trimOrUndefined = (value: unknown) => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
};

const numberOrUndefined = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
};

const booleanOrUndefined = (value: unknown) => {
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

const normalizeModel = (model: Record<string, unknown>): EditableModelConfig | undefined => {
  const id = trimOrUndefined(model.id);
  if (!id) return undefined;

  const normalized: EditableModelConfig = {
    id,
    label: trimOrUndefined(model.label),
    icon: trimOrUndefined(model.icon),
    protocol: trimOrUndefined(model.protocol),
    baseUrl: trimOrUndefined(model.baseUrl),
    key: trimOrUndefined(model.key),
    maxContext: numberOrUndefined(model.maxContext),
    maxTemperature: numberOrUndefined(model.maxTemperature),
    reasoning: booleanOrUndefined(model.reasoning),
    vision: booleanOrUndefined(model.vision),
    visionModel: trimOrUndefined(model.visionModel),
    toolChoice: trimOrUndefined(model.toolChoice),
    toolChoiceMode: trimOrUndefined(model.toolChoiceMode),
    forceToolChoice: trimOrUndefined(model.forceToolChoice),
    defaultConfig: objectOrUndefined(model.defaultConfig),
    fieldMap: objectOrUndefined(model.fieldMap),
  };

  return normalized;
};

const toConfigModel = (model: EditableModelConfig) => {
  const next: Record<string, unknown> = {
    id: model.id,
  };

  if (model.label) next.label = model.label;
  if (model.icon) next.icon = model.icon;
  if (model.protocol) next.protocol = model.protocol;
  if (model.baseUrl) next.baseUrl = model.baseUrl;
  if (model.key) next.key = model.key;
  if (typeof model.maxContext === "number") next.maxContext = model.maxContext;
  if (typeof model.maxTemperature === "number") next.maxTemperature = model.maxTemperature;
  if (typeof model.reasoning === "boolean") next.reasoning = model.reasoning;
  if (typeof model.vision === "boolean") next.vision = model.vision;
  if (model.visionModel) next.visionModel = model.visionModel;
  if (model.toolChoice) next.toolChoice = model.toolChoice;
  if (model.toolChoiceMode) next.toolChoiceMode = model.toolChoiceMode;
  if (model.forceToolChoice) next.forceToolChoice = model.forceToolChoice;
  if (model.defaultConfig && Object.keys(model.defaultConfig).length > 0) next.defaultConfig = model.defaultConfig;
  if (model.fieldMap && Object.keys(model.fieldMap).length > 0) next.fieldMap = model.fieldMap;

  return next;
};

export const getEditableModels = async () => {
  const filePath = resolveConfigFilePath();
  const rawText = await fs.readFile(filePath, "utf8");
  const parsed = JSON5.parse(rawText) as Record<string, unknown>;
  const modelValue = parsed?.model;
  const models = Array.isArray(modelValue)
    ? modelValue
        .map((item) => (item && typeof item === "object" ? normalizeModel(item as Record<string, unknown>) : undefined))
        .filter((item): item is EditableModelConfig => Boolean(item))
    : [];

  return {
    filePath,
    models,
  };
};

export const saveEditableModels = async (models: EditableModelConfig[]) => {
  const filePath = resolveConfigFilePath();
  const rawText = await fs.readFile(filePath, "utf8");
  const parsed = JSON5.parse(rawText) as Record<string, unknown>;
  const deduped = new Map<string, EditableModelConfig>();
  models.forEach((model) => {
    if (model.id.trim()) {
      deduped.set(model.id.trim(), {
        ...model,
        id: model.id.trim(),
      });
    }
  });
  parsed.model = Array.from(deduped.values()).map(toConfigModel);
  await fs.writeFile(filePath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
  await warmupChatModelCatalogs();
  return {
    filePath,
    models: Array.from(deduped.values()),
  };
};

export const listModelIcons = async () => {
  try {
    const files = await fs.readdir(MODEL_ICON_DIR, { withFileTypes: true });
    const icons = files
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".svg"))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b, "en"));
    return icons;
  } catch {
    return ["auto.svg", "openai.svg", "minimax.svg", "kimi.svg", "glm.svg", "gemini.svg"];
  }
};

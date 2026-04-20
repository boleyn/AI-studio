import { createChatId } from "@shared/chat/ids";
import { extractText } from "@shared/chat/messages";
import {
  buildDownloadUrl,
  buildPreviewUrl,
  getPresignedChatFileGetUrl,
} from "../services/files";
import type { ChatInputFile } from "../types/chatInput";
import type { ContextWindowUsage } from "../types/contextWindow";
import type { UploadedFileArtifact } from "../types/fileArtifact";
import type { ConversationMessage } from "@/types/conversation";
import type { MessageRating } from "../components/message/MessageActionBar";

export const FILE_TAG_MARKER_PREFIX = "FILETAG:";
export const SKILL_TAG_MARKER_PREFIX = "SKILLTAG:";

export const normalizeAttachmentWorkspacePath = (filePath: string): string => {
  const normalized = (filePath || "").replace(/\\/g, "/").trim();
  if (!normalized) return normalized;
  if (normalized === "/files") return "/.files";
  if (normalized.startsWith("/files/")) return `/.files/${normalized.slice("/files/".length)}`;
  return normalized;
};

export const toFileTagLabel = (filePath: string): string => {
  const normalized = (filePath || "").replace(/\\/g, "/");
  const base = normalized.split("/").filter(Boolean).pop() || filePath;
  try {
    return decodeURIComponent(base);
  } catch {
    return base;
  }
};

export const getMessageFeedback = (message: ConversationMessage): MessageRating | undefined => {
  if (!message.additional_kwargs || typeof message.additional_kwargs !== "object") return undefined;
  const value = (message.additional_kwargs as { userFeedback?: unknown }).userFeedback;
  return value === "up" || value === "down" ? value : undefined;
};

export const normalizeHistoryMessagesForTimeline = (messages: ConversationMessage[]): ConversationMessage[] => {
  if (!Array.isArray(messages) || messages.length === 0) return [];

  // Keep last occurrence for duplicated message ids while preserving chronological order.
  const latestIndexById = new Map<string, number>();
  messages.forEach((message, index) => {
    if (typeof message.id === "string" && message.id.trim()) {
      latestIndexById.set(message.id.trim(), index);
    }
  });
  const deduped = messages.filter((message, index) => {
    const id = typeof message.id === "string" ? message.id.trim() : "";
    if (!id) return true;
    return latestIndexById.get(id) === index;
  });

  const findLatestPlanProgressPayload = (
    controlEvents: unknown
  ): { explanation?: string; plan: Array<{ step: string; status: "pending" | "in_progress" | "completed" }> } | null => {
    const events = Array.isArray(controlEvents) ? controlEvents : [];
    for (let idx = events.length - 1; idx >= 0; idx -= 1) {
      const entry = events[idx];
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      const record = entry as Record<string, unknown>;
      if (record.type !== "plan_progress") continue;
      const payload =
        record.payload && typeof record.payload === "object" && !Array.isArray(record.payload)
          ? (record.payload as Record<string, unknown>)
          : null;
      if (!payload) continue;
      const rawPlan = Array.isArray(payload.plan) ? payload.plan : [];
      const plan = rawPlan
        .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item)))
        .map((item) => ({
          step: typeof item.step === "string" ? item.step.trim() : "",
          status:
            item.status === "completed"
              ? "completed"
              : item.status === "in_progress"
              ? "in_progress"
              : "pending",
        }))
        .filter((item) => item.step.length > 0);
      if (plan.length === 0) continue;
      return {
        ...(typeof payload.explanation === "string" && payload.explanation.trim()
          ? { explanation: payload.explanation.trim() }
          : {}),
        plan,
      };
    }
    return null;
  };

  return deduped.map((message) => {
    const kwargs =
      message.additional_kwargs && typeof message.additional_kwargs === "object" && !Array.isArray(message.additional_kwargs)
        ? (message.additional_kwargs as Record<string, unknown>)
        : null;
    if (!kwargs || kwargs.planProgress) return message;

    const planProgress = findLatestPlanProgressPayload(kwargs.controlEvents);
    if (!planProgress) return message;

    return {
      ...message,
      additional_kwargs: {
        ...kwargs,
        planProgress,
      },
    };
  });
};

export const buildConversationTitle = (value: string): string | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > 40 ? `${trimmed.slice(0, 40)}...` : trimmed;
};

export const normalizeProjectFiles = (rawFiles: unknown): Record<string, { code: string }> | null => {
  if (!rawFiles || typeof rawFiles !== "object") return null;
  const next: Record<string, { code: string }> = {};
  for (const [filePath, value] of Object.entries(rawFiles as Record<string, unknown>)) {
    if (typeof filePath !== "string" || !filePath) continue;
    if (typeof value === "string") {
      next[filePath] = { code: value };
      continue;
    }
    if (value && typeof value === "object" && typeof (value as { code?: unknown }).code === "string") {
      next[filePath] = { code: (value as { code: string }).code };
    }
  }
  return Object.keys(next).length > 0 ? next : null;
};

export const buildUserBubbleContent = ({
  text,
  files: _files,
  selectedSkills,
  selectedFilePaths,
}: {
  text: string;
  files: UploadedFileArtifact[];
  selectedSkills?: string[];
  selectedFilePaths?: string[];
}) => {
  const trimmedText = text.trim();
  const skillTagsMarkdown =
    selectedSkills && selectedSkills.length > 0
      ? selectedSkills
          .map((skill) => `[${skill}](${SKILL_TAG_MARKER_PREFIX}${encodeURIComponent(skill)})`)
          .join(" ")
      : "";
  const fileTagsMarkdown =
    selectedFilePaths && selectedFilePaths.length > 0
      ? selectedFilePaths
          .map((path) => normalizeAttachmentWorkspacePath(path))
          .filter(Boolean)
          .map((path) => `[${toFileTagLabel(path)}](${FILE_TAG_MARKER_PREFIX}${encodeURIComponent(path)})`)
          .join(" ")
      : "";
  // User image previews are rendered from artifact.files in ChatItem to avoid stale markdown URLs in history.
  return [skillTagsMarkdown, fileTagsMarkdown, trimmedText].filter(Boolean).join("\n\n");
};

export const stripTagMarkersFromUserContent = (content: string): string => {
  if (!content) return "";
  const noSkillTags = content.replace(
    /\[[^\]]+\]\(SKILLTAG:[^)]+\)/g,
    ""
  );
  const noFileTags = noSkillTags.replace(
    /\[[^\]]+\]\(FILETAG:[^)]+\)/g,
    ""
  );
  return noFileTags;
};

export const stripInlineImageMarkdown = (content: string): string => {
  if (!content) return "";
  return content
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "");
};

export const isImageArtifact = (file: UploadedFileArtifact) => (file.type || "").toLowerCase().startsWith("image/");

export const toStableChatFileViewUrl = ({
  storagePath,
  token,
  chatId,
}: {
  storagePath?: string;
  token: string;
  chatId: string;
}) => {
  if (!storagePath) return "";
  const params = new URLSearchParams({
    storagePath,
  });
  if (token) params.set("token", token);
  if (chatId) params.set("chatId", chatId);
  return `/api/core/chat/files/view?${params.toString()}`;
};

export const hydrateHistoryUserMessage = ({
  message,
  token,
  chatId,
}: {
  message: ConversationMessage;
  token: string;
  chatId: string;
}): ConversationMessage => {
  if (message.role !== "user" || !message.artifact || typeof message.artifact !== "object") {
    return message;
  }

  const artifact = message.artifact as { files?: unknown };
  const files = Array.isArray(artifact.files)
    ? (artifact.files as UploadedFileArtifact[])
    : [];
  if (files.length === 0) return message;

  const hydratedFiles = files.map((file) => {
    if (!isImageArtifact(file)) return file;
    const stablePreviewUrl =
      file.publicUrl || toStableChatFileViewUrl({ storagePath: file.storagePath, token, chatId }) || file.previewUrl;
    if (!stablePreviewUrl || stablePreviewUrl === file.previewUrl) return file;
    return {
      ...file,
      previewUrl: stablePreviewUrl,
    };
  });

  const imageFiles = hydratedFiles.filter((file) => isImageArtifact(file));
  if (imageFiles.length === 0) {
    return {
      ...message,
      artifact: {
        ...artifact,
        files: hydratedFiles,
      },
    };
  }

  const imageByName = new Map<string, string>();
  const imageQueue: string[] = [];
  imageFiles.forEach((file) => {
    const nextUrl = file.previewUrl || file.publicUrl || "";
    if (!nextUrl) return;
    if (file.name) {
      imageByName.set(file.name, nextUrl);
    }
    imageQueue.push(nextUrl);
  });

  let queueIndex = 0;
  const originalContent = extractText(message.content);
  const rewrittenContent = originalContent.replace(
    /!\[([^\]]*)\]\(([^)]+)\)/g,
    (full, alt: string) => {
      const byName = imageByName.get(alt);
      const byOrder = imageQueue[queueIndex];
      if (byOrder) queueIndex += 1;
      const nextUrl = byName || byOrder;
      if (!nextUrl) return full;
      return `![${alt}](${nextUrl})`;
    }
  );

  return {
    ...message,
    content: rewrittenContent,
    artifact: {
      ...artifact,
      files: hydratedFiles,
    },
  };
};

export const toFileArtifacts = (files: ChatInputFile[]) =>
  files.map((item) => ({
    id: item.id,
    name: item.file.name,
    size: item.file.size,
    type: item.file.type,
    lastModified: item.file.lastModified,
    parse: {
      status: "pending" as const,
      progress: 0,
      parser: "metadata" as const,
    },
  }));

export const getImageInputParts = async (files: UploadedFileArtifact[]) => {
  const imageFiles = files
    .filter((item) => (item.type || "").startsWith("image/") && item.storagePath)
    .slice(0, 4);

  return imageFiles
    .filter((item) => (item.size || 0) <= 4 * 1024 * 1024)
    .map((item) => ({
      type: "image_url" as const,
      image_url: {
        url: item.previewUrl || item.publicUrl || "",
      },
      key: item.storagePath,
    }))
    .filter((item) => item.image_url.url || item.key);
};

export const toUpdatedFilesMap = (value: unknown): Record<string, { code: string }> | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const normalizeWorkspaceFilePath = (inputPath: string): string => {
    const normalized = inputPath.replace(/\\/g, "/").trim();
    if (!normalized) return "";
    return normalized.startsWith("/") ? normalized : `/${normalized}`;
  };

  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return null;

  const normalized: Record<string, { code: string }> = {};
  for (const [path, file] of entries) {
    if (!path || typeof path !== "string") return null;
    if (!file || typeof file !== "object" || Array.isArray(file)) return null;

    const code = (file as { code?: unknown }).code;
    if (typeof code !== "string") return null;

    const normalizedPath = normalizeWorkspaceFilePath(path);
    if (!normalizedPath) return null;
    normalized[normalizedPath] = { code };
  }

  return Object.keys(normalized).length > 0 ? normalized : null;
};

export const toContextWindowUsage = (
  value: unknown,
  fallbackModel?: string
): ContextWindowUsage | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const usedTokens = candidate.usedTokens;
  const maxContext = candidate.maxContext;
  const remainingTokens = candidate.remainingTokens;
  const usedPercent = candidate.usedPercent;
  if (
    typeof usedTokens !== "number" ||
    !Number.isFinite(usedTokens) ||
    typeof maxContext !== "number" ||
    !Number.isFinite(maxContext) ||
    typeof remainingTokens !== "number" ||
    !Number.isFinite(remainingTokens) ||
    typeof usedPercent !== "number" ||
    !Number.isFinite(usedPercent)
  ) {
    return null;
  }

  return {
    model: typeof candidate.model === "string" && candidate.model ? candidate.model : fallbackModel || "agent",
    usedTokens,
    maxContext,
    remainingTokens,
    usedPercent,
    totalPromptTokens:
      typeof candidate.totalPromptTokens === "number" && Number.isFinite(candidate.totalPromptTokens)
        ? candidate.totalPromptTokens
        : undefined,
    currentInputTokens:
      typeof candidate.currentInputTokens === "number" && Number.isFinite(candidate.currentInputTokens)
        ? candidate.currentInputTokens
        : undefined,
    budget:
      candidate.budget && typeof candidate.budget === "object" && !Array.isArray(candidate.budget)
        ? (candidate.budget as ContextWindowUsage["budget"])
        : undefined,
  };
};

export const getLatestContextUsageFromMessages = (
  conversationMessages: ConversationMessage[],
  fallbackModel?: string
): ContextWindowUsage | null => {
  for (let i = conversationMessages.length - 1; i >= 0; i -= 1) {
    const message = conversationMessages[i];
    if (!message.additional_kwargs || typeof message.additional_kwargs !== "object") continue;
    const kwargs = message.additional_kwargs as Record<string, unknown>;
    const fromPrimary = toContextWindowUsage(kwargs.contextWindow, fallbackModel);
    if (fromPrimary) return fromPrimary;
    const fromLegacy = toContextWindowUsage(kwargs.contextWindowUsage, fallbackModel);
    if (fromLegacy) return fromLegacy;
  }
  return null;
};

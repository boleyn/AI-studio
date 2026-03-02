import { Box, Flex, Spinner, Text } from "@chakra-ui/react";
import { withAuthHeaders } from "@features/auth/client/authClient";
import { extractText } from "@shared/chat/messages";
import { createId } from "@shared/chat/messages";
import { streamFetch, SseResponseEventEnum } from "@shared/network/streamFetch";
import { useRouter } from "next/router";
import { useTranslation } from "next-i18next";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConversations } from "../hooks/useConversations";
import {
  buildDownloadUrl,
  buildPreviewUrl,
  fetchMarkdownContent,
  fetchMarkdownContentByUrl,
  parseChatFiles,
  uploadChatFiles,
} from "../services/files";
import { updateMessageFeedback } from "../services/feedback";
import { getChatModels } from "../services/models";
import type { ChatModelCatalog } from "../services/models";
import { listSkills } from "../services/skills";
import type { ChatInputFile, ChatInputSubmitPayload } from "../types/chatInput";
import type { UploadedFileArtifact } from "../types/fileArtifact";
import { getExecutionSummary } from "../utils/executionSummary";
import { type FlowNodeResponsePayload } from "../utils/flowNodeMessages";

import ChatHeader from "./ChatHeader";
import ChatInput from "./ChatInput";
import SkillsManagerModal from "./SkillsManagerModal";
import ChatMessageBlock from "./message/ChatMessageBlock";
import type { MessageRating } from "./message/MessageActionBar";
import ExecutionSummaryRow from "./ExecutionSummaryRow";

import type { ConversationMessage } from "@/types/conversation";

const TEXT_FILE_EXTENSIONS = [
  ".txt",
  ".md",
  ".json",
  ".js",
  ".ts",
  ".tsx",
  ".jsx",
  ".py",
  ".java",
  ".go",
  ".rs",
  ".css",
  ".html",
  ".xml",
  ".yml",
  ".yaml",
  ".log",
  ".csv",
] as const;
const MAX_TEXT_FILE_SIZE = 200 * 1024;
const MAX_TEXT_FILE_PREVIEW = 3000;

interface ToolStreamPayload {
  id?: string;
  toolName?: string;
  params?: string;
  response?: string;
}

interface ReasoningStreamPayload {
  reasoningText?: string;
}

interface WorkflowDurationPayload {
  durationSeconds?: number;
}
const FILE_TAG_MARKER_PREFIX = "FILETAG:";
const SKILL_TAG_MARKER_PREFIX = "SKILLTAG:";

const getMessageFeedback = (message: ConversationMessage): MessageRating | undefined => {
  if (!message.additional_kwargs || typeof message.additional_kwargs !== "object") return undefined;
  const value = (message.additional_kwargs as { userFeedback?: unknown }).userFeedback;
  return value === "up" || value === "down" ? value : undefined;
};

const buildConversationTitle = (value: string): string | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > 40 ? `${trimmed.slice(0, 40)}...` : trimmed;
};

const isTextLikeFile = (file: File) => {
  if (file.type.startsWith("text/")) return true;
  const lowerName = file.name.toLowerCase();
  return TEXT_FILE_EXTENSIONS.some((ext) => lowerName.endsWith(ext));
};

const buildFilePrompt = async (files: ChatInputFile[]) => {
  if (files.length === 0) return "";

  const sections: string[] = [];

  for (const item of files) {
    const file = item.file;
    const header = `文件: ${file.name} (${file.type || "unknown"}, ${file.size} bytes)`;

    if (!isTextLikeFile(file) || file.size > MAX_TEXT_FILE_SIZE) {
      sections.push(`${header}\n该文件为二进制或过大文件，仅提供元信息。`);
      continue;
    }

    try {
      const raw = await file.text();
      const preview = raw.slice(0, MAX_TEXT_FILE_PREVIEW);
      sections.push(
        `${header}\n\n\`\`\`\n${preview}${raw.length > MAX_TEXT_FILE_PREVIEW ? "\n... [truncated]" : ""}\n\`\`\``
      );
    } catch {
      sections.push(`${header}\n无法读取文件内容，仅提供元信息。`);
    }
  }

  return sections.join("\n\n");
};

const buildFilePromptFromArtifacts = (files: UploadedFileArtifact[]) => {
  if (!files.length) return "";

  const sections = files.map((file) => {
    const header = `### 文件: ${file.name}`;
    const markdown = typeof file.parse?.markdown === "string" ? file.parse.markdown.trim() : "";

    if ((file.type || "").startsWith("image/") && file.previewUrl) {
      return [header, `![${file.name}](${file.previewUrl})`].join("\n\n");
    }

    if (markdown) {
      return [header, markdown].join("\n\n");
    }

    return `${header}\n\n该文件当前无可解析正文，仅提供元信息。`;
  });

  return sections.join("\n\n");
};

const buildUserBubbleContent = ({
  text,
  files,
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
          .map((path) => `[${path}](${FILE_TAG_MARKER_PREFIX}${encodeURIComponent(path)})`)
          .join(" ")
      : "";
  const imageMarkdown = files
    .filter((file) => (file.type || "").startsWith("image/") && file.previewUrl)
    .map((file) => `![${file.name || "image"}](${file.previewUrl})`)
    .join("\n\n");

  return [skillTagsMarkdown, fileTagsMarkdown, trimmedText, imageMarkdown].filter(Boolean).join("\n\n");
};

const hydrateArtifactsMarkdown = async (files: UploadedFileArtifact[]) => {
  const hydrated = await Promise.all(
    files.map(async (file) => {
      const markdown = file.markdownPublicUrl
        ? await fetchMarkdownContentByUrl(file.markdownPublicUrl).catch(() => "")
        : file.markdownStoragePath
        ? await fetchMarkdownContent(file.markdownStoragePath).catch(() => "")
        : "";
      if (!markdown) return file;
      return {
        ...file,
        parse: {
          ...(file.parse || {
            status: "success" as const,
            progress: 100,
            parser: "text" as const,
          }),
          markdown,
        },
      };
    })
  );

  return hydrated;
};

const toFileArtifacts = (files: ChatInputFile[]) =>
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
      markdown: "",
    },
  }));

const getImageInputParts = async (files: UploadedFileArtifact[]) => {
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

const toUpdatedFilesMap = (value: unknown): Record<string, { code: string }> | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return null;

  const normalized: Record<string, { code: string }> = {};
  for (const [path, file] of entries) {
    if (!path || typeof path !== "string") return null;
    if (!file || typeof file !== "object" || Array.isArray(file)) return null;

    const code = (file as { code?: unknown }).code;
    if (typeof code !== "string") return null;

    normalized[path] = { code };
  }

  return Object.keys(normalized).length > 0 ? normalized : null;
};

const ChatPanel = ({
  token,
  onFilesUpdated,
  height = "100%",
  completionsPath = "/api/chat/completions",
  completionsStream = true,
  completionsExtraBody,
  hideSkillsManager = false,
  autoCreateInitialConversation = true,
  defaultHeaderTitle = "代码助手",
  emptyStateTitle,
  emptyStateDescription,
  roundTop = true,
  defaultSelectedSkill,
  fileOptions = [],
  skillsProjectToken,
}: {
  token: string;
  onFilesUpdated?: (files: Record<string, { code: string }>) => void;
  height?: string;
  completionsPath?: string;
  completionsStream?: boolean;
  completionsExtraBody?: Record<string, unknown>;
  hideSkillsManager?: boolean;
  autoCreateInitialConversation?: boolean;
  defaultHeaderTitle?: string;
  emptyStateTitle?: string;
  emptyStateDescription?: string;
  roundTop?: boolean;
  defaultSelectedSkill?: string;
  fileOptions?: string[];
  skillsProjectToken?: string;
}) => {
  const { t } = useTranslation();
  const router = useRouter();
  const {
    conversations,
    activeConversation,
    isLoadingConversation,
    isInitialized,
    createNewConversation,
    ensureConversation,
    loadConversation,
    deleteConversation,
    deleteAllConversations,
    updateConversationTitle,
  } = useConversations(token, router, { autoCreateInitialConversation });

  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  const [messageRatings, setMessageRatings] = useState<Record<string, MessageRating | undefined>>(
    {}
  );
  const [modelLoading, setModelLoading] = useState(false);
  const [channel, setChannel] = useState("aiproxy");
  const [model, setModel] = useState("agent");
  const [isSkillsOpen, setIsSkillsOpen] = useState(false);
  const [selectedSkills, setSelectedSkills] = useState<string[]>(
    defaultSelectedSkill ? [defaultSelectedSkill] : []
  );
  const [skillOptions, setSkillOptions] = useState<Array<{ name: string; description?: string }>>([]);
  const [modelOptions, setModelOptions] = useState<Array<{ value: string; label: string; channel: string; icon?: string }>>([
    { value: "agent", label: "agent", channel: "aiproxy" },
  ]);
  const [modelCatalog, setModelCatalog] = useState<ChatModelCatalog | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const shouldAutoScrollRef = useRef(true);
  const scrollRafRef = useRef<number | null>(null);
  const streamAbortRef = useRef<AbortController | null>(null);
  const streamingConversationIdRef = useRef<string | null>(null);
  const streamingTextRef = useRef("");
  const streamingReasoningRef = useRef("");
  const streamFlushFrameRef = useRef<number | null>(null);
  const reasoningFlushFrameRef = useRef<number | null>(null);
  const skillListRefreshKey = useMemo(
    () =>
      fileOptions
        .filter((item) => /\/SKILL\.md$/i.test(item))
        .sort((a, b) => a.localeCompare(b))
        .join("|"),
    [fileOptions]
  );

  const flushAssistantReasoning = useCallback((assistantMessageId: string, reasoningText: string) => {
    setMessages((prev) =>
      prev.map((msg) => {
        if (msg.id !== assistantMessageId) return msg;
        const currentKwargs =
          msg.additional_kwargs && typeof msg.additional_kwargs === "object"
            ? msg.additional_kwargs
            : {};
        return {
          ...msg,
          additional_kwargs: {
            ...currentKwargs,
            reasoning_text: reasoningText,
          },
        };
      })
    );
  }, []);

  const flushAssistantText = useCallback((assistantMessageId: string, content: string) => {
    setMessages((prev) =>
      prev.map((msg) =>
        msg.id === assistantMessageId
          ? {
              ...msg,
              content,
            }
          : msg
      )
    );
  }, []);

  const scheduleAssistantTextFlush = useCallback(
    (assistantMessageId: string) => {
      if (streamFlushFrameRef.current !== null) return;

      streamFlushFrameRef.current = window.requestAnimationFrame(() => {
        streamFlushFrameRef.current = null;
        flushAssistantText(assistantMessageId, streamingTextRef.current);
      });
    },
    [flushAssistantText]
  );

  const scheduleAssistantReasoningFlush = useCallback(
    (assistantMessageId: string) => {
      if (reasoningFlushFrameRef.current !== null) return;

      reasoningFlushFrameRef.current = window.requestAnimationFrame(() => {
        reasoningFlushFrameRef.current = null;
        flushAssistantReasoning(assistantMessageId, streamingReasoningRef.current);
      });
    },
    [flushAssistantReasoning]
  );

  useEffect(() => {
    const nextMessages = activeConversation?.messages ?? [];
    setMessages(nextMessages);
    setMessageRatings(() => {
      const next: Record<string, MessageRating | undefined> = {};
      for (const message of nextMessages) {
        if (!message.id) continue;
        const feedback = getMessageFeedback(message);
        if (feedback) {
          next[message.id] = feedback;
        }
      }
      return next;
    });
    shouldAutoScrollRef.current = true;
  }, [activeConversation?.id, activeConversation?.messages]);

  useEffect(() => {
    let active = true;
    setModelLoading(true);
    getChatModels()
      .then((catalog) => {
        if (!active) return;
        setModelCatalog(catalog);

        const options = catalog.models.length
          ? catalog.models.map((item) => {
              return {
                value: item.id,
                label: item.label || item.id,
                channel: item.channel,
              };
            })
          : [
              {
                value: catalog.defaultModel || catalog.toolCallModel || "agent",
                label: catalog.defaultModel || catalog.toolCallModel || "agent",
                channel: catalog.defaultChannel || "aiproxy",
              },
            ];
        setModelOptions(options);
        const nextModel = (() => {
          const prevMatch = options.find((item) => item.value === model);
          if (prevMatch) return prevMatch.value;
          return catalog.defaultModel || catalog.toolCallModel || options[0]?.value || "agent";
        })();

        setModel(nextModel);
        const selectedModel = options.find((item) => item.value === nextModel);
        setChannel(selectedModel?.channel || catalog.defaultChannel || "aiproxy");
      })
      .catch(() => {
        if (!active) return;
        setModelCatalog(null);
        setChannel("aiproxy");
        setModelOptions([{ value: "agent", label: "agent", channel: "aiproxy" }]);
      })
      .finally(() => {
        if (active) setModelLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!modelCatalog) return;
    const selected = modelCatalog.models.find((item) => item.id === model);
    if (!selected) return;
    if (selected.channel !== channel) {
      setChannel(selected.channel);
    }
  }, [channel, model, modelCatalog]);

  useEffect(() => {
    let active = true;
    const tokenForSkills =
      (skillsProjectToken && skillsProjectToken.trim()) ||
      (token.startsWith("skill-studio:") ? "" : token);
    listSkills(tokenForSkills)
      .then((result) => {
        if (!active) return;
        const next = (result.skills || [])
          .filter((item) => item.isLoadable && typeof item.name === "string" && item.name.length > 0)
          .map((item) => ({
            name: item.name as string,
            description: item.description,
          }));
        setSkillOptions(next);
        if (
          defaultSelectedSkill &&
          selectedSkills.length === 0 &&
          next.some((item) => item.name === defaultSelectedSkill)
        ) {
          setSelectedSkills([defaultSelectedSkill]);
        }
      })
      .catch(() => {
        if (!active) return;
        setSkillOptions([]);
      });
    return () => {
      active = false;
    };
  }, [
    defaultSelectedSkill,
    isSkillsOpen,
    selectedSkills.length,
    skillsProjectToken,
    token,
    skillListRefreshKey,
  ]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (!shouldAutoScrollRef.current) return;
    if (scrollRafRef.current !== null) {
      window.cancelAnimationFrame(scrollRafRef.current);
    }
    scrollRafRef.current = window.requestAnimationFrame(() => {
      const target = scrollRef.current;
      if (!target) return;
      target.scrollTop = target.scrollHeight;
      scrollRafRef.current = null;
    });
  }, [messages]);

  useEffect(() => {
    return () => {
      if (scrollRafRef.current !== null) {
        window.cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = null;
      }
      if (streamFlushFrameRef.current !== null) {
        window.cancelAnimationFrame(streamFlushFrameRef.current);
        streamFlushFrameRef.current = null;
      }
      if (reasoningFlushFrameRef.current !== null) {
        window.cancelAnimationFrame(reasoningFlushFrameRef.current);
        reasoningFlushFrameRef.current = null;
      }
    };
  }, []);

  const prepareUploadFiles = useCallback(
    async (pickedFiles: ChatInputFile[]) => {
      if (pickedFiles.length === 0) return [] as UploadedFileArtifact[];

      const conversation = await ensureConversation();
      const uploadChatId = conversation?.id ?? activeConversation?.id ?? createId();

      const uploadedFiles = await uploadChatFiles({
        token,
        chatId: uploadChatId,
        files: pickedFiles,
      });
      const parsedFiles =
        uploadedFiles.length > 0
          ? await parseChatFiles({
              files: uploadedFiles,
            }).catch(() => uploadedFiles)
          : uploadedFiles;

      const withPreviewUrls = parsedFiles.map((file) => ({
        ...file,
        previewUrl: file.publicUrl
          ? buildPreviewUrl({
              publicUrl: file.publicUrl,
            })
          : undefined,
        downloadUrl: file.storagePath
          ? buildDownloadUrl({
              storagePath: file.storagePath,
            })
          : undefined,
      }));

      return withPreviewUrls.length > 0 ? await hydrateArtifactsMarkdown(withPreviewUrls) : withPreviewUrls;
    },
    [activeConversation?.id, ensureConversation, token]
  );

  const handleSend = useCallback(
    async (
      payload: ChatInputSubmitPayload,
      options?: {
        echoUserMessage?: boolean;
      }
    ) => {
      const text = payload.text.trim();
      if ((text.length === 0 && payload.files.length === 0 && !payload.selectedFilePaths?.length) || isSending)
        return;
      const echoUserMessage = options?.echoUserMessage ?? true;

      const conversation = await ensureConversation();
      const conversationId = conversation?.id ?? activeConversation?.id;

      const displayText =
        text ||
        (payload.selectedFilePaths?.length ? `已选择 ${payload.selectedFilePaths.length} 个文件` : "") ||
        `已上传 ${payload.files.length} 个文件`;
      const nextConversationTitle = buildConversationTitle(text);

      const userMessageId = createId();
      const fallbackArtifacts = toFileArtifacts(payload.files);
      const finalArtifacts =
        payload.uploadedFiles.length > 0 ? payload.uploadedFiles : fallbackArtifacts;
      if (echoUserMessage) {
        setMessages((prev) => [
          ...prev,
          {
            role: "user",
            content: displayText,
            id: userMessageId,
            artifact:
              payload.files.length > 0
                ? {
                    files: finalArtifacts,
                  }
                : undefined,
          },
        ]);
      }

      const filePrompt =
        payload.uploadedFiles.length > 0
          ? buildFilePromptFromArtifacts(payload.uploadedFiles)
          : await buildFilePrompt(payload.files);
      const imageInputParts = await getImageInputParts(finalArtifacts);

      if (echoUserMessage && conversationId && nextConversationTitle) {
        updateConversationTitle(conversationId, nextConversationTitle);
      }

      const userBubbleContent = buildUserBubbleContent({
        text,
        files: finalArtifacts,
        selectedSkills: payload.selectedSkills || (payload.selectedSkill ? [payload.selectedSkill] : undefined),
        selectedFilePaths: payload.selectedFilePaths,
      });

      const userMessage: ConversationMessage = {
        role: "user",
        content: userBubbleContent || displayText,
        id: userMessageId,
        artifact: payload.files.length > 0 ? { files: finalArtifacts } : undefined,
        additional_kwargs: filePrompt
          ? {
              filePrompt,
              ...(payload.selectedFilePaths ? { selectedFilePaths: payload.selectedFilePaths } : {}),
            }
          : payload.selectedFilePaths
          ? { selectedFilePaths: payload.selectedFilePaths }
          : undefined,
      };

      if (echoUserMessage) {
        setMessages((prev) =>
          prev.map((msg) => {
            if (msg.id !== userMessageId) return msg;
            return userMessage;
          })
        );
      }
      setIsSending(true);

      const requestMessage: ConversationMessage = {
        ...userMessage,
        additional_kwargs: {
          ...(userMessage.additional_kwargs || {}),
          imageInputParts,
          ...(payload.selectedSkill ? { selectedSkill: payload.selectedSkill } : {}),
          ...(payload.selectedSkills ? { selectedSkills: payload.selectedSkills } : {}),
          ...(payload.selectedFilePaths ? { selectedFilePaths: payload.selectedFilePaths } : {}),
        },
      };

      const assistantMessageId = createId();
      streamingTextRef.current = "";
      streamingReasoningRef.current = "";
      if (streamFlushFrameRef.current !== null) {
        window.cancelAnimationFrame(streamFlushFrameRef.current);
        streamFlushFrameRef.current = null;
      }
      if (reasoningFlushFrameRef.current !== null) {
        window.cancelAnimationFrame(reasoningFlushFrameRef.current);
        reasoningFlushFrameRef.current = null;
      }
      setStreamingMessageId(assistantMessageId);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "",
          id: assistantMessageId,
        },
      ]);

      const abortCtrl = new AbortController();
      streamAbortRef.current = abortCtrl;
      streamingConversationIdRef.current = conversationId ?? null;
      try {
        const updateAssistantMetadata = (
          updater: (current: Record<string, unknown>) => Record<string, unknown>
        ) => {
          setMessages((prev) =>
            prev.map((msg) => {
              if (msg.id !== assistantMessageId) return msg;
              const current =
                msg.additional_kwargs && typeof msg.additional_kwargs === "object"
                  ? msg.additional_kwargs
                  : {};
              return {
                ...msg,
                additional_kwargs: updater(current),
              };
            })
          );
        };

        const upsertToolMessage = (
          id: string,
          nextPartial: { toolName?: string; params?: string; response?: string }
        ) => {
          updateAssistantMetadata((current) => {
            const list = Array.isArray(current.toolDetails)
              ? (current.toolDetails as Array<{
                  id?: string;
                  toolName?: string;
                  params?: string;
                  response?: string;
                }>)
              : [];
            const index = list.findIndex((item) => item.id === id);
            const base = index >= 0 ? list[index] : { id, params: "", response: "" };
            const merged = {
              ...base,
              id,
              toolName: nextPartial.toolName ?? base.toolName,
              params: `${base.params || ""}${nextPartial.params || ""}`,
              response: nextPartial.response ?? base.response,
            };
            const next = [...list];
            if (index >= 0) {
              next[index] = merged;
            } else {
              next.push(merged);
            }
            return {
              ...current,
              toolDetails: next,
            };
          });
        };
        const appendTimelineText = (type: "reasoning" | "answer", text: string) => {
          if (!text) return;
          updateAssistantMetadata((current) => {
            const list = Array.isArray(current.timeline)
              ? (current.timeline as Array<Record<string, unknown>>)
              : [];
            const last = list[list.length - 1];
            if (last && last.type === type && typeof last.text === "string") {
              const next = [...list];
              next[next.length - 1] = {
                ...last,
                text: `${last.text}${text}`,
              };
              return { ...current, timeline: next };
            }
            return {
              ...current,
              timeline: [...list, { type, text }],
            };
          });
        };
        const upsertTimelineTool = (nextPartial: {
          id?: string;
          toolName?: string;
          params?: string;
          response?: string;
        }) => {
          updateAssistantMetadata((current) => {
            const list = Array.isArray(current.timeline)
              ? (current.timeline as Array<Record<string, unknown>>)
              : [];
            const toolId = typeof nextPartial.id === "string" ? nextPartial.id : "";
            if (toolId) {
              const index = list.findIndex((item) => item.type === "tool" && item.id === toolId);
              if (index >= 0) {
                const target = list[index];
                const next = [...list];
                next[index] = {
                  ...target,
                  id: toolId,
                  toolName:
                    typeof nextPartial.toolName === "string" ? nextPartial.toolName : target.toolName,
                  params: typeof nextPartial.params === "string" ? nextPartial.params : target.params,
                  response:
                    typeof nextPartial.response === "string" ? nextPartial.response : target.response,
                };
                return { ...current, timeline: next };
              }
            }
            return {
              ...current,
              timeline: [
                ...list,
                {
                  type: "tool",
                  id: toolId || undefined,
                  toolName: nextPartial.toolName || "",
                  params: nextPartial.params || "",
                  response: nextPartial.response || "",
                },
              ],
            };
          });
        };

        if (!completionsStream) {
          const historyMessages = [...messages, requestMessage].map((message) => ({
            role: message.role,
            content: extractText(message.content),
          }));
          const response = await fetch(completionsPath, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...withAuthHeaders(),
            },
            signal: abortCtrl.signal,
            body: JSON.stringify({
              token,
              messages: historyMessages,
              ...(conversationId ? { conversationId } : {}),
              channel,
              model,
              ...(payload.selectedSkill ? { selectedSkill: payload.selectedSkill } : {}),
              ...(payload.selectedSkills ? { selectedSkills: payload.selectedSkills } : {}),
              ...(payload.selectedFilePaths ? { selectedFilePaths: payload.selectedFilePaths } : {}),
              ...(completionsExtraBody || {}),
            }),
          });
          const responsePayload = await response.json().catch(() => ({}));
          if (!response.ok) {
            throw new Error(
              typeof responsePayload?.error === "string" ? responsePayload.error : "请求失败"
            );
          }
          const assistantText =
            typeof responsePayload?.assistant?.content === "string"
              ? responsePayload.assistant.content
              : "已完成";
          const assistantReasoning =
            typeof responsePayload?.assistant?.reasoning === "string"
              ? responsePayload.assistant.reasoning
              : "";
          streamingTextRef.current = assistantText;
          streamingReasoningRef.current = assistantReasoning;

          if (onFilesUpdated) {
            const files = toUpdatedFilesMap(responsePayload?.files);
            if (files) onFilesUpdated(files);
          }
        } else {
          await streamFetch({
            url: completionsPath,
            data: {
              token,
              messages: [requestMessage],
              stream: true,
              ...(conversationId ? { conversationId } : {}),
              channel,
              model,
              ...(payload.selectedSkill ? { selectedSkill: payload.selectedSkill } : {}),
              ...(payload.selectedSkills ? { selectedSkills: payload.selectedSkills } : {}),
              ...(payload.selectedFilePaths ? { selectedFilePaths: payload.selectedFilePaths } : {}),
              ...(completionsExtraBody || {}),
            },
            headers: withAuthHeaders(),
            abortCtrl,
            onMessage: (item) => {
              if (abortCtrl.signal.aborted) return;
              if (item.event === SseResponseEventEnum.answer) {
                const answerPayload = item as { text?: string; reasoningText?: string };
                if (answerPayload.reasoningText) {
                  const reasoningText = answerPayload.reasoningText;
                  streamingReasoningRef.current = `${streamingReasoningRef.current}${reasoningText}`;
                  scheduleAssistantReasoningFlush(assistantMessageId);
                  appendTimelineText("reasoning", reasoningText);
                }
                if (answerPayload.text) {
                  streamingTextRef.current = `${streamingTextRef.current}${answerPayload.text}`;
                  scheduleAssistantTextFlush(assistantMessageId);
                  appendTimelineText("answer", answerPayload.text);
                }
                return;
              }
              if (item.event === SseResponseEventEnum.toolCall) {
                const streamPayload = item as ToolStreamPayload;
                if (streamPayload.id) {
                  upsertToolMessage(streamPayload.id, {
                    toolName: streamPayload.toolName,
                    params: "",
                    response: "",
                  });
                  upsertTimelineTool({
                    id: streamPayload.id,
                    toolName: streamPayload.toolName,
                  });
                }
                return;
              }
              if (item.event === SseResponseEventEnum.toolParams) {
                const streamPayload = item as ToolStreamPayload;
                if (streamPayload.id) {
                  upsertToolMessage(streamPayload.id, {
                    toolName: streamPayload.toolName,
                    params: streamPayload.params || "",
                  });
                  upsertTimelineTool({
                    id: streamPayload.id,
                    toolName: streamPayload.toolName,
                    params: streamPayload.params || "",
                  });
                }
                return;
              }
              if (item.event === SseResponseEventEnum.toolResponse) {
                const streamPayload = item as ToolStreamPayload;
                if (streamPayload.id) {
                  upsertToolMessage(streamPayload.id, {
                    toolName: streamPayload.toolName,
                    params: streamPayload.params || "",
                    response: streamPayload.response || "",
                  });
                  upsertTimelineTool({
                    id: streamPayload.id,
                    toolName: streamPayload.toolName,
                    params: streamPayload.params || "",
                    response: streamPayload.response || "",
                  });
                }

                if (streamPayload.response && onFilesUpdated) {
                  try {
                    const parsed = JSON.parse(streamPayload.response);
                    const filesCandidate =
                      (parsed as { files?: Record<string, { code: string }> }).files ||
                      (parsed as { data?: { files?: Record<string, { code: string }> } }).data?.files;
                    const files = toUpdatedFilesMap(filesCandidate);
                    if (files && typeof files === "object") {
                      onFilesUpdated(files);
                    }
                  } catch {
                    return;
                  }
                }
                return;
              }
              if (item.event === SseResponseEventEnum.flowNodeResponse) {
                const streamPayload = item as FlowNodeResponsePayload;
                updateAssistantMetadata((current) => {
                  const currentResponseData = Array.isArray(current.responseData)
                    ? current.responseData
                    : [];
                  return {
                    ...current,
                    responseData: [...currentResponseData, streamPayload],
                  };
                });
                return;
              }
              if (item.event === SseResponseEventEnum.workflowDuration) {
                const streamPayload = item as WorkflowDurationPayload;
                if (typeof streamPayload.durationSeconds !== "number") return;
                updateAssistantMetadata((current) => ({
                  ...current,
                  durationSeconds: streamPayload.durationSeconds,
                }));
              }
            },
          });
        }
      } catch (error) {
        if (abortCtrl.signal.aborted) {
          return;
        }
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMessageId
              ? { ...msg, content: `请求失败: ${error instanceof Error ? error.message : "未知错误"}` }
              : msg
          )
        );
      } finally {
        if (streamFlushFrameRef.current !== null) {
          window.cancelAnimationFrame(streamFlushFrameRef.current);
          streamFlushFrameRef.current = null;
        }
        if (reasoningFlushFrameRef.current !== null) {
          window.cancelAnimationFrame(reasoningFlushFrameRef.current);
          reasoningFlushFrameRef.current = null;
        }
        if (streamingTextRef.current) {
          flushAssistantText(assistantMessageId, streamingTextRef.current);
        }
        if (streamingReasoningRef.current) {
          flushAssistantReasoning(assistantMessageId, streamingReasoningRef.current);
        }
        if (streamAbortRef.current === abortCtrl) {
          streamAbortRef.current = null;
          streamingConversationIdRef.current = null;
        }
        setStreamingMessageId(null);
        setIsSending(false);
      }
    },
    [
      activeConversation?.id,
      ensureConversation,
      isSending,
      model,
      channel,
      completionsExtraBody,
      completionsPath,
      completionsStream,
      onFilesUpdated,
      token,
      updateConversationTitle,
      scheduleAssistantReasoningFlush,
    ]
  );

  const handleStop = useCallback(() => {
    const chatId = streamingConversationIdRef.current;
    const abortCtrl = streamAbortRef.current;
    if (!abortCtrl) return;

    // 立即停止前端流，确保按钮点击立刻生效
    abortCtrl.abort(new Error("stop"));

    if (!chatId) return;
    if (!completionsStream || completionsPath !== "/api/chat/completions") return;

    // 后端停止异步执行，避免网络慢导致前端停不下来
    const stopApiAbort = new AbortController();
    const timeout = setTimeout(() => stopApiAbort.abort(new Error("stop timeout")), 5000);
    fetch("/api/v2/chat/stop", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...withAuthHeaders(),
      },
      body: JSON.stringify({ token, chatId }),
      signal: stopApiAbort.signal,
    })
      .catch(() => {
        // ignore stop API errors
      })
      .finally(() => {
        clearTimeout(timeout);
      });
  }, [completionsPath, completionsStream, token]);

  const handleRateMessage = useCallback(
    async (messageId: string, nextRating: MessageRating) => {
      const conversationId = activeConversation?.id;
      if (!conversationId) return;

      let previous: MessageRating | undefined;
      let resolved: MessageRating | undefined;

      setMessageRatings((prev) => {
        previous = prev[messageId];
        resolved = previous === nextRating ? undefined : nextRating;
        return {
          ...prev,
          [messageId]: resolved,
        };
      });

      setMessages((prev) =>
        prev.map((message) => {
          if (message.id !== messageId) return message;
          const kwargs =
            message.additional_kwargs && typeof message.additional_kwargs === "object"
              ? message.additional_kwargs
              : {};
          return {
            ...message,
            additional_kwargs: {
              ...kwargs,
              userFeedback: resolved,
            },
          };
        })
      );

      try {
        await updateMessageFeedback({
          token,
          conversationId,
          messageId,
          feedback: resolved,
        });
      } catch {
        setMessageRatings((prev) => ({
          ...prev,
          [messageId]: previous,
        }));
        setMessages((prev) =>
          prev.map((message) => {
            if (message.id !== messageId) return message;
            const kwargs =
              message.additional_kwargs && typeof message.additional_kwargs === "object"
                ? message.additional_kwargs
                : {};
            return {
              ...message,
              additional_kwargs: {
                ...kwargs,
                userFeedback: previous,
              },
            };
          })
        );
      }
    },
    [activeConversation?.id, token]
  );

  const handleDeleteMessage = useCallback((messageId: string) => {
    setMessages((prev) => prev.filter((message) => message.id !== messageId));
  }, []);

  const handleRegenerateMessage = useCallback(
    async (assistantMessageId: string) => {
      if (isSending) return;
      const snapshot = [...messages];
      const assistantIndex = snapshot.findIndex((message) => message.id === assistantMessageId);
      if (assistantIndex < 0) return;

      const previousUserMessage = [...snapshot.slice(0, assistantIndex)]
        .reverse()
        .find((message) => message.role === "user");
      if (!previousUserMessage) return;

      const text = extractText(previousUserMessage.content).trim();
      if (!text) return;

      setMessages((prev) => prev.slice(0, assistantIndex));
      setMessageRatings((prev) => {
        const next = { ...prev };
        for (const message of snapshot.slice(assistantIndex)) {
          if (!message.id) continue;
          delete next[message.id];
        }
        return next;
      });

      await handleSend({
        text,
        files: [],
        uploadedFiles: [],
        selectedSkill: selectedSkills[0],
        selectedSkills,
        selectedFilePaths:
          previousUserMessage.additional_kwargs &&
          typeof previousUserMessage.additional_kwargs === "object" &&
          Array.isArray((previousUserMessage.additional_kwargs as { selectedFilePaths?: unknown }).selectedFilePaths)
            ? ((previousUserMessage.additional_kwargs as { selectedFilePaths?: unknown }).selectedFilePaths as unknown[])
                .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
            : undefined,
      }, { echoUserMessage: false });
    },
    [handleSend, isSending, messages, selectedSkills]
  );

  const activeConversationTitle = useMemo(
    () => activeConversation?.title || defaultHeaderTitle,
    [activeConversation?.title, defaultHeaderTitle]
  );

  const handleUseSkill = useCallback((skillName: string) => {
    setSelectedSkills((prev) => (prev.includes(skillName) ? prev : [...prev, skillName]));
  }, []);

  const handleCreateSkillViaChat = useCallback(() => {
    const projectToken = token.startsWith("skill-studio:") ? "" : token;
    void router.push(
      projectToken
        ? `/skills/create?projectToken=${encodeURIComponent(projectToken)}`
        : "/skills/create"
    );
  }, [router, token]);
  const showInitialLoading = !isInitialized && messages.length === 0;

  return (
    <Flex
      backdropFilter="blur(10px)"
      bg="transparent"
      border="1px solid"
      borderBottomLeftRadius="xl"
      borderColor="rgba(203,213,225,0.85)"
      borderRight={0}
      borderTopLeftRadius={roundTop ? "xl" : 0}
      boxShadow="0 12px 30px -18px rgba(15,23,42,0.2)"
      direction="column"
      h={height}
      overflow="hidden"
    >
      <ChatHeader
        activeConversationId={activeConversation?.id}
        conversations={conversations}
        model={model}
        modelLoading={modelLoading}
        modelOptions={modelOptions}
        onChangeModel={setModel}
        onDeleteAllConversations={() => deleteAllConversations()}
        onDeleteConversation={(id) => deleteConversation(id)}
        onNewConversation={() => createNewConversation()}
        onOpenSkills={!hideSkillsManager ? () => setIsSkillsOpen(true) : undefined}
        onSelectConversation={(id) => loadConversation(id)}
        title={activeConversationTitle}
      />

      <Flex direction="column" flex="1" overflow="hidden">
        <Box
          ref={scrollRef}
          bg="linear-gradient(180deg, rgba(248,250,252,0.82) 0%, rgba(241,245,249,0.78) 100%)"
          flex="1"
          overflowY="auto"
          px={4}
          py={4}
          onScroll={(event) => {
            const el = event.currentTarget;
            const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
            shouldAutoScrollRef.current = distanceToBottom < 80;
          }}
        >
          {showInitialLoading ? (
            <Flex align="center" color="gray.600" gap={2} h="full" justify="center">
              <Spinner size="sm" />
              <Text fontSize="sm">{t("chat:loading_conversation", { defaultValue: "加载对话..." })}</Text>
            </Flex>
          ) : messages.length === 0 ? (
            <Flex align="center" color="gray.500" h="full" justify="center">
              <Box textAlign="center">
                <Text color="myGray.700" fontSize="lg" fontWeight="700">
                  {emptyStateTitle || t("chat:ready_start", { defaultValue: "准备开始" })}
                </Text>
                <Text fontSize="sm" mt={1}>
                  {emptyStateDescription ||
                    t("chat:ready_desc", { defaultValue: "描述你想改的功能，我会直接修改代码" })}
                </Text>
              </Box>
            </Flex>
          ) : (
            <Flex direction="column" gap={3}>
              {messages.map((message, index) => {
                const messageId = message.id ?? `${message.role}-${index}`;
                const summary = getExecutionSummary(message);
                const canRegenerate =
                  message.role === "assistant" &&
                  messages.slice(0, index).some((item) => item.role === "user");
                return (
                  <Box key={messageId}>
                    <ChatMessageBlock
                      isStreaming={message.id === streamingMessageId}
                      message={message}
                      messageId={messageId}
                      canRegenerate={canRegenerate}
                      onDelete={() => handleDeleteMessage(messageId)}
                      onRate={(rating) => handleRateMessage(messageId, rating)}
                      onRegenerate={() => {
                        void handleRegenerateMessage(messageId);
                      }}
                      rating={messageRatings[messageId]}
                    />
                    {summary ? (
                      <ExecutionSummaryRow
                        durationSeconds={summary.durationSeconds}
                        nodeCount={summary.nodeCount}
                      />
                    ) : null}
                  </Box>
                );
              })}
              {isLoadingConversation ? (
                <Flex align="center" color="gray.500" gap={2} justify="center" py={1}>
                  <Spinner size="xs" />
                  <Text fontSize="xs">{t("chat:loading_conversation", { defaultValue: "加载对话..." })}</Text>
                </Flex>
              ) : null}
            </Flex>
          )}
        </Box>

        <ChatInput
          isSending={isSending}
          model={model}
          modelLoading={modelLoading}
          modelOptions={modelOptions}
          selectedSkill={selectedSkills[0]}
          selectedSkills={selectedSkills}
          skillOptions={skillOptions}
          fileOptions={fileOptions}
          onChangeModel={setModel}
          onChangeSelectedSkills={setSelectedSkills}
          onUploadFiles={prepareUploadFiles}
          onSend={handleSend}
          onStop={handleStop}
        />
      </Flex>
      {!hideSkillsManager ? (
        <SkillsManagerModal
          isOpen={isSkillsOpen}
          onClose={() => setIsSkillsOpen(false)}
          onCreateViaChat={handleCreateSkillViaChat}
          onUseSkill={handleUseSkill}
        />
      ) : null}
    </Flex>
  );
};

export default ChatPanel;

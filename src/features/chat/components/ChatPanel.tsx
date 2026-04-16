import { withAuthHeaders } from "@features/auth/client/authClient";
import { createChatId, createDataId } from "@shared/chat/ids";
import { extractText } from "@shared/chat/messages";
import {
  isPlanInteractionEnvelope,
  type PlanInteractionEnvelope,
  type PlanProgressInteractionPayload,
} from "@shared/chat/planInteraction";
import { streamFetch } from "@shared/network/streamFetch";
import { SdkStreamEventEnum } from "@shared/network/sdkStreamEvents";
import { useRouter } from "next/router";
import { useTranslation } from "next-i18next";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { ChatPanelViewProvider } from "../context/ChatPanelViewContext";
import { useConversations } from "../hooks/useConversations";
import {
  buildDownloadUrl,
  buildPreviewUrl,
  getPresignedChatFileGetUrl,
  uploadChatFiles,
} from "../services/files";
import {
  getConversation as getConversationById,
  replaceConversationMessages,
} from "../services/conversations";
import type { ChatInputFile, ChatInputSubmitPayload } from "../types/chatInput";
import type { ContextWindowUsage } from "../types/contextWindow";
import type { UploadedFileArtifact } from "../types/fileArtifact";
import { type PermissionApprovalPayload } from "../types/chatPanelRuntime";
import { getExecutionSummary } from "../utils/executionSummary";
import {
  derivePlanModeFromMessages,
  parseToolPayload,
  type PlanModeApprovalPayload,
} from "../utils/planModeDisplay";
import { derivePlanResumeState } from "../utils/planResume";

import ChatPanelView from "./ChatPanelView";
import type { MessageRating } from "./message/MessageActionBar";

import type { ConversationMessage } from "@/types/conversation";

import {
  FILE_TAG_MARKER_PREFIX,
  SKILL_TAG_MARKER_PREFIX,
  buildConversationTitle,
  buildUserBubbleContent,
  getLatestContextUsageFromMessages,
  getMessageFeedback,
  hydrateHistoryUserMessage,
  normalizeProjectFiles,
  toFileArtifacts,
  getImageInputParts,
  toUpdatedFilesMap,
  normalizeHistoryMessagesForTimeline,
} from "../utils/chatPanelUtils";
import { useChatModels } from "../hooks/useChatModels";
import { useChatMessageActions } from "../hooks/useChatMessageActions";
import { useChatPlanInteractions } from "../hooks/useChatPlanInteractions";
import { useChatSkills } from "../hooks/useChatSkills";
import { useChatStreamFlusher } from "../hooks/useChatStreamFlusher";
import { useChatAutoScroll } from "../hooks/useChatAutoScroll";
import { updatePrimaryModel } from "../services/models";

const buildContextUsageCacheKey = (conversationId: string, modelId: string) =>
  `${conversationId}::${modelId}`;
const THINKING_ENABLED_STORAGE_KEY = "aistudio.chat.thinkingEnabled";

const readThinkingEnabled = () => {
  if (typeof window === "undefined") return true;
  try {
    const value = window.localStorage.getItem(THINKING_ENABLED_STORAGE_KEY);
    if (value === "0") return false;
    if (value === "1") return true;
  } catch {
    // ignore
  }
  return true;
};

const persistThinkingEnabled = (enabled: boolean) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(THINKING_ENABLED_STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    // ignore
  }
};

const isSdkLikeMessage = (value: unknown): value is {
  type: "user" | "assistant" | "system" | "progress";
  uuid?: string;
  timestamp?: string;
  message?: {
    role?: "user" | "assistant" | "system" | "tool";
    content?: unknown;
  };
  meta?: Record<string, unknown>;
} => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const type = typeof record.type === "string" ? record.type : "";
  return type === "user" || type === "assistant" || type === "system" || type === "progress";
};

const sdkContentToText = (content: unknown): string => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((item) => {
      if (!item || typeof item !== "object") return "";
      const block = item as Record<string, unknown>;
      if (block.type === "text" && typeof block.text === "string") return block.text;
      // Only assistant "text" blocks should become the final visible answer body.
      // thinking/tool_result are intermediate protocol artifacts and must stay in timeline metadata.
      return "";
    })
    .join("");
};


const ChatPanel = ({
  token,
  onFilesUpdated,
  height = "100%",
  completionsPath = "/api/v2/chat/completions",
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
  openSkillsSignal = 0,
  thinkingTooltipEnabled,
  thinkingTooltipDisabled,
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
  openSkillsSignal?: number;
  thinkingTooltipEnabled?: string;
  thinkingTooltipDisabled?: string;
}) => {
  const { t } = useTranslation();
  const router = useRouter();
  const { user } = useAuth();
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
  const [thinkingEnabled, setThinkingEnabled] = useState(true);
  const [chatMode, setChatMode] = useState<"default" | "plan">("default");
  const [planResumeInputEnabled, setPlanResumeInputEnabled] = useState(false);
  const [messageRatings, setMessageRatings] = useState<Record<string, MessageRating | undefined>>(
    {}
  );
  const messagesRef = useRef<ConversationMessage[]>([]);
  const { model, setModel, channel, modelOptions, modelGroups, modelLoading, modelCatalog } = useChatModels(
    user?.primaryModel
  );
  
  const {
    isSkillsOpen,
    setIsSkillsOpen,
    selectedSkills,
    setSelectedSkills,
    skillOptions,
  } = useChatSkills({
    token,
    defaultSelectedSkill,
    hideSkillsManager,
    openSkillsSignal,
    skillsProjectToken,
    fileOptions,
  });

  const [contextUsage, setContextUsage] = useState<ContextWindowUsage | null>(null);
  const [contextStatus, setContextStatus] = useState<"idle" | "pending" | "ready">("idle");
  const contextUsageRef = useRef<ContextWindowUsage | null>(null);
  const contextUsageCacheRef = useRef<Record<string, ContextWindowUsage>>({});
  const streamAbortRef = useRef<AbortController | null>(null);
  const streamingConversationIdRef = useRef<string | null>(null);
  const streamingMessageIdRef = useRef<string | null>(null);

  const handleChangeModel = useCallback(
    (nextModel: string) => {
      if (nextModel === model) return;
      setModel(nextModel);
      updatePrimaryModel(nextModel).catch(() => {
        // Ignore persistence failures to keep the chat interaction smooth.
      });
    },
    [model, setModel]
  );
  useEffect(() => {
    setThinkingEnabled(readThinkingEnabled());
  }, []);
  const handleChangeThinkingEnabled = useCallback((enabled: boolean) => {
    setThinkingEnabled(enabled);
    persistThinkingEnabled(enabled);
  }, []);
  const selectedModelSupportsReasoning = useMemo(() => {
    const selected = modelCatalog?.models?.find((item) => item.id === model);
    return selected?.reasoning === true;
  }, [model, modelCatalog]);

  const { scrollRef, shouldAutoScrollRef, scrollRafRef } = useChatAutoScroll(messages);
  const {
    streamingTextRef,
    streamingReasoningRef,
    cancelPendingFlushes,
    scheduleAssistantTextFlush,
    scheduleAssistantReasoningFlush,
    flushAssistantText,
    flushAssistantReasoning,
  } = useChatStreamFlusher(setMessages);

  const setContextUsageSnapshot = useCallback(
    (next: ContextWindowUsage | null, conversationId?: string | null, modelId?: string | null) => {
      contextUsageRef.current = next;
      setContextUsage(next);
      if (next) {
        const cacheModelId = (modelId || next.model || "").trim();
        if (conversationId && cacheModelId) {
          contextUsageCacheRef.current[buildContextUsageCacheKey(conversationId, cacheModelId)] = next;
        }
        setContextStatus("ready");
        return;
      }
      setContextStatus("idle");
    },
    []
  );

  const getCachedContextUsage = useCallback((conversationId?: string | null, modelId?: string | null) => {
    const safeConversationId = (conversationId || "").trim();
    const safeModelId = (modelId || "").trim();
    if (!safeConversationId || !safeModelId) return null;
    return contextUsageCacheRef.current[buildContextUsageCacheKey(safeConversationId, safeModelId)] || null;
  }, []);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    streamingMessageIdRef.current = streamingMessageId;
  }, [streamingMessageId]);

  useEffect(() => {
    const nextMessages = activeConversation?.messages ?? [];
    const chatId = activeConversation?.id || "";
    const hydratedMessages =
      chatId && nextMessages.length > 0
        ? nextMessages.map((message) =>
            hydrateHistoryUserMessage({
              message,
              token,
              chatId,
            })
          )
        : nextMessages;
    const normalizedHydratedMessages = normalizeHistoryMessagesForTimeline(hydratedMessages);
    const isStreamingCurrentConversation =
      Boolean(streamAbortRef.current) &&
      Boolean(chatId) &&
      streamingConversationIdRef.current === chatId;
    if (isStreamingCurrentConversation) {
      const localMessages = messagesRef.current;
      const localCount = localMessages.length;
      const hydratedCount = normalizedHydratedMessages.length;
      const activeStreamingId = (streamingMessageIdRef.current || "").trim();
      const localHasStreamingMessage = activeStreamingId
        ? localMessages.some((message) => message.id === activeStreamingId)
        : false;
      const hydratedHasStreamingMessage = activeStreamingId
        ? normalizedHydratedMessages.some((message) => message.id === activeStreamingId)
        : false;
      if (
        hydratedCount < localCount ||
        (localHasStreamingMessage && !hydratedHasStreamingMessage)
      ) {
        return;
      }
    }
    setMessages(normalizedHydratedMessages);
    setChatMode(derivePlanModeFromMessages(normalizedHydratedMessages));
    setPlanResumeInputEnabled(false);
    setMessageRatings(() => {
      const next: Record<string, MessageRating | undefined> = {};
      for (const message of normalizedHydratedMessages) {
        if (!message.id) continue;
        const feedback = getMessageFeedback(message);
        if (feedback) {
          next[message.id] = feedback;
        }
      }
      return next;
    });
    shouldAutoScrollRef.current = true;
  }, [
    activeConversation?.id,
    activeConversation?.messages,
    token,
  ]);

  useEffect(() => {
    const activeId = activeConversation?.id || "";
    if (!activeId) {
      setContextUsageSnapshot(null);
      return;
    }
    const activeMessages = activeConversation?.messages ?? [];
    if (activeMessages.length === 0) {
      // New/empty conversation should always start from a clean context usage state.
      setContextUsageSnapshot(null, activeId, model);
      return;
    }
    const cachedUsage = getCachedContextUsage(activeId, model);
    if (cachedUsage) {
      setContextUsageSnapshot(cachedUsage, activeId, model);
      return;
    }
    const recoveredUsage = getLatestContextUsageFromMessages(messagesRef.current, model);
    const matchedRecoveredUsage =
      recoveredUsage && (!recoveredUsage.model || recoveredUsage.model === model)
        ? recoveredUsage
        : null;
    setContextUsageSnapshot(matchedRecoveredUsage || null, activeId, model);
  }, [activeConversation?.id, activeConversation?.messages, getCachedContextUsage, model, setContextUsageSnapshot]);





  const prepareUploadFiles = useCallback(
    async (pickedFiles: ChatInputFile[]) => {
      if (pickedFiles.length === 0) return [] as UploadedFileArtifact[];

      const conversation = await ensureConversation();
      const uploadChatId = conversation?.id ?? activeConversation?.id ?? createChatId();

      const uploadedFiles = await uploadChatFiles({
        token,
        chatId: uploadChatId,
        files: pickedFiles,
      });

      const withPreviewUrls = await Promise.all(
        uploadedFiles.map(async (file) => {
          const signedPreviewUrl = file.storagePath
            ? await getPresignedChatFileGetUrl({
                token,
                key: file.storagePath,
              }).catch(() => "")
            : "";
          return {
            ...file,
            previewUrl:
              signedPreviewUrl ||
              (file.publicUrl
                ? buildPreviewUrl({
                    publicUrl: file.publicUrl,
                  })
                : undefined),
            downloadUrl: file.storagePath
              ? buildDownloadUrl({
                  storagePath: file.storagePath,
                  token,
                  chatId: uploadChatId,
                })
              : undefined,
          };
        })
      );

      if (onFilesUpdated) {
        const response = await fetch(`/api/code?token=${encodeURIComponent(token)}`, {
          headers: withAuthHeaders(),
        }).catch(() => null);
        if (response?.ok) {
          const payload = (await response.json().catch(() => ({}))) as { files?: unknown };
          const normalized = normalizeProjectFiles(payload.files);
          if (normalized) onFilesUpdated(normalized);
        }
      }

      return withPreviewUrls;
    },
    [activeConversation?.id, ensureConversation, onFilesUpdated, token]
  );

  const handleSend = useCallback(
    async (
      payload: ChatInputSubmitPayload,
      options?: {
        echoUserMessage?: boolean;
        persistIncomingMessages?: boolean;
        continueAssistantMessageId?: string;
      }
    ) => {
      const text = payload.text.trim();
      const fallbackArtifacts = toFileArtifacts(payload.files);
      const finalArtifacts =
        payload.uploadedFiles.length > 0 ? payload.uploadedFiles : fallbackArtifacts;
      const hasArtifacts = finalArtifacts.length > 0;
      if ((text.length === 0 && !hasArtifacts && !payload.selectedFilePaths?.length) || isSending) return;
      if (planResumeInputEnabled) {
        setPlanResumeInputEnabled(false);
      }
      const echoUserMessage = options?.echoUserMessage ?? true;
      const persistIncomingMessages = options?.persistIncomingMessages ?? true;
      const continueAssistantMessageId = (options?.continueAssistantMessageId || "").trim();

      const conversation = await ensureConversation();
      const conversationId = conversation?.id ?? activeConversation?.id;
      const effectiveMode: "default" | "plan" =
        payload.planModeApprovalResponse?.decision === "approve"
          ? payload.planModeApprovalResponse.action === "enter"
            ? "plan"
            : "default"
          : chatMode;

      const displayText =
        text ||
        (payload.selectedFilePaths?.length ? `已选择 ${payload.selectedFilePaths.length} 个文件` : "") ||
        `已上传 ${finalArtifacts.length} 个文件`;
      const nextConversationTitle = buildConversationTitle(text);
      const userCreatedAt = new Date().toISOString();

      const userMessageId = createDataId();
      if (echoUserMessage) {
        shouldAutoScrollRef.current = true;
        setMessages((prev) => [
          ...prev,
          {
            type: "user",
            role: "user",
            content: displayText,
            id: userMessageId,
            time: userCreatedAt,
            subtype: effectiveMode === "plan" ? "plan_user" : "user",
            artifact:
              hasArtifacts
                ? {
                    files: finalArtifacts,
                  }
                : undefined,
          },
        ]);
      }

      const imageInputParts = await getImageInputParts(finalArtifacts);

      if (echoUserMessage && conversationId) {
        updateConversationTitle(conversationId, nextConversationTitle || "历史记录");
      }

      const userBubbleContent = buildUserBubbleContent({
        text,
        files: finalArtifacts,
        selectedSkills: payload.selectedSkills || (payload.selectedSkill ? [payload.selectedSkill] : undefined),
        selectedFilePaths: payload.selectedFilePaths,
      });

      const userMessage: ConversationMessage = {
        type: "user",
        subtype: effectiveMode === "plan" ? "plan_user" : "user",
        role: "user",
        content: userBubbleContent || displayText,
        id: userMessageId,
        time: userCreatedAt,
        artifact: hasArtifacts ? { files: finalArtifacts } : undefined,
        additional_kwargs: payload.selectedFilePaths
          ? {
              selectedFilePaths: payload.selectedFilePaths,
              ...(echoUserMessage ? {} : { hiddenFromTimeline: true }),
              planModeState: effectiveMode === "plan",
              ...(payload.planModeApprovalResponse
                ? { planModeApprovalResponse: payload.planModeApprovalResponse }
                : {}),
              ...(payload.planQuestionResponse
                ? { planQuestionResponse: payload.planQuestionResponse }
                : {}),
              ...(payload.permissionApprovalResponse
                ? { permissionApprovalResponse: payload.permissionApprovalResponse }
                : {}),
            }
          : {
              ...(echoUserMessage ? {} : { hiddenFromTimeline: true }),
              planModeState: effectiveMode === "plan",
              ...(payload.planModeApprovalResponse
                ? { planModeApprovalResponse: payload.planModeApprovalResponse }
                : {}),
              ...(payload.planQuestionResponse
                ? { planQuestionResponse: payload.planQuestionResponse }
                : {}),
              ...(payload.permissionApprovalResponse
                ? { permissionApprovalResponse: payload.permissionApprovalResponse }
                : {}),
            },
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
      setContextStatus("pending");

      const requestMessage: ConversationMessage = {
        ...userMessage,
        additional_kwargs: {
          ...(userMessage.additional_kwargs || {}),
          imageInputParts,
          ...(payload.selectedSkill ? { selectedSkill: payload.selectedSkill } : {}),
          ...(payload.selectedSkills ? { selectedSkills: payload.selectedSkills } : {}),
          ...(payload.selectedFilePaths ? { selectedFilePaths: payload.selectedFilePaths } : {}),
          planModeState: effectiveMode === "plan",
          ...(payload.planModeApprovalResponse
            ? { planModeApprovalResponse: payload.planModeApprovalResponse }
            : {}),
          ...(payload.planQuestionResponse
            ? { planQuestionResponse: payload.planQuestionResponse }
            : {}),
          ...(payload.permissionApprovalResponse
            ? { permissionApprovalResponse: payload.permissionApprovalResponse }
            : {}),
        },
      };
      const continuedAssistantMessage = continueAssistantMessageId
        ? messagesRef.current.find(
            (item) => item.id === continueAssistantMessageId && item.role === "assistant"
          ) || null
        : null;
      const isInteractionContinuation = Boolean(
        payload.planQuestionResponse || payload.planModeApprovalResponse || payload.permissionApprovalResponse
      );
      const assistantMessageId = continuedAssistantMessage?.id || createDataId();
      const assistantCreatedAt = continuedAssistantMessage?.time || new Date().toISOString();
      const existingAssistantContent = continuedAssistantMessage
        ? extractText(continuedAssistantMessage.content)
        : "";
      const existingAssistantKwargs =
        continuedAssistantMessage?.additional_kwargs &&
        typeof continuedAssistantMessage.additional_kwargs === "object"
          ? (continuedAssistantMessage.additional_kwargs as Record<string, unknown>)
          : {};
      const existingAssistantReasoning =
        !isInteractionContinuation && typeof existingAssistantKwargs.reasoning_text === "string"
          ? existingAssistantKwargs.reasoning_text
          : "";

      const requestMessagesForApi = [
        ...messagesRef.current
          .filter((item) => !(item.role === "assistant" && item.id === assistantMessageId))
          .map((item) => ({
            ...item,
            role: item.role || (item.type as ConversationMessage["role"]) || "user",
            content: item.content,
          })),
        requestMessage,
      ];
      if (continuedAssistantMessage && isInteractionContinuation) {
        setMessages((prev) =>
          prev.map((msg) => {
            if (msg.id !== assistantMessageId) return msg;
            const kwargs =
              msg.additional_kwargs && typeof msg.additional_kwargs === "object"
                ? (msg.additional_kwargs as Record<string, unknown>)
                : {};
            const sdkMessage =
              kwargs.sdkMessage && typeof kwargs.sdkMessage === "object"
                ? (kwargs.sdkMessage as Record<string, unknown>)
                : null;
            const sdkPayload =
              sdkMessage?.message && typeof sdkMessage.message === "object"
                ? (sdkMessage.message as Record<string, unknown>)
                : null;
            const content = Array.isArray(sdkPayload?.content)
              ? (sdkPayload?.content as unknown[]).filter(
                  (item) =>
                    !(
                      item &&
                      typeof item === "object" &&
                      (item as Record<string, unknown>).type === "thinking"
                    )
                )
              : [];
            return {
              ...msg,
              additional_kwargs: {
                ...kwargs,
                reasoning_text: "",
                reasoning_content: "",
                ...(sdkMessage
                  ? {
                      sdkMessage: {
                        ...sdkMessage,
                        message: {
                          ...(sdkPayload || {}),
                          role: (sdkPayload?.role as string) || "assistant",
                          content,
                        },
                      },
                    }
                  : {}),
              },
            };
          })
        );
      }
      let assistantFailureText: string | null = null;
      streamingTextRef.current = existingAssistantContent;
      streamingReasoningRef.current = existingAssistantReasoning;
      cancelPendingFlushes();
      shouldAutoScrollRef.current = true;
      setStreamingMessageId(assistantMessageId);
      if (!continuedAssistantMessage) {
        setMessages((prev) => [
          ...prev,
          {
            type: "assistant",
            subtype: effectiveMode === "plan" ? "plan_result" : "result",
            role: "assistant",
            content: "",
            id: assistantMessageId,
            time: assistantCreatedAt,
          },
        ]);
      }

      const abortCtrl = new AbortController();
      streamAbortRef.current = abortCtrl;
      streamingConversationIdRef.current = conversationId ?? null;
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
      try {
        const appendSdkBlock = (block: Record<string, unknown>) => {
          updateAssistantMetadata((current) => {
            const sdkMessage =
              current.sdkMessage && typeof current.sdkMessage === "object"
                ? (current.sdkMessage as Record<string, unknown>)
                : { type: "assistant", message: { role: "assistant", content: [] as unknown[] } };
            const sdkPayload =
              sdkMessage.message && typeof sdkMessage.message === "object"
                ? (sdkMessage.message as Record<string, unknown>)
                : { role: "assistant", content: [] as unknown[] };
            const content = Array.isArray(sdkPayload.content)
              ? (sdkPayload.content as unknown[])
              : [];
            return {
              ...current,
              sdkMessage: {
                ...sdkMessage,
                message: {
                  ...sdkPayload,
                  role: sdkPayload.role || "assistant",
                  content: [...content, block],
                },
              },
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
              persistIncomingMessages,
              ...(continueAssistantMessageId ? { continueAssistantMessageId } : {}),
              ...(conversationId ? { conversationId } : {}),
              channel,
              model,
              ...(model.toLowerCase().includes("kimi")
                ? { thinking: { type: payload.thinkingEnabled === false ? "disabled" : "enabled" } }
                : {}),
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
          const contextWindowPayload =
            responsePayload?.contextWindow && typeof responsePayload.contextWindow === "object"
              ? (responsePayload.contextWindow as ContextWindowUsage)
              : null;
          if (contextWindowPayload) {
            setContextUsageSnapshot(
              contextWindowPayload,
              conversationId || null,
              typeof contextWindowPayload.model === "string" ? contextWindowPayload.model : model
            );
            setMessages((prev) =>
              prev.map((msg) => {
                if (msg.id !== assistantMessageId) return msg;
                const kwargs =
                  msg.additional_kwargs && typeof msg.additional_kwargs === "object"
                    ? msg.additional_kwargs
                    : {};
                return {
                  ...msg,
                  additional_kwargs: {
                    ...kwargs,
                    contextWindow: contextWindowPayload,
                  },
                };
              })
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
          if (assistantText || assistantReasoning) {
            shouldAutoScrollRef.current = true;
          }

          if (onFilesUpdated) {
            const files = toUpdatedFilesMap(responsePayload?.files);
            if (files) onFilesUpdated(files);
          }
        } else {
          const streamEventQueue: unknown[] = [];
          let isDrainingStreamQueue = false;
          const processSseEventInOrder = (item: unknown) => {
            if (abortCtrl.signal.aborted) return;
            if (!item || typeof item !== "object") return;
            const event = (item as { event?: unknown }).event;
            const flushPendingAssistantStreams = () => {
              if (streamingTextRef.current) {
                flushAssistantText(assistantMessageId, streamingTextRef.current);
              }
              if (streamingReasoningRef.current) {
                flushAssistantReasoning(assistantMessageId, streamingReasoningRef.current);
              }
            };

            if (event === SdkStreamEventEnum.streamEvent) {
              const payload = item as {
                subtype?: unknown;
                text?: unknown;
                id?: unknown;
                name?: unknown;
                input?: unknown;
                content?: unknown;
                is_error?: unknown;
              };
              const subtype = typeof payload.subtype === "string" ? payload.subtype : "";
              if (subtype === "thinking_delta" && typeof payload.text === "string" && payload.text) {
                shouldAutoScrollRef.current = true;
                streamingReasoningRef.current = `${streamingReasoningRef.current}${payload.text}`;
                scheduleAssistantReasoningFlush(assistantMessageId);
                appendSdkBlock({ type: "thinking", thinking: payload.text });
                return;
              }
              if (subtype === "text_delta" && typeof payload.text === "string" && payload.text) {
                shouldAutoScrollRef.current = true;
                streamingTextRef.current = `${streamingTextRef.current}${payload.text}`;
                scheduleAssistantTextFlush(assistantMessageId);
                appendSdkBlock({ type: "text", text: payload.text });
                return;
              }
              if (subtype === "tool_use_start" && typeof payload.id === "string") {
                flushPendingAssistantStreams();
                appendSdkBlock({
                  type: "tool_use",
                  id: payload.id,
                  name: typeof payload.name === "string" ? payload.name : "tool",
                });
                return;
              }
              if (subtype === "tool_use_delta" && typeof payload.id === "string") {
                appendSdkBlock({
                  type: "tool_use",
                  id: payload.id,
                  name: typeof payload.name === "string" ? payload.name : "tool",
                  ...(payload.input !== undefined ? { input: payload.input } : {}),
                });
                return;
              }
              if (subtype === "tool_result" && typeof payload.id === "string") {
                const responseText =
                  typeof payload.content === "string"
                    ? payload.content
                    : JSON.stringify(payload.content ?? "", null, 2);
                appendSdkBlock({
                  type: "tool_result",
                  tool_use_id: payload.id,
                  content: responseText,
                  ...(payload.is_error === true ? { is_error: true } : {}),
                });
                const parsedPayload = parseToolPayload(responseText, responseText);
                if (parsedPayload) {
                  const parsed = parsedPayload as {
                    requiresPermissionApproval?: boolean;
                    permission?: PermissionApprovalPayload;
                  };
                  const permission = parsed.permission;
                  if (
                    parsed.requiresPermissionApproval === true &&
                    permission &&
                    typeof permission === "object" &&
                    typeof permission.toolName === "string"
                  ) {
                    updateAssistantMetadata((current) => ({
                      ...current,
                      permissionApproval: {
                        toolName: permission.toolName,
                        reason:
                          typeof permission.reason === "string"
                            ? permission.reason
                            : undefined,
                      },
                    }));
                  }
                }
              }
              return;
            }

            if (event === SdkStreamEventEnum.control) {
              const payload = item as { interaction?: unknown };
              const interaction = isPlanInteractionEnvelope(payload.interaction)
                ? payload.interaction
                : undefined;
              if (!interaction) return;
              updateAssistantMetadata((current) => {
                const controlEvents = Array.isArray(current.controlEvents)
                  ? [...(current.controlEvents as unknown[]), interaction]
                  : [interaction];
                const currentInteractionState =
                  current.planModeInteractionState &&
                  typeof current.planModeInteractionState === "object" &&
                  !Array.isArray(current.planModeInteractionState)
                    ? (current.planModeInteractionState as Record<string, unknown>)
                    : {};
                const next: Record<string, unknown> = {
                  ...current,
                  controlEvents,
                  planModeProtocolVersion: 2,
                  planModeInteractionState: {
                    ...currentInteractionState,
                    [interaction.requestId]: {
                      type: interaction.type,
                      status: "pending",
                    },
                  },
                };
                if (interaction.type === "plan_progress") {
                  const content = interaction.payload as PlanProgressInteractionPayload;
                  next.planProgress = {
                    explanation: content.explanation,
                    plan: content.plan,
                  };
                }
                if (interaction.type === "plan_question") next.planQuestions = [];
                if (interaction.type === "plan_approval") {
                  next.planModeApproval = interaction.payload;
                }
                return next;
              });
              return;
            }

            if (event === SdkStreamEventEnum.status) {
              const payload = item as { phase?: unknown; toolName?: unknown };
              if (payload.phase === "tool_error") {
                appendSdkBlock({
                  type: "text",
                  text: `\n[tool-error] ${typeof payload.toolName === "string" ? payload.toolName : "tool"}\n`,
                });
              }
              return;
            }

            if (event === SdkStreamEventEnum.message) {
              const payload = item as { message?: unknown };
              if (!isSdkLikeMessage(payload.message)) return;
              const sdkMessage = payload.message;
              if ((sdkMessage.message?.role || "assistant") !== "assistant") return;
              const contentText = sdkContentToText(sdkMessage.message?.content);
              if (contentText) {
                shouldAutoScrollRef.current = true;
                streamingTextRef.current = contentText;
                flushAssistantText(assistantMessageId, contentText);
              }
              updateAssistantMetadata((current) => ({
                ...current,
                sdkMessage,
              }));
              return;
            }

            if (event === SdkStreamEventEnum.done) return;
            if (event === SdkStreamEventEnum.error) return;
          };
          const enqueueSseEvent = (item: unknown) => {
            streamEventQueue.push(item);
            if (isDrainingStreamQueue) return;
            isDrainingStreamQueue = true;
            try {
              while (streamEventQueue.length > 0) {
                const next = streamEventQueue.shift();
                processSseEventInOrder(next);
              }
            } finally {
              isDrainingStreamQueue = false;
            }
          };
          await streamFetch({
            url: completionsPath,
            data: {
              token,
              messages: requestMessagesForApi,
              stream: true,
              persistIncomingMessages,
              ...(continueAssistantMessageId ? { continueAssistantMessageId } : {}),
              ...(conversationId ? { conversationId } : {}),
              channel,
              model,
              ...(model.toLowerCase().includes("kimi")
                ? { thinking: { type: payload.thinkingEnabled === false ? "disabled" : "enabled" } }
                : {}),
              ...(payload.selectedSkill ? { selectedSkill: payload.selectedSkill } : {}),
              ...(payload.selectedSkills ? { selectedSkills: payload.selectedSkills } : {}),
              ...(payload.selectedFilePaths ? { selectedFilePaths: payload.selectedFilePaths } : {}),
              ...(completionsExtraBody || {}),
            },
            headers: withAuthHeaders(),
            abortCtrl,
            onMessage: (item) => {
              enqueueSseEvent(item);
            },
          });
        }
      } catch (error) {
        if (abortCtrl.signal.aborted) {
          return;
        }
        assistantFailureText = `请求失败: ${error instanceof Error ? error.message : "未知错误"}`;
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMessageId
              ? {
                  ...msg,
                  content: assistantFailureText,
                  status: "error",
                }
              : msg
          )
        );
      } finally {
        cancelPendingFlushes();
        if (streamingTextRef.current) {
          flushAssistantText(assistantMessageId, streamingTextRef.current);
        }
        if (streamingReasoningRef.current) {
          flushAssistantReasoning(assistantMessageId, streamingReasoningRef.current);
        }
        // Do not synthesize client-side fake tool results.
        // Missing tool closures must be emitted by backend protocol events.
        if (conversationId) {
          const persistedMessages = (() => {
            const snapshot = messagesRef.current.map((item) => ({ ...item }));
            if (!snapshot.some((item) => item.id === userMessage.id)) {
              snapshot.push(userMessage);
            }
            const assistantIndex = snapshot.findIndex((item) => item.id === assistantMessageId);
            const finalAssistantText = streamingTextRef.current.trim();
            const finalReasoningText = streamingReasoningRef.current.trim();

            if (assistantIndex >= 0) {
              const assistant = snapshot[assistantIndex];
              const kwargs =
                assistant.additional_kwargs && typeof assistant.additional_kwargs === "object"
                  ? assistant.additional_kwargs
                  : {};
              snapshot[assistantIndex] = {
                ...assistant,
                content:
                  finalAssistantText ||
                  extractText(assistant.content) ||
                  assistantFailureText ||
                  "[已中断]",
                ...(assistantFailureText ? { status: "error" as const } : {}),
                additional_kwargs: {
                  ...kwargs,
                  ...(finalReasoningText ? { reasoning_text: finalReasoningText } : {}),
                },
              };
            } else if (finalAssistantText || finalReasoningText || assistantFailureText) {
              snapshot.push({
                role: "assistant",
                id: assistantMessageId,
                time: assistantCreatedAt,
                content: finalAssistantText || assistantFailureText || "[已中断]",
                ...(assistantFailureText ? { status: "error" as const } : {}),
                additional_kwargs: finalReasoningText
                  ? { reasoning_text: finalReasoningText }
                  : undefined,
              });
            }

            return snapshot;
          })();
          if (persistedMessages.length > 0) {
            await replaceConversationMessages(token, conversationId, persistedMessages).catch(() => false);
          }
        }
        if (streamAbortRef.current === abortCtrl) {
          streamAbortRef.current = null;
          streamingConversationIdRef.current = null;
        }
        if (conversationId && !contextUsageRef.current) {
          const latestConversation = await getConversationById(token, conversationId, { model }).catch(() => null);
          const recoveredUsage = latestConversation
            ? getLatestContextUsageFromMessages(latestConversation.messages || [], model)
            : null;
          if (recoveredUsage) {
            setContextUsageSnapshot(
              recoveredUsage,
              conversationId,
              typeof recoveredUsage.model === "string" ? recoveredUsage.model : model
            );
          }
        }
        setStreamingMessageId(null);
        setIsSending(false);
        setContextStatus((prev) => {
          if (prev !== "pending") return prev;
          return contextUsageRef.current ? "ready" : "idle";
        });
      }
    },
    [
      activeConversation?.id,
      chatMode,
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
      setContextUsageSnapshot,
    ]
  );

  const handleStop = useCallback(() => {
    const chatId = streamingConversationIdRef.current || activeConversation?.id || null;
    const abortCtrl = streamAbortRef.current;
    if (abortCtrl && !abortCtrl.signal.aborted) {
      // 立即停止前端流，确保按钮点击立刻生效
      abortCtrl.abort(new Error("stop"));
    }
    if (!chatId) return;

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
  }, [activeConversation?.id, token]);

  const {
    handlePlanQuestionSelect,
    handlePlanQuestionsSubmit,
    handlePlanModeApprovalSelect,
    handlePermissionApprovalSelect,
    chatInteractionContextValue,
  } = useChatPlanInteractions({
    isSending,
    setMessages,
    handleSend,
    selectedSkills,
    thinkingEnabled,
  });

  const { handleRateMessage, handleDeleteMessage, handleRegenerateMessage } = useChatMessageActions({
    token,
    activeConversationId: activeConversation?.id,
    isSending,
    messages,
    setMessages,
    streamingMessageId,
    setStreamingMessageId,
    setMessageRatings,
    selectedSkills,
    handleSend,
  });

  const activeConversationTitle = useMemo(
    () => activeConversation?.title || defaultHeaderTitle,
    [activeConversation?.title, defaultHeaderTitle]
  );

  const handleUseSkill = useCallback((skillName: string) => {
    setSelectedSkills((prev) => (prev.includes(skillName) ? prev : [...prev, skillName]));
  }, []);

  const handleCreateSkillViaChat = useCallback(() => {
    const projectToken = token.startsWith("skill-studio:") ? "" : token;
    const params = new URLSearchParams();
    const currentPath = typeof router.asPath === "string" ? router.asPath : "";
    if (projectToken) params.set("projectToken", projectToken);
    if (currentPath.startsWith("/")) params.set("returnTo", currentPath);
    void router.push(
      params.toString() ? `/skills/create?${params.toString()}` : "/skills/create"
    );
  }, [router, token]);
  const showInitialLoading = !isInitialized && messages.length === 0;
  const planResumeState = useMemo(() => derivePlanResumeState(messages), [messages]);

  const handleResumePlanExecute = useCallback(() => {
    if (isSending || !planResumeState.visible) return;
    setPlanResumeInputEnabled(false);
    setChatMode("plan");
    const targetMessageId = planResumeState.messageId;
    const pendingQuestion = planResumeState.pendingQuestion;
    if (!targetMessageId) return;

    if (pendingQuestion) {
      const executeOption =
        pendingQuestion.options.find((option) => /确认执行|执行|approve|proceed|yes/i.test(option.label.trim())) ||
        pendingQuestion.options[0];
      if (!executeOption) return;
      handlePlanQuestionsSubmit({
        messageId: targetMessageId,
        requestId: pendingQuestion.requestId,
        answers: {
          [pendingQuestion.questionId]: executeOption.label,
        },
      });
      return;
    }

    void handleSend({
      text: "继续执行当前未完成计划，并保持计划进度持续回写。",
      uploadedFiles: [],
      files: [],
      selectedSkills,
      thinkingEnabled,
    });
  }, [
    handlePlanQuestionsSubmit,
    handleSend,
    isSending,
    planResumeState.messageId,
    planResumeState.pendingQuestion,
    planResumeState.visible,
    selectedSkills,
    thinkingEnabled,
  ]);

  const handleResumePlanAdjust = useCallback(() => {
    if (isSending || !planResumeState.visible) return;
    setPlanResumeInputEnabled(true);
    setChatMode("plan");
  }, [isSending, planResumeState.visible]);
  const handleExitPlanAdjusting = useCallback(() => {
    setPlanResumeInputEnabled(false);
  }, []);

  const chatPanelViewContextValue = useMemo(
    () => ({
      height,
      t,
      activeConversationId: activeConversation?.id,
      conversations,
      contextUsage,
      contextStatus,
      messageCount: conversations.length,
      model,
      modelLoading,
      modelOptions,
      modelGroups,
      onChangeModel: handleChangeModel,
      onChangeMode: setChatMode,
      onDeleteAllConversations: () => deleteAllConversations(),
      onDeleteConversation: (id: string) => void deleteConversation(id),
      onNewConversation: () => {
        setContextUsageSnapshot(null);
        void createNewConversation();
      },
      onSelectConversation: (id: string) => void loadConversation(id),
      activeConversationTitle,
      scrollRef,
      onScroll: (event: { currentTarget: { scrollHeight: number; scrollTop: number; clientHeight: number } }) => {
        const el = event.currentTarget;
        const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
        shouldAutoScrollRef.current = distanceToBottom < 80;
      },
      showInitialLoading,
      emptyStateTitle,
      emptyStateDescription,
      messages,
      chatInteractionContextValue,
      isLoadingConversation,
      isSending,
      messageRatings,
      onDeleteMessage: (messageId: string) => void handleDeleteMessage(messageId),
      onRateMessage: (messageId: string, rating: MessageRating) => void handleRateMessage(messageId, rating),
      onRegenerateMessage: (messageId: string) => void handleRegenerateMessage(messageId),
      streamingMessageId,
      planResumeState,
      planResumeInputEnabled,
      onResumePlanExecute: handleResumePlanExecute,
      onResumePlanAdjust: handleResumePlanAdjust,
      onExitPlanAdjusting: handleExitPlanAdjusting,
      thinkingEnabled,
      chatMode,
      selectedModelSupportsReasoning,
      thinkingTooltipEnabled,
      thinkingTooltipDisabled,
      selectedSkills,
      skillOptions,
      fileOptions,
      onChangeThinkingEnabled: handleChangeThinkingEnabled,
      onChangeSelectedSkills: setSelectedSkills,
      onUploadFiles: prepareUploadFiles,
      onSend: handleSend,
      onStop: handleStop,
      hideSkillsManager,
      isSkillsOpen,
      onCloseSkills: () => setIsSkillsOpen(false),
      token,
      onFilesApplied: onFilesUpdated,
      onCreateSkillViaChat: handleCreateSkillViaChat,
      onUseSkill: handleUseSkill,
    }),
    [
      height,
      t,
      activeConversation?.id,
      conversations,
      contextUsage,
      contextStatus,
      messages.length,
      model,
      modelLoading,
      modelOptions,
      modelGroups,
      handleChangeModel,
      deleteAllConversations,
      deleteConversation,
      setContextUsageSnapshot,
      createNewConversation,
      loadConversation,
      activeConversationTitle,
      scrollRef,
      showInitialLoading,
      emptyStateTitle,
      emptyStateDescription,
      messages,
      chatInteractionContextValue,
      isLoadingConversation,
      isSending,
      messageRatings,
      handleDeleteMessage,
      handleRateMessage,
      handleRegenerateMessage,
      streamingMessageId,
      planResumeState,
      planResumeInputEnabled,
      handleResumePlanExecute,
      handleResumePlanAdjust,
      handleExitPlanAdjusting,
      thinkingEnabled,
      chatMode,
      selectedModelSupportsReasoning,
      thinkingTooltipEnabled,
      thinkingTooltipDisabled,
      selectedSkills,
      skillOptions,
      fileOptions,
      handleChangeThinkingEnabled,
      setSelectedSkills,
      prepareUploadFiles,
      handleSend,
      handleStop,
      hideSkillsManager,
      isSkillsOpen,
      token,
      onFilesUpdated,
      handleCreateSkillViaChat,
      handleUseSkill,
    ]
  );

  return (
    <ChatPanelViewProvider value={chatPanelViewContextValue}>
      <ChatPanelView />
    </ChatPanelViewProvider>
  );
};

export default ChatPanel;

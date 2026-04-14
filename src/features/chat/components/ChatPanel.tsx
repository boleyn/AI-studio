import { withAuthHeaders } from "@features/auth/client/authClient";
import { createChatId, createDataId } from "@shared/chat/ids";
import { extractText } from "@shared/chat/messages";
import { streamFetch, SseResponseEventEnum } from "@shared/network/streamFetch";
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
import {
  type AgentDurationPayload,
  type AgentTaskSnapshot,
  type PermissionApprovalPayload,
  type PlanQuestion,
  type PlanQuestionOption,
  type ReasoningStreamPayload,
  type SessionTaskSnapshot,
  type ToolStreamPayload,
} from "../types/chatPanelRuntime";
import { getExecutionSummary } from "../utils/executionSummary";
import { type FlowNodeResponsePayload } from "../utils/flowNodeMessages";
import {
  derivePlanModeFromMessages,
  parseToolPayload,
  type PlanModeApprovalPayload,
} from "../utils/planModeDisplay";

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
  const [messageRatings, setMessageRatings] = useState<Record<string, MessageRating | undefined>>(
    {}
  );
  const [agentTasks, setAgentTasks] = useState<Record<string, AgentTaskSnapshot>>({});
  const [showAgentTasks, setShowAgentTasks] = useState(true);
  const [agentTaskFilter, setAgentTaskFilter] = useState<"all" | "active" | "done" | "failed">("all");
  const [sessionTasks, setSessionTasks] = useState<Record<string, SessionTaskSnapshot>>({});
  const [showSessionTasks, setShowSessionTasks] = useState(true);
  const [sessionTaskFilter, setSessionTaskFilter] = useState<"all" | "active" | "done" | "blocked">("all");
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

  const upsertAgentTasks = useCallback((incoming: AgentTaskSnapshot | AgentTaskSnapshot[]) => {
    const list = Array.isArray(incoming) ? incoming : [incoming];
    if (list.length === 0) return;
    setAgentTasks((prev) => {
      const next = { ...prev };
      for (const item of list) {
        if (!item || typeof item !== "object" || !item.id) continue;
        next[item.id] = {
          ...(next[item.id] || {}),
          ...item,
        };
      }
      return next;
    });
  }, []);

  const upsertSessionTasks = useCallback((incoming: SessionTaskSnapshot | SessionTaskSnapshot[]) => {
    const list = Array.isArray(incoming) ? incoming : [incoming];
    if (list.length === 0) return;
    setSessionTasks((prev) => {
      const next = { ...prev };
      for (const item of list) {
        if (!item || typeof item !== "object" || !item.id) continue;
        next[item.id] = {
          ...(next[item.id] || {}),
          ...item,
        };
      }
      return next;
    });
  }, []);

  const clearCompletedSessionTasks = useCallback(() => {
    setSessionTasks((prev) => {
      const next: Record<string, SessionTaskSnapshot> = {};
      for (const [id, task] of Object.entries(prev)) {
        if (!task || typeof task !== "object") continue;
        if (task.status === "completed" || task.status === "deleted") continue;
        next[id] = task;
      }
      return next;
    });
  }, []);

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
    setMessages(hydratedMessages);
    setChatMode(derivePlanModeFromMessages(hydratedMessages));
    setMessageRatings(() => {
      const next: Record<string, MessageRating | undefined> = {};
      for (const message of hydratedMessages) {
        if (!message.id) continue;
        const feedback = getMessageFeedback(message);
        if (feedback) {
          next[message.id] = feedback;
        }
      }
      return next;
    });
    const restoredAgentTasks: Record<string, AgentTaskSnapshot> = {};
    const restoredSessionTasks: Record<string, SessionTaskSnapshot> = {};
    for (const message of hydratedMessages) {
      const kwargs =
        message.additional_kwargs && typeof message.additional_kwargs === "object"
          ? (message.additional_kwargs as Record<string, unknown>)
          : null;
      if (!kwargs) continue;
      if (Array.isArray(kwargs.agentTasks)) {
        for (const task of kwargs.agentTasks as unknown[]) {
          if (!task || typeof task !== "object") continue;
          const item = task as AgentTaskSnapshot;
          if (typeof item.id !== "string" || !item.id) continue;
          restoredAgentTasks[item.id] = {
            ...(restoredAgentTasks[item.id] || {}),
            ...item,
          };
        }
      }
      if (Array.isArray(kwargs.sessionTasks)) {
        for (const task of kwargs.sessionTasks as unknown[]) {
          if (!task || typeof task !== "object") continue;
          const item = task as SessionTaskSnapshot;
          if (typeof item.id !== "string" || !item.id) continue;
          restoredSessionTasks[item.id] = {
            ...(restoredSessionTasks[item.id] || {}),
            ...item,
          };
        }
      }
    }
    setAgentTasks(restoredAgentTasks);
    setSessionTasks(restoredSessionTasks);
    shouldAutoScrollRef.current = true;
    const activeId = activeConversation?.id || "";
    const cachedUsage = getCachedContextUsage(activeId || null, model);
    const recoveredUsage = getLatestContextUsageFromMessages(hydratedMessages, model);
    const matchedRecoveredUsage =
      recoveredUsage && (!recoveredUsage.model || recoveredUsage.model === model)
        ? recoveredUsage
        : null;
    setContextUsageSnapshot(cachedUsage || matchedRecoveredUsage || null, activeId || null, model);
  }, [activeConversation?.id, activeConversation?.messages, getCachedContextUsage, setContextUsageSnapshot, token]);

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
      }
    ) => {
      const text = payload.text.trim();
      const fallbackArtifacts = toFileArtifacts(payload.files);
      const finalArtifacts =
        payload.uploadedFiles.length > 0 ? payload.uploadedFiles : fallbackArtifacts;
      const hasArtifacts = finalArtifacts.length > 0;
      if ((text.length === 0 && !hasArtifacts && !payload.selectedFilePaths?.length) || isSending) return;
      const echoUserMessage = options?.echoUserMessage ?? true;
      const persistIncomingMessages = options?.persistIncomingMessages ?? true;

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
              planModeState: effectiveMode === "plan",
              ...(payload.planModeApprovalResponse
                ? { planModeApprovalResponse: payload.planModeApprovalResponse }
                : {}),
              ...(payload.permissionApprovalResponse
                ? { permissionApprovalResponse: payload.permissionApprovalResponse }
                : {}),
            }
          : {
              planModeState: effectiveMode === "plan",
              ...(payload.planModeApprovalResponse
                ? { planModeApprovalResponse: payload.planModeApprovalResponse }
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
          ...(payload.permissionApprovalResponse
            ? { permissionApprovalResponse: payload.permissionApprovalResponse }
            : {}),
        },
      };

      const assistantMessageId = createDataId();
      const assistantCreatedAt = new Date().toISOString();
      let assistantFailureText: string | null = null;
      streamingTextRef.current = "";
      streamingReasoningRef.current = "";
      cancelPendingFlushes();
      shouldAutoScrollRef.current = true;
      setStreamingMessageId(assistantMessageId);
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
                  params: `${typeof target.params === "string" ? target.params : ""}${typeof nextPartial.params === "string" ? nextPartial.params : ""}`,
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
              persistIncomingMessages,
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

            if (event === SseResponseEventEnum.answer) {
              const answerPayload = item as { text?: string; reasoningText?: string };
              if (answerPayload.reasoningText) {
                shouldAutoScrollRef.current = true;
                const reasoningText = answerPayload.reasoningText;
                streamingReasoningRef.current = `${streamingReasoningRef.current}${reasoningText}`;
                scheduleAssistantReasoningFlush(assistantMessageId);
                appendTimelineText("reasoning", reasoningText);
              }
              if (answerPayload.text) {
                shouldAutoScrollRef.current = true;
                streamingTextRef.current = `${streamingTextRef.current}${answerPayload.text}`;
                scheduleAssistantTextFlush(assistantMessageId);
                appendTimelineText("answer", answerPayload.text);
              }
              return;
            }
            if (event === SseResponseEventEnum.toolCall) {
              // 保证视觉顺序与事件顺序一致：在工具卡片出现前先提交已到达的文本片段
              flushPendingAssistantStreams();
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
            if (event === SseResponseEventEnum.toolParams) {
              flushPendingAssistantStreams();
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
            if (event === SseResponseEventEnum.toolResponse) {
              flushPendingAssistantStreams();
              const streamPayload = item as ToolStreamPayload;
              const responseForDisplay = streamPayload.response || "";
              const responseForFileUpdates = streamPayload.rawResponse || streamPayload.response || "";
              const parsedPayload = parseToolPayload(responseForDisplay, responseForFileUpdates);
              if (streamPayload.id) {
                upsertToolMessage(streamPayload.id, {
                  toolName: streamPayload.toolName,
                  response: responseForDisplay,
                });
                upsertTimelineTool({
                  id: streamPayload.id,
                  toolName: streamPayload.toolName,
                  response: responseForDisplay,
                });
              }
              if (streamPayload.toolName && responseForDisplay) {
                try {
                  const parsed = (parsedPayload ||
                    JSON.parse(responseForDisplay)) as AgentTaskSnapshot | { agents?: AgentTaskSnapshot[] };
                  if (Array.isArray((parsed as { agents?: AgentTaskSnapshot[] }).agents)) {
                    upsertAgentTasks((parsed as { agents: AgentTaskSnapshot[] }).agents);
                    updateAssistantMetadata((current) => ({
                      ...current,
                      agentTasks: (parsed as { agents: AgentTaskSnapshot[] }).agents,
                    }));
                  } else if (
                    parsed &&
                    typeof parsed === "object" &&
                    "id" in parsed &&
                    typeof (parsed as AgentTaskSnapshot).id === "string"
                  ) {
                    const snapshot = parsed as AgentTaskSnapshot;
                    upsertAgentTasks(snapshot);
                    updateAssistantMetadata((current) => {
                      const existing = Array.isArray(current.agentTasks)
                        ? (current.agentTasks as AgentTaskSnapshot[])
                        : [];
                      const index = existing.findIndex((item) => item.id === snapshot.id);
                      const next = [...existing];
                      if (index >= 0) next[index] = { ...next[index], ...snapshot };
                      else next.push(snapshot);
                      return {
                        ...current,
                        agentTasks: next,
                      };
                    });
                  }
                } catch {
                  // ignore non-JSON tool responses
                }
              }

              if (streamPayload.toolName === "request_user_input" && parsedPayload) {
                const parsed = parsedPayload as {
                  questions?: PlanQuestion[];
                };
                const questions = Array.isArray(parsed.questions)
                  ? parsed.questions
                      .filter((item): item is PlanQuestion => Boolean(item && typeof item === "object"))
                      .map((item) => ({
                        header: typeof item.header === "string" ? item.header : "确认",
                        id: typeof item.id === "string" ? item.id : "",
                        question: typeof item.question === "string" ? item.question : "",
                        options: Array.isArray(item.options)
                          ? item.options
                              .filter((opt): opt is PlanQuestionOption => Boolean(opt && typeof opt === "object"))
                              .map((opt) => ({
                                label: typeof opt.label === "string" ? opt.label : "",
                                description: typeof opt.description === "string" ? opt.description : "",
                              }))
                              .filter((opt) => opt.label.trim().length > 0)
                          : [],
                      }))
                      .filter((item) => item.id && item.question)
                  : [];
                if (questions.length > 0) {
                  updateAssistantMetadata((current) => ({
                    ...current,
                    planQuestions: questions,
                  }));
                }
              }

              if (streamPayload.toolName === "update_plan" && parsedPayload) {
                const parsed = parsedPayload as {
                  explanation?: string;
                  plan?: Array<{ step?: string; status?: string }>;
                };
                const plan = Array.isArray(parsed.plan)
                  ? parsed.plan
                      .filter((item): item is { step?: string; status?: string } => Boolean(item && typeof item === "object"))
                      .map((item) => ({
                        step: typeof item.step === "string" ? item.step.trim() : "",
                        status:
                          item.status === "completed"
                            ? ("completed" as const)
                            : item.status === "in_progress"
                            ? ("in_progress" as const)
                            : ("pending" as const),
                      }))
                      .filter((item) => item.step.length > 0)
                  : [];
                if (plan.length > 0) {
                  updateAssistantMetadata((current) => ({
                    ...current,
                    planProgress: {
                      explanation: typeof parsed.explanation === "string" ? parsed.explanation : undefined,
                      plan,
                    },
                  }));
                }
              }

              if (
                (streamPayload.toolName === "enter_plan_mode" ||
                  streamPayload.toolName === "exit_plan_mode") &&
                parsedPayload
              ) {
                const planPreview = streamingTextRef.current.trim().slice(0, 6000);
                const parsed = parsedPayload as {
                  approval?: PlanModeApprovalPayload;
                };
                if (parsed.approval && typeof parsed.approval === "object") {
                  updateAssistantMetadata((current) => ({
                    ...current,
                    planModeApproval: parsed.approval,
                    ...(planPreview ? { planPreview } : {}),
                  }));
                }
              }

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

              if (
                streamPayload.toolName &&
                ["TaskCreate", "TaskGet", "TaskUpdate", "TaskStop", "TaskList"].includes(streamPayload.toolName) &&
                responseForDisplay
              ) {
                try {
                  const parsed = JSON.parse(responseForDisplay) as {
                    task?: SessionTaskSnapshot;
                    tasks?: SessionTaskSnapshot[];
                  };
                  if (Array.isArray(parsed.tasks)) {
                    upsertSessionTasks(parsed.tasks);
                    updateAssistantMetadata((current) => ({
                      ...current,
                      sessionTasks: parsed.tasks,
                    }));
                  } else if (parsed.task && typeof parsed.task === "object" && parsed.task.id) {
                    const task = parsed.task;
                    upsertSessionTasks(task);
                    updateAssistantMetadata((current) => {
                      const existing = Array.isArray(current.sessionTasks)
                        ? (current.sessionTasks as SessionTaskSnapshot[])
                        : [];
                      const index = existing.findIndex((item) => item.id === task.id);
                      const next = [...existing];
                      if (index >= 0) next[index] = { ...next[index], ...task };
                      else next.push(task);
                      return {
                        ...current,
                        sessionTasks: next,
                      };
                    });
                  }
                } catch {
                  // ignore parser failures
                }
              }

              if (responseForFileUpdates && onFilesUpdated) {
                try {
                  const parsed = JSON.parse(responseForFileUpdates);
                  const filesCandidate =
                    (parsed as { uiFiles?: Record<string, { code: string }> }).uiFiles ||
                    (parsed as { files?: Record<string, { code: string }> }).files ||
                    (parsed as {
                      data?: { files?: Record<string, { code: string }>; uiFiles?: Record<string, { code: string }> };
                    }).data?.uiFiles ||
                    (parsed as {
                      data?: { files?: Record<string, { code: string }>; uiFiles?: Record<string, { code: string }> };
                    }).data?.files;
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
            if (event === SseResponseEventEnum.flowNodeResponse) {
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
            if (event === SseResponseEventEnum.agentDuration) {
              const streamPayload = item as AgentDurationPayload;
              if (typeof streamPayload.durationSeconds !== "number") return;
              updateAssistantMetadata((current) => ({
                ...current,
                durationSeconds: streamPayload.durationSeconds,
              }));
              return;
            }
            if (event === SseResponseEventEnum.contextWindow) {
              const streamPayload = item as Partial<ContextWindowUsage>;
              if (
                typeof streamPayload.usedTokens !== "number" ||
                typeof streamPayload.maxContext !== "number" ||
                typeof streamPayload.remainingTokens !== "number" ||
                typeof streamPayload.usedPercent !== "number"
              ) {
                return;
              }
              const phase = streamPayload.phase;
              const prevUsage = contextUsageRef.current;
              // Prevent visual "drop then recover": keep previous number during start phase
              // when backend sends a transient lower snapshot before final usage is emitted.
              if (
                phase === "start" &&
                prevUsage &&
                typeof prevUsage.usedPercent === "number" &&
                streamPayload.usedPercent < prevUsage.usedPercent
              ) {
                return;
              }
              setContextUsageSnapshot({
                model: typeof streamPayload.model === "string" ? streamPayload.model : model,
                phase: phase === "start" || phase === "final" ? phase : undefined,
                usedTokens: streamPayload.usedTokens,
                maxContext: streamPayload.maxContext,
                remainingTokens: streamPayload.remainingTokens,
                usedPercent: streamPayload.usedPercent,
              }, conversationId || null, typeof streamPayload.model === "string" ? streamPayload.model : model);
              updateAssistantMetadata((current) => ({
                ...current,
                contextWindow: {
                  model: typeof streamPayload.model === "string" ? streamPayload.model : model,
                  usedTokens: streamPayload.usedTokens,
                  maxContext: streamPayload.maxContext,
                  remainingTokens: streamPayload.remainingTokens,
                  usedPercent: streamPayload.usedPercent,
                },
              }));
            }
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
              messages: [requestMessage],
              stream: true,
              persistIncomingMessages,
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
        updateAssistantMetadata((current) => {
          const details = Array.isArray(current.toolDetails)
            ? (current.toolDetails as Array<{ response?: string }>)
            : [];
          const timeline = Array.isArray(current.timeline)
            ? (current.timeline as Array<Record<string, unknown>>)
            : [];
          const pendingCount = details.filter(
            (item) => !item?.response || String(item.response).trim().length === 0
          ).length;
          const pendingTimelineCount = timeline.filter(
            (item) =>
              item?.type === "tool" &&
              (typeof item.response !== "string" || item.response.trim().length === 0)
          ).length;
          if (pendingCount === 0 && pendingTimelineCount === 0) return current;

          const pendingMessage = abortCtrl.signal.aborted
            ? "[已中断] 工具未返回结果"
            : "[已结束] 工具未返回结果";
          return {
            ...current,
            toolDetails: details.map((item) => ({
              ...item,
              response:
                !item?.response || String(item.response).trim().length === 0
                  ? pendingMessage
                  : item.response,
            })),
            timeline: timeline.map((item) =>
              item?.type === "tool" &&
              (typeof item.response !== "string" || item.response.trim().length === 0)
                ? { ...item, response: pendingMessage }
                : item
            ),
          };
        });
        if ((abortCtrl.signal.aborted || assistantFailureText) && conversationId) {
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
      upsertAgentTasks,
      upsertSessionTasks,
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
    handlePlanModeApprovalSelect,
    handlePermissionApprovalSelect,
    chatInteractionContextValue,
  } = useChatPlanInteractions({
    isSending,
    setMessages,
    chatMode,
    setChatMode,
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

  const filteredAgentTaskList = useMemo(() => {
    const list = Object.values(agentTasks).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    if (agentTaskFilter === "active") {
      return list.filter((task) => task.status === "running");
    }
    if (agentTaskFilter === "done") {
      return list.filter((task) => task.status === "completed" || task.status === "closed");
    }
    if (agentTaskFilter === "failed") {
      return list.filter((task) => task.status === "failed");
    }
    return list;
  }, [agentTaskFilter, agentTasks]);

  const filteredSessionTaskList = useMemo(() => {
    const list = Object.values(sessionTasks)
      .filter((task) => task.status !== "deleted")
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    if (sessionTaskFilter === "active") {
      return list.filter((task) => task.status === "pending" || task.status === "in_progress");
    }
    if (sessionTaskFilter === "done") {
      return list.filter((task) => task.status === "completed" || task.status === "stopped");
    }
    if (sessionTaskFilter === "blocked") {
      return list.filter((task) => task.status === "blocked");
    }
    return list;
  }, [sessionTaskFilter, sessionTasks]);

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

  const chatPanelViewContextValue = useMemo(
    () => ({
      height,
      t,
      activeConversationId: activeConversation?.id,
      conversations,
      contextUsage,
      contextStatus,
      messageCount: messages.length,
      model,
      modelLoading,
      modelOptions,
      modelGroups,
      onChangeModel: handleChangeModel,
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
      agentTaskFilter,
      sessionTaskFilter,
      agentTasks,
      sessionTasks,
      filteredAgentTaskList,
      filteredSessionTaskList,
      onSetAgentTaskFilter: setAgentTaskFilter,
      onSetSessionTaskFilter: setSessionTaskFilter,
      onToggleShowAgentTasks: () => setShowAgentTasks((prev) => !prev),
      onToggleShowSessionTasks: () => setShowSessionTasks((prev) => !prev),
      onClearCompletedSessionTasks: clearCompletedSessionTasks,
      showAgentTasks,
      showSessionTasks,
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
      agentTaskFilter,
      sessionTaskFilter,
      agentTasks,
      sessionTasks,
      filteredAgentTaskList,
      filteredSessionTaskList,
      clearCompletedSessionTasks,
      showAgentTasks,
      showSessionTasks,
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

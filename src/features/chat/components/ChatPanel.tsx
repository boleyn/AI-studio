import { Box, Flex, Spinner, Text } from "@chakra-ui/react";
import { withAuthHeaders } from "@features/auth/client/authClient";
import { createChatId, createDataId } from "@shared/chat/ids";
import { extractText } from "@shared/chat/messages";
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
  getPresignedChatFileGetUrl,
  parseChatFiles,
  uploadChatFiles,
} from "../services/files";
import { updateMessageFeedback } from "../services/feedback";
import { getConversation as getConversationById, replaceConversationMessages } from "../services/conversations";
import type { ChatInputFile, ChatInputSubmitPayload } from "../types/chatInput";
import type { ContextWindowUsage } from "../types/contextWindow";
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

interface ToolStreamPayload {
  id?: string;
  toolName?: string;
  params?: string;
  response?: string;
  rawResponse?: string;
}

interface ReasoningStreamPayload {
  reasoningText?: string;
}

interface WorkflowDurationPayload {
  durationSeconds?: number;
}

import {
  FILE_TAG_MARKER_PREFIX,
  SKILL_TAG_MARKER_PREFIX,
  buildConversationTitle,
  buildUserBubbleContent,
  stripTagMarkersFromUserContent,
  getLatestContextUsageFromMessages,
  getMessageFeedback,
  hydrateArtifactsMarkdown,
  hydrateHistoryUserMessage,
  normalizeProjectFiles,
  toFileArtifacts,
  getImageInputParts,
  toUpdatedFilesMap,
} from "../utils/chatPanelUtils";
import { useChatModels } from "../hooks/useChatModels";
import { useChatSkills } from "../hooks/useChatSkills";
import { useChatStreamFlusher } from "../hooks/useChatStreamFlusher";
import { useChatAutoScroll } from "../hooks/useChatAutoScroll";


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
  const { model, setModel, channel, modelOptions, modelLoading, modelCatalog } = useChatModels();
  
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
    (next: ContextWindowUsage | null, conversationId?: string | null) => {
      contextUsageRef.current = next;
      setContextUsage(next);
      if (next) {
        if (conversationId) {
          contextUsageCacheRef.current[conversationId] = next;
        }
        setContextStatus("ready");
        return;
      }
      setContextStatus("idle");
    },
    []
  );

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
    shouldAutoScrollRef.current = true;
    const activeId = activeConversation?.id || "";
    const cachedUsage = activeId ? contextUsageCacheRef.current[activeId] : null;
    const recoveredUsage = getLatestContextUsageFromMessages(hydratedMessages, model);
    setContextUsageSnapshot(cachedUsage || recoveredUsage || null, activeId || null);
  }, [activeConversation?.id, activeConversation?.messages, model, setContextUsageSnapshot, token]);





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
      const parsedFiles =
        uploadedFiles.length > 0
          ? await parseChatFiles({
              token,
              chatId: uploadChatId,
              files: uploadedFiles,
            }).catch(() => uploadedFiles)
          : uploadedFiles;

      const withPreviewUrls = await Promise.all(
        parsedFiles.map(async (file) => {
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

      const hydratedFiles = withPreviewUrls.length > 0
        ? await hydrateArtifactsMarkdown({
            files: withPreviewUrls,
            token,
            chatId: uploadChatId,
          })
        : withPreviewUrls;

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

      return hydratedFiles;
    },
    [activeConversation?.id, ensureConversation, onFilesUpdated, token]
  );

  const handleSend = useCallback(
    async (
      payload: ChatInputSubmitPayload,
      options?: {
        echoUserMessage?: boolean;
      }
    ) => {
      const text = payload.text.trim();
      const fallbackArtifacts = toFileArtifacts(payload.files);
      const finalArtifacts =
        payload.uploadedFiles.length > 0 ? payload.uploadedFiles : fallbackArtifacts;
      const hasArtifacts = finalArtifacts.length > 0;
      if ((text.length === 0 && !hasArtifacts && !payload.selectedFilePaths?.length) || isSending) return;
      const echoUserMessage = options?.echoUserMessage ?? true;

      const conversation = await ensureConversation();
      const conversationId = conversation?.id ?? activeConversation?.id;

      const displayText =
        text ||
        (payload.selectedFilePaths?.length ? `已选择 ${payload.selectedFilePaths.length} 个文件` : "") ||
        `已上传 ${finalArtifacts.length} 个文件`;
      const nextConversationTitle = buildConversationTitle(text);

      const userMessageId = createDataId();
      if (echoUserMessage) {
        setMessages((prev) => [
          ...prev,
          {
            role: "user",
            content: displayText,
            id: userMessageId,
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
        artifact: hasArtifacts ? { files: finalArtifacts } : undefined,
        additional_kwargs: payload.selectedFilePaths
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
      setContextStatus("pending");

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

      const assistantMessageId = createDataId();
      streamingTextRef.current = "";
      streamingReasoningRef.current = "";
      cancelPendingFlushes();
      shouldAutoScrollRef.current = false;
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
          const contextWindowPayload =
            responsePayload?.contextWindow && typeof responsePayload.contextWindow === "object"
              ? (responsePayload.contextWindow as ContextWindowUsage)
              : null;
          if (contextWindowPayload) {
            setContextUsageSnapshot(contextWindowPayload, conversationId || null);
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
                const responseForDisplay = streamPayload.response || "";
                const responseForFileUpdates = streamPayload.rawResponse || streamPayload.response || "";
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

                if (responseForFileUpdates && onFilesUpdated) {
                  try {
                    const parsed = JSON.parse(responseForFileUpdates);
                    const filesCandidate =
                      (parsed as { uiFiles?: Record<string, { code: string }> }).uiFiles ||
                      (parsed as { files?: Record<string, { code: string }> }).files ||
                      (parsed as { data?: { files?: Record<string, { code: string }>; uiFiles?: Record<string, { code: string }> } }).data?.uiFiles ||
                      (parsed as { data?: { files?: Record<string, { code: string }>; uiFiles?: Record<string, { code: string }> } }).data?.files;
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
                return;
              }
              if (item.event === SseResponseEventEnum.contextWindow) {
                const streamPayload = item as Partial<ContextWindowUsage>;
                if (
                  typeof streamPayload.usedTokens !== "number" ||
                  typeof streamPayload.maxContext !== "number" ||
                  typeof streamPayload.remainingTokens !== "number" ||
                  typeof streamPayload.usedPercent !== "number"
                ) {
                  return;
                }
                setContextUsageSnapshot({
                  model: typeof streamPayload.model === "string" ? streamPayload.model : model,
                  usedTokens: streamPayload.usedTokens,
                  maxContext: streamPayload.maxContext,
                  remainingTokens: streamPayload.remainingTokens,
                  usedPercent: streamPayload.usedPercent,
                }, conversationId || null);
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
        cancelPendingFlushes();
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
        if (conversationId && !contextUsageRef.current) {
          const latestConversation = await getConversationById(token, conversationId, { model }).catch(() => null);
          const recoveredUsage = latestConversation
            ? getLatestContextUsageFromMessages(latestConversation.messages || [], model)
            : null;
          if (recoveredUsage) {
            setContextUsageSnapshot(recoveredUsage, conversationId);
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
    const chatId = streamingConversationIdRef.current;
    const abortCtrl = streamAbortRef.current;
    if (!abortCtrl) return;

    // 立即停止前端流，确保按钮点击立刻生效
    abortCtrl.abort(new Error("stop"));

    if (!chatId) return;
    if (!completionsStream) return;

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
  }, [completionsStream, token]);

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
    async (userMessageId: string) => {
      if (isSending) return;
      const snapshot = [...messages];
      const userIndex = snapshot.findIndex((message) => message.id === userMessageId);
      if (userIndex < 0) return;

      const userMessage = snapshot[userIndex];
      if (userMessage.role !== "user") return;

      const text = stripTagMarkersFromUserContent(extractText(userMessage.content));
      if (!text) return;
      const uploadedFiles =
        userMessage.artifact && typeof userMessage.artifact === "object"
          ? (Array.isArray((userMessage.artifact as { files?: unknown }).files) ? ((userMessage.artifact as { files?: unknown }).files as unknown[]) : [])
              .filter((item): item is UploadedFileArtifact => Boolean(item && typeof item === "object"))
          : [];

      const conversationId = activeConversation?.id;
      if (!conversationId) return;

      // Step 1: 删除当前用户消息及其以下所有消息（持久化到后端）
      const remainedMessages = snapshot.slice(0, userIndex);
      const replaced = await replaceConversationMessages(token, conversationId, remainedMessages);
      if (!replaced) return;

      setMessages((prev) => prev.slice(0, userIndex));
      setMessageRatings((prev) => {
        const next = { ...prev };
        for (const message of snapshot.slice(userIndex)) {
          if (!message.id) continue;
          delete next[message.id];
        }
        return next;
      });

      // Step 2: 重新发送当前用户消息，走 completions 生成新回复
      await handleSend({
        text,
        files: [],
        uploadedFiles,
        selectedSkill: Array.from(new Set(selectedSkills.filter(Boolean)))[0],
        selectedSkills: Array.from(new Set(selectedSkills.filter(Boolean))),
        selectedFilePaths:
          userMessage.additional_kwargs &&
          typeof userMessage.additional_kwargs === "object" &&
          Array.isArray((userMessage.additional_kwargs as { selectedFilePaths?: unknown }).selectedFilePaths)
            ? ((userMessage.additional_kwargs as { selectedFilePaths?: unknown }).selectedFilePaths as unknown[])
                .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
            : undefined,
      });
    },
    [activeConversation?.id, handleSend, isSending, messages, selectedSkills, token]
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
    const params = new URLSearchParams();
    const currentPath = typeof router.asPath === "string" ? router.asPath : "";
    if (projectToken) params.set("projectToken", projectToken);
    if (currentPath.startsWith("/")) params.set("returnTo", currentPath);
    void router.push(
      params.toString() ? `/skills/create?${params.toString()}` : "/skills/create"
    );
  }, [router, token]);
  const showInitialLoading = !isInitialized && messages.length === 0;

  return (
    <Flex
      backdropFilter="none"
      bg="#f7f8fc"
      border="1px solid"
      borderTop={0}
      borderBottom={0}
      borderBottomLeftRadius={0}
      borderColor="#dbe2ec"
      borderRight={0}
      borderTopLeftRadius={0}
      boxShadow="none"
      direction="column"
      h={height}
      overflow="hidden"
    >
      <ChatHeader
        activeConversationId={activeConversation?.id}
        conversations={conversations}
        contextUsage={contextUsage}
        contextStatus={contextStatus}
        messageCount={messages.length}
        model={model}
        modelLoading={modelLoading}
        modelOptions={modelOptions}
        onChangeModel={setModel}
        onDeleteAllConversations={() => deleteAllConversations()}
        onDeleteConversation={(id) => deleteConversation(id)}
        onNewConversation={() => createNewConversation()}
        onOpenSkills={undefined}
        onSelectConversation={(id) => loadConversation(id)}
        title={activeConversationTitle}
      />

      <Flex direction="column" flex="1" overflow="hidden">
        <Box
          ref={scrollRef}
          bg="#f7f8fc"
          flex="1"
          overflowY="auto"
          sx={{
            scrollbarWidth: "none",
            msOverflowStyle: "none",
            "&::-webkit-scrollbar": {
              display: "none",
            },
          }}
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
            <Flex direction="column" gap={3} pt={14}>
              {messages.map((message, index) => {
                const messageId = message.id ?? `${message.role}-${index}`;
                const summary = getExecutionSummary(message);
                const canRegenerate =
                  message.role === "user" &&
                  messages.slice(index + 1).some((item) => item.role === "assistant");
                return (
                  <Box key={messageId}>
                    <ChatMessageBlock
                      isStreaming={message.id === streamingMessageId}
                      message={message}
                      messageId={messageId}
                      canRegenerate={canRegenerate}
                      onDelete={handleDeleteMessage}
                      onRate={handleRateMessage}
                      onRegenerate={handleRegenerateMessage}
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
          projectToken={token.startsWith("skill-studio:") ? "" : token}
          onFilesApplied={onFilesUpdated}
          onCreateViaChat={handleCreateSkillViaChat}
          onUseSkill={handleUseSkill}
        />
      ) : null}
    </Flex>
  );
};

export default ChatPanel;

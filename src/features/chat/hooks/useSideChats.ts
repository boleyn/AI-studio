import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createDataId } from "@shared/chat/ids";
import {
  deleteSideChat,
  listSideChats,
  streamSideChatCompletion,
} from "../services/sideChats";
import type { SideChatMessage, SideChatThread } from "../types/selectionChat";

export interface UseSideChatsOptions {
  token: string;
  conversationId?: string;
  model: string;
  modelChannel?: string;
}

export const useSideChats = ({
  token,
  conversationId,
  model,
  modelChannel,
}: UseSideChatsOptions) => {
  const scopeKey = `${token}:${conversationId || ""}`;
  const [trackedScopeKey, setTrackedScopeKey] = useState(scopeKey);
  const [threads, setThreads] = useState<SideChatThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pendingQuote, setPendingQuote] = useState<string | null>(null);
  const [focusSignal, setFocusSignal] = useState(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const threadsRef = useRef<SideChatThread[]>(threads);

  if (trackedScopeKey !== scopeKey) {
    setTrackedScopeKey(scopeKey);
    setIsStreaming(false);
    setErrorMessage(null);
    setIsOpen(false);
    setActiveThreadId(null);
    setPendingQuote(null);
    setThreads([]);
  }

  useEffect(() => {
    threadsRef.current = threads;
  }, [threads]);

  useEffect(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;

    if (!token || !conversationId) {
      return;
    }

    const controller = new AbortController();
    void listSideChats({ token, conversationId, signal: controller.signal })
      .then((loaded) => {
        if (!controller.signal.aborted) {
          setThreads(loaded);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setThreads([]);
        }
      });

    return () => {
      controller.abort();
    };
  }, [token, conversationId]);

  const activeThread = useMemo(
    () => threads.find((item) => item.id === activeThreadId) || null,
    [threads, activeThreadId]
  );

  const openSideChatForSelection = useCallback(
    ({ text, messageId }: { text: string; messageId?: string }) => {
      const normalizedText = text.trim();
      if (!normalizedText) return;

      // If a side chat is already open and active, attach the quote directly to its composer (like ChatGPT)
      // unless it's an existing persisted thread with exact same quote.
      const existing = threadsRef.current.find(
        (item) =>
          item.messages.length > 0 &&
          item.quoteText.trim() === normalizedText &&
          (!messageId || !item.sourceMessageId || item.sourceMessageId === messageId)
      );
      if (existing) {
        setActiveThreadId(existing.id);
        setPendingQuote(null);
        setIsOpen(true);
        setErrorMessage(null);
        setFocusSignal((prev) => prev + 1);
        return;
      }

      // Reuse an empty draft thread if one is already active
      const currentActive = threadsRef.current.find((item) => item.id === activeThreadId);
      if (isOpen && currentActive) {
        setThreads((prev) =>
          prev.map((item) =>
            item.id === currentActive.id
              ? {
                  ...item,
                  quoteText: item.quoteText || normalizedText,
                  title:
                    item.messages.length === 0
                      ? normalizedText.replace(/\s+/g, " ").slice(0, 36) || "侧边聊天"
                      : item.title,
                  ...(messageId && !item.sourceMessageId ? { sourceMessageId: messageId } : {}),
                }
              : item
          )
        );
        setPendingQuote(normalizedText);
        setErrorMessage(null);
        setFocusSignal((prev) => prev + 1);
        return;
      }

      const now = new Date().toISOString();
      const newThread: SideChatThread = {
        id: createDataId(),
        token,
        chatId: conversationId || "",
        ...(messageId ? { sourceMessageId: messageId } : {}),
        quoteText: normalizedText,
        title: normalizedText.replace(/\s+/g, " ").slice(0, 36) || "侧边聊天",
        messages: [],
        createdAt: now,
        updatedAt: now,
      };
      setThreads((prev) => [newThread, ...prev]);
      setActiveThreadId(newThread.id);
      setPendingQuote(normalizedText);
      setIsOpen(true);
      setErrorMessage(null);
      setFocusSignal((prev) => prev + 1);
    },
    [activeThreadId, conversationId, isOpen, token]
  );

  const startNewSideChat = useCallback(() => {
    if (isStreaming) {
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
      setIsStreaming(false);
    }
    const now = new Date().toISOString();
    const newThread: SideChatThread = {
      id: createDataId(),
      token,
      chatId: conversationId || "",
      quoteText: "",
      title: "侧边聊天",
      messages: [],
      createdAt: now,
      updatedAt: now,
    };
    setThreads((prev) => [newThread, ...prev]);
    setActiveThreadId(newThread.id);
    setPendingQuote(null);
    setIsOpen(true);
    setErrorMessage(null);
    setFocusSignal((prev) => prev + 1);
  }, [conversationId, isStreaming, token]);

  const openSideChatById = useCallback((threadId: string) => {
    setActiveThreadId(threadId);
    const target = threadsRef.current.find((item) => item.id === threadId);
    setPendingQuote(target && target.messages.length === 0 && target.quoteText ? target.quoteText : null);
    setIsOpen(true);
    setErrorMessage(null);
    setFocusSignal((prev) => prev + 1);
  }, []);

  const closeSideChat = useCallback(() => {
    setIsOpen(false);
  }, []);

  const clearPendingQuote = useCallback(() => {
    setPendingQuote(null);
  }, []);

  const stopSideChat = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setIsStreaming(false);
  }, []);

  const deleteThread = useCallback(
    async (threadId: string) => {
      if (activeThreadId === threadId && isStreaming) {
        stopSideChat();
      }
      setThreads((prev) => {
        const next = prev.filter((item) => item.id !== threadId);
        if (activeThreadId === threadId) {
          if (next.length > 0) {
            setActiveThreadId(next[0].id);
          } else {
            setActiveThreadId(null);
            setIsOpen(false);
          }
          setPendingQuote(null);
        }
        return next;
      });
      if (token && conversationId) {
        await deleteSideChat({ token, conversationId, threadId }).catch(() => undefined);
      }
    },
    [activeThreadId, conversationId, isStreaming, stopSideChat, token]
  );

  const sendMessage = useCallback(
    async (rawPrompt: string) => {
      const promptText = rawPrompt.trim();
      const attachedQuote = pendingQuote?.trim() || "";
      if ((!promptText && !attachedQuote) || isStreaming) return;
      const currentThread = threadsRef.current.find((item) => item.id === activeThreadId);
      if (!currentThread) return;

      const effectivePrompt = promptText || "请帮我解析以上选中的内容";
      const userMessageId = createDataId();
      const optimisticAssistantId = createDataId();
      const now = new Date().toISOString();
      const historyBeforeSend = currentThread.messages;
      const effectiveQuoteForBackend = attachedQuote || currentThread.quoteText;

      const userMsg: SideChatMessage = {
        id: userMessageId,
        role: "user",
        content: effectivePrompt,
        ...(attachedQuote ? { quoteText: attachedQuote } : {}),
        createdAt: now,
      };
      const assistantPlaceholder: SideChatMessage = {
        id: optimisticAssistantId,
        role: "assistant",
        content: "",
        createdAt: now,
      };

      setPendingQuote(null);
      setErrorMessage(null);
      setIsStreaming(true);
      setThreads((prev) =>
        prev.map((item) =>
          item.id === currentThread.id
            ? {
                ...item,
                quoteText: item.quoteText || attachedQuote,
                title:
                  item.title === "侧边聊天"
                    ? (attachedQuote || effectivePrompt).replace(/\s+/g, " ").slice(0, 36)
                    : item.title,
                messages: [...item.messages, userMsg, assistantPlaceholder],
                updatedAt: now,
              }
            : item
        )
      );

      const controller = new AbortController();
      abortControllerRef.current = controller;

      await streamSideChatCompletion({
        token,
        conversationId,
        threadId: currentThread.id,
        sourceMessageId: currentThread.sourceMessageId,
        quoteText: effectiveQuoteForBackend,
        prompt: effectivePrompt,
        userMessageId,
        messages: historyBeforeSend,
        model,
        channel: modelChannel,
        signal: controller.signal,
        onDelta: (deltaText) => {
          setThreads((prev) =>
            prev.map((item) => {
              if (item.id !== currentThread.id) return item;
              return {
                ...item,
                messages: item.messages.map((msg) =>
                  msg.id === optimisticAssistantId
                    ? { ...msg, content: msg.content + deltaText }
                    : msg
                ),
              };
            })
          );
        },
        onDone: ({ thread: savedThread }) => {
          abortControllerRef.current = null;
          setIsStreaming(false);
          if (savedThread) {
            setThreads((prev) =>
              prev.map((item) => {
                if (item.id !== currentThread.id) return item;
                // Preserve local quoteText metadata on user messages
                const quoteById = new Map(
                  item.messages
                    .filter((m) => m.quoteText)
                    .map((m) => [m.id, m.quoteText as string])
                );
                return {
                  ...savedThread,
                  messages: savedThread.messages.map((m) =>
                    quoteById.has(m.id) ? { ...m, quoteText: quoteById.get(m.id) } : m
                  ),
                };
              })
            );
          }
        },
        onError: (errMsg) => {
          abortControllerRef.current = null;
          setIsStreaming(false);
          setErrorMessage(errMsg);
          setThreads((prev) =>
            prev.map((item) => {
              if (item.id !== currentThread.id) return item;
              return {
                ...item,
                messages: item.messages.filter(
                  (msg) => !(msg.id === optimisticAssistantId && !msg.content.trim())
                ),
              };
            })
          );
        },
      });
    },
    [activeThreadId, conversationId, isStreaming, model, modelChannel, pendingQuote, token]
  );

  // Only show inline badges on messages for side chats that actually have messages or are saved
  const sideChatsByMessageId = useMemo(() => {
    const map: Record<string, SideChatThread[]> = {};
    for (const thread of threads) {
      if (!thread.sourceMessageId || thread.messages.length === 0) continue;
      if (!map[thread.sourceMessageId]) {
        map[thread.sourceMessageId] = [];
      }
      map[thread.sourceMessageId].push(thread);
    }
    return map;
  }, [threads]);

  return {
    threads,
    activeThread,
    activeThreadId,
    isOpen,
    isStreaming,
    errorMessage,
    pendingQuote,
    focusSignal,
    sideChatsByMessageId,
    openSideChatForSelection,
    startNewSideChat,
    openSideChatById,
    closeSideChat,
    clearPendingQuote,
    sendMessage,
    stopSideChat,
    deleteThread,
  };
};

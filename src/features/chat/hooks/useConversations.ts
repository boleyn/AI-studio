import type { NextRouter } from "next/router";
import { useCallback, useEffect, useRef, useState } from "react";
import { createChatId } from "@shared/chat/ids";


import {
  deleteConversation as deleteConversationRequest,
  deleteAllConversations as deleteAllConversationsRequest,
  getConversation,
  listConversations,
} from "../services/conversations";

import type { Conversation, ConversationSummary } from "@/types/conversation";

const CONVERSATION_LIST_CACHE_MS = 1000;
const conversationListCache = new Map<
  string,
  { data: ConversationSummary[]; expiresAt: number }
>();
const conversationListRequests = new Map<string, Promise<ConversationSummary[]>>();

export interface UseConversationsResult {
  conversations: ConversationSummary[];
  activeConversation: Conversation | null;
  isLoadingConversation: boolean;
  isInitialized: boolean;
  loadConversation: (id: string) => Promise<void>;
  createNewConversation: () => Promise<Conversation | null>;
  ensureConversation: () => Promise<Conversation | null>;
  updateConversationTitle: (id: string, title: string) => void;
  deleteConversation: (id: string) => Promise<void>;
  deleteAllConversations: () => Promise<void>;
  setActiveConversation: (conversation: Conversation | null) => void;
}

interface UseConversationsOptions {
  autoCreateInitialConversation?: boolean;
}

export function useConversations(
  token: string,
  router: NextRouter,
  options?: UseConversationsOptions
): UseConversationsResult {
  const autoCreateInitialConversation = options?.autoCreateInitialConversation ?? true;
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeConversation, setActiveConversation] = useState<Conversation | null>(null);
  const [isLoadingConversation, setIsLoadingConversation] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const loadingConversationIdRef = useRef<string | null>(null);
  const activeConversationIdRef = useRef<string | null>(null);
  const initKeyRef = useRef<string | null>(null);

  const queryConversationId =
    router.isReady && typeof router.query.conversation === "string"
      ? router.query.conversation
      : null;

  const refreshConversations = useCallback(async (): Promise<ConversationSummary[]> => {
    const cacheKey = token;
    const cached = conversationListCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }
    const inflight = conversationListRequests.get(cacheKey);
    if (inflight) {
      return inflight;
    }

    const request = (async () => listConversations(token))();
    conversationListRequests.set(cacheKey, request);
    try {
      const data = await request;
      conversationListCache.set(cacheKey, {
        data,
        expiresAt: Date.now() + CONVERSATION_LIST_CACHE_MS,
      });
      return data;
    } finally {
      conversationListRequests.delete(cacheKey);
    }
  }, [token]);

  const loadConversation = useCallback(
    async (id: string) => {
      if (!token) return;
      if (activeConversationIdRef.current === id) return;
      if (loadingConversationIdRef.current === id) return;
      loadingConversationIdRef.current = id;
      setIsLoadingConversation(true);
      try {
        const conversation = await getConversation(token, id);
        if (conversation) {
          activeConversationIdRef.current = conversation.id;
          setActiveConversation(conversation);
          setConversations((prev) => {
            const exists = prev.some((item) => item.id === conversation.id);
            if (exists) {
              return prev.map((item) =>
                item.id === conversation.id
                  ? { ...item, title: conversation.title, updatedAt: conversation.updatedAt }
                  : item
              );
            }
            return [conversation, ...prev];
          });
          if (queryConversationId !== conversation.id) {
            router.replace(
              {
                pathname: router.pathname,
                query: { ...router.query, conversation: conversation.id },
              },
              undefined,
              { shallow: true }
            );
          }
        }
      } finally {
        setIsLoadingConversation(false);
        loadingConversationIdRef.current = null;
      }
    },
    [queryConversationId, router, token]
  );

  const createNewConversation = useCallback(async (): Promise<Conversation | null> => {
    if (!token) return null;
    const now = new Date().toISOString();
    const previousConversation = activeConversation;
    const conversation: Conversation = {
      id: createChatId(),
      title: "新对话",
      createdAt: now,
      updatedAt: now,
      messages: [],
    };

    activeConversationIdRef.current = conversation.id;
    setActiveConversation(conversation);
    setConversations((prev) => {
      // 若上一个对话为空且仅为本地草稿，切换到新对话时从历史列表中移除
      if (previousConversation && previousConversation.messages.length === 0) {
        return prev.filter((item) => item.id !== previousConversation.id && item.id !== conversation.id);
      }
      return prev.filter((item) => item.id !== conversation.id);
    });

    if (queryConversationId !== conversation.id) {
      router.replace(
        {
          pathname: router.pathname,
          query: { ...router.query, conversation: conversation.id },
        },
        undefined,
        { shallow: true }
      );
    }

    return conversation;
  }, [activeConversation, queryConversationId, router, token]);

  const ensureConversation = useCallback(async () => {
    if (activeConversation) return activeConversation;
    return createNewConversation();
  }, [activeConversation, createNewConversation]);

  const updateConversationTitle = useCallback((id: string, title: string) => {
    const now = new Date().toISOString();
    setActiveConversation((prev) => (prev?.id === id ? { ...prev, title, updatedAt: now } : prev));
    setConversations((prev) => {
      const index = prev.findIndex((item) => item.id === id);
      if (index >= 0) {
        const next = [...prev];
        next[index] = { ...next[index], title, updatedAt: now };
        return next;
      }
      const active = activeConversationIdRef.current === id ? activeConversation : null;
      return [
        {
          id,
          title,
          createdAt: active?.createdAt || now,
          updatedAt: now,
        },
        ...prev,
      ];
    });
  }, []);

  const deleteConversation = useCallback(
    async (id: string) => {
      let nextConversationId: string | null = null;
      setConversations((prev) => {
        const filtered = prev.filter((item) => item.id !== id);
        nextConversationId = filtered[0]?.id ?? null;
        return filtered;
      });
      // 本地先删，后端失败也不回滚，避免出现“删不掉”
      if (token) {
        void deleteConversationRequest(token, id);
      }
      if (activeConversationIdRef.current === id) {
        activeConversationIdRef.current = null;
        setActiveConversation(null);
        if (nextConversationId) {
          await loadConversation(nextConversationId);
        } else if (autoCreateInitialConversation) {
          await createNewConversation();
        }
      }
    },
    [autoCreateInitialConversation, createNewConversation, loadConversation, token]
  );

  const deleteAllConversations = useCallback(async () => {
    setConversations([]);
    activeConversationIdRef.current = null;
    setActiveConversation(null);
    if (token) {
      void deleteAllConversationsRequest(token);
    }
    if (autoCreateInitialConversation) {
      await createNewConversation();
    }
  }, [autoCreateInitialConversation, createNewConversation, token]);

  useEffect(() => {
    if (!token || !router.isReady) return;
    const initKey = token;
    if (initKeyRef.current === initKey) return;
    initKeyRef.current = initKey;
    setIsInitialized(false);
    let active = true;
    (async () => {
      const list = await refreshConversations();
      if (!active) return;
      setConversations(list);
      const initialConversationId = queryConversationId || list[0]?.id;
      if (initialConversationId) {
        await loadConversation(initialConversationId);
        if (active) setIsInitialized(true);
        return;
      }
      if (autoCreateInitialConversation) {
        await createNewConversation();
      }
      if (active) setIsInitialized(true);
    })();
    return () => {
      active = false;
    };
  }, [
    autoCreateInitialConversation,
    createNewConversation,
    loadConversation,
    queryConversationId,
    refreshConversations,
    router.isReady,
    token,
  ]);

  useEffect(() => {
    if (!token || !router.isReady || !isInitialized) return;
    if (!queryConversationId) return;
    if (activeConversationIdRef.current === queryConversationId) return;
    void loadConversation(queryConversationId);
  }, [isInitialized, loadConversation, queryConversationId, router.isReady, token]);

  return {
    conversations,
    activeConversation,
    isLoadingConversation,
    isInitialized,
    loadConversation,
    createNewConversation,
    ensureConversation,
    updateConversationTitle,
    deleteConversation,
    deleteAllConversations,
    setActiveConversation,
  };
}

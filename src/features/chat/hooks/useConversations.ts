import type { NextRouter } from "next/router";
import { useCallback, useEffect, useRef, useState } from "react";
import { createId } from "@shared/chat/messages";


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
      const conversation = await getConversation(token, id);
      setIsLoadingConversation(false);
      loadingConversationIdRef.current = null;
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
    },
    [queryConversationId, router, token]
  );

  const createNewConversation = useCallback(async (): Promise<Conversation | null> => {
    if (!token) return null;
    const now = new Date().toISOString();
    const conversation: Conversation = {
      id: createId(),
      title: "新对话",
      createdAt: now,
      updatedAt: now,
      messages: [],
    };

    activeConversationIdRef.current = conversation.id;
    setActiveConversation(conversation);
    if (autoCreateInitialConversation) {
      setConversations((prev) => [conversation, ...prev.filter((item) => item.id !== conversation.id)]);

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

    return conversation;
  }, [autoCreateInitialConversation, queryConversationId, router, token]);

  const ensureConversation = useCallback(async () => {
    if (activeConversation) return activeConversation;
    return createNewConversation();
  }, [activeConversation, createNewConversation]);

  const updateConversationTitle = useCallback((id: string, title: string) => {
    setActiveConversation((prev) => (prev?.id === id ? { ...prev, title } : prev));
    setConversations((prev) =>
      prev.map((item) => (item.id === id ? { ...item, title } : item))
    );
  }, []);

  const deleteConversation = useCallback(
    async (id: string) => {
      if (!token) return;
      const ok = await deleteConversationRequest(token, id);
      if (!ok) return;
      let nextConversationId: string | null = null;
      setConversations((prev) => {
        const filtered = prev.filter((item) => item.id !== id);
        nextConversationId = filtered[0]?.id ?? null;
        return filtered;
      });
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
    if (!token) return;
    await deleteAllConversationsRequest(token);
    setConversations([]);
    activeConversationIdRef.current = null;
    setActiveConversation(null);
    if (autoCreateInitialConversation) {
      await createNewConversation();
    }
  }, [autoCreateInitialConversation, createNewConversation, token]);

  useEffect(() => {
    if (!token || !router.isReady) return;
    const initKey = `${token}:${queryConversationId ?? ""}`;
    if (initKeyRef.current === initKey) return;
    initKeyRef.current = initKey;
    setIsInitialized(false);
    let active = true;
    (async () => {
      const list = await refreshConversations();
      if (!active) return;
      setConversations(list);
      if (queryConversationId) {
        await loadConversation(queryConversationId);
        if (active) setIsInitialized(true);
        return;
      }
      if (list.length > 0) {
        await loadConversation(list[0].id);
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

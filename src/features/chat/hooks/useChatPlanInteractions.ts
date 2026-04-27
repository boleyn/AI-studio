import { useCallback, useMemo, useState } from "react";
import type { ChatInteractionContextValue } from "../context/ChatInteractionContext";

export const useChatPlanInteractions = ({
  token,
  conversationId,
  pendingInteraction,
  clearPendingInteraction,
}: {
  token: string;
  conversationId?: string;
  pendingInteraction: ChatInteractionContextValue["pendingInteraction"];
  clearPendingInteraction: (input: { requestId?: string; toolUseId?: string; toolName?: string }) => void;
}) => {
  const [isResolvingInteraction, setIsResolvingInteraction] = useState(false);

  const resolveInteraction = useCallback(
    async (input: {
      requestId: string;
      decision: "approve" | "reject";
      answers?: Record<string, string>;
      note?: string;
      updatedInput?: unknown;
    }) => {
      if (!conversationId) return false;
      const response = await fetch("/api/v2/chat/resolve-interaction", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          token,
          chatId: conversationId,
          requestId: input.requestId,
          decision: input.decision,
          ...(input.answers ? { answers: input.answers } : {}),
          ...(input.note ? { note: input.note } : {}),
          ...(input.updatedInput !== undefined ? { updatedInput: input.updatedInput } : {}),
        }),
      }).catch(() => null);
      if (!response?.ok) return false;
      const payload = (await response.json().catch(() => ({}))) as { resolved?: boolean };
      return payload.resolved === true;
    },
    [conversationId, token]
  );

  const handlePlanQuestionsSubmit = useCallback(
    async (input: {
      requestId: string;
      answers: Record<string, string>;
    }) => {
      if (!input.requestId || isResolvingInteraction) return;
      const answerEntries = Object.entries(input.answers).filter(
        ([key, value]) => Boolean(key && typeof value === "string" && value.trim().length > 0)
      );
      if (answerEntries.length === 0) return;
      const answerMap = Object.fromEntries(answerEntries);
      setIsResolvingInteraction(true);
      try {
        const resolved = await resolveInteraction({
          requestId: input.requestId,
          decision: "approve",
          answers: answerMap,
        });
        if (resolved) {
          clearPendingInteraction({ requestId: input.requestId });
          return true;
        }
        return false;
      } finally {
        setIsResolvingInteraction(false);
      }
    },
    [
      clearPendingInteraction,
      isResolvingInteraction,
      resolveInteraction,
    ]
  );

  const handlePlanModeApprovalSelect = useCallback(
    async (input: {
      requestId: string;
      action: "enter" | "exit";
      decision: "approve" | "reject";
      note?: string;
    }) => {
      if (isResolvingInteraction) return;
      setIsResolvingInteraction(true);
      try {
        const resolved = await resolveInteraction({
          requestId: input.requestId,
          decision: input.decision,
          ...(input.note ? { note: input.note } : {}),
        });
        if (resolved) {
          clearPendingInteraction({ requestId: input.requestId });
          return true;
        }
        return false;
      } finally {
        setIsResolvingInteraction(false);
      }
    },
    [
      clearPendingInteraction,
      isResolvingInteraction,
      resolveInteraction,
    ]
  );

  const handlePermissionApprovalSelect = useCallback(
    async (input: {
      requestId?: string;
      toolName: string;
      toolUseId?: string;
      decision: "approve" | "reject";
      note?: string;
    }) => {
      if (!input.toolName || isResolvingInteraction) return;
      const requestId = (input.toolUseId || input.requestId || "").trim();
      if (requestId) {
        setIsResolvingInteraction(true);
        try {
          const resolved = await resolveInteraction({
            requestId,
            decision: input.decision,
            ...(input.note ? { note: input.note } : {}),
          });
          if (resolved) {
            clearPendingInteraction({
              requestId: input.requestId,
              toolUseId: input.toolUseId,
              toolName: input.toolName,
            });
            return true;
          }
          return false;
        } finally {
          setIsResolvingInteraction(false);
        }
      }
      return false;
    },
    [
      clearPendingInteraction,
      isResolvingInteraction,
      resolveInteraction,
    ]
  );

  const chatInteractionContextValue = useMemo<ChatInteractionContextValue>(
    () => ({
      planQuestionSubmitting: isResolvingInteraction,
      planModeApprovalSubmitting: isResolvingInteraction,
      permissionApprovalSubmitting: isResolvingInteraction,
      pendingInteraction,
      hideInteractiveCards: false,
      onPlanQuestionsSubmit: handlePlanQuestionsSubmit,
      onPlanModeApprovalSelect: handlePlanModeApprovalSelect,
      onPermissionApprovalSelect: handlePermissionApprovalSelect,
    }),
    [
      handlePermissionApprovalSelect,
      handlePlanModeApprovalSelect,
      handlePlanQuestionsSubmit,
      isResolvingInteraction,
      pendingInteraction,
    ]
  );

  return {
    handlePlanQuestionsSubmit,
    handlePlanModeApprovalSelect,
    handlePermissionApprovalSelect,
    chatInteractionContextValue,
  };
};

import { useCallback, useMemo, useState } from "react";
import type { ChatInteractionContextValue } from "../context/ChatInteractionContext";
import type { ChatInputSubmitPayload } from "../types/chatInput";

export const useChatPlanInteractions = ({
  token,
  conversationId,
  handleSend,
  selectedSkills,
  thinkingEnabled,
  pendingInteraction,
  clearPendingInteraction,
}: {
  token: string;
  conversationId?: string;
  handleSend: (
    input: ChatInputSubmitPayload,
    options?: {
      echoUserMessage?: boolean;
      persistIncomingMessages?: boolean;
      continueAssistantMessageId?: string;
    }
  ) => Promise<void>;
  selectedSkills: string[];
  thinkingEnabled: boolean;
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
      const executionDecision = (answerMap.plan_execute_confirm || "").trim();
      const shouldExecuteNow = executionDecision === "确认执行";
      setIsResolvingInteraction(true);
      try {
        const resolved = await resolveInteraction({
          requestId: input.requestId,
          decision: "approve",
          answers: answerMap,
        });
        if (resolved) {
          clearPendingInteraction({ requestId: input.requestId });
          return;
        }
      } finally {
        setIsResolvingInteraction(false);
      }

      const answerText = [
        "Plan mode user selection:",
        `- request_id: ${input.requestId}`,
        ...answerEntries.map(([questionId, answer]) => `- ${questionId}: ${answer}`),
      ].join("\n");

      void handleSend(
        {
          text: answerText,
          uploadedFiles: [],
          files: [],
          planQuestionResponse: {
            requestId: input.requestId,
            answers: answerMap,
          },
          ...(shouldExecuteNow
            ? {
                planModeApprovalResponse: {
                  requestId: input.requestId,
                  action: "exit" as const,
                  decision: "approve" as const,
                  note: "execute_confirmed",
                },
              }
            : {}),
          selectedSkills,
          thinkingEnabled,
        },
        {
          echoUserMessage: false,
          continueAssistantMessageId: pendingInteraction?.assistantMessageId,
        }
      );
    },
    [
      clearPendingInteraction,
      handleSend,
      isResolvingInteraction,
      pendingInteraction?.assistantMessageId,
      resolveInteraction,
      selectedSkills,
      thinkingEnabled,
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
          return;
        }
      } finally {
        setIsResolvingInteraction(false);
      }

      const answerText = [
        "Plan mode approval response:",
        `- request_id: ${input.requestId}`,
        `- action: ${input.action}`,
        `- decision: ${input.decision}`,
        ...(input.note ? [`- note: ${input.note}`] : []),
      ].join("\n");

      void handleSend(
        {
          text: answerText,
          uploadedFiles: [],
          files: [],
          selectedSkills,
          planModeApprovalResponse: {
            requestId: input.requestId,
            action: input.action,
            decision: input.decision,
            ...(input.note ? { note: input.note } : {}),
          },
          thinkingEnabled,
        },
        {
          echoUserMessage: false,
          continueAssistantMessageId: pendingInteraction?.assistantMessageId,
        }
      );
    },
    [
      clearPendingInteraction,
      handleSend,
      isResolvingInteraction,
      pendingInteraction?.assistantMessageId,
      resolveInteraction,
      selectedSkills,
      thinkingEnabled,
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
            return;
          }
        } finally {
          setIsResolvingInteraction(false);
        }
      }
      const answerText = [
        "Tool permission approval response:",
        `- tool_name: ${input.toolName}`,
        `- decision: ${input.decision}`,
        ...(input.note ? [`- note: ${input.note}`] : []),
      ].join("\n");

      void handleSend(
        {
          text: answerText,
          uploadedFiles: [],
          files: [],
          selectedSkills,
          permissionApprovalResponse: {
            ...(input.requestId ? { requestId: input.requestId } : {}),
            ...(input.toolUseId ? { toolUseId: input.toolUseId } : {}),
            toolName: input.toolName,
            decision: input.decision,
            ...(input.note ? { note: input.note } : {}),
          },
          thinkingEnabled,
        },
        {
          echoUserMessage: false,
          continueAssistantMessageId: pendingInteraction?.assistantMessageId,
        }
      );
    },
    [
      clearPendingInteraction,
      handleSend,
      isResolvingInteraction,
      pendingInteraction?.assistantMessageId,
      resolveInteraction,
      selectedSkills,
      thinkingEnabled,
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

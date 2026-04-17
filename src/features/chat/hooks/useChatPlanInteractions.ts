import { useCallback, useMemo, type Dispatch, type SetStateAction } from "react";
import type { ConversationMessage } from "@/types/conversation";
import type { ChatInteractionContextValue } from "../context/ChatInteractionContext";
import type { ChatInputSubmitPayload } from "../types/chatInput";

export const useChatPlanInteractions = ({
  isSending,
  setMessages,
  handleSend,
  selectedSkills,
  thinkingEnabled,
}: {
  isSending: boolean;
  setMessages: Dispatch<SetStateAction<ConversationMessage[]>>;
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
}) => {
  const handlePlanQuestionSelect = useCallback(
    (input: {
      messageId: string;
      requestId?: string;
      questionId: string;
      header?: string;
      question: string;
      optionLabel: string;
      optionDescription?: string;
    }) => {
      if (!input.messageId || !input.questionId || !input.optionLabel || isSending) return;
      setMessages((prev) =>
        prev.map((message) => {
          if (message.id !== input.messageId) return message;
          const kwargs =
            message.additional_kwargs && typeof message.additional_kwargs === "object"
              ? message.additional_kwargs
              : {};
          const existingAnswers =
            kwargs.planAnswers && typeof kwargs.planAnswers === "object" && !Array.isArray(kwargs.planAnswers)
              ? (kwargs.planAnswers as Record<string, unknown>)
              : {};
          return {
            ...message,
            additional_kwargs: {
              ...kwargs,
              planAnswers: {
                ...existingAnswers,
                [input.questionId]: input.optionLabel,
              },
              ...(input.requestId
                ? {
                    planModeInteractionState: {
                      ...(kwargs.planModeInteractionState &&
                      typeof kwargs.planModeInteractionState === "object" &&
                      !Array.isArray(kwargs.planModeInteractionState)
                        ? (kwargs.planModeInteractionState as Record<string, unknown>)
                        : {}),
                      [input.requestId]: {
                        type: "plan_question",
                        status: "submitted",
                      },
                    },
                  }
                : {}),
            },
          };
        })
      );

    },
    [isSending, setMessages]
  );

  const handlePlanQuestionsSubmit = useCallback(
    (input: {
      messageId: string;
      requestId: string;
      answers: Record<string, string>;
    }) => {
      if (!input.messageId || !input.requestId || isSending) return;
      const answerEntries = Object.entries(input.answers).filter(
        ([key, value]) => Boolean(key && typeof value === "string" && value.trim().length > 0)
      );
      if (answerEntries.length === 0) return;
      const answerMap = Object.fromEntries(answerEntries);
      const executionDecision = (answerMap.plan_execute_confirm || "").trim();
      const shouldExecuteNow = executionDecision === "确认执行";

      setMessages((prev) =>
        prev.map((message) => {
          if (message.id !== input.messageId) return message;
          const kwargs =
            message.additional_kwargs && typeof message.additional_kwargs === "object"
              ? message.additional_kwargs
              : {};
          return {
            ...message,
            additional_kwargs: {
              ...kwargs,
              planQuestions: [],
              planQuestionSubmission: {
                requestId: input.requestId,
                answers: answerMap,
                submittedAt: new Date().toISOString(),
              },
              planModeInteractionState: {
                ...(kwargs.planModeInteractionState &&
                typeof kwargs.planModeInteractionState === "object" &&
                !Array.isArray(kwargs.planModeInteractionState)
                  ? (kwargs.planModeInteractionState as Record<string, unknown>)
                  : {}),
                [input.requestId]: {
                  type: "plan_question",
                  status: "submitted",
                },
              },
              ...(shouldExecuteNow ? { planModeApprovalDecision: "approve" } : {}),
            },
          };
        })
      );
      // Keep mode transition server-driven (via persisted planModeState),
      // avoiding optimistic local flips that can desync with history replay.

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
          continueAssistantMessageId: input.messageId,
        }
      );
    },
    [handleSend, isSending, selectedSkills, setMessages, thinkingEnabled]
  );

  const handlePlanModeApprovalSelect = useCallback(
    (input: {
      messageId: string;
      requestId: string;
      action: "enter" | "exit";
      decision: "approve" | "reject";
      note?: string;
    }) => {
      if (!input.messageId || isSending) return;

      setMessages((prev) =>
        prev.map((message) => {
          if (message.id !== input.messageId) return message;
          const kwargs =
            message.additional_kwargs && typeof message.additional_kwargs === "object"
              ? message.additional_kwargs
              : {};
          return {
            ...message,
            additional_kwargs: {
              ...kwargs,
              planModeApprovalDecision: input.decision,
              ...(input.note ? { planModeApprovalNote: input.note } : {}),
              planModeApproval: null,
              planModeInteractionState: {
                ...(kwargs.planModeInteractionState &&
                typeof kwargs.planModeInteractionState === "object" &&
                !Array.isArray(kwargs.planModeInteractionState)
                  ? (kwargs.planModeInteractionState as Record<string, unknown>)
                  : {}),
                [input.requestId]: {
                  type: "plan_approval",
                  status: "submitted",
                  decision: input.decision,
                },
              },
            },
          };
        })
      );

      // Keep mode transition server-driven (via persisted planModeState),
      // avoiding optimistic local flips that can desync with history replay.

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
          continueAssistantMessageId: input.messageId,
        }
      );
    },
    [handleSend, isSending, selectedSkills, setMessages, thinkingEnabled]
  );

  const handlePermissionApprovalSelect = useCallback(
    (input: { messageId: string; toolName: string; toolUseId?: string; decision: "approve" | "reject"; note?: string }) => {
      if (!input.messageId || !input.toolName || isSending) return;

      setMessages((prev) =>
        prev.map((message) => {
          if (message.id !== input.messageId) return message;
          const kwargs =
            message.additional_kwargs && typeof message.additional_kwargs === "object"
              ? message.additional_kwargs
              : {};
          return {
            ...message,
            additional_kwargs: {
              ...kwargs,
              permissionApprovalDecision: input.decision,
              ...(input.note ? { permissionApprovalNote: input.note } : {}),
            },
          };
        })
      );

      const answerText = [
        "Tool permission approval response:",
        `- tool_name: ${input.toolName}`,
        `- decision: ${input.decision}`,
        ...(input.note ? [`- note: ${input.note}`] : []),
      ].join("\n");

      void handleSend({
        text: answerText,
        uploadedFiles: [],
        files: [],
        selectedSkills,
        permissionApprovalResponse: {
          ...(input.toolUseId ? { requestId: input.toolUseId, toolUseId: input.toolUseId } : {}),
          toolName: input.toolName,
          decision: input.decision,
          ...(input.note ? { note: input.note } : {}),
        },
        thinkingEnabled,
      });
    },
    [handleSend, isSending, selectedSkills, setMessages, thinkingEnabled]
  );

  const chatInteractionContextValue = useMemo<ChatInteractionContextValue>(
    () => ({
      planQuestionSubmitting: isSending,
      planModeApprovalSubmitting: isSending,
      hideInteractiveCards: false,
      onPlanQuestionSelect: handlePlanQuestionSelect,
      onPlanQuestionsSubmit: handlePlanQuestionsSubmit,
      onPlanModeApprovalSelect: handlePlanModeApprovalSelect,
      onPermissionApprovalSelect: handlePermissionApprovalSelect,
    }),
    [
      handlePermissionApprovalSelect,
      handlePlanModeApprovalSelect,
      handlePlanQuestionSelect,
      handlePlanQuestionsSubmit,
      isSending,
    ]
  );

  return {
    handlePlanQuestionSelect,
    handlePlanQuestionsSubmit,
    handlePlanModeApprovalSelect,
    handlePermissionApprovalSelect,
    chatInteractionContextValue,
  };
};

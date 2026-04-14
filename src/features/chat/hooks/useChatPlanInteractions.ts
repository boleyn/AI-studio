import { useCallback, useMemo, type Dispatch, type SetStateAction } from "react";
import type { ConversationMessage } from "@/types/conversation";
import type { ChatInteractionContextValue } from "../context/ChatInteractionContext";

export const useChatPlanInteractions = ({
  isSending,
  setMessages,
  chatMode,
  setChatMode,
  handleSend,
  selectedSkills,
  thinkingEnabled,
}: {
  isSending: boolean;
  setMessages: Dispatch<SetStateAction<ConversationMessage[]>>;
  chatMode: "default" | "plan";
  setChatMode: Dispatch<SetStateAction<"default" | "plan">>;
  handleSend: (input: {
    text?: string;
    uploadedFiles?: unknown[];
    files?: unknown[];
    selectedSkills?: string[];
    thinkingEnabled?: boolean;
    planModeApprovalResponse?: {
      action: "enter" | "exit";
      decision: "approve" | "reject";
      note?: string;
    };
    permissionApprovalResponse?: {
      toolName: string;
      decision: "approve" | "reject";
      note?: string;
    };
  }) => Promise<void>;
  selectedSkills: string[];
  thinkingEnabled: boolean;
}) => {
  const handlePlanQuestionSelect = useCallback(
    (input: {
      messageId: string;
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
            },
          };
        })
      );

      const answerText = [
        "Plan mode user selection:",
        `- question_id: ${input.questionId}`,
        `- header: ${input.header || "Confirm"}`,
        `- question: ${input.question}`,
        `- selected_option: ${input.optionLabel}`,
        ...(input.optionDescription ? [`- selected_option_description: ${input.optionDescription}`] : []),
      ].join("\n");

      void handleSend({
        text: answerText,
        uploadedFiles: [],
        files: [],
        selectedSkills,
        thinkingEnabled,
      });
    },
    [handleSend, isSending, selectedSkills, setMessages, thinkingEnabled]
  );

  const handlePlanModeApprovalSelect = useCallback(
    (input: {
      messageId: string;
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
            },
          };
        })
      );

      const nextMode = input.decision !== "approve" ? chatMode : input.action === "enter" ? "plan" : "default";
      if (nextMode !== chatMode) {
        setChatMode(nextMode);
      }

      const answerText = [
        "Plan mode approval response:",
        `- action: ${input.action}`,
        `- decision: ${input.decision}`,
        ...(input.note ? [`- note: ${input.note}`] : []),
      ].join("\n");

      void handleSend({
        text: answerText,
        uploadedFiles: [],
        files: [],
        selectedSkills,
        planModeApprovalResponse: {
          action: input.action,
          decision: input.decision,
          ...(input.note ? { note: input.note } : {}),
        },
        thinkingEnabled,
      });
    },
    [chatMode, handleSend, isSending, selectedSkills, setChatMode, setMessages, thinkingEnabled]
  );

  const handlePermissionApprovalSelect = useCallback(
    (input: { messageId: string; toolName: string; decision: "approve" | "reject"; note?: string }) => {
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
      onPlanModeApprovalSelect: handlePlanModeApprovalSelect,
      onPermissionApprovalSelect: handlePermissionApprovalSelect,
    }),
    [handlePermissionApprovalSelect, handlePlanModeApprovalSelect, handlePlanQuestionSelect, isSending]
  );

  return {
    handlePlanQuestionSelect,
    handlePlanModeApprovalSelect,
    handlePermissionApprovalSelect,
    chatInteractionContextValue,
  };
};

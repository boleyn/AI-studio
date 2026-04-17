import { createContext, useContext } from "react";

type PlanQuestionSelectInput = {
  messageId: string;
  requestId?: string;
  questionId: string;
  header?: string;
  question: string;
  optionLabel: string;
  optionDescription?: string;
};

type PlanQuestionsSubmitInput = {
  messageId: string;
  requestId: string;
  answers: Record<string, string>;
};

type PlanModeApprovalInput = {
  messageId: string;
  requestId: string;
  action: "enter" | "exit";
  decision: "approve" | "reject";
};

type PermissionApprovalInput = {
  messageId: string;
  toolName: string;
  toolUseId?: string;
  decision: "approve" | "reject";
};

export type ChatInteractionContextValue = {
  planQuestionSubmitting: boolean;
  planModeApprovalSubmitting: boolean;
  hideInteractiveCards?: boolean;
  onPlanQuestionSelect?: (input: PlanQuestionSelectInput) => void;
  onPlanQuestionsSubmit?: (input: PlanQuestionsSubmitInput) => void;
  onPlanModeApprovalSelect?: (input: PlanModeApprovalInput) => void;
  onPermissionApprovalSelect?: (input: PermissionApprovalInput) => void;
};

const ChatInteractionContext = createContext<ChatInteractionContextValue | null>(null);

export const ChatInteractionProvider = ChatInteractionContext.Provider;

export const useChatInteractionContext = () => {
  const context = useContext(ChatInteractionContext);
  if (!context) {
    throw new Error("useChatInteractionContext must be used within ChatInteractionProvider");
  }
  return context;
};

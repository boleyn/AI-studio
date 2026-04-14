import { createContext, useContext } from "react";

type PlanQuestionSelectInput = {
  messageId: string;
  questionId: string;
  header?: string;
  question: string;
  optionLabel: string;
  optionDescription?: string;
};

type PlanModeApprovalInput = {
  messageId: string;
  action: "enter" | "exit";
  decision: "approve" | "reject";
};

type PermissionApprovalInput = {
  messageId: string;
  toolName: string;
  decision: "approve" | "reject";
};

export type ChatInteractionContextValue = {
  planQuestionSubmitting: boolean;
  planModeApprovalSubmitting: boolean;
  hideInteractiveCards?: boolean;
  onPlanQuestionSelect?: (input: PlanQuestionSelectInput) => void;
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


import { createContext, useContext } from "react";

type PlanQuestionsSubmitInput = {
  requestId: string;
  answers: Record<string, string>;
};

type PlanModeApprovalInput = {
  requestId: string;
  action: "enter" | "exit";
  decision: "approve" | "reject";
};

type PermissionApprovalInput = {
  requestId?: string;
  toolName: string;
  toolUseId?: string;
  decision: "approve" | "reject";
};

export type PendingPlanQuestion = {
  header?: string;
  id: string;
  question: string;
  options: Array<{
    label: string;
    description?: string;
  }>;
};

export type PendingPlanApproval = {
  requestId: string;
  action: "enter" | "exit";
  title?: string;
  description?: string;
};

export type PendingPermissionApproval = {
  requestId?: string;
  toolName: string;
  toolUseId?: string;
  reason?: string;
};

export type PendingChatInteraction =
  | {
      type: "plan_questions";
      requestId: string;
      assistantMessageId: string;
      questions: PendingPlanQuestion[];
    }
  | {
      type: "plan_approval";
      requestId: string;
      assistantMessageId: string;
      approval: PendingPlanApproval;
    }
  | {
      type: "permission";
      requestId?: string;
      assistantMessageId: string;
      permission: PendingPermissionApproval;
    };

export type ChatInteractionContextValue = {
  planQuestionSubmitting: boolean;
  planModeApprovalSubmitting: boolean;
  permissionApprovalSubmitting: boolean;
  pendingInteraction: PendingChatInteraction | null;
  hideInteractiveCards?: boolean;
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

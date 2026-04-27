import type { ChatInteractionContextValue } from "../../context/ChatInteractionContext";
import InteractionShell from "./interactionSurface/InteractionShell";
import PermissionApprovalCard from "./interactionSurface/PermissionApprovalCard";
import PlanApprovalCard from "./interactionSurface/PlanApprovalCard";
import PlanQuestionsCard from "./interactionSurface/PlanQuestionsCard";

const ChatInteractionSurface = ({
  interaction,
}: {
  interaction: ChatInteractionContextValue;
}) => {
  if (interaction.hideInteractiveCards) return null;
  const pending = interaction.pendingInteraction;
  if (!pending) return null;

  if (pending.type === "permission") {
    return (
      <InteractionShell title="工具权限审批" tone="amber">
        <PermissionApprovalCard interaction={interaction} pending={pending} />
      </InteractionShell>
    );
  }

  if (pending.type === "plan_approval") {
    return (
      <InteractionShell title={pending.approval.title || "计划模式审批"} tone="purple">
        <PlanApprovalCard interaction={interaction} pending={pending} />
      </InteractionShell>
    );
  }

  return (
    <InteractionShell title="计划问题" tone="purple">
      <PlanQuestionsCard interaction={interaction} pending={pending} />
    </InteractionShell>
  );
};

export default ChatInteractionSurface;

import { Button, Flex, Input } from "@chakra-ui/react";
import { useState } from "react";
import Markdown from "@/components/Markdown";
import type { InteractionContext, PendingInteraction } from "./types";

type PlanApprovalInteraction = Extract<
  PendingInteraction,
  { type: "plan_approval" }
>;

const PlanApprovalCard = ({
  pending,
  interaction,
}: {
  pending: PlanApprovalInteraction;
  interaction: InteractionContext;
}) => {
  const [feedback, setFeedback] = useState("");
  return (
    <>
      {pending.approval.description ? (
        <Flex mt={1}>
          <Markdown source={pending.approval.description} />
        </Flex>
      ) : null}
      <Input
        mt={2}
        size="sm"
        aria-label="计划修改意见"
        placeholder="需要调整计划？写下修改意见"
        value={feedback}
        onChange={(event) => setFeedback(event.target.value)}
      />
      <Flex gap={2} justify="flex-end" mt={2.5}>
        <Button
          bg="#262626" color="white" borderRadius="full" _hover={{ bg: "#414141" }}
          h="30px"
          isDisabled={Boolean(
            interaction.planModeApprovalSubmitting ||
            feedback.trim() ||
            !interaction.onPlanModeApprovalSelect,
          )}
          isLoading={Boolean(interaction.planModeApprovalSubmitting)}
          onClick={() => {
            interaction.onPlanModeApprovalSelect?.({
              requestId: pending.requestId,
              action: pending.approval.action,
              decision: "approve",
            });
          }}
          size="sm"
        >
          {pending.approval.action === "exit" ? "执行此计划" : "进入计划模式"}
        </Button>
        <Button
          borderColor="#dedede"
          color="#444"
          h="30px"
          isDisabled={Boolean(
            interaction.planModeApprovalSubmitting ||
            !interaction.onPlanModeApprovalSelect,
          )}
          onClick={() => {
            interaction.onPlanModeApprovalSelect?.({
              requestId: pending.requestId,
              action: pending.approval.action,
              decision: "reject",
              ...(feedback.trim() ? { note: feedback.trim() } : {}),
            });
          }}
          size="sm"
          variant="outline"
          _hover={{ bg: "#f4f4f4" }}
        >
          {feedback.trim() ? "提交修改意见" : "暂不执行"}
        </Button>
      </Flex>
    </>
  );
};

export default PlanApprovalCard;

import { Button, Flex, Text } from "@chakra-ui/react";
import type { InteractionContext, PendingInteraction } from "./types";

type PlanApprovalInteraction = Extract<PendingInteraction, { type: "plan_approval" }>;

const PlanApprovalCard = ({
  pending,
  interaction,
}: {
  pending: PlanApprovalInteraction;
  interaction: InteractionContext;
}) => (
  <>
    {pending.approval.description ? (
      <Text color="myGray.700" fontSize="12px" mt={1} whiteSpace="pre-wrap">
        {pending.approval.description}
      </Text>
    ) : null}
    <Text color="myGray.500" fontSize="11px" mt={2}>
      批准后将继续当前流程，拒绝会中断当前计划步骤。
    </Text>
    <Flex gap={2} justify="flex-end" mt={3}>
      <Button
        colorScheme="primary"
        isDisabled={Boolean(interaction.planModeApprovalSubmitting || !interaction.onPlanModeApprovalSelect)}
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
        批准
      </Button>
      <Button
        isDisabled={Boolean(interaction.planModeApprovalSubmitting || !interaction.onPlanModeApprovalSelect)}
        onClick={() => {
          interaction.onPlanModeApprovalSelect?.({
            requestId: pending.requestId,
            action: pending.approval.action,
            decision: "reject",
          });
        }}
        size="sm"
        variant="outline"
      >
        拒绝
      </Button>
    </Flex>
  </>
);

export default PlanApprovalCard;

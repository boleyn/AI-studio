import { Button, Flex, Text } from "@chakra-ui/react";
import type { InteractionContext, PendingInteraction } from "./types";

type PermissionInteraction = Extract<PendingInteraction, { type: "permission" }>;

const PermissionApprovalCard = ({
  pending,
  interaction,
}: {
  pending: PermissionInteraction;
  interaction: InteractionContext;
}) => (
  <>
    <Text color="myGray.700" fontSize="12px" mt={1}>
      工具: {pending.permission.toolName}
    </Text>
    {pending.permission.reason ? (
      <Text color="myGray.600" fontSize="12px" mt={1}>
        {pending.permission.reason}
      </Text>
    ) : null}
    <Text color="myGray.500" fontSize="11px" mt={2}>
      允许后本次调用会继续，拒绝将返回工具被拒绝状态。
    </Text>
    <Flex gap={2} justify="flex-end" mt={2.5}>
      <Button
        colorScheme="primary"
        h="30px"
        isDisabled={Boolean(interaction.permissionApprovalSubmitting || !interaction.onPermissionApprovalSelect)}
        isLoading={Boolean(interaction.permissionApprovalSubmitting)}
        onClick={() =>
          interaction.onPermissionApprovalSelect?.({
            requestId: pending.requestId,
            toolName: pending.permission.toolName,
            toolUseId: pending.permission.toolUseId,
            decision: "approve",
          })
        }
        size="sm"
      >
        允许
      </Button>
      <Button
        borderColor="red.300"
        color="red.700"
        h="30px"
        isDisabled={Boolean(interaction.permissionApprovalSubmitting || !interaction.onPermissionApprovalSelect)}
        onClick={() =>
          interaction.onPermissionApprovalSelect?.({
            requestId: pending.requestId,
            toolName: pending.permission.toolName,
            toolUseId: pending.permission.toolUseId,
            decision: "reject",
          })
        }
        size="sm"
        variant="outline"
        _hover={{ bg: "red.50", borderColor: "red.400" }}
      >
        拒绝
      </Button>
    </Flex>
  </>
);

export default PermissionApprovalCard;

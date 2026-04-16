import { Box, Flex, Spinner, Text } from "@chakra-ui/react";
import type {
  PlanApprovalInteractionPayload,
  PlanInteractionEnvelope,
  PlanProgressInteractionPayload,
  PlanProgressItem,
  PlanQuestionInteractionPayload,
} from "@shared/chat/planInteraction";
import PlanModeToolApprovalCard from "./PlanModeToolApprovalCard";

type TimelineToolItem = {
  toolName?: string;
  interaction?: PlanInteractionEnvelope;
  progressStatus?: "pending" | "in_progress" | "completed" | "error";
};

const PlanModeTimelineCard = ({
  toolItem,
  isStreaming,
  planModeApprovalDecision,
  planPreview,
}: {
  toolItem: TimelineToolItem;
  isStreaming?: boolean;
  planModeApprovalDecision: "approve" | "reject" | "";
  planPreview?: string;
}) => {
  const normalizedToolName = (toolItem.toolName || "").trim().toLowerCase();
  const isRunning = Boolean(
    isStreaming || toolItem.progressStatus === "pending" || toolItem.progressStatus === "in_progress"
  );

  const runtimeInteraction = toolItem.interaction;
  if (!runtimeInteraction) return null;

  const runtimePlanProgress =
    runtimeInteraction?.type === "plan_progress"
      ? ({
        explanation: (runtimeInteraction.payload as PlanProgressInteractionPayload).explanation,
        plan: (runtimeInteraction.payload as PlanProgressInteractionPayload).plan,
      } as { explanation?: string; plan: PlanProgressItem[] })
      : null;

  const runtimeApproval =
    runtimeInteraction?.type === "plan_approval"
      ? {
        requestId: runtimeInteraction.requestId,
        payload: runtimeInteraction.payload as PlanApprovalInteractionPayload,
      }
      : null;

  const runtimeQuestions =
    runtimeInteraction?.type === "plan_question"
      ? (runtimeInteraction.payload as PlanQuestionInteractionPayload)
      : null;

  if (normalizedToolName === "request_user_input") {
    return (
      <Flex align="stretch" gap={2}>
        <Flex align="center" direction="column" w="12px">
          {isRunning ? (
            <Spinner color="green.500" mt="5px" size="xs" speed="0.7s" thickness="2.5px" />
          ) : (
            <Box bg="primary.500" borderRadius="full" h="7px" mt="7px" w="7px" />
          )}
        </Flex>
        <Box bg="myGray.25" border="1px solid" borderColor="myGray.250" borderRadius="10px" flex="1" minW={0} p={2.5}>
          <Text color="myGray.800" fontSize="12px" fontWeight="700">
            计划问题已生成
          </Text>
          <Text color="myGray.600" fontSize="12px" mt={1}>
            请在消息末尾的计划确认区域完成选择。
          </Text>
          {runtimeQuestions?.questions?.length ? (
            <Text color="myGray.500" fontSize="11px" mt={1}>
              共 {runtimeQuestions.questions.length} 个问题
            </Text>
          ) : null}
        </Box>
      </Flex>
    );
  }

  if (normalizedToolName === "update_plan") {
    const progress = runtimePlanProgress;
    if (!progress || progress.plan.length === 0) return null;
    return (
      <Flex align="stretch" gap={2}>
        <Flex align="center" direction="column" w="12px">
          {isRunning ? (
            <Spinner color="green.500" mt="5px" size="xs" speed="0.7s" thickness="2.5px" />
          ) : (
            <Box bg="primary.500" borderRadius="full" h="7px" mt="7px" w="7px" />
          )}
        </Flex>
        <Box flex="1" minW={0}>
          <PlanModeToolApprovalCard
            checklist={progress.plan.map((item) => ({ text: item.step, status: item.status }))}
            description={progress.explanation || "计划执行进度已更新。"}
            preview={planPreview}
            title="计划清单"
          />
        </Box>
      </Flex>
    );
  }

  if (normalizedToolName === "enter_plan_mode" || normalizedToolName === "exit_plan_mode") {
    const approval = runtimeApproval;
    if (!approval) return null;
    return (
      <Flex align="stretch" gap={2}>
        <Flex align="center" direction="column" w="12px">
          {isRunning ? (
            <Spinner color="green.500" mt="5px" size="xs" speed="0.7s" thickness="2.5px" />
          ) : (
            <Box bg="primary.500" borderRadius="full" h="7px" mt="7px" w="7px" />
          )}
        </Flex>
        <Box bg="myGray.25" border="1px solid" borderColor="myGray.250" borderRadius="10px" flex="1" minW={0} p={2.5}>
          <Text color="myGray.800" fontSize="12px" fontWeight="700">
            {approval.payload.title || "计划模式审批"}
          </Text>
          <Text color="myGray.600" fontSize="12px" mt={1}>
            请在消息末尾的计划确认区域完成审批操作。
          </Text>
          {planModeApprovalDecision ? (
            <Text color="myGray.500" fontSize="11px" mt={1}>
              当前选择: {planModeApprovalDecision === "approve" ? "批准" : "拒绝"}
            </Text>
          ) : null}
        </Box>
      </Flex>
    );
  }

  return null;
};

export default PlanModeTimelineCard;

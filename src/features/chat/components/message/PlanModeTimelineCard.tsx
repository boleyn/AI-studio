import { Box, Flex, Spinner, Text } from "@chakra-ui/react";
import PlanModeToolApprovalCard from "./PlanModeToolApprovalCard";
import { parseToolPayload, type PlanModeApprovalPayload } from "../../utils/planModeDisplay";

type TimelineToolItem = {
  toolName?: string;
  response?: string;
};

type PlanProgressItem = {
  step: string;
  status: "pending" | "in_progress" | "completed";
};

const parsePlanProgressFromToolResponse = (
  response?: string
): { explanation?: string; plan: PlanProgressItem[] } | null => {
  const payload = parseToolPayload(response);
  if (!payload) return null;
  const raw = payload as Record<string, unknown>;
  const plan = Array.isArray(raw.plan)
    ? raw.plan
        .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
        .map((item) => ({
          step: typeof item.step === "string" ? item.step.trim() : "",
          status:
            item.status === "completed"
              ? ("completed" as const)
              : item.status === "in_progress"
              ? ("in_progress" as const)
              : ("pending" as const),
        }))
        .filter((item) => item.step.length > 0)
    : [];
  if (plan.length === 0) return null;
  return {
    plan,
    ...(typeof raw.explanation === "string" && raw.explanation.trim()
      ? { explanation: raw.explanation.trim() }
      : {}),
  };
};

const parseApprovalFromToolResponse = (response?: string): PlanModeApprovalPayload | null => {
  const payload = parseToolPayload(response);
  if (!payload || !payload.approval || typeof payload.approval !== "object") return null;
  const approval = payload.approval as Record<string, unknown>;
  const action = approval.action === "exit" ? "exit" : approval.action === "enter" ? "enter" : null;
  if (!action) return null;
  const options = Array.isArray(approval.options)
    ? approval.options
        .filter((option): option is Record<string, unknown> => Boolean(option && typeof option === "object"))
        .map((option) => ({
          label: typeof option.label === "string" ? option.label : "",
          value: option.value === "reject" ? ("reject" as const) : ("approve" as const),
        }))
        .filter((option) => option.label.trim().length > 0)
    : undefined;
  return {
    action,
    ...(typeof approval.title === "string" ? { title: approval.title } : {}),
    ...(typeof approval.description === "string" ? { description: approval.description } : {}),
    ...(typeof approval.rationale === "string" ? { rationale: approval.rationale } : {}),
    ...(options && options.length > 0 ? { options } : {}),
  };
};

const PlanModeTimelineCard = ({
  messageId,
  toolItem,
  isStreaming,
  planModeApproval,
  planModeApprovalDecision,
  planPreview,
  planProgress,
  planModeApprovalSubmitting,
  onPlanModeApprovalSelect,
}: {
  messageId: string;
  toolItem: TimelineToolItem;
  isStreaming?: boolean;
  planModeApproval?: PlanModeApprovalPayload | null;
  planModeApprovalDecision: "approve" | "reject" | "";
  planPreview?: string;
  planProgress?: { explanation?: string; plan: PlanProgressItem[] } | null;
  planModeApprovalSubmitting?: boolean;
  onPlanModeApprovalSelect?: (input: {
    messageId: string;
    action: "enter" | "exit";
    decision: "approve" | "reject";
  }) => void;
}) => {
  const normalizedToolName = (toolItem.toolName || "").trim().toLowerCase();
  const isRunning = Boolean(isStreaming && !toolItem.response);
  const runtimeApproval = parseApprovalFromToolResponse(toolItem.response);
  const runtimePlanProgress = parsePlanProgressFromToolResponse(toolItem.response);

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
            请在下方计划确认卡片中完成选择。
          </Text>
        </Box>
      </Flex>
    );
  }

  if (normalizedToolName === "update_plan") {
    const progress = runtimePlanProgress || planProgress;
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
    const approval = runtimeApproval || planModeApproval;
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
        <Box flex="1" minW={0}>
          <PlanModeToolApprovalCard
            decision={planModeApprovalDecision}
            description={approval.description || "模型请求计划模式切换，请确认是否批准。"}
            onSelect={(decision) =>
              onPlanModeApprovalSelect?.({
                messageId,
                action: approval.action,
                decision,
              })
            }
            options={
              Array.isArray(approval.options) && approval.options.length > 0
                ? approval.options
                : [
                    { label: "批准", value: "approve" as const },
                    { label: "拒绝", value: "reject" as const },
                  ]
            }
            preview={planPreview}
            rationale={approval.rationale}
            submitting={planModeApprovalSubmitting}
            title={approval.title || "计划模式审批"}
          />
        </Box>
      </Flex>
    );
  }

  return null;
};

export default PlanModeTimelineCard;


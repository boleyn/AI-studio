import { Box, Button, Flex, Text } from "@chakra-ui/react";
import { parseChecklistItems, type PlanApprovalOption, type PlanApprovalDecision } from "../../utils/planModeDisplay";

type ChecklistItem = {
  text: string;
  status?: "pending" | "in_progress" | "completed";
};

const PlanModeToolApprovalCard = ({
  title,
  description,
  rationale,
  preview,
  checklist,
  options,
  decision,
  submitting,
  onSelect,
  compact = false,
}: {
  title: string;
  description: string;
  rationale?: string;
  preview?: string;
  checklist?: ChecklistItem[];
  options?: PlanApprovalOption[];
  decision?: PlanApprovalDecision;
  submitting?: boolean;
  onSelect?: (decision: "approve" | "reject") => void;
  compact?: boolean;
}) => {
  const parsedChecklist = parseChecklistItems(preview || rationale).map((text) => ({
    text,
    status: "pending" as const,
  }));
  const finalChecklist = checklist && checklist.length > 0 ? checklist : parsedChecklist;
  const hasActiveStatus = finalChecklist.some(
    (item) => item.status === "in_progress" || item.status === "completed"
  );
  const statusPalette: Record<
    NonNullable<ChecklistItem["status"]>,
    { dot: string; text: string; label: string; dotBorder?: string }
  > = {
    pending: { dot: "#C4CAD4", dotBorder: "#AAB4C2", text: "myGray.700", label: "待处理" },
    in_progress: { dot: "primary.500", text: "primary.700", label: "进行中" },
    completed: { dot: "green.500", text: "green.700", label: "已完成" },
  };

  return (
    <Box
      bg={compact ? "transparent" : "myWhite.100"}
      border={compact ? "0" : "1px solid"}
      borderColor={compact ? "transparent" : "primary.200"}
      borderRadius={compact ? "0" : "12px"}
      p={compact ? 0 : 3}
      shadow={compact ? "none" : "xs"}
    >
      <Text color="myGray.900" fontSize="12px" fontWeight={700} letterSpacing="0.01em">
        {title}
      </Text>
      <Text color="myGray.700" fontSize="12px" mt={1} noOfLines={compact ? 2 : undefined}>
        {description}
      </Text>
      {rationale ? (
        <Text color="myGray.600" fontSize="11px" mt={1.5} noOfLines={compact ? 2 : undefined}>
          说明: {rationale}
        </Text>
      ) : null}
      {finalChecklist.length > 0 ? (
        <Box
          bg={compact ? "myGray.25" : "myGray.50"}
          border="1px solid"
          borderColor={compact ? "myGray.150" : "myGray.200"}
          borderRadius="8px"
          mt={2}
          p={compact ? 2 : 2.5}
        >
          <Text color="myGray.600" fontSize="11px" fontWeight={700} mb={1.5}>
            计划进度
          </Text>
          <Flex direction="column" gap={1.5}>
            {(compact ? finalChecklist.slice(0, 3) : finalChecklist).map((item, index) => {
              const status = statusPalette[item.status || "pending"];
              return (
              <Flex key={`plan-check-${index}`} align="center" gap={2} justify="space-between">
                <Flex align="center" gap={2} minW={0}>
                  <Box
                    bg={status.dot}
                    border="1px solid"
                    borderColor={status.dotBorder || "transparent"}
                    borderRadius="full"
                    h="8px"
                    minW="8px"
                  />
                  <Text color={status.text} fontSize="12px" noOfLines={2}>
                    {item.text}
                  </Text>
                </Flex>
                {hasActiveStatus && !compact ? (
                  <Text
                    bg="white"
                    border="1px solid"
                    borderColor="myGray.250"
                    borderRadius="999px"
                    color="myGray.600"
                    flexShrink={0}
                    fontSize="10px"
                    px={2}
                    py="1px"
                  >
                    {status.label}
                  </Text>
                ) : null}
              </Flex>
            )})}
          </Flex>
          {compact && finalChecklist.length > 3 ? (
            <Text color="myGray.500" fontSize="10px" mt={1.5}>
              还有 {finalChecklist.length - 3} 个步骤
            </Text>
          ) : null}
        </Box>
      ) : null}
      {Array.isArray(options) && options.length > 0 ? (
      <Flex gap={2} mt={2.5}>
        {options.map((option, idx) => {
          const isSelected = decision === option.value;
          const isReject = option.value === "reject";
          return (
          <Button
            key={`plan-mode-tool-approval-${option.value}-${idx}`}
            bg={isSelected ? (isReject ? "myGray.100" : "primary.100") : "white"}
            border="1px solid"
            borderColor={
              isSelected ? (isReject ? "myGray.350" : "primary.300") : "myGray.250"
            }
            color={isSelected ? (isReject ? "myGray.700" : "primary.700") : "myGray.700"}
            h="30px"
            isDisabled={Boolean(submitting || decision)}
            onClick={() => onSelect?.(option.value)}
            px={3}
            size="sm"
            variant="ghost"
            _hover={{
              bg: isSelected ? undefined : "myGray.50",
            }}
          >
            {option.label}
          </Button>
        )})}
      </Flex>
      ) : null}
      {decision && Array.isArray(options) && options.length > 0 ? (
        <Text color="myGray.500" fontSize="11px" mt={1.5}>
          已选择: {decision === "approve" ? "批准" : "拒绝"}
        </Text>
      ) : null}
    </Box>
  );
};

export default PlanModeToolApprovalCard;

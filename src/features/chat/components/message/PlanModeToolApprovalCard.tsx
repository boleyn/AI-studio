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
      bg="myWhite.100"
      border="1px solid"
      borderColor="primary.200"
      borderRadius="12px"
      p={3}
      shadow="xs"
    >
      <Text color="myGray.900" fontSize="12px" fontWeight={700}>
        {title}
      </Text>
      <Text color="myGray.700" fontSize="12px" mt={1}>
        {description}
      </Text>
      {rationale ? (
        <Text color="myGray.600" fontSize="11px" mt={1.5}>
          说明: {rationale}
        </Text>
      ) : null}
      {finalChecklist.length > 0 ? (
        <Box bg="myGray.50" border="1px solid" borderColor="myGray.200" borderRadius="10px" mt={2.5} p={2.5}>
          <Text color="myGray.600" fontSize="11px" fontWeight={700} mb={1.5}>
            计划清单
          </Text>
          <Flex direction="column" gap={2}>
            {finalChecklist.map((item, index) => {
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
                {hasActiveStatus ? (
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
      {decision ? (
        <Text color="myGray.500" fontSize="11px" mt={1.5}>
          已选择: {decision === "approve" ? "批准" : "拒绝"}
        </Text>
      ) : null}
    </Box>
  );
};

export default PlanModeToolApprovalCard;

import { Box, Flex, Text } from "@chakra-ui/react";
import MyTooltip from "@/components/ui/MyTooltip";
import { PLAN_STATUS_META, type PlanStepStatus } from "./planDockStatus";

type PlanStepRowProps = {
  text: string;
  status: PlanStepStatus;
};

const PlanStepRow = ({ text, status }: PlanStepRowProps) => {
  const meta = PLAN_STATUS_META[status];
  const normalizedText = text
    .replace(/\s*[（(]\s*(已完成|进行中|待处理)\s*[）)]\s*$/u, "")
    .trim();
  const textColorByStatus: Record<PlanStepStatus, string> = {
    pending: "myGray.700",
    in_progress: "blue.800",
    completed: "green.800",
  };

  return (
    <Flex align="center" gap={2} minH="24px">
      <MyTooltip label={meta.label}>
        <Box
          bg={meta.dotBg}
          border="1px solid"
          borderColor={meta.dotBorder}
          borderRadius="full"
          flexShrink={0}
          h="8px"
          w="8px"
        />
      </MyTooltip>
      <Text color={textColorByStatus[status]} fontSize="12px" noOfLines={1}>
        {normalizedText || text}
      </Text>
    </Flex>
  );
};

export default PlanStepRow;

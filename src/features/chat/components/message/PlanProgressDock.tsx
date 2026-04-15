import { Box, Button, Collapse, Flex, Progress, Text } from "@chakra-ui/react";
import { useMemo, useState } from "react";
import type { PlanResumeState } from "../../utils/planResume";
import PlanDockToggle from "./planDock/PlanDockToggle";
import PlanStepList from "./planDock/PlanStepList";

type PlanProgressDockProps = {
  state: PlanResumeState;
  isSending?: boolean;
  onContinueExecute?: () => void;
  onContinueAdjust?: () => void;
};

const PlanProgressDock = ({
  state,
  isSending,
  onContinueExecute,
  onContinueAdjust,
}: PlanProgressDockProps) => {
  const [expanded, setExpanded] = useState(false);
  const percent = useMemo(() => {
    if (state.totalSteps <= 0) return 0;
    return Math.max(0, Math.min(100, Math.round((state.completedSteps / state.totalSteps) * 100)));
  }, [state.completedSteps, state.totalSteps]);
  if (!state.visible) return null;

  return (
    <Box
      bg="myWhite.100"
      border="1px solid"
      borderColor="myGray.250"
      borderRadius="14px"
      mb={3}
      px={3}
      py={2.5}
      sx={{
        animation: "planDockIn 220ms cubic-bezier(.2,.8,.2,1)",
        "@keyframes planDockIn": {
          "0%": { opacity: 0, transform: "translateY(4px)" },
          "100%": { opacity: 1, transform: "translateY(0)" },
        },
      }}
    >
      <Flex align="center" justify="space-between" mb={1.5}>
        <Text color="myGray.900" fontSize="13px" fontWeight={700}>
          计划进度
        </Text>
        <PlanDockToggle expanded={expanded} onToggle={() => setExpanded((prev) => !prev)} />
      </Flex>

      <Progress borderRadius="999px" colorScheme="blue" h="6px" value={percent} />
      <Text color="myGray.600" fontSize="12px" mt={1.5}>
        已完成 {state.completedSteps}/{state.totalSteps}，进行中 {state.inProgressSteps}，待处理 {state.pendingSteps}
      </Text>

      <Collapse animateOpacity in={expanded}>
        {state.explanation ? (
          <Text color="myGray.700" fontSize="12px" mt={2} noOfLines={3}>
            {state.explanation}
          </Text>
        ) : null}
        <PlanStepList steps={state.steps} />
      </Collapse>

      <Flex gap={2} justify="flex-end" mt={2.5}>
        <Button
          colorScheme="green"
          h="30px"
          isDisabled={Boolean(isSending)}
          onClick={onContinueExecute}
          size="sm"
        >
          继续执行
        </Button>
        <Button
          h="30px"
          isDisabled={Boolean(isSending)}
          onClick={onContinueAdjust}
          size="sm"
          variant="outline"
        >
          继续调整
        </Button>
      </Flex>
    </Box>
  );
};

export default PlanProgressDock;

import { Box, Button, Flex, Progress, Text } from "@chakra-ui/react";
import type { PlanResumeState } from "../../utils/planResume";

type PlanResumeBannerProps = {
  state: PlanResumeState;
  disabled?: boolean;
  onContinueExecute?: () => void;
  onContinueAdjust?: () => void;
};

const PlanResumeBanner = ({
  state,
  disabled,
  onContinueExecute,
  onContinueAdjust,
}: PlanResumeBannerProps) => {
  if (!state.visible) return null;

  const progressPercent =
    state.totalSteps > 0 ? Math.max(0, Math.min(100, Math.round((state.completedSteps / state.totalSteps) * 100))) : 0;

  const summary =
    state.totalSteps > 0
      ? `已完成 ${state.completedSteps}/${state.totalSteps}，进行中 ${state.inProgressSteps}，待处理 ${state.pendingSteps}`
      : "存在未完成的计划交互";

  return (
    <Box
      bg="myWhite.100"
      border="1px solid"
      borderColor="primary.200"
      borderRadius="12px"
      mb={3}
      p={3}
    >
      <Text color="myGray.900" fontSize="12px" fontWeight={700}>
        检测到未完成计划，可继续
      </Text>
      {state.explanation ? (
        <Text color="myGray.700" fontSize="12px" mt={1} noOfLines={2}>
          {state.explanation}
        </Text>
      ) : null}

      {state.totalSteps > 0 ? (
        <Box mt={2}>
          <Progress borderRadius="999px" colorScheme="blue" h="6px" value={progressPercent} />
          <Text color="myGray.600" fontSize="11px" mt={1}>
            {summary}
          </Text>
        </Box>
      ) : null}

      {state.pendingQuestion ? (
        <Box bg="myGray.50" border="1px solid" borderColor="myGray.250" borderRadius="10px" mt={2} p={2}>
          <Text color="myGray.700" fontSize="11px" fontWeight={600}>
            待确认: {state.pendingQuestion.question}
          </Text>
        </Box>
      ) : null}

      <Flex gap={2} mt={2.5}>
        <Button
          bg="primary.500"
          color="white"
          h="30px"
          isDisabled={Boolean(disabled)}
          onClick={onContinueExecute}
          size="sm"
          _hover={{ bg: "primary.600" }}
        >
          继续执行
        </Button>
        <Button
          bg="white"
          border="1px solid"
          borderColor="myGray.250"
          color="myGray.700"
          h="30px"
          isDisabled={Boolean(disabled)}
          onClick={onContinueAdjust}
          size="sm"
          _hover={{ bg: "myGray.50" }}
        >
          继续调整计划
        </Button>
      </Flex>
    </Box>
  );
};

export default PlanResumeBanner;

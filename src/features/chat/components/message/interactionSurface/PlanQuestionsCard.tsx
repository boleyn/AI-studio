import { Box, Button, Flex, Text } from "@chakra-ui/react";
import { useEffect, useMemo, useState } from "react";
import type { InteractionContext, PendingInteraction } from "./types";

type PlanQuestionsInteraction = Extract<PendingInteraction, { type: "plan_questions" }>;

const hasMissingAnswer = (
  pending: PlanQuestionsInteraction,
  selections: Record<string, string>
) =>
  pending.questions.some((question) => {
    return typeof selections[question.id] !== "string" || !String(selections[question.id]).trim();
  });

const buildAnswers = (
  pending: PlanQuestionsInteraction,
  selections: Record<string, string>
) =>
  pending.questions.reduce<Record<string, string>>((acc, question) => {
    const selected = typeof selections[question.id] === "string" ? String(selections[question.id]).trim() : "";
    if (selected) acc[question.id] = selected;
    return acc;
  }, {});

const PlanQuestionsCard = ({
  pending,
  interaction,
}: {
  pending: PlanQuestionsInteraction;
  interaction: InteractionContext;
}) => {
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [currentStep, setCurrentStep] = useState(0);

  useEffect(() => {
    setSelections({});
    setCurrentStep(0);
  }, [pending.requestId]);

  const missingAnswer = useMemo(() => hasMissingAnswer(pending, selections), [pending, selections]);
  const totalSteps = pending.questions.length;
  const safeStep = Math.min(Math.max(currentStep, 0), Math.max(totalSteps - 1, 0));
  const currentQuestion = pending.questions[safeStep];
  const currentAnswer = currentQuestion ? (selections[currentQuestion.id] || "").trim() : "";
  const isLastStep = safeStep >= totalSteps - 1;
  const canGoPrev = safeStep > 0;
  const canGoNext = !isLastStep && Boolean(currentAnswer);

  return (
    <>
      {currentQuestion ? (
        <Flex direction="column" gap={2} mt={1.5}>
          <Flex align="center" gap={2}>
            <Text color="myGray.500" fontSize="11px" fontWeight={600}>
              {safeStep + 1}/{totalSteps}
            </Text>
            <Flex flex={1} gap={1}>
              {pending.questions.map((question, idx) => {
                const answered = Boolean((selections[question.id] || "").trim());
                const active = idx === safeStep;
                return (
                  <Box
                    key={`${pending.requestId}-${question.id}-dot-${idx}`}
                    bg={active ? "blue.400" : answered ? "blue.200" : "myGray.200"}
                    borderRadius="999px"
                    h="4px"
                    transition="all 0.2s ease"
                    w={active ? "20px" : "10px"}
                  />
                );
              })}
            </Flex>
          </Flex>
          <Box
            key={`${pending.requestId}-${currentQuestion.id}-${safeStep}`}
            bg="myWhite.100"
            border="1px solid"
            borderColor="myGray.200"
            borderRadius="8px"
            p={2.5}
          >
            <Text color="myGray.500" fontSize="11px" fontWeight={600} mb={1}>
              {(currentQuestion.header || "确认").toUpperCase()}
            </Text>
            <Text color="myGray.800" fontSize="12px" fontWeight={700}>
              {currentQuestion.question}
            </Text>
            <Flex direction="column" gap={1.5} mt={2.5}>
              {currentQuestion.options.map((option, oIndex) => {
                const isSelected = selections[currentQuestion.id] === option.label;
                return (
                  <Button
                    key={`${currentQuestion.id}-option-${oIndex}`}
                    alignItems="flex-start"
                    bg={isSelected ? "blue.600" : "myWhite.100"}
                    border="1px solid"
                    borderColor={isSelected ? "blue.600" : "myGray.250"}
                    color={isSelected ? "white" : "myGray.800"}
                    h="auto"
                    justifyContent="flex-start"
                    onClick={() =>
                      setSelections((current) => ({
                        ...current,
                        [currentQuestion.id]: option.label,
                      }))
                    }
                    px={2.5}
                    py={2}
                    size="sm"
                    variant="unstyled"
                    w="full"
                    _hover={{
                      bg: isSelected ? "blue.700" : "myGray.50",
                      borderColor: isSelected ? "blue.700" : "myGray.350",
                    }}
                  >
                    <Flex align="center" justify="space-between" w="full">
                      <Text fontSize="12px" fontWeight={isSelected ? 700 : 600}>
                        {option.label}
                      </Text>
                      <Text color={isSelected ? "whiteAlpha.900" : "myGray.400"} fontSize="14px">
                        {isSelected ? "❯" : ""}
                      </Text>
                    </Flex>
                  </Button>
                );
              })}
            </Flex>
            <Text color="myGray.500" fontSize="11px" mt={2}>
              请选择一个选项后继续，最后一步提交后才会继续执行。
            </Text>
          </Box>
        </Flex>
      ) : null}
      <Flex justify="flex-end" mt={2.5}>
        <Button
          h="30px"
          isDisabled={Boolean(interaction.planQuestionSubmitting || !canGoPrev)}
          mr={2}
          onClick={() => setCurrentStep((step) => Math.max(step - 1, 0))}
          size="sm"
          variant="outline"
        >
          上一步
        </Button>
        {!isLastStep ? (
          <Button
            colorScheme="primary"
            h="30px"
            isDisabled={Boolean(interaction.planQuestionSubmitting || !canGoNext)}
            onClick={() => setCurrentStep((step) => Math.min(step + 1, totalSteps - 1))}
            size="sm"
          >
            下一步
          </Button>
        ) : null}
        <Button
          colorScheme="primary"
          h="30px"
          isDisabled={Boolean(
            interaction.planQuestionSubmitting ||
              !interaction.onPlanQuestionsSubmit ||
              missingAnswer ||
              !isLastStep
          )}
          isLoading={Boolean(interaction.planQuestionSubmitting)}
          onClick={() => {
            interaction.onPlanQuestionsSubmit?.({
              requestId: pending.requestId,
              answers: buildAnswers(pending, selections),
            });
          }}
          ml={2}
          size="sm"
        >
          提交选择
        </Button>
      </Flex>
    </>
  );
};

export default PlanQuestionsCard;

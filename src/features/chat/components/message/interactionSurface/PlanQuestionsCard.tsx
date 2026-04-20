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
        <Flex direction="column" gap={2} mt={2}>
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
            bg="white"
            border="1px solid"
            borderColor="myGray.200"
            borderRadius="8px"
            p={2}
          >
            <Text color="myGray.800" fontSize="12px" fontWeight={600}>
              {currentQuestion.header || "确认"}: {currentQuestion.question}
            </Text>
            <Flex gap={2} mt={2} wrap="wrap">
              {currentQuestion.options.map((option, oIndex) => {
                const isSelected = selections[currentQuestion.id] === option.label;
                return (
                  <Button
                    key={`${currentQuestion.id}-option-${oIndex}`}
                    colorScheme={isSelected ? "primary" : undefined}
                    h="28px"
                    onClick={() =>
                      setSelections((current) => ({
                        ...current,
                        [currentQuestion.id]: option.label,
                      }))
                    }
                    size="sm"
                    variant={isSelected ? "solid" : "outline"}
                  >
                    {option.label}
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
      <Flex justify="flex-end" mt={3}>
        <Button
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
            isDisabled={Boolean(interaction.planQuestionSubmitting || !canGoNext)}
            onClick={() => setCurrentStep((step) => Math.min(step + 1, totalSteps - 1))}
            size="sm"
          >
            下一步
          </Button>
        ) : null}
        <Button
          colorScheme="primary"
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

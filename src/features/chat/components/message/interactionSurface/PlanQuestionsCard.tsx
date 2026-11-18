import { Input, Box, Button, Flex, Text } from "@chakra-ui/react";
import { useEffect, useMemo, useState } from "react";
import type { InteractionContext, PendingInteraction } from "./types";

type PlanQuestionsInteraction = Extract<
  PendingInteraction,
  { type: "plan_questions" }
>;

const hasMissingAnswer = (
  pending: PlanQuestionsInteraction,
  selections: Record<string, string>,
) =>
  pending.questions.some((question) => {
    return (
      typeof selections[question.id] !== "string" ||
      !String(selections[question.id]).trim()
    );
  });

const buildAnswers = (
  pending: PlanQuestionsInteraction,
  selections: Record<string, string>,
) =>
  pending.questions.reduce<Record<string, string>>((acc, question) => {
    const selected =
      typeof selections[question.id] === "string"
        ? String(selections[question.id]).trim()
        : "";
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

  const missingAnswer = useMemo(
    () => hasMissingAnswer(pending, selections),
    [pending, selections],
  );
  const totalSteps = pending.questions.length;
  const safeStep = Math.min(
    Math.max(currentStep, 0),
    Math.max(totalSteps - 1, 0),
  );
  const currentQuestion = pending.questions[safeStep];
  const currentAnswer = currentQuestion
    ? (selections[currentQuestion.id] || "").trim()
    : "";
  const isLastStep = safeStep >= totalSteps - 1;
  const canGoPrev = safeStep > 0;
  const canGoNext = !isLastStep && Boolean(currentAnswer);

  return (
    <>
      {currentQuestion ? (
        <Flex direction="column" gap={2} mt={1.5}>
          <Flex align="baseline" justify="space-between" gap={2} color="#666">
            <Text fontSize="13px">{currentQuestion.header}</Text>
            {totalSteps > 1 && (
              <Text fontSize="12px">
                {safeStep + 1} / {totalSteps}
              </Text>
            )}
          </Flex>
          <Box>
            <Text
              color="#242424"
              fontSize="14px"
              lineHeight="1.55"
              fontWeight={500}
            >
              {currentQuestion.question}
            </Text>
            <Flex direction="column" gap={0.5} mt={2}>
              {currentQuestion.options.map((option, oIndex) => {
                const isSelected =
                  selections[currentQuestion.id] === option.label;
                return (
                  <Button
                    key={`${currentQuestion.id}-option-${oIndex}`}
                    aria-pressed={isSelected}
                    alignItems="flex-start"
                    bg={isSelected ? "#f1f1f1" : "transparent"}
                    whiteSpace="normal"
                    borderRadius="8px"
                    color="#242424"
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
                      bg: isSelected ? "#ececec" : "#f7f7f7",
                      borderColor: isSelected ? "primary.700" : "myGray.350",
                    }}
                  >
                    <Flex align="center" justify="space-between" w="full">
                      <Box textAlign="left">
                        <Text fontSize="14px" fontWeight={500}>
                          {option.label}
                        </Text>
                        {option.description && (
                          <Text
                            fontSize="12px"
                            color="#626262"
                            fontWeight={400}
                          >
                            {option.description}
                          </Text>
                        )}
                      </Box>
                      <Text color="#333" fontSize="14px">
                        {isSelected ? "✓" : ""}
                      </Text>
                    </Flex>
                  </Button>
                );
              })}
            </Flex>
            <Input
              mt={2}
              size="sm"
              aria-label="自定义回答"
              placeholder="或输入自己的回答"
              value={
                currentQuestion.options.some(
                  (option) => option.label === selections[currentQuestion.id],
                )
                  ? ""
                  : selections[currentQuestion.id] || ""
              }
              onChange={(event) =>
                setSelections({
                  ...selections,
                  [currentQuestion.id]: event.target.value,
                })
              }
            />
          </Box>
        </Flex>
      ) : null}
      <Flex justify="flex-end" mt={2.5}>
        {canGoPrev && (
          <Button
            h="30px"
            isDisabled={Boolean(
              interaction.planQuestionSubmitting || !canGoPrev,
            )}
            mr={2}
            onClick={() => setCurrentStep((step) => Math.max(step - 1, 0))}
            size="sm"
            variant="outline"
          >
            上一步
          </Button>
        )}
        {!isLastStep ? (
          <Button
            bg="#262626"
            color="white"
            borderRadius="full"
            _hover={{ bg: "#414141" }}
            h="30px"
            isDisabled={Boolean(
              interaction.planQuestionSubmitting || !canGoNext,
            )}
            onClick={() =>
              setCurrentStep((step) => Math.min(step + 1, totalSteps - 1))
            }
            size="sm"
          >
            下一步
          </Button>
        ) : null}
        {isLastStep && (
          <Button
            bg="#262626"
            color="white"
            borderRadius="full"
            _hover={{ bg: "#414141" }}
            h="30px"
            isDisabled={Boolean(
              interaction.planQuestionSubmitting ||
              !interaction.onPlanQuestionsSubmit ||
              missingAnswer ||
              !isLastStep,
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
        )}
      </Flex>
    </>
  );
};

export default PlanQuestionsCard;

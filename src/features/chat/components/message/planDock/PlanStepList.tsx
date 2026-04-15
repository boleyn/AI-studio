import { Box, Flex } from "@chakra-ui/react";
import type { PlanResumeState } from "../../../utils/planResume";
import PlanStepRow from "./PlanStepRow";

type PlanStepListProps = {
  steps: PlanResumeState["steps"];
};

const MAX_VISIBLE_ROWS = 6;
const ROW_HEIGHT = 24;
const ROW_GAP = 8;

const PlanStepList = ({ steps }: PlanStepListProps) => {
  if (steps.length === 0) return null;

  const maxHeight = MAX_VISIBLE_ROWS * ROW_HEIGHT + (MAX_VISIBLE_ROWS - 1) * ROW_GAP;

  return (
    <Box
      border="1px solid"
      borderColor="myGray.200"
      borderRadius="10px"
      mt={2}
      p={2}
    >
      <Flex
        direction="column"
        gap={2}
        maxH={steps.length > MAX_VISIBLE_ROWS ? `${maxHeight}px` : undefined}
        overflowY={steps.length > MAX_VISIBLE_ROWS ? "auto" : "visible"}
        pr={steps.length > MAX_VISIBLE_ROWS ? 1 : 0}
        sx={{
          "&::-webkit-scrollbar": {
            width: "6px",
          },
          "&::-webkit-scrollbar-thumb": {
            background: "#CBD5E1",
            borderRadius: "999px",
          },
          "&::-webkit-scrollbar-track": {
            background: "transparent",
          },
        }}
      >
        {steps.map((item, index) => (
          <PlanStepRow key={`plan-step-row-${index}`} status={item.status} text={item.step} />
        ))}
      </Flex>
    </Box>
  );
};

export default PlanStepList;

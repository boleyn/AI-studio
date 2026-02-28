import React from "react";
import { Box } from "@chakra-ui/react";

const QuestionTip = ({ label, ...props }: any) => {
  return (
    <Box fontSize="xs" color="gray.500" {...props}>
      {label}
    </Box>
  );
};

export default QuestionTip;

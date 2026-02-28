import React from "react";
import { Box } from "@chakra-ui/react";

const FormLabel = ({ children, ...props }: any) => {
  return (
    <Box as="span" fontSize="sm" fontWeight="500" {...props}>
      {children}
    </Box>
  );
};

export default FormLabel;

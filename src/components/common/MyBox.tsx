import React from "react";
import { Box, Spinner, Flex } from "@chakra-ui/react";

const MyBox = ({ isLoading, children, ...props }: any) => {
  return (
    <Box position="relative" {...props}>
      {children}
      {isLoading ? (
        <Flex
          position="absolute"
          inset={0}
          align="center"
          justify="center"
          bg="rgba(255,255,255,0.6)"
        >
          <Spinner size="sm" />
        </Flex>
      ) : null}
    </Box>
  );
};

export default MyBox;

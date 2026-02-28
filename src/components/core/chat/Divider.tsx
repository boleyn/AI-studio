import React from "react";
import { Divider, Flex, Box } from "@chakra-ui/react";

const ChatBoxDivider = ({ icon, text }: { icon?: string; text?: string }) => {
  return (
    <Flex align="center" gap={2} my={2}>
      <Divider />
      <Box fontSize="xs" color="gray.500">
        {text || icon || ""}
      </Box>
      <Divider />
    </Flex>
  );
};

export default ChatBoxDivider;

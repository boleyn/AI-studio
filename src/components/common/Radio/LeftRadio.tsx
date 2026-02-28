import React from "react";
import { Box, Flex } from "@chakra-ui/react";

type Option<T> = { title: React.ReactNode; value: T };

const LeftRadio = <T,>({ list, value, onChange, ...props }: { list: Option<T>[]; value?: T; onChange?: (v: T) => void; [key: string]: any; }) => {
  return (
    <Flex direction="column" gap={2} {...props}>
      {list.map((item, idx) => (
        <Box
          key={idx}
          border="1px solid"
          borderColor={item.value === value ? "blue.300" : "gray.200"}
          borderRadius="md"
          px={3}
          py={2}
          cursor="pointer"
          onClick={() => onChange?.(item.value)}
        >
          {item.title}
        </Box>
      ))}
    </Flex>
  );
};

export default LeftRadio;

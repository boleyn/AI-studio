import { Box, Flex, Text } from "@chakra-ui/react";
import type { ReactNode } from "react";

const InteractionShell = ({
  title,
  tone = "blue",
  children,
}: {
  title: string;
  tone?: "blue" | "amber" | "purple";
  children: ReactNode;
}) => {
  const toneMap: Record<NonNullable<typeof tone>, { bg: string; border: string; text: string; dot: string }> = {
    blue: { bg: "blue.50", border: "blue.200", text: "blue.800", dot: "blue.500" },
    amber: { bg: "yellow.50", border: "yellow.200", text: "yellow.800", dot: "yellow.500" },
    purple: { bg: "primary.50", border: "primary.200", text: "primary.800", dot: "primary.500" },
  };
  const style = toneMap[tone];

  return (
    <Box bg="myGray.50" borderTop="1px solid" borderColor="myGray.200" px={4} py={2}>
      <Box
        bg={style.bg}
        border="1px solid"
        borderColor={style.border}
        borderRadius="14px"
        boxShadow="0 10px 28px -20px rgba(17, 24, 36, 0.35)"
        p={3}
      >
        <Flex align="center" gap={2} mb={1.5}>
          <Box bg={style.dot} borderRadius="full" h="7px" w="7px" />
          <Text color={style.text} fontSize="13px" fontWeight={800}>
            {title}
          </Text>
        </Flex>
        {children}
      </Box>
    </Box>
  );
};

export default InteractionShell;

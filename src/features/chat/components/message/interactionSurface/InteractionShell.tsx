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
    amber: { bg: "orange.50", border: "orange.200", text: "orange.800", dot: "orange.500" },
    purple: { bg: "purple.50", border: "purple.200", text: "purple.800", dot: "purple.500" },
  };
  const style = toneMap[tone];

  return (
    <Box bg="myGray.50" borderTop="1px solid" borderColor="myGray.200" px={4} py={2}>
      <Box bg={style.bg} border="1px solid" borderColor={style.border} borderRadius="10px" boxShadow="sm" p={2.5}>
        <Flex align="center" gap={2} mb={1.5}>
          <Box bg={style.dot} borderRadius="full" h="7px" w="7px" />
          <Text color={style.text} fontSize="12px" fontWeight={700}>
            {title}
          </Text>
        </Flex>
        {children}
      </Box>
    </Box>
  );
};

export default InteractionShell;

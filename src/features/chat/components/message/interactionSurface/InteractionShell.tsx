import { Box, Flex, Text } from "@chakra-ui/react";
import { HelpCircle, ShieldCheck, ListChecks } from "lucide-react";
import type { ReactNode } from "react";

export default function InteractionShell({
  title,
  kind,
  children,
}: {
  title: string;
  kind: "question" | "approval" | "permission";
  children: ReactNode;
}) {
  const Icon = {
    question: HelpCircle,
    approval: ListChecks,
    permission: ShieldCheck,
  }[kind];
  return (
    <Box
      as="section"
      aria-label={title}
      bg="white"
      border="1px solid #dedede"
      borderRadius="16px"
      mb={2}
      px={{ base: 3, md: 4 }}
      py={3}
      maxH="54dvh"
      overflowY="auto"
      sx={{
        input: { borderColor: "#d6d6d6", borderRadius: "8px" },
        "button:focus-visible, input:focus-visible": {
          outline: "2px solid #525252",
          outlineOffset: "2px",
        },
      }}
    >
      <Flex align="center" gap={2} mb={2} color="#555">
        <Icon size={16} aria-hidden />
        <Text fontSize="13px" fontWeight={500}>
          {title}
        </Text>
      </Flex>
      {children}
    </Box>
  );
}

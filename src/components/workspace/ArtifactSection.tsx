import { AccordionButton, AccordionIcon, AccordionItem, AccordionPanel, Box } from "@chakra-ui/react";
import type { ReactNode } from "react";

export function ArtifactSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <AccordionItem borderTop="0" borderColor="gray.100">
      <Box as="h2">
        <AccordionButton px={2} py={2} minH={9} borderRadius="md" _hover={{ bg: "gray.50" }}>
          <Box as="span" flex={1} textAlign="left" fontSize="sm" fontWeight={600}>{label}</Box>
          <AccordionIcon color="gray.500" />
        </AccordionButton>
      </Box>
      <AccordionPanel px={0} pt={0} pb={2}>{children}</AccordionPanel>
    </AccordionItem>
  );
}

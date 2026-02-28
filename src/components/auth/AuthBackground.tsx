import { Box } from "@chakra-ui/react";

const AuthBackground = () => (
  <Box position="fixed" inset={0} zIndex={0} overflow="hidden" bg="gray.50">
    <Box
      position="absolute"
      top="-30%"
      left="-10%"
      w="60vw"
      h="60vw"
      borderRadius="9999px"
      bg="rgba(59, 130, 246, 0.25)"
      filter="blur(120px)"
    />
    <Box
      position="absolute"
      bottom="-35%"
      right="-10%"
      w="60vw"
      h="60vw"
      borderRadius="9999px"
      bg="rgba(16, 185, 129, 0.22)"
      filter="blur(140px)"
    />
    <Box
      position="absolute"
      top="10%"
      right="10%"
      w="40vw"
      h="40vw"
      borderRadius="9999px"
      bg="rgba(248, 113, 113, 0.18)"
      filter="blur(110px)"
    />
    <Box
      position="absolute"
      inset={0}
      opacity={0.35}
      bgImage="linear-gradient(rgba(148, 163, 184, 0.15) 1px, transparent 1px), linear-gradient(90deg, rgba(148, 163, 184, 0.15) 1px, transparent 1px)"
      bgSize="40px 40px"
    />
  </Box>
);

export default AuthBackground;

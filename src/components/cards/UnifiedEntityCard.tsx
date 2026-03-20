import type { ReactNode } from "react";
import { Box, Card, CardBody, Flex, Heading, Text } from "@chakra-ui/react";
import { keyframes } from "@emotion/react";

type UnifiedEntityCardProps = {
  index: number;
  title: string;
  topBadges?: ReactNode;
  description?: ReactNode;
  meta?: ReactNode;
  actions: ReactNode;
  onClick: (event: React.MouseEvent) => void;
};

const cardFadeIn = keyframes`
  from {
    opacity: 0;
    transform: translateY(10px) scale(0.985);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
`;

export default function UnifiedEntityCard({
  index,
  title,
  topBadges,
  description,
  meta,
  actions,
  onClick,
}: UnifiedEntityCardProps) {
  return (
    <Card
      role="group"
      cursor="pointer"
      position="relative"
      borderRadius="2xl"
      border="1px solid rgba(148,163,184,0.38)"
      bg="rgba(255,255,255,0.92)"
      backdropFilter="blur(14px)"
      boxShadow="none"
      overflow="hidden"
      transition="all 0.25s ease"
      animation={`${cardFadeIn} 0.35s ease-out both`}
      style={{ animationDelay: `${Math.min(index * 0.06, 0.36)}s` }}
      _hover={{
        borderColor: "rgba(126, 171, 255, 0.72)",
        bg: "rgba(255,255,255,0.98)",
        boxShadow: "0 3px 12px -10px rgba(15, 23, 42, 0.2)",
        transform: "translateY(-2px)",
      }}
      onClick={onClick}
    >
      <CardBody p={5}>
        <Flex justify="space-between" align="flex-start" gap={3}>
          <Box flex={1} minW={0}>
            {topBadges ? <Flex align="center" gap={2} mb={1.5}>{topBadges}</Flex> : null}
            <Heading size="sm" color="myGray.800" noOfLines={2} mb={1.5} fontWeight="600">
              {title}
            </Heading>
            {description ? (
              <Text color="myGray.600" fontSize="xs" noOfLines={2}>
                {description}
              </Text>
            ) : null}
            {meta ? (
              <Text color="myGray.500" fontSize="xs" mt={description ? 2 : 0}>
                {meta}
              </Text>
            ) : null}
          </Box>
          <Flex
            data-card-actions
            align="center"
            gap={1}
            opacity={0.75}
            transition="opacity 0.2s ease"
            _groupHover={{ opacity: 1 }}
            onClick={(event) => event.stopPropagation()}
          >
            {actions}
          </Flex>
        </Flex>
      </CardBody>
    </Card>
  );
}

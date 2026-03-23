import type { ReactNode } from "react";
import { Box, Card, CardBody, Divider, Flex, Heading, Text } from "@chakra-ui/react";
import { keyframes } from "@emotion/react";

type UnifiedEntityCardProps = {
  index: number;
  title: string;
  topBadges?: ReactNode;
  description?: ReactNode;
  titlePrefix?: ReactNode;
  footerLeft?: ReactNode;
  footerRight?: ReactNode;
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
  titlePrefix,
  footerLeft,
  footerRight,
  actions,
  onClick,
}: UnifiedEntityCardProps) {
  return (
    <Card
      role="group"
      cursor="pointer"
      position="relative"
      borderRadius="2xl"
      border="1px solid rgba(148,163,184,0.35)"
      bg="linear-gradient(140deg, rgba(255,255,255,0.96) 0%, rgba(255,255,255,0.94) 62%, rgba(242,251,244,0.78) 100%)"
      backdropFilter="blur(14px)"
      boxShadow="none"
      overflow="hidden"
      transition="all 0.25s ease"
      animation={`${cardFadeIn} 0.35s ease-out both`}
      style={{ animationDelay: `${Math.min(index * 0.06, 0.36)}s` }}
      _before={{
        content: '""',
        position: "absolute",
        inset: "-18% -14%",
        borderRadius: "inherit",
        background:
          "radial-gradient(58% 52% at 5% 10%, rgba(100,218,122,0.1) 0%, rgba(100,218,122,0) 72%), radial-gradient(44% 56% at 95% 90%, rgba(50,165,73,0.1) 0%, rgba(50,165,73,0) 74%)",
        pointerEvents: "none",
      }}
      _after={{
        content: '""',
        position: "absolute",
        left: 0,
        right: 0,
        top: 0,
        height: "1.5px",
        bgGradient: "linear(to-r, transparent, rgba(100,218,122,0.65), rgba(100,218,122,0.4), transparent)",
        opacity: 0.38,
        transition: "opacity 0.2s ease",
        pointerEvents: "none",
      }}
      _hover={{
        borderColor: "rgba(100,218,122,0.42)",
        bg: "linear-gradient(140deg, rgba(255,255,255,0.98) 0%, rgba(255,255,255,0.96) 58%, rgba(242,251,244,0.86) 100%)",
        boxShadow: "0 12px 26px -22px rgba(34, 197, 94, 0.45)",
        transform: "translateY(-2px)",
        _after: {
          opacity: 0.76,
        },
      }}
      onClick={onClick}
    >
      <CardBody p={5} position="relative" zIndex={1}>
        <Flex justify="space-between" align="flex-start" gap={4}>
          <Box flex={1} minW={0}>
            {topBadges ? <Flex align="center" gap={2} mb={1.5}>{topBadges}</Flex> : null}
            <Flex align="center" gap={3} mb={description ? 1.5 : 0}>
              {titlePrefix || null}
              <Heading size="sm" color="myGray.800" noOfLines={2} fontWeight="700">
                {title}
              </Heading>
            </Flex>
            {description ? (
              <Text color="myGray.600" fontSize="sm" lineHeight="1.7" noOfLines={2}>
                {description}
              </Text>
            ) : null}
          </Box>
          <Flex
            data-card-actions
            align="center"
            gap={1}
            opacity={0.88}
            transition="opacity 0.2s ease"
            _groupHover={{ opacity: 1 }}
            onClick={(event) => event.stopPropagation()}
          >
            {actions}
          </Flex>
        </Flex>
        {footerLeft || footerRight ? (
          <>
            <Divider mt={4} borderColor="myGray.200" />
            <Flex
              mt={4}
              direction="row"
              gap={6}
              align="center"
              justify="space-between"
              wrap="nowrap"
            >
              <Box flex={1} minW={0} overflowX="auto">{footerLeft}</Box>
              <Box minW="fit-content">{footerRight}</Box>
            </Flex>
          </>
        ) : null}
      </CardBody>
    </Card>
  );
}

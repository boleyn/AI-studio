import { Box, Badge, Button, Divider, Flex, Heading, HStack, Text } from "@chakra-ui/react";
import { useRouter } from "next/router";
import type { ReactNode } from "react";

import { LogoIcon } from "@components/common/Icon";
import { UserAccountMenu } from "@components/UserAccountMenu";
import VectorBackground from "@components/auth/VectorBackground";
import type { AuthUser } from "@/types/auth";

type WorkbenchShellProps = {
  active: "home" | "models" | "usage";
  title: string;
  description: string;
  user: AuthUser | null;
  loadingUser: boolean;
  actions?: ReactNode;
  children: ReactNode;
};

export function WorkbenchShell({
  active,
  title,
  description,
  user,
  loadingUser,
  actions,
  children,
}: WorkbenchShellProps) {
  const router = useRouter();
  const modelCenterActive = active === "models" || active === "usage";

  const navActiveStyles = {
    bg: "primary.50",
    border: "1px solid",
    borderColor: "primary.200",
    color: "primary.700",
    fontWeight: "semibold",
  } as const;

  const navInactiveStyles = {
    bg: "transparent",
    border: "1px solid transparent",
    color: "myGray.700",
    fontWeight: "medium",
  } as const;

  return (
    <Box position="relative" minH="100vh" overflow="hidden">
      <VectorBackground />
      <Flex
        direction="column"
        minH="100vh"
        align="stretch"
        justify="flex-start"
        px={{ base: 4, md: 8, xl: 10 }}
        py={{ base: 6, md: 8 }}
        position="relative"
        zIndex={1}
      >
        <Flex direction={{ base: "column", lg: "row" }} flex="1" minH="0" align="stretch" gap={{ base: 6, lg: 0 }}>
          <Box
            w={{ base: "100%", lg: "300px" }}
            bg="var(--ws-surface)"
            borderTopLeftRadius="2xl"
            borderTopRightRadius={{ base: "2xl", lg: 0 }}
            borderBottomRightRadius={{ base: 0, lg: 0 }}
            borderBottomLeftRadius={{ base: 0, lg: "2xl" }}
            border="1px solid var(--ws-border)"
            px={{ base: 5, md: 6 }}
            py={{ base: 6, md: 7 }}
            backdropFilter="blur(18px)"
            minH={{ base: "auto", lg: "100%" }}
            display="flex"
          >
            <Flex direction="column" h="100%" gap={6} flex="1">
              <Flex align="center" justify="space-between">
                <HStack spacing={3}>
                  <Box as={LogoIcon} w={7} h={7} flexShrink={0} />
                  <Box>
                    <Heading size="sm" color="myGray.800">
                      AI Studio
                    </Heading>
                    <Text fontSize="xs" color="myGray.500">
                      MODEL LAB
                    </Text>
                  </Box>
                </HStack>
                <Badge fontSize="0.6rem" colorScheme="green" variant="subtle" borderRadius="full" px={2}>
                  LIVE
                </Badge>
              </Flex>

              <Box>
                <Text fontSize="xs" color="myGray.500" mb={3} textTransform="uppercase" letterSpacing="wider">
                  资源导航
                </Text>
                <Flex direction="column" gap={2}>
                  <Button
                    variant="ghost"
                    justifyContent="flex-start"
                    borderRadius="md"
                    {...(active === "home" ? navActiveStyles : navInactiveStyles)}
                    _hover={{ bg: active === "home" ? "primary.50" : "myGray.100" }}
                    onClick={() => void router.push("/")}
                  >
                    工作台
                  </Button>
                  <Button
                    variant="ghost"
                    justifyContent="flex-start"
                    borderRadius="md"
                    {...(modelCenterActive ? navActiveStyles : navInactiveStyles)}
                    _hover={{ bg: modelCenterActive ? "primary.50" : "myGray.100" }}
                    onClick={() => void router.push("/models")}
                  >
                    模型中心
                  </Button>
                </Flex>
              </Box>

              <Divider borderColor="var(--ws-border)" />
              <UserAccountMenu user={user} loadingUser={loadingUser} />
            </Flex>
          </Box>

          <Box
            flex={1}
            px={{ base: 5, md: 8, lg: 10 }}
            py={{ base: 6, md: 8 }}
            bg="var(--ws-surface)"
            border="1px solid var(--ws-border)"
            borderLeft={{ base: "1px solid var(--ws-border)", lg: "none" }}
            borderTopLeftRadius={{ base: 0, lg: 0 }}
            borderTopRightRadius={{ base: 0, lg: "2xl" }}
            borderBottomRightRadius="2xl"
            borderBottomLeftRadius={{ base: "2xl", lg: 0 }}
            backdropFilter="blur(22px)"
            overflowX="hidden"
            display="flex"
            flexDirection="column"
            minH={0}
          >
            <Flex
              align={{ base: "flex-start", lg: "center" }}
              justify="space-between"
              direction={{ base: "column", lg: "row" }}
              gap={4}
              mb={6}
              flexShrink={0}
            >
              <Box>
                <Heading size="md" mb={2} color="myGray.800" lineHeight="1.2">
                  {title}
                </Heading>
                <Text color="myGray.600">{description}</Text>
              </Box>
              {actions ? <HStack spacing={3}>{actions}</HStack> : null}
            </Flex>
            <Box flex="1" minH={0} display="flex" flexDirection="column">
              {children}
            </Box>
          </Box>
        </Flex>
      </Flex>
    </Box>
  );
}

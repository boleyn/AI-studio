import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { Flex, Spinner } from "@chakra-ui/react";
import { clearAuthToken, getAuthToken, withAuthHeaders } from "@features/auth/client/authClient";

const PUBLIC_ROUTES = new Set<string>([
  "/login",
  "/auth/feishu/login",
  "/auth/feishu/callback",
  "/share/preview/[shareId]",
]);

const AuthGuard = ({ children }: { children: React.ReactNode }) => {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const isPublic = useMemo(() => PUBLIC_ROUTES.has(router.pathname), [router.pathname]);

  useEffect(() => {
    if (!router.isReady) return;
    if (isPublic) {
      setChecking(false);
      return;
    }

    const token = getAuthToken();
    if (!token) {
      router.replace(`/login?lastRoute=${encodeURIComponent(router.asPath)}`);
      return;
    }

    const verify = async () => {
      try {
        const response = await fetch("/api/auth/me", { headers: withAuthHeaders() });
        if (!response.ok) {
          clearAuthToken();
          router.replace(`/login?lastRoute=${encodeURIComponent(router.asPath)}`);
          return;
        }
      } catch {
        clearAuthToken();
        router.replace(`/login?lastRoute=${encodeURIComponent(router.asPath)}`);
        return;
      }

      setChecking(false);
    };

    verify();
  }, [router, isPublic]);

  if (checking && !isPublic) {
    return (
      <Flex minH="100vh" align="center" justify="center" bg="gray.50">
        <Spinner size="xl" color="blue.500" />
      </Flex>
    );
  }

  return <>{children}</>;
};

export default AuthGuard;

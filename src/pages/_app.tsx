import type { AppProps } from "next/app";
import { Box, ChakraProvider, Text } from "@chakra-ui/react";
import { useRouter } from "next/router";
import { theme } from "../styles/theme";
import { AuthProvider } from "../contexts/AuthContext";

// Import polyfill - it runs immediately on import
import "@shared/polyfills/crypto";
import "../styles/globals.css";
import "../styles/chat.css";
import AuthGuard from "../components/auth/AuthGuard";

const App = ({ Component, pageProps }: AppProps) => {
  const router = useRouter();
  const isWorkspaceRoute =
    router.pathname === "/project/[di]" || router.pathname === "/skills/create";

  return (
    <ChakraProvider theme={theme}>
      <AuthProvider>
        <AuthGuard>
          {isWorkspaceRoute ? (
            <Component {...pageProps} />
          ) : (
            <Box minH="100vh" position="relative">
              <Component {...pageProps} />
              <Text
                position="fixed"
                left={0}
                right={0}
                bottom={2}
                zIndex={10}
                pointerEvents="none"
                textAlign="center"
                color="myGray.500"
                opacity={0.78}
                fontSize="10px"
                lineHeight="1"
              >
                AI-STUDIO · AI EBOSS · AIID
              </Text>
            </Box>
          )}
        </AuthGuard>
      </AuthProvider>
    </ChakraProvider>
  );
};

export default App;

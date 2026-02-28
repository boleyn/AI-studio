import type { AppProps } from "next/app";
import { ChakraProvider } from "@chakra-ui/react";
import { theme } from "../styles/theme";
import { AuthProvider } from "../contexts/AuthContext";

// Import polyfill - it runs immediately on import
import "@shared/polyfills/crypto";
import "../styles/globals.css";
import "../styles/chat.css";
import AuthGuard from "../components/auth/AuthGuard";

const App = ({ Component, pageProps }: AppProps) => {
  return (
    <ChakraProvider theme={theme}>
      <AuthProvider>
        <AuthGuard>
          <Component {...pageProps} />
        </AuthGuard>
      </AuthProvider>
    </ChakraProvider>
  );
};

export default App;

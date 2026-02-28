import { Box, Flex, IconButton, Text } from "@chakra-ui/react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { codeLight } from "./codeTheme";
import { useState } from "react";

export type CodeBlockProps = {
  language?: string;
  value: string;
};

const CodeBlock = ({ language, value }: CodeBlockProps) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Box borderRadius="12px" overflow="hidden" border="1px solid" borderColor="gray.700" bg="#1e1e1e">
      <Flex align="center" justify="space-between" px={3} py={2} bg="#111827">
        <Text fontSize="xs" color="gray.200" textTransform="uppercase" letterSpacing="0.08em">
          {language || "code"}
        </Text>
        <IconButton
          aria-label="Copy code"
          size="xs"
          variant="ghost"
          colorScheme="whiteAlpha"
          onClick={handleCopy}
        >
          <Text fontSize="xs">{copied ? "已复制" : "复制"}</Text>
        </IconButton>
      </Flex>
      <Box px={3} py={3} overflowX="auto">
        <SyntaxHighlighter
          language={language}
          style={codeLight as any}
          customStyle={{ background: "transparent", margin: 0, padding: 0 }}
          wrapLongLines
        >
          {value}
        </SyntaxHighlighter>
      </Box>
    </Box>
  );
};

export default CodeBlock;

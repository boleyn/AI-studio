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
    <Box
      borderRadius="14px"
      overflow="hidden"
      border="1px solid rgba(0, 0, 0, 0.08)"
      bg="#f9f9fa"
      my={3}
    >
      <Flex
        align="center"
        justify="space-between"
        px={4}
        py={2}
        bg="#f3f4f6"
        borderBottom="1px solid rgba(0, 0, 0, 0.06)"
      >
        <Text fontSize="12px" fontWeight="500" color="#52525b" letterSpacing="0.02em">
          {language || "code"}
        </Text>
        <IconButton
          aria-label="Copy code"
          size="xs"
          variant="ghost"
          color="#52525b"
          _hover={{ bg: "rgba(0, 0, 0, 0.06)", color: "#18181b" }}
          px={2}
          borderRadius="6px"
          onClick={handleCopy}
        >
          <Text fontSize="12px">{copied ? "已复制" : "复制"}</Text>
        </IconButton>
      </Flex>
      <Box px={4} py={3} overflowX="auto">
        <SyntaxHighlighter
          language={language}
          style={codeLight as any}
          customStyle={{ background: "transparent", margin: 0, padding: 0, fontSize: "13.5px", lineHeight: "1.6" }}
          wrapLongLines
        >
          {value}
        </SyntaxHighlighter>
      </Box>
    </Box>
  );
};

export default CodeBlock;

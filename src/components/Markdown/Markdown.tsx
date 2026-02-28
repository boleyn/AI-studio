import React, { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkBreaks from "remark-breaks";
import rehypeKatex from "rehype-katex";
import rehypeExternalLinks from "rehype-external-links";
import { Box } from "@chakra-ui/react";
import CodeBlock from "./CodeBlock";
import "katex/dist/katex.min.css";

export type MarkdownProps = {
  content: string;
};

const Markdown = ({ content }: MarkdownProps) => {
  const components = useMemo(
    () => ({
      code({ inline, className, children, ...props }: any) {
        const match = /language-(\w+)/.exec(className || "");
        const language = match?.[1];
        const value = String(children ?? "").replace(/\n$/, "");
        if (inline) {
          return (
            <Box as="code" px={1} py={0.5} bg="gray.100" borderRadius="4px" fontSize="0.85em" {...props}>
              {value}
            </Box>
          );
        }
        return <CodeBlock language={language} value={value} />;
      },
      pre({ children }: any) {
        return <Box my={2}>{children}</Box>;
      },
      p({ children }: any) {
        return (
          <Box as="p" mb={2} lineHeight="1.7">
            {children}
          </Box>
        );
      },
      a({ href, children }: any) {
        return (
          <Box as="a" href={href} color="blue.600" target="_blank" rel="noreferrer">
            {children}
          </Box>
        );
      }
    }),
    []
  );

  return (
    <Box className="markdown" maxW="100%" overflow="hidden">
      <ReactMarkdown
        remarkPlugins={[remarkMath, remarkGfm, remarkBreaks]}
        rehypePlugins={[rehypeKatex, [rehypeExternalLinks, { target: "_blank" }]]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </Box>
  );
};

export default Markdown;

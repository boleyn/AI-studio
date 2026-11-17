import React, { useMemo } from "react";
import { Streamdown } from "streamdown";
import { code } from "@streamdown/code";
import { Box } from "@chakra-ui/react";
import "katex/dist/katex.min.css";

interface StreamdownMarkdownProps {
  source?: string;
  showAnimation?: boolean;
  onOpenWorkspaceFile?: (path: string) => boolean;
}

const STREAMDOWN_PLUGINS = { code };

const StreamdownMarkdown: React.FC<StreamdownMarkdownProps> = ({
  source = "",
  showAnimation = false,
  onOpenWorkspaceFile,
}) => {
  const components = useMemo(
    () => ({
      a: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => {
        const cleanHref = typeof href === "string" ? href : "";
        const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
          if (
            onOpenWorkspaceFile &&
            cleanHref &&
            !/^(https?:|mailto:|tel:|#)/i.test(cleanHref)
          ) {
            if (onOpenWorkspaceFile(cleanHref)) {
              e.preventDefault();
            }
          }
        };
        return (
          <a
            href={cleanHref}
            onClick={handleClick}
            target={/^(https?:)/i.test(cleanHref) ? "_blank" : undefined}
            rel={/^(https?:)/i.test(cleanHref) ? "noreferrer noopener" : undefined}
            className="text-blue-600 underline underline-offset-2 hover:text-blue-700"
            {...props}
          >
            {children}
          </a>
        );
      },
    }),
    [onOpenWorkspaceFile],
  );

  return (
    <Box
      w="100%"
      minW={0}
      color="#0d0d0d"
      fontSize="15px"
      lineHeight="1.75"
      sx={{
        "& > *": {
          width: "100%",
        },
        "& [data-streamdown='code-block']": {
          width: "100%",
          borderRadius: "14px",
          border: "1px solid rgba(0, 0, 0, 0.04)",
          backgroundColor: "#f4f4f5",
          overflow: "hidden",
          margin: "10px 0",
        },
        "& [data-streamdown='code-block-header']": {
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          backgroundColor: "transparent",
          borderBottom: "none",
          padding: "10px 14px 4px",
          fontSize: "13px",
          fontWeight: 500,
          color: "#3f3f46",
        },
        "& [data-streamdown='code-block-header'] > :first-child": {
          display: "inline-flex",
          alignItems: "center",
          gap: "6px",
        },
        "& [data-streamdown='code-block-header'] > :first-child::before": {
          content: '"</>"',
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          fontSize: "11.5px",
          fontWeight: 600,
          color: "#52525b",
        },
        "& [data-streamdown='code-block-body']": {
          backgroundColor: "transparent",
          border: "none",
          fontSize: "13.5px",
          lineHeight: 1.6,
          padding: "4px 14px 12px",
        },
        "& [data-streamdown='code-block-body'] pre": {
          margin: 0,
          padding: 0,
          backgroundColor: "transparent !important",
          overflowX: "auto",
          whiteSpace: "pre",
        },
        "& [data-streamdown='code-block-body'] code": {
          whiteSpace: "pre",
        },
        "& [data-streamdown='code-block-actions']": {
          border: "none",
          backgroundColor: "transparent",
          boxShadow: "none",
          padding: 0,
        },
        "& [data-streamdown='code-block-copy-button']": {
          border: "none",
          backgroundColor: "transparent",
          boxShadow: "none",
          color: "#52525b",
        },
        "& [data-streamdown='code-block-copy-button']:hover": {
          backgroundColor: "rgba(0, 0, 0, 0.06)",
          color: "#18181b",
        },
        "& p": { margin: "8px 0" },
        "& p:first-of-type": { marginTop: 0 },
        "& p:last-of-type": { marginBottom: 0 },
        "& ul, & ol": { paddingLeft: "20px", margin: "6px 0" },
        "& li": { margin: "3px 0" },
        "& code:not(pre code)": {
          backgroundColor: "#f4f4f5",
          padding: "2px 6px",
          borderRadius: "6px",
          fontSize: "0.88em",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        },
      }}
    >
      <Streamdown
        className="w-full"
        plugins={STREAMDOWN_PLUGINS}
        shikiTheme={["github-light", "github-light"]}
        isAnimating={showAnimation}
        mode={showAnimation ? "streaming" : "static"}
        lineNumbers={false}
        controls={{
          code: { copy: true, download: false },
          table: { copy: true, download: true, fullscreen: false },
          mermaid: false,
        }}
        components={components}
      >
        {source}
      </Streamdown>
    </Box>
  );
};

export default React.memo(StreamdownMarkdown);

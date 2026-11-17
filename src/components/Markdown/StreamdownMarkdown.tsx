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
      w="full"
      color="#0d0d0d"
      fontSize="15px"
      lineHeight="1.75"
      sx={{
        "& [data-streamdown='code-block']": {
          borderRadius: "12px",
          border: "none",
          backgroundColor: "#f7f7f8",
          overflow: "hidden",
          margin: "12px 0",
        },
        "& [data-streamdown='code-block-header']": {
          backgroundColor: "transparent",
          borderBottom: "none",
          padding: "8px 14px 2px",
          fontSize: "12px",
          color: "#71717a",
        },
        "& [data-streamdown='code-block-body']": {
          backgroundColor: "transparent",
          border: "none",
          fontSize: "13.5px",
          lineHeight: 1.6,
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

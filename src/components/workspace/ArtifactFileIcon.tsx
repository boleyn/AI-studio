import { Box, Flex } from "@chakra-ui/react";
import { getIcon } from "material-file-icons";

const imageExtension = /^(png|jpe?g|gif|webp|svg|bmp|avif|tiff?|heic|heif|jxl|ico)$/i;

export function isArtifactImage(name: string) {
  return name.includes(".") && imageExtension.test(name.split(".").pop() ?? "");
}

export function artifactFileType(name: string) {
  const extension = name.includes(".") ? name.split(".").pop()?.toLowerCase() : undefined;
  if (extension === "xlsx" || extension === "xls") return { label: "Excel" };
  if (extension === "csv" || extension === "tsv") return { label: extension.toUpperCase() };
  if (extension === "docx" || extension === "doc") return { label: "Word" };
  if (extension === "pptx" || extension === "ppt") return { label: "PowerPoint" };
  if (extension && isArtifactImage(name)) return { label: extension.toUpperCase() };
  if (extension === "md" || extension === "markdown") return { label: "Markdown" };
  if (extension === "pdf") return { label: "PDF" };
  return { label: extension?.toUpperCase() || "文件" };
}

export function ArtifactFileIcon({ name, compact = false }: { name: string; compact?: boolean }) {
  const icon = getIcon(name || "file");
  const iconPx = compact ? 18 : 24;
  return (
    <Flex
      as="span"
      align="center"
      justify="center"
      flexShrink={0}
      boxSize={compact ? "24px" : "34px"}
      borderRadius={compact ? "6px" : "9px"}
      bg={compact ? "transparent" : "#f4f4f5"}
      aria-hidden="true"
    >
      <Box
        as="span"
        display="inline-flex"
        w={`${iconPx}px`}
        h={`${iconPx}px`}
        sx={{ "& svg": { width: "100%", height: "100%", display: "block" } }}
        dangerouslySetInnerHTML={{ __html: icon.svg }}
      />
    </Flex>
  );
}

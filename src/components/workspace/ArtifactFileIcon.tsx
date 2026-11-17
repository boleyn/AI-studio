import { Flex } from "@chakra-ui/react";
import { File, FileArchive, FileCode2, FileImage, FileSpreadsheet, FileText, Presentation } from "lucide-react";

export function artifactFileType(name: string) {
  const extension = name.includes(".") ? name.split(".").pop()?.toLowerCase() : undefined;
  if (extension === "xlsx" || extension === "xls") return { label: "Excel", icon: FileSpreadsheet, color: "green" };
  if (extension === "csv" || extension === "tsv") return { label: extension.toUpperCase(), icon: FileSpreadsheet, color: "green" };
  if (extension === "docx" || extension === "doc") return { label: "Word", icon: FileText, color: "blue" };
  if (extension === "pptx" || extension === "ppt") return { label: "PowerPoint", icon: Presentation, color: "orange" };
  if (/^(png|jpe?g|gif|webp|svg|bmp|avif|tiff?|heic)$/.test(extension ?? "")) {
    return { label: extension!.toUpperCase(), icon: FileImage, color: "purple" };
  }
  if (/^(zip|7z|rar|tar|gz)$/.test(extension ?? "")) return { label: extension!.toUpperCase(), icon: FileArchive, color: "gray" };
  if (extension === "md" || extension === "markdown") return { label: "Markdown", icon: FileText, color: "gray" };
  if (extension === "pdf") return { label: "PDF", icon: FileText, color: "red" };
  if (/^(js|jsx|ts|tsx|json|css|html|py|xml)$/.test(extension ?? "")) return { label: extension!.toUpperCase(), icon: FileCode2, color: "gray" };
  return { label: extension?.toUpperCase() || "文件", icon: File, color: "gray" };
}

export function ArtifactFileIcon({ name, compact = false }: { name: string; compact?: boolean }) {
  const { icon: Icon, color } = artifactFileType(name);
  return <Flex as="span" align="center" justify="center" flexShrink={0} boxSize={compact ? 6 : 9}
    borderRadius="lg" bg={`${color}.50`} color={`${color}.600`} aria-hidden="true">
    <Icon size={compact ? 14 : 19} strokeWidth={1.7} />
  </Flex>;
}

import { Box } from "@chakra-ui/react";
import { File, FileArchive, FileText, Folder, Image, Layers, NotebookText, PanelsTopLeft, Presentation, Sheet } from "lucide-react";
import type { LibraryFile } from "@/types/library";
import { isArtifactImage } from "../workspace/ArtifactFileIcon";

type IconItem = Pick<LibraryFile,"name"> & Partial<Pick<LibraryFile,"path" | "kind" | "sharedPage">>;

function appearance(item: IconItem) {
  if (item.kind === "站点") return { Icon: PanelsTopLeft };
  if (item.kind === "文件夹") return { Icon: Folder };
  if (item.kind === "资料空间") return { Icon: Layers };
  if (item.kind === "页面" || item.sharedPage) return { Icon: NotebookText, color: "#168aff" };
  const path = item.path || item.name;
  if (/\.(xlsx?|csv|tsv|ods)$/i.test(path)) return { Icon: Sheet, color: "#18a851" };
  if (/\.(pptx?|odp)$/i.test(path)) return { Icon: Presentation, color: "#d86a32" };
  if (/\.pdf$/i.test(path)) return { Icon: FileText, color: "#d54540" };
  if (/\.(docx?|odt)$/i.test(path)) return { Icon: FileText, color: "#168aff" };
  if (/\.(zip|rar|7z|tar|gz)$/i.test(path)) return { Icon: FileArchive };
  if (isArtifactImage(path)) return { Icon: Image };
  if (/\.(txt|md|markdown|rtf)$/i.test(path)) return { Icon: FileText };
  return { Icon: File };
}

export default function LibraryItemIcon({item, compact=false}:{item:IconItem; compact?:boolean}) {
  const {Icon,color} = appearance(item);
  return <Box as="span" aria-hidden="true" display="inline-flex" alignItems="center" justifyContent="center"
    flexShrink={0} boxSize={compact ? "16px" : "32px"} border={compact ? "none" : "1px solid rgba(0,0,0,.1)"}
    borderRadius="8px" bg={compact ? "transparent" : "#fcfcfc"} color={compact ? "currentColor" : color || "#0d0d0d"}>
    <Icon size={compact ? 14 : 20} strokeWidth={1.75}/>
  </Box>;
}

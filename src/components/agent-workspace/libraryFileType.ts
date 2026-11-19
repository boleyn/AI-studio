import { libraryTypeName, type LibraryFile } from "@/types/library";
import { isArtifactImage } from "../workspace/ArtifactFileIcon";
import { isContainer } from "@features/chat/services/libraryAttachment";

export function fileType(file: LibraryFile) {
  if (isContainer(file)) return file.kind;
  if (file.kind === "页面" || file.sharedPage) return "页面";
  if (file.siteId) return "站点";
  const path = libraryTypeName(file);
  if (isArtifactImage(path)) return "图像";
  if (/\.(xls[xm]?|csv|tsv|ods)$/i.test(path)) return "电子表格";
  if (/\.(ppt[xm]?|odp)$/i.test(path)) return "演示文稿";
  if (/\.pdf$/i.test(path)) return "PDF 文件";
  if (/\.(doc[xm]?|txt|md|markdown|rtf|odt)$/i.test(path)) return "文档";
  return "其他";
}

export function matchesLibraryType(file: LibraryFile, term: string) {
  const label = fileType(file);
  return label.toLowerCase().includes(term) || (label === "演示文稿" && "幻灯片".includes(term));
}

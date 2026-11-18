import { withAuthHeaders } from "@features/auth/client/authClient";
import type { LibraryFile } from "@/types/library";
import { buildDownloadUrl } from "./files";

export function libraryAttachmentUrl(item: LibraryFile) {
  if (item.shareId) return "/api/artifact-share?id=" + item.shareId + "&file=1";
  const query = new URLSearchParams({token:item.token, action:"view", path:item.path});
  if (item.version) query.set("version",item.version);
  let url = "/api/code?" + query;
  if (item.kind === "页面") url = "/api/library/pages?id=" + item.id;
  else if (item.directUpload) url = "/api/library/files?id=" + item.id;
  else if (item.kind === "上传") url = buildDownloadUrl({storagePath:item.path,token:item.token,chatId:item.chatId});
  return url;
}

export async function readLibraryAttachment(item: LibraryFile, signal?:AbortSignal):Promise<File> {
  const response = await fetch(libraryAttachmentUrl(item),{headers:withAuthHeaders(),signal});
  if (!response.ok) throw new Error("读取失败：" + item.name);
  if (item.kind === "页面") {
    const page = await response.json();
    return new File(["# " + page.name + "\n\n" + page.body],page.name + ".md",{type:"text/markdown"});
  }
  const blob = await response.blob();
  return new File([blob],item.name,{type:blob.type});
}

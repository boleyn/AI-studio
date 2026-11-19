import { inferAttachmentMimeType } from "../utils/attachmentMimeType";
import { fromLibrary } from "./libraryFileOrigin";
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

export class LibraryReadError extends Error {
  constructor(readonly status:number, name:string) {
    super("读取失败：" + name);
  }
}

export async function readLibraryAttachment(item: LibraryFile, signal?:AbortSignal):Promise<File> {
  const response = await fetch(libraryAttachmentUrl(item),{headers:withAuthHeaders(),signal});
  if (!response.ok) throw new LibraryReadError(response.status,item.name);
  if (item.kind === "页面") {
    const page = await response.json();
    return fromLibrary(new File(["# " + page.name + "\n\n" + page.body],page.name + ".md",{type:"text/markdown"}),item.id);
  }
  const blob = await response.blob();
  if (item.sharedPage) return fromLibrary(new File([blob],item.name + ".md",{type:"text/markdown"}),item.id);
  const type = !blob.type || blob.type.split(";")[0].trim() === "application/octet-stream"
    ? inferAttachmentMimeType(item.name, item.path)
    : blob.type;
  return fromLibrary(new File([blob],item.name,{type}),item.id);
}

export async function addLibraryAttachments(
  items: LibraryFile[],
  upload: (files: File[]) => Promise<(string | undefined)[]>,
) {
  const reads = await Promise.allSettled(items.map(item => readLibraryAttachment(item)));
  const ready: File[] = [];
  const errors = new Map<string, string>();
  reads.forEach((read, index) => {
    if (read.status === "fulfilled") ready.push(read.value);
    else {
      const status = read.reason instanceof LibraryReadError ? read.reason.status : undefined;
      let message = "暂时无法读取，请稍后重试。";
      if (status === 401) message = "登录已过期，请重新登录。";
      if (status === 403) message = "当前账号没有读取权限，请联系文件所有者。";
      if (status === 404 || status === 410) message = "文件可能已删除或共享已结束，请重新选择。";
      errors.set(items[index].id,message);
    }
  });
  if (ready.length) {
    const uploadErrors = await upload(ready);
    let uploadedIndex = 0;
    reads.forEach((read, index) => {
      if (read.status !== "fulfilled") return;
      const reason = uploadErrors[uploadedIndex++];
      if (reason) errors.set(items[index].id, reason);
    });
  }
  return errors;
}

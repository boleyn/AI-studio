import { markdownFilename, sharedPreviewFilename } from "@/types/library";
import { inferAttachmentMimeType } from "../utils/attachmentMimeType";
import { fromLibrary } from "./libraryFileOrigin";
import { withAuthHeaders } from "@features/auth/client/authClient";
import { libraryTypeName, type LibraryFile } from "@/types/library";
import { buildDownloadUrl, MAX_UPLOAD_FILE_SIZE } from "./files";

export const isContainer = (file:LibraryFile) => file.kind === "文件夹" || file.kind === "资料空间";

export function expandLibrarySelection(selection: LibraryFile[], files: LibraryFile[], sharedSpaces?: Map<string, LibraryFile>) {
    const containers = selection.filter(isContainer);
    for (const item of containers) {
      if (item.shareId) sharedSpaces?.set(item.id, item);
    }
    const folders = new Set(containers.map(item => item.id));
    if (!folders.size) return selection;
    const children = new Map<string,LibraryFile[]>();
    for (const file of files) {
      if (file.deleted || !file.folderId) continue;
      const siblings = children.get(file.folderId);
      if (siblings) siblings.push(file);
      else children.set(file.folderId,[file]);
    }
    const attachments = new Map(selection.filter(item => !isContainer(item)).map(item => [item.id, item]));
    for (const folderId of folders) {
      for (const file of children.get(folderId) || []) {
        if (isContainer(file) && file.shareId) sharedSpaces?.set(file.id, file);
        if (isContainer(file) || file.kind === "页面") folders.add(file.id);
        if (!isContainer(file) && !file.siteId) attachments.set(file.id, file);
      }
    }
    return [...attachments.values()];
  }

export async function includeSharedPages(files: LibraryFile[], spaces: Iterable<LibraryFile>) {
  const uniqueFiles = new Map(files.map(file => [file.id, file]));
  for (const space of spaces) {
    const pages = await loadSharedSpacePages(space);
    for (const page of pages) uniqueFiles.set(page.id, page);
  }
  return [...uniqueFiles.values()];
}

export function recordLibraryOpen(selection: string | string[]) {
  const ids = typeof selection === "string" ? [selection] : [...new Set(selection)];
  for (let start = 0; start < ids.length; start += 100) {
    void fetch("/api/library", {method:"POST", headers:withAuthHeaders({"Content-Type":"application/json"}),
      body:JSON.stringify({openedIds:ids.slice(start,start+100)})}).catch(() => undefined);
  }
}

async function readLibraryJson<T>(response: Response, message: string): Promise<T> {
  try {
    return await response.json();
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new Error(message);
  }
}

export async function loadLibraryFiles(signal: AbortSignal): Promise<LibraryFile[]> {
  const response = await fetch("/api/library", {headers:withAuthHeaders(), signal});
  if (response.status === 401) throw new Error("请先登录，再打开资料空间。");
  if (response.status === 403) throw new Error("当前账号没有访问资料空间的权限。");
  if (!response.ok) throw new Error("资料空间暂时不可用，请稍后重试。");
  const message = "资料列表未能加载，请重试。";
  const items = await readLibraryJson<unknown>(response, message);
  if (!Array.isArray(items)) throw new Error(message);
  return items;
}

export async function loadSharedSpacePages(space: LibraryFile, signal?: AbortSignal): Promise<LibraryFile[]> {
  if (!space.shareId) return [];
  const response = await fetch("/api/library/space-share?" + new URLSearchParams({id:space.shareId,contents:"1"}),
    {headers:withAuthHeaders(), signal});
  if (response.status === 401) throw new Error("请重新登录后打开共享空间。");
  if (response.status === 403 || response.status === 404) throw new Error("共享空间已不可访问，请联系所有者确认。");
  if (!response.ok) throw new Error("共享空间暂时无法加载，请稍后重试。");
  const message = "共享空间的页面列表未能加载，请重试。";
  type Page = {id:string;name:string;path?:string;time?:string;openedAt?:string};
  const data = await readLibraryJson<{pages?: Page[]} | null>(response, message);
  if (!Array.isArray(data?.pages) || data.pages.some(page => !page || typeof page.id !== "string" || typeof page.name !== "string")) {
    throw new Error(message);
  }
  return data.pages.map(page => ({
    ...space, id:`space-${space.shareId}-${page.id}`, name:page.name, kind:"上传", time:page.time || space.time, openedAt:page.openedAt,
    path:page.path || page.name, sharedPage:true, project:space.name,
  }));
}

export function sharedSpacePageLocation(origin: string) {
  const match = /^space-([a-f0-9]{24})-([a-f0-9]{24})$/.exec(origin);
  if (!match) return;
  const [, id, page] = match;
  return {
    api: "/api/library/space-share?" + new URLSearchParams({id,page,contents:"1",download:"1"}),
    href: "/share/space/" + id + "?page=" + page,
  };
}

export function libraryAttachmentUrl(item: LibraryFile) {
  const location = sharedSpacePageLocation(item.id);
  if (location) return location.api;
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

export function libraryReadMessage(reason: unknown) {
  if (reason instanceof TypeError && /fetch|network|load failed/i.test(reason.message)) {
    return "连接失败，请检查网络后重试。";
  }
  const status = reason instanceof LibraryReadError ? reason.status : undefined;
  if (status === 401) return "登录已过期，请重新登录。";
  if (status === 403) return "当前账号没有读取权限，请联系文件所有者。";
  if (status === 404 || status === 410) return "文件可能已删除或共享已结束，请重新选择。";
  if (status === 413) return "文件超过单个聊天附件 10 MB 的上限。";
  if (status === 429) return "读取请求过于频繁，请稍后重试。";
  if (status === 422) return "页面内容无法读取，请重新打开页面后重试。";
  if (status === 503) return "文件服务暂时不可用，请稍后重试。";
  return "暂时无法读取，请稍后重试。";
}

export async function readLibraryAttachment(item: LibraryFile, signal?:AbortSignal, maxBytes?:number):Promise<File> {
  const response = await fetch(libraryAttachmentUrl(item),{headers:withAuthHeaders(),signal});
  if (!response.ok) throw new LibraryReadError(response.status,item.name);
  if (item.kind === "页面") {
    const page = await response.json().catch(error => {
      if (error instanceof SyntaxError) throw new LibraryReadError(422, item.name);
      throw error;
    });
    if (typeof page?.body !== "string") throw new LibraryReadError(422, item.name);
    const name = typeof page.name === "string" && page.name.trim() ? page.name : item.name;
    return fromLibrary(new File(["# " + name + "\n\n" + page.body],markdownFilename(name),{type:"text/markdown"}),item.id);
  }
  // Pages are converted to Markdown above. For raw files the response length is a lower bound only when unencoded.
  if (maxBytes !== undefined && !response.headers.has("Content-Encoding") &&
      Number(response.headers.get("Content-Length")) > maxBytes) {
    await response.body?.cancel();
    throw new LibraryReadError(413,item.name);
  }
  const blob = await readAttachmentBlob(response, item.name, maxBytes);
  if (item.sharedPage) return fromLibrary(new File([blob],markdownFilename(item.name),{type:"text/markdown"}),item.id);
  const inferred = inferAttachmentMimeType(libraryTypeName(item), item.name);
  const mediaType = blob.type.split(";")[0].trim().toLowerCase();
  const type = !mediaType || mediaType === "application/octet-stream" || (mediaType === "text/plain" && inferred === "text/markdown")
    ? inferred
    : blob.type;
  const filename = sharedPreviewFilename(item.name, libraryTypeName(item));
  return fromLibrary(new File([blob],filename,{type}),item.id);
}

async function readAttachmentBlob(response: Response, name: string, maxBytes?: number) {
  if (maxBytes === undefined || !response.body) return response.blob();
  const reader = response.body.getReader();
  const chunks: ArrayBuffer[] = [];
  let bytes = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        throw new LibraryReadError(413, name);
      }
      chunks.push(value.slice().buffer);
    }
    return new Blob(chunks, {type: response.headers.get("Content-Type") || ""});
  } finally {
    reader.releaseLock();
  }
}

export async function readLibraryAttachments(items: LibraryFile[], purpose: "chat" | "download") {
  const reads: PromiseSettledResult<File>[] = [];
  for (let start = 0; start < items.length; start += 6) {
    const batch = items.slice(start, start + 6);
    reads.push(...await Promise.allSettled(batch.map(async item => {
      if (purpose === "chat" && item.size !== undefined && item.size > MAX_UPLOAD_FILE_SIZE) {
        throw new LibraryReadError(413,item.name);
      }
      const file = await readLibraryAttachment(item, undefined, purpose === "chat" ? MAX_UPLOAD_FILE_SIZE : undefined);
      if (purpose === "chat" && file.size > MAX_UPLOAD_FILE_SIZE) throw new LibraryReadError(413,item.name);
      return file;
    })));
  }
  return reads;
}

export async function addLibraryAttachments(
  items: LibraryFile[],
  upload: (files: File[]) => Promise<(string | undefined)[]>,
) {
  const reads = await readLibraryAttachments(items, "chat");
  const ready: File[] = [];
  const errors = new Map<string, string>();
  reads.forEach((read, index) => {
    if (read.status === "fulfilled") ready.push(read.value);
    else {
      errors.set(items[index].id, libraryReadMessage(read.reason));
    }
  });
  if (ready.length) {
    let uploadErrors: (string | undefined)[];
    try {
      uploadErrors = await upload(ready);
    } catch (reason) {
      const message = reason instanceof TypeError ? "上传连接失败，请检查网络后重试。"
        : reason instanceof Error && reason.message ? reason.message : "附件上传失败，请重试。";
      uploadErrors = ready.map(() => message);
    }
    const opened: string[] = [];
    let uploadedIndex = 0;
    reads.forEach((read, index) => {
      if (read.status !== "fulfilled") return;
      const reason = uploadErrors[uploadedIndex++];
      if (reason) errors.set(items[index].id, reason);
      else opened.push(items[index].id);
    });
    recordLibraryOpen(opened);
  }
  return errors;
}

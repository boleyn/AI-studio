import { libraryOrigin } from "./libraryFileOrigin";
import { withAuthHeaders } from "@features/auth/client/authClient";

import type { ChatInputFile } from "../types/chatInput";
import type { UploadedFileArtifact } from "../types/fileArtifact";

export const MAX_UPLOAD_FILE_SIZE = 10 * 1024 * 1024;

interface PresignedUploadArtifact extends UploadedFileArtifact {
  storagePath: string;
  publicUrl: string;
  upload: {
    method: "PUT";
    url: string;
    headers: Record<string, string>;
  };
}

export type UploadPhase = "uploading" | "parsing" | "done";

const requestPresignedUploads = async ({
  token,
  chatId,
  files,
}: {
  token: string;
  chatId: string;
  files: ChatInputFile[];
}) => {
  const results = await Promise.all(
    files.map(async (item) => {
      const response = await fetch("/api/core/chat/file/presignChatFilePostUrl", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...withAuthHeaders(),
        },
        body: JSON.stringify({
          token,
          chatId,
          filename: item.file.name,
          contentType: item.file.type,
        }),
      });

      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        key?: string;
        url?: string;
        headers?: Record<string, string>;
      };
      if (!response.ok || !data.key || !data.url) {
        throw new Error(typeof data.error === "string" ? data.error : "申请上传地址失败");
      }

      return {
        id: item.id,
        name: item.file.name,
        type: item.file.type || "application/octet-stream",
        size: item.file.size,
        lastModified: item.file.lastModified,
        libraryItemId: libraryOrigin(item.file),
        storagePath: data.key,
        publicUrl: "",
        upload: {
          method: "PUT" as const,
          url: data.url,
          headers: data.headers || {},
        },
      } satisfies PresignedUploadArtifact;
    })
  );

  return results;
};

const uploadFileByPresignedUrl = ({
  file,
  upload,
  onProgress,
}: {
  file: File;
  upload: PresignedUploadArtifact["upload"];
  onProgress?: (loaded: number, total: number) => void;
}) =>
  new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(upload.method, upload.url, true);

    Object.entries(upload.headers || {}).forEach(([key, value]) => {
      xhr.setRequestHeader(key, value);
    });

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      onProgress?.(event.loaded, event.total);
    };

    xhr.onerror = () => reject(new Error("文件上传失败"));

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
        return;
      }
      reject(new Error(`文件上传失败: ${xhr.status}`));
    };

    xhr.send(file);
  });

const finalizeUploadedFiles = async ({
  token,
  chatId,
  files,
}: {
  token: string;
  chatId: string;
  files: PresignedUploadArtifact[];
}) => {
  const response = await fetch("/api/core/chat/files/upload", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...withAuthHeaders(),
    },
    body: JSON.stringify({
      token,
      chatId,
      files: files.map((item) => ({
        id: item.id,
        name: item.name,
        type: item.type,
        size: item.size,
        lastModified: item.lastModified,
        storagePath: item.storagePath,
      })),
    }),
  });

  const data = (await response.json().catch(() => ({}))) as {
    error?: string;
    files?: UploadedFileArtifact[];
  };

  if (!response.ok) {
    throw new Error(typeof data.error === "string" ? data.error : "上传确认失败");
  }

  const origins = new Map<string, string>();
  for (const file of files) {
    if (file.storagePath && file.libraryItemId) origins.set(file.storagePath.replace(/^\/+/, ""), file.libraryItemId);
  }
  return (data.files ?? []).map(file => ({
    ...file,
    libraryItemId: origins.get(file.storagePath?.replace(/^\/+/, "") ?? "") ?? file.libraryItemId,
  }));
};

export const uploadChatFiles = async ({
  token,
  chatId,
  files,
  onProgress,
}: {
  token: string;
  chatId: string;
  files: ChatInputFile[];
  onProgress?: (phase: UploadPhase, progress: number) => void;
}): Promise<UploadedFileArtifact[]> => {
  if (!files.length) return [];
  const oversized = files.find(item => item.file.size > MAX_UPLOAD_FILE_SIZE);
  if (oversized) throw new Error(`“${oversized.file.name}”超过单个附件 10 MB 的上限`);

  const presignedFiles = await requestPresignedUploads({
    token,
    chatId,
    files,
  });

  const totalBytes = files.reduce((sum, item) => sum + item.file.size, 0);
  let finishedBytes = 0;

  for (const [index, uploadItem] of presignedFiles.entries()) {
    const matched = files[index];

    await uploadFileByPresignedUrl({
      file: matched.file,
      upload: uploadItem.upload,
      onProgress: (loaded) => {
        if (!onProgress || totalBytes <= 0) return;
        const uploaded = Math.min(totalBytes, finishedBytes + loaded);
        const percent = Math.min(70, Math.round((uploaded / totalBytes) * 70));
        onProgress("uploading", percent);
      },
    });

    finishedBytes += matched.file.size;
    if (onProgress && totalBytes > 0) {
      const percent = Math.min(70, Math.round((finishedBytes / totalBytes) * 70));
      onProgress("uploading", percent);
    }
  }

  return finalizeUploadedFiles({
    token,
    chatId,
    files: presignedFiles,
  });
};

export const getPresignedChatFileGetUrl = async ({
  token,
  key,
}: {
  token: string;
  key: string;
}) => {
  const response = await fetch("/api/core/chat/file/presignChatFileGetUrl", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...withAuthHeaders(),
    },
    body: JSON.stringify({
      token,
      key,
    }),
  });
  const data = await response.json().catch(() => "");
  if (!response.ok) return "";
  return typeof data === "string" ? data : "";
};

export const buildPreviewUrl = ({ publicUrl }: { publicUrl: string }) => publicUrl;

export const buildDownloadUrl = ({
  storagePath,
  token,
  chatId,
}: {
  storagePath: string;
  token?: string;
  chatId?: string;
}) => {
  const params = new URLSearchParams({
    storagePath,
    download: "1",
  });
  if (token) params.set("token", token);
  if (chatId) params.set("chatId", chatId);
  return `/api/core/chat/files/view?${params.toString()}`;
};

export async function fetchWorkspaceArtifact(token: string, path: string, version?: string, signal?: AbortSignal) {
  const query = new URLSearchParams({ token, action: "view", path });
  if (version) query.set("version", version);
  const response = await fetch(`/api/code?${query}`, { headers: withAuthHeaders(), signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.blob();
}

export async function downloadWorkspaceArtifact(token: string, path: string, version?: string, filename?: string) {
  const query = new URLSearchParams({ token, action: "view", path });
  if (version) query.set("version", version);
  return downloadAuthenticatedFile(`/api/code?${query}`, filename || path.split("/").pop() || "file");
}

export async function downloadAuthenticatedFile(endpoint: string, filename: string) {
  const response = await fetch(endpoint, { headers: withAuthHeaders() });
  if (!response.ok) {
    const message = response.status === 401 ? "请重新登录后下载。" :
      response.status === 403 ? "当前账号没有下载权限。" :
      response.status === 404 || response.status === 410 ? "文件已不可访问，请确认文件或共享链接仍有效。" :
      "文件暂时无法下载，请稍后重试。";
    throw new Error(message);
  }
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

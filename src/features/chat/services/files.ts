import { withAuthHeaders } from "@features/auth/client/authClient";

import type { ChatInputFile } from "../types/chatInput";
import type { UploadedFileArtifact } from "../types/fileArtifact";

const MAX_UPLOAD_FILE_SIZE = 10 * 1024 * 1024;

interface PresignedUploadArtifact extends UploadedFileArtifact {
  storagePath: string;
  publicUrl: string;
  markdownStoragePath?: string;
  markdownPublicUrl?: string;
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
  const response = await fetch("/api/core/chat/files/presign", {
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
        name: item.file.name,
        type: item.file.type,
        size: item.file.size,
        lastModified: item.file.lastModified,
      })),
    }),
  });

  const data = (await response.json().catch(() => ({}))) as {
    error?: string;
    files?: PresignedUploadArtifact[];
  };

  if (!response.ok) {
    throw new Error(typeof data.error === "string" ? data.error : "申请上传地址失败");
  }

  return Array.isArray(data.files) ? data.files : [];
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
        markdownStoragePath: item.markdownStoragePath,
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

  return Array.isArray(data.files) ? data.files : [];
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
  const uploadable = files.filter((item) => item.file.size <= MAX_UPLOAD_FILE_SIZE);
  if (uploadable.length === 0) return [];

  const presignedFiles = await requestPresignedUploads({
    token,
    chatId,
    files: uploadable,
  });

  const totalBytes = uploadable.reduce((sum, item) => sum + item.file.size, 0);
  let finishedBytes = 0;

  for (const uploadItem of presignedFiles) {
    const matched = uploadable.find((item) => (item.id && item.id === uploadItem.id) || item.file.name === uploadItem.name);
    if (!matched) continue;

    await uploadFileByPresignedUrl({
      file: matched.file,
      upload: uploadItem.upload,
      onProgress: (loaded, total) => {
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

export const parseChatFiles = async ({
  files,
  onProgress,
}: {
  files: UploadedFileArtifact[];
  onProgress?: (phase: UploadPhase, progress: number) => void;
}): Promise<UploadedFileArtifact[]> => {
  if (!files.length) return files;
  if (onProgress) onProgress("parsing", 80);

  const response = await fetch("/api/core/chat/files/parse", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...withAuthHeaders(),
    },
    body: JSON.stringify({ files }),
  });

  if (!response.ok) {
    if (onProgress) onProgress("parsing", 90);
    return files;
  }

  const data = (await response.json()) as { files?: UploadedFileArtifact[] };
  const nextFiles = Array.isArray(data.files) ? data.files : files;
  if (onProgress) onProgress("done", 100);
  return nextFiles;
};

export const fetchMarkdownContent = async (storagePath: string) => {
  const response = await fetch(`/api/core/chat/files/markdown?storagePath=${encodeURIComponent(storagePath)}`, {
    headers: {
      ...withAuthHeaders(),
    },
  });
  if (!response.ok) return "";
  const data = (await response.json()) as { markdown?: string };
  return typeof data.markdown === "string" ? data.markdown : "";
};

export const fetchMarkdownContentByUrl = async (url: string) => {
  const response = await fetch(url, {
    headers: {
      ...withAuthHeaders(),
    },
  });
  if (!response.ok) return "";
  return await response.text();
};

export const buildPreviewUrl = ({ publicUrl }: { publicUrl: string }) => publicUrl;

export const buildDownloadUrl = ({ storagePath }: { storagePath: string }) =>
  `/api/core/chat/files/view?storagePath=${encodeURIComponent(storagePath)}&download=1`;

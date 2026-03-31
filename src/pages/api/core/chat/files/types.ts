export type ParseStatus = "pending" | "success" | "error" | "skipped";

export interface FileParseInfo {
  status: ParseStatus;
  progress: number;
  parser: "text" | "customPdfParse" | "metadata";
  error?: string;
}

export interface UploadFileResult {
  id?: string;
  name: string;
  type: string;
  size: number;
  lastModified: number;
  storagePath: string;
  publicUrl: string;
  parse: FileParseInfo;
}

export const pendingParseInfo: FileParseInfo = {
  status: "skipped",
  progress: 100,
  parser: "metadata",
  error: "上传文件自动 markdown 解析已关闭",
};

export type ParseStatus = "pending" | "success" | "error" | "skipped";

export interface FileParseInfo {
  status: ParseStatus;
  progress: number;
  parser: "text" | "customPdfParse" | "metadata";
  markdown?: string;
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
  markdownStoragePath?: string;
  markdownPublicUrl?: string;
  parse: FileParseInfo;
}

export const pendingParseInfo: FileParseInfo = {
  status: "pending",
  progress: 0,
  parser: "metadata",
  markdown: "",
};

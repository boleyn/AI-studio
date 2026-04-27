export type ParseStatus = "pending" | "success" | "error" | "skipped";

export interface UploadedFileArtifact {
  id?: string;
  name: string;
  size: number;
  type: string;
  lastModified: number;
  storagePath?: string;
  publicUrl?: string;
  previewUrl?: string;
  downloadUrl?: string;
  parse?: {
    status: ParseStatus;
    progress: number;
    parser: "text" | "customPdfParse" | "metadata";
    error?: string;
  };
}

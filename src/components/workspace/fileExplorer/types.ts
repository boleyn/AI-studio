export type SandpackFilesPayload = Record<string, { code: string }>;

export type CreateMode = "file" | "folder" | null;

export type RenameTarget = {
  path: string;
  type: "file" | "folder";
} | null;

export type FileNode = {
  type: "file";
  name: string;
  path: string;
};

export type FolderNode = {
  type: "folder";
  name: string;
  path: string;
  folderMap: Map<string, FolderNode>;
  fileMap: Map<string, FileNode>;
  entries: Array<{ kind: "folder" | "file"; path: string }>;
};

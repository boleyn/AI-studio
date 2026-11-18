export interface LibraryFile {
  id: string;
  shareId?: string;
  directUpload?: boolean;
  folderId?: string | null;
  favorite?: boolean;
  deleted?: boolean;
  kind: "生成" | "上传" | "页面" | "文件夹" | "资料空间";
  token: string;
  project: string;
  chatId: string;
  conversation: string;
  path: string;
  name: string;
  version?: string;
  time: string;
}

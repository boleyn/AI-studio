export const referenceTypes = ["我", "宠物", "朋友", "空间", "其他"] as const;
export type ImageReference = { type: typeof referenceTypes[number]; name: string };
export interface LibraryFile {
  id: string;
  shareId?: string;
  editablePageId?: string;
  reference?: ImageReference;
  directUpload?: boolean;
  folderId?: string | null;
  favorite?: boolean;
  deleted?: boolean;
  deletedAt?: string | null;
  size?: number;
  kind: "生成" | "上传" | "页面" | "文件夹" | "资料空间";
  token: string;
  project: string;
  chatId: string;
  conversation: string;
  path: string;
  name: string;
  version?: string;
  openedAt?: string;
  time: string;
}

export const referenceTypes = ["我", "宠物", "朋友", "空间", "其他"] as const;
export type ImageReference = { type: typeof referenceTypes[number]; name: string };
export type SpaceAppearance = {icon:string;color:string};
export interface LibraryFile {
  appearance?: SpaceAppearance;
  id: string;
  siteId?: string;
  siteSlug?: string;
  shareId?: string;
  editablePageId?: string;
  sharedPage?: boolean;
  sharedSpaceName?: string;
  fileOrigin?: "上传" | "生成";
  reference?: ImageReference;
  directUpload?: boolean;
  fromTemplate?: boolean;
  createdAt?: string;
  firstSeenAt?: string;
  createdBy?: string;
  permission?: "所有者" | "可编辑" | "可查看";
  folderId?: string | null;
  favorite?: boolean;
  pinned?: boolean;
  deleted?: boolean;
  deletedAt?: string | null;
  size?: number;
  kind: "生成" | "上传" | "页面" | "文件夹" | "资料空间" | "站点";
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

export function libraryTypeName(item: {path?:string; name:string}) {
  return item.path && /\.[^./\\]+$/.test(item.path) ? item.path : item.name;
}

export function libraryActivityTime(file: LibraryFile) {
  return file.openedAt && file.openedAt > file.time ? file.openedAt : file.time;
}

export function markdownFilename(title: string) {
  return /\.(md|markdown)$/i.test(title) ? title : title + ".md";
}

export function sharedPreviewFilename(name: string, originalName?: string) {
  const extension = originalName?.match(/\.[a-z0-9]{1,12}$/i)?.[0];
  return extension && !name.toLowerCase().endsWith(extension.toLowerCase()) ? name + extension : name;
}

export function sitePreviewPath(shareId: string, slug?: string) {
  return slug ? "/s/" + encodeURIComponent(slug) : "/share/preview/" + encodeURIComponent(shareId);
}

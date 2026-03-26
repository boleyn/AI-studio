export type FileMap = Record<string, { code: string }>;

export type ActiveView = "preview" | "code" | "logs";

export type PublishDraft = {
  slug: string;
  displayName: string;
  summary: string;
  tags: string;
  changelog: string;
  version: string;
  latestVersion: string;
  fileCount: number;
};

export type PublishConflict = {
  message: string;
  ownerName: string;
  ownerHandle?: string;
};

export type PublishHubStatus = {
  exists: boolean;
  canUpdate: boolean;
  ownerName: string;
  ownerHandle: string;
};

export type ImportVersionCheck = {
  incomingVersion: string;
  localVersion: string;
  sameVersion: boolean;
};

export type ImportDiffStatus = "added" | "removed" | "changed" | "same";

export type ImportDiffItem = {
  path: string;
  status: ImportDiffStatus;
  localCode: string;
  incomingCode: string;
};

export type ImportDiffPayload = {
  files: ImportDiffItem[];
  summary: {
    added: number;
    removed: number;
    changed: number;
    same: number;
  };
};

export type ImportConflictDraft = {
  skillId: string;
  skillName: string;
  versionCheck: ImportVersionCheck;
  importDiff: ImportDiffPayload;
};


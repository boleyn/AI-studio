import { httpGet, httpPost } from "./http";

export type SkillIssue = {
  code: string;
  message: string;
  location: string;
  name?: string;
};

export type SkillListItem = {
  name?: string;
  description?: string;
  location: string;
  relativeLocation: string;
  isLoadable: boolean;
  issues: SkillIssue[];
};

export type SkillListResponse = {
  scannedAt: string;
  rootDir: string;
  total: number;
  loadable: number;
  duplicateNames: Record<string, string[]>;
  skills: SkillListItem[];
};

export type SkillDetailResponse = {
  name: string;
  description: string;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, string>;
  location: string;
  relativeLocation: string;
  baseDir: string;
  body: string;
  sampledFiles: string[];
};

export type SkillValidationResponse = {
  ok: boolean;
  scannedAt: string;
  skills: Array<{
    name?: string;
    location: string;
    relativeLocation: string;
    isLoadable: boolean;
    issues: SkillIssue[];
  }>;
  issues: SkillIssue[];
};

export type SkillReloadResponse = {
  ok: boolean;
  scannedAt: string;
  total: number;
  loadable: number;
  duplicateNames: Record<string, string[]>;
};

export type SkillCreateInput = {
  name: string;
  description: string;
  body?: string;
  compatibility?: string;
  license?: string;
};

export type SkillCreateResponse = {
  ok: boolean;
  name: string;
  skillDir: string;
  skillFile: string;
};

export type InstallSkillCreatorResponse = {
  ok: boolean;
  installed: boolean;
  alreadyExists: boolean;
  skillDir: string;
  skillFile: string;
  sourceFile?: string;
};

export const listSkills = (projectToken?: string) =>
  httpGet<SkillListResponse>(
    `/agent/skills${
      projectToken && projectToken.trim()
        ? `?projectToken=${encodeURIComponent(projectToken.trim())}`
        : ""
    }`
  );
export const getSkillDetail = (name: string) =>
  httpGet<SkillDetailResponse>(`/agent/skills/${encodeURIComponent(name)}`);
export const validateSkills = (name?: string) =>
  httpPost<SkillValidationResponse>("/agent/skills/validate", name ? { name } : {});
export const reloadSkills = () => httpPost<SkillReloadResponse>("/agent/skills/reload");
export const createSkill = (input: SkillCreateInput) =>
  httpPost<SkillCreateResponse>("/agent/skills/create", input);
export const installSkillCreator = () =>
  httpPost<InstallSkillCreatorResponse>("/agent/skills/install-skill-creator");

export const SKILL_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export type SkillIssueCode =
  | "frontmatter_missing"
  | "frontmatter_parse_error"
  | "frontmatter_not_object"
  | "name_missing"
  | "name_invalid"
  | "name_dir_mismatch"
  | "description_missing"
  | "description_invalid"
  | "description_too_long"
  | "duplicate_name"
  | "not_found";

export type SkillIssue = {
  code: SkillIssueCode;
  message: string;
  location: string;
  name?: string;
};

export type SkillEntry = {
  name?: string;
  description?: string;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, string>;
  location: string;
  relativeLocation: string;
  baseDir: string;
  body: string;
  issues: SkillIssue[];
  isLoadable: boolean;
};

export type RuntimeSkill = {
  name: string;
  description: string;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, string>;
  location: string;
  relativeLocation: string;
  baseDir: string;
  body: string;
};

export type SkillSnapshot = {
  scannedAt: number;
  rootDir: string;
  entries: SkillEntry[];
  skills: RuntimeSkill[];
  duplicateNames: Record<string, string[]>;
};

export type SkillValidationItem = {
  name?: string;
  location: string;
  relativeLocation: string;
  isLoadable: boolean;
  issues: SkillIssue[];
};

export type SkillValidationResult = {
  ok: boolean;
  scannedAt: string;
  skills: SkillValidationItem[];
  issues: SkillIssue[];
};

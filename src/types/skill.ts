export type SkillSourceType = "custom" | "template";

export type SkillListItem = {
  token: string;
  name: string;
  description: string;
  sourceType: SkillSourceType;
  templateKey?: string;
  createdAt: string;
  updatedAt: string;
};

export type SkillDetail = SkillListItem & {
  content: string;
};

import { randomBytes } from "crypto";
import yaml from "js-yaml";
import { ObjectId } from "mongodb";

import { getMongoDb } from "@server/db/mongo";
import type { SkillDetail, SkillListItem, SkillSourceType } from "@/types/skill";

type SkillDoc = {
  _id: ObjectId;
  token: string;
  userId: string;
  name: string;
  description: string;
  content: string;
  sourceType: SkillSourceType;
  templateKey?: string;
  createdAt: string;
  updatedAt: string;
};

type CreateSkillInput = {
  userId: string;
  name?: string;
  description?: string;
  content?: string;
  sourceType?: SkillSourceType;
  templateKey?: string;
  sourceSkillId?: string;
};

type UpdateSkillInput = {
  name?: string;
  description?: string;
  content?: string;
};

const COLLECTION = "skills";
const DEFAULT_DESCRIPTION = "Describe what this skill does and when to use it.";

const TEMPLATE_PRESETS: Record<
  string,
  {
    name: string;
    description: string;
    body: string;
  }
> = {
  "analysis-skill": {
    name: "analysis-skill",
    description: "Analyze requirements and produce implementation-ready plans.",
    body: [
      "# Analysis Skill",
      "",
      "## Goal",
      "Turn ambiguous requests into clear execution specs.",
      "",
      "## Workflow",
      "1. Gather context.",
      "2. Identify constraints.",
      "3. Produce concrete acceptance criteria.",
    ].join("\n"),
  },
  "workflow-skill": {
    name: "workflow-skill",
    description: "Coordinate multi-step engineering workflows with clear checkpoints.",
    body: [
      "# Workflow Skill",
      "",
      "## Goal",
      "Drive complex implementation in reliable, testable phases.",
      "",
      "## Workflow",
      "1. Define phase boundaries.",
      "2. Track dependencies and risks.",
      "3. Confirm done criteria for each phase.",
    ].join("\n"),
  },
  "ui-builder-skill": {
    name: "ui-builder-skill",
    description: "Build expressive UI components with production-ready interaction details.",
    body: [
      "# UI Builder Skill",
      "",
      "## Goal",
      "Create polished UI with clear hierarchy, states, and responsive behavior.",
      "",
      "## Workflow",
      "1. Define visual direction and constraints.",
      "2. Implement structure, style, and interaction.",
      "3. Validate responsive and accessibility behavior.",
    ].join("\n"),
  },
};

const getCollection = async () => {
  const db = await getMongoDb();
  const coll = db.collection<SkillDoc>(COLLECTION);
  await coll.createIndex({ token: 1 }, { unique: true });
  await coll.createIndex({ userId: 1, updatedAt: -1 });
  return coll;
};

const makeToken = () => randomBytes(16).toString("hex");

const toListItem = (doc: SkillDoc): SkillListItem => ({
  token: doc.token,
  name: doc.name,
  description: doc.description,
  sourceType: doc.sourceType,
  templateKey: doc.templateKey,
  createdAt: doc.createdAt,
  updatedAt: doc.updatedAt,
});

const toDetail = (doc: SkillDoc): SkillDetail => ({
  ...toListItem(doc),
  content: doc.content,
});

const toKebab = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "new-skill";

const readFrontmatter = (content: string) => {
  const trimmed = content.trimStart();
  if (!trimmed.startsWith("---")) return {} as { name?: string; description?: string };
  const match = trimmed.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (!match) return {} as { name?: string; description?: string };
  try {
    const parsed = yaml.load(match[1]);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {} as { name?: string; description?: string };
    }
    const data = parsed as Record<string, unknown>;
    return {
      name: typeof data.name === "string" ? data.name.trim() : undefined,
      description: typeof data.description === "string" ? data.description.trim() : undefined,
    };
  } catch {
    return {} as { name?: string; description?: string };
  }
};

const writeFrontmatter = (
  content: string,
  data: { name?: string; description?: string }
) => {
  const trimmed = content.trimStart();
  let head = "";
  let body = content;

  const yamlOptions = { indent: 2, lineWidth: -1, noRefs: true };

  if (trimmed.startsWith("---")) {
    const match = trimmed.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
    if (match) {
      head = match[1];
      body = trimmed.slice(match[0].length);
    }
  }

  try {
    const parsed = (head ? yaml.load(head) : {}) as Record<string, any>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      // 如果解析失败，强制从头构造
      const nextHead = yaml.dump(data, yamlOptions).trim();
      return `---\n${nextHead}\n---\n\n${content.trimStart()}`;
    }

    if (data.name) parsed.name = data.name;
    if (data.description) parsed.description = data.description;

    const nextHead = yaml.dump(parsed, yamlOptions).trim();
    return `---\n${nextHead}\n---\n\n${body.trimStart()}`;
  } catch {
    // 兜底：直接构造新的 FM 并拼上原内容
    const nextHead = yaml.dump(data, yamlOptions).trim();
    return `---\n${nextHead}\n---\n\n${content.trimStart()}`;
  }
};

const buildDefaultContent = (name: string, description: string, body?: string) => {
  const safeName = toKebab(name);
  const safeDescription = (description || DEFAULT_DESCRIPTION).trim();
  const safeBody =
    body?.trim() ||
    [
      "# Skill",
      "",
      "## Goal",
      "Describe what this skill should help accomplish.",
      "",
      "## Workflow",
      "1. Read context before action.",
      "2. Keep changes scoped.",
      "3. Validate before finishing.",
    ].join("\n");

  return [
    "---",
    `name: ${safeName}`,
    `description: ${safeDescription}`,
    "---",
    "",
    safeBody,
  ].join("\n");
};

const resolveTemplate = (templateKey?: string) => {
  if (!templateKey) return null;
  return TEMPLATE_PRESETS[templateKey] || null;
};

const ensureUserId = (userId: string) => {
  if (!userId?.trim()) throw new Error("用户身份无效");
  return userId.trim();
};

const ensureName = (name?: string) => {
  const base = (name || "new-skill").trim();
  return toKebab(base);
};

const ensureDescription = (description?: string) => {
  const text = (description || DEFAULT_DESCRIPTION).trim();
  if (!text) return DEFAULT_DESCRIPTION;
  if (text.length > 1024) return text.slice(0, 1024);
  return text;
};

const findSkillDocForUser = async (token: string, userId: string) => {
  const coll = await getCollection();
  const doc = await coll.findOne({ token, userId });
  return doc;
};

export const listUserSkills = async ({
  userId,
  query,
}: {
  userId: string;
  query?: string;
}): Promise<SkillListItem[]> => {
  const coll = await getCollection();
  const safeUserId = ensureUserId(userId);
  const keyword = (query || "").trim();

  const filter: Record<string, unknown> = {
    userId: safeUserId,
  };

  if (keyword) {
    filter.$or = [
      { name: { $regex: keyword, $options: "i" } },
      { description: { $regex: keyword, $options: "i" } },
    ];
  }

  const docs = await coll.find(filter).sort({ updatedAt: -1 }).toArray();
  return docs.map(toListItem);
};

export const getUserSkill = async ({
  token,
  userId,
}: {
  token: string;
  userId: string;
}): Promise<SkillDetail | null> => {
  const doc = await findSkillDocForUser(token.trim(), ensureUserId(userId));
  return doc ? toDetail(doc) : null;
};

export const createUserSkill = async (input: CreateSkillInput): Promise<SkillDetail> => {
  const coll = await getCollection();
  const safeUserId = ensureUserId(input.userId);

  let sourceType: SkillSourceType = input.sourceType || "custom";
  let templateKey = input.templateKey?.trim();
  let name = ensureName(input.name);
  let description = ensureDescription(input.description);
  let content = (input.content || "").trim();

  if (input.sourceSkillId?.trim()) {
    const source = await findSkillDocForUser(input.sourceSkillId.trim(), safeUserId);
    if (!source) throw new Error("源 skill 不存在或无权限访问");
    sourceType = "custom";
    templateKey = undefined;
    name = ensureName(`${source.name}-copy`);
    description = source.description;
    content = source.content;
  } else if (sourceType === "template") {
    const preset = resolveTemplate(templateKey);
    if (!preset) throw new Error("模板不存在");
    name = ensureName(input.name || preset.name);
    description = ensureDescription(input.description || preset.description);
    content = buildDefaultContent(name, description, preset.body);
  }

  if (!content) {
    content = buildDefaultContent(name, description);
  }

  const parsed = readFrontmatter(content);
  if (parsed.name) {
    name = ensureName(parsed.name);
  }
  if (parsed.description) {
    description = ensureDescription(parsed.description);
  }

  const now = new Date().toISOString();
  const doc: Omit<SkillDoc, "_id"> = {
    token: makeToken(),
    userId: safeUserId,
    name,
    description,
    content,
    sourceType,
    templateKey,
    createdAt: now,
    updatedAt: now,
  };

  await coll.insertOne(doc as SkillDoc);
  return toDetail(doc as SkillDoc);
};

export const updateUserSkill = async ({
  token,
  userId,
  updates,
}: {
  token: string;
  userId: string;
  updates: UpdateSkillInput;
}): Promise<SkillDetail | null> => {
  const safeToken = token.trim();
  const safeUserId = ensureUserId(userId);
  const current = await findSkillDocForUser(safeToken, safeUserId);
  if (!current) return null;

  let nextContent =
    typeof updates.content === "string" ? updates.content : current.content;
  const parsed = readFrontmatter(nextContent || "");

  const nextName = ensureName(
    updates.name || parsed.name || current.name
  );
  const nextDescription = ensureDescription(
    updates.description || parsed.description || current.description
  );

  // 关键修复：如果 name/description 发生了主动更新（通常来自外部重命名），需要强制同步到 content 内容里的 FM 中
  // 否则之后打开编辑器会因为从 content 重新解析 FM 而发生“名称回弹”
  if (updates.name || updates.description) {
    nextContent = writeFrontmatter(nextContent, { name: nextName, description: nextDescription });
  }

  const now = new Date().toISOString();
  const coll = await getCollection();
  await coll.updateOne(
    { token: safeToken, userId: safeUserId },
    {
      $set: {
        name: nextName,
        description: nextDescription,
        content: nextContent,
        updatedAt: now,
      },
    }
  );

  return {
    token: safeToken,
    name: nextName,
    description: nextDescription,
    content: nextContent,
    sourceType: current.sourceType,
    templateKey: current.templateKey,
    createdAt: current.createdAt,
    updatedAt: now,
  };
};

export const deleteUserSkill = async ({
  token,
  userId,
}: {
  token: string;
  userId: string;
}): Promise<boolean> => {
  const coll = await getCollection();
  const result = await coll.deleteOne({ token: token.trim(), userId: ensureUserId(userId) });
  return result.deletedCount > 0;
};

export const SKILL_TEMPLATE_KEYS = Object.keys(TEMPLATE_PRESETS);

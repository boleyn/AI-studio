import { randomBytes } from "crypto";
import yaml from "js-yaml";
import { ObjectId } from "mongodb";

import { getMongoDb } from "@server/db/mongo";
import type { SkillDetail, SkillListItem, SkillSourceType } from "@/types/skill";
import {
  DEFAULT_DESCRIPTION,
  buildDefaultContent,
  buildFilesFromContent,
  ensureDescription,
  ensureName,
  ensureUserId,
  findSkillFilePath,
  normalizeSkillFiles,
  readFrontmatter,
  writeFrontmatter,
} from "./skillUtils";

type SkillDoc = {
  _id: ObjectId;
  token: string;
  userId: string;
  name: string;
  description: string;
  content: string;
  files?: Record<string, { code: string }>;
  sourceType: SkillSourceType;
  templateKey?: string;
  publishedAt?: string;
  publishedVersion?: string;
  createdAt: string;
  updatedAt: string;
};

type CreateSkillInput = {
  userId: string;
  name?: string;
  description?: string;
  content?: string;
  files?: Record<string, { code: string }>;
  sourceType?: SkillSourceType;
  templateKey?: string;
  sourceSkillId?: string;
};

type UpdateSkillInput = {
  name?: string;
  description?: string;
  content?: string;
  files?: Record<string, { code: string }>;
};

const COLLECTION = "skills";

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
  "orchestration-skill": {
    name: "orchestration-skill",
    description: "Coordinate multi-step engineering execution with clear checkpoints.",
    body: [
      "# Orchestration Skill",
      "",
      "## Goal",
      "Drive complex implementation in reliable, testable phases.",
      "",
      "## Execution Plan",
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
  publishedAt: doc.publishedAt,
  publishedVersion: doc.publishedVersion,
  fileCount: (() => {
    const files = normalizeSkillFiles(doc.files);
    const count = Object.keys(files).length;
    if (count > 0) return count;
    return doc.content?.trim() ? 1 : 0;
  })(),
  createdAt: doc.createdAt,
  updatedAt: doc.updatedAt,
});

const toDetail = (doc: SkillDoc): SkillDetail => ({
  ...toListItem(doc),
  content: doc.content,
  files: doc.files ? normalizeSkillFiles(doc.files) : undefined,
});

const resolveTemplate = (templateKey?: string) => {
  if (!templateKey) return null;
  return TEMPLATE_PRESETS[templateKey] || null;
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
  let files = normalizeSkillFiles(input.files);

  if (input.sourceSkillId?.trim()) {
    const source = await findSkillDocForUser(input.sourceSkillId.trim(), safeUserId);
    if (!source) throw new Error("源 skill 不存在或无权限访问");
    sourceType = "custom";
    templateKey = undefined;
    name = ensureName(`${source.name}-copy`);
    description = source.description;
    content = source.content;
    files = normalizeSkillFiles(source.files);
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

  if (Object.keys(files).length === 0) {
    files = buildFilesFromContent(name, content);
  }

  const skillFilePath = findSkillFilePath(files, name);
  if (skillFilePath) {
    content = files[skillFilePath]?.code || content;
  } else {
    const fallbackPath = `/skills/${name}/SKILL.md`;
    files[fallbackPath] = { code: content };
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
    files: normalizeSkillFiles(files),
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

  const hasIncomingFiles = updates.files && typeof updates.files === "object";
  let nextFiles = hasIncomingFiles
    ? normalizeSkillFiles(updates.files)
    : normalizeSkillFiles(current.files);

  if (!hasIncomingFiles && Object.keys(nextFiles).length === 0) {
    nextFiles = buildFilesFromContent(current.name, current.content);
  }

  const skillFilePath = findSkillFilePath(nextFiles, current.name);
  const fileBackedContent = skillFilePath ? nextFiles[skillFilePath]?.code : "";
  let nextContent =
    typeof updates.content === "string" ? updates.content : fileBackedContent || current.content;

  if (typeof updates.content === "string" && skillFilePath) {
    nextFiles[skillFilePath] = { code: updates.content };
  }

  const parsed = readFrontmatter(nextContent || "");
  const nextName = ensureName(updates.name || parsed.name || current.name);
  const nextDescription = ensureDescription(updates.description || parsed.description || current.description);

  if (updates.name || updates.description) {
    nextContent = writeFrontmatter(nextContent, { name: nextName, description: nextDescription });
    if (skillFilePath) {
      nextFiles[skillFilePath] = { code: nextContent };
    }
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
        files: normalizeSkillFiles(nextFiles),
        updatedAt: now,
      },
    }
  );

  return {
    token: safeToken,
    name: nextName,
    description: nextDescription,
    content: nextContent,
    files: normalizeSkillFiles(nextFiles),
    sourceType: current.sourceType,
    templateKey: current.templateKey,
    createdAt: current.createdAt,
    updatedAt: now,
  };
};

export const markUserSkillPublished = async ({
  token,
  userId,
  version,
}: {
  token: string;
  userId: string;
  version?: string;
}) => {
  const safeToken = token.trim();
  const safeUserId = ensureUserId(userId);
  if (!safeToken) return;
  const coll = await getCollection();
  const now = new Date().toISOString();
  await coll.updateOne(
    { token: safeToken, userId: safeUserId },
    {
      $set: {
        publishedAt: now,
        ...(typeof version === "string" && version.trim() ? { publishedVersion: version.trim() } : {}),
        updatedAt: now,
      },
    }
  );
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

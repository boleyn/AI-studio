import { promises as fs } from "fs";
import path from "path";
import { toSafeSegment } from "@server/agent/workspace/pathUtils";

export type ProjectMemoryType = "user" | "feedback" | "project" | "reference";

export type ProjectMemoryFile = {
  path: string;
  name: string;
  description: string;
  type: ProjectMemoryType;
  content: string;
};

export type ProjectMemoryRecall = {
  index: {
    content: string;
    truncatedByLines: boolean;
    truncatedByBytes: boolean;
  };
  files: ProjectMemoryFile[];
};

export type ProjectMemoryUpdateResult = {
  updated: boolean;
  writtenPaths: string[];
};

type MemoryRecallCandidate = {
  path: string;
  name: string;
  description: string;
  type: ProjectMemoryType;
};

type MemoryExtractionCandidate = {
  name: string;
  description: string;
  type: ProjectMemoryType;
  body: string;
};

const MAX_INDEX_LINES = 200;
const MAX_INDEX_BYTES = 25_000;
const MAX_RECALL_FILES = 5;
const INDEX_FILE = "MEMORY.md";

const normalizeType = (value: string): ProjectMemoryType => {
  const lowered = value.trim().toLowerCase();
  if (lowered === "user" || lowered === "feedback" || lowered === "project" || lowered === "reference") {
    return lowered;
  }
  return "project";
};

const splitTerms = (value: string) =>
  value
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fa5_]+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);

const parseJsonObject = <T extends Record<string, unknown>>(raw: string): T | null => {
  const trimmed = (raw || "").trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      const slice = trimmed.slice(start, end + 1);
      try {
        return JSON.parse(slice) as T;
      } catch {
        return null;
      }
    }
    return null;
  }
};

const toSlug = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "memory";

const memoryRoot = (projectToken: string) =>
  path.join(process.cwd(), ".aistudio", "projects", toSafeSegment(projectToken), "memory");

const trimIndexContent = (raw: string) => {
  const normalizedRaw = (raw || "").trim();
  const lines = normalizedRaw ? normalizedRaw.split("\n") : [];
  const truncatedByLines = lines.length > MAX_INDEX_LINES;
  const byLines = truncatedByLines ? lines.slice(0, MAX_INDEX_LINES).join("\n") : normalizedRaw;
  const truncatedByBytes = Buffer.byteLength(byLines, "utf8") > MAX_INDEX_BYTES;
  if (!truncatedByBytes) {
    return { content: byLines, truncatedByLines, truncatedByBytes };
  }

  let content = byLines;
  while (Buffer.byteLength(content, "utf8") > MAX_INDEX_BYTES && content.includes("\n")) {
    content = content.slice(0, content.lastIndexOf("\n"));
  }
  if (Buffer.byteLength(content, "utf8") > MAX_INDEX_BYTES) {
    content = content.slice(0, MAX_INDEX_BYTES);
  }
  return { content: content.trim(), truncatedByLines, truncatedByBytes };
};

const parseFrontmatter = (
  raw: string
): { name: string; description: string; type: ProjectMemoryType; body: string } => {
  const content = (raw || "").trim();
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    return {
      name: "memory",
      description: "",
      type: "project",
      body: content,
    };
  }
  const fm = match[1] || "";
  const body = (match[2] || "").trim();
  const lines = fm.split("\n");
  const kv = new Map<string, string>();
  for (const line of lines) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    kv.set(key, value);
  }
  return {
    name: kv.get("name") || "memory",
    description: kv.get("description") || "",
    type: normalizeType(kv.get("type") || "project"),
    body,
  };
};

const formatMemoryFile = ({
  name,
  description,
  type,
  body,
}: {
  name: string;
  description: string;
  type: ProjectMemoryType;
  body: string;
}) => {
  return [
    "---",
    `name: ${name}`,
    `description: ${description}`,
    `type: ${type}`,
    "---",
    "",
    body.trim(),
    "",
  ].join("\n");
};

const ensureDir = async (projectToken: string) => {
  const root = memoryRoot(projectToken);
  await fs.mkdir(root, { recursive: true });
  const indexPath = path.join(root, INDEX_FILE);
  await fs.access(indexPath).catch(async () => {
    await fs.writeFile(indexPath, "# Project Memory\n\n", "utf8");
  });
  return { root, indexPath };
};

const loadAllMemoryFiles = async (projectToken: string) => {
  const { root } = await ensureDir(projectToken);
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md") && entry.name !== INDEX_FILE)
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  const result: ProjectMemoryFile[] = [];
  for (const file of files) {
    const absPath = path.join(root, file);
    const raw = await fs.readFile(absPath, "utf8").catch(() => "");
    const parsed = parseFrontmatter(raw);
    result.push({
      path: `/${file}`,
      name: parsed.name,
      description: parsed.description,
      type: parsed.type,
      content: parsed.body,
    });
  }
  return result;
};

const buildRecallPromptBlock = (recall: ProjectMemoryRecall) => {
  const lines: string[] = [];
  if (recall.index.content.trim()) {
    lines.push("Project memory index (MEMORY.md):");
    lines.push(recall.index.content.trim());
  }
  if (recall.files.length > 0) {
    lines.push("Relevant project memories:");
    recall.files.forEach((item) => {
      lines.push(`- ${item.path} (${item.type}) ${item.description || item.name}`);
      if (item.content.trim()) {
        lines.push(item.content.trim().slice(0, 1200));
      }
    });
  }
  return lines.join("\n\n");
};

export const getProjectMemoryBehaviorPrompt = () => {
  return [
    "Project Memory Rules:",
    "- You have project memory files under /.aistudio/projects/<project>/memory.",
    "- Use memory as durable cross-session facts; do not store transient task state.",
    "- Memory types: user, feedback, project, reference.",
    "- If user asks to ignore memory, proceed as if memory were empty.",
  ].join("\n");
};

export const recallProjectMemories = async ({
  projectToken,
  query,
  maxFiles = MAX_RECALL_FILES,
}: {
  projectToken: string;
  query: string;
  maxFiles?: number;
}): Promise<ProjectMemoryRecall> => {
  const { indexPath } = await ensureDir(projectToken);
  const rawIndex = await fs.readFile(indexPath, "utf8").catch(() => "");
  const index = trimIndexContent(rawIndex || "");
  const files = await loadAllMemoryFiles(projectToken);

  const queryTerms = splitTerms(query);
  const ranked = files
    .map((file) => {
      const haystack = `${file.name} ${file.description} ${file.type} ${file.content.slice(0, 4000)}`.toLowerCase();
      let score = 0;
      for (const term of queryTerms) {
        if (haystack.includes(term)) score += 1;
      }
      if (file.type === "feedback") score += 0.2;
      return { file, score };
    })
    .sort((a, b) => b.score - a.score || a.file.path.localeCompare(b.file.path));

  const selected = ranked
    .filter((item) => (queryTerms.length === 0 ? false : item.score > 0))
    .slice(0, Math.max(1, Math.min(maxFiles, MAX_RECALL_FILES)))
    .map((item) => item.file);

  return {
    index,
    files: selected,
  };
};

export const selectRelevantMemoriesByModel = async ({
  query,
  candidates,
  maxFiles = MAX_RECALL_FILES,
  llmSelect,
}: {
  query: string;
  candidates: MemoryRecallCandidate[];
  maxFiles?: number;
  llmSelect?: (input: { system: string; user: string }) => Promise<string>;
}) => {
  if (!llmSelect || candidates.length === 0) return null;

  const system = [
    "You select the most relevant project memory file paths.",
    "Return strict JSON only.",
    'Schema: {"paths":["/file1.md","/file2.md"]}',
    `Return at most ${Math.max(1, Math.min(maxFiles, MAX_RECALL_FILES))} paths.`,
    "Prefer feedback/project memories when equally relevant.",
  ].join("\n");
  const user = JSON.stringify(
    {
      query,
      candidates: candidates.map((item) => ({
        path: item.path,
        name: item.name,
        description: item.description,
        type: item.type,
      })),
    },
    null,
    2
  );

  const answer = await llmSelect({ system, user }).catch(() => "");
  const parsed = parseJsonObject<{ paths?: unknown }>(answer);
  if (!parsed || !Array.isArray(parsed.paths)) return null;
  const allowed = new Set(candidates.map((item) => item.path));
  const picked = parsed.paths
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => allowed.has(item))
    .slice(0, Math.max(1, Math.min(maxFiles, MAX_RECALL_FILES)));
  return picked;
};

export const recallProjectMemoriesWithModel = async ({
  projectToken,
  query,
  maxFiles = MAX_RECALL_FILES,
  llmSelect,
}: {
  projectToken: string;
  query: string;
  maxFiles?: number;
  llmSelect?: (input: { system: string; user: string }) => Promise<string>;
}): Promise<ProjectMemoryRecall> => {
  const base = await recallProjectMemories({ projectToken, query, maxFiles: Math.max(maxFiles, MAX_RECALL_FILES) });
  if (!llmSelect || base.files.length === 0) return base;

  const picked = await selectRelevantMemoriesByModel({
    query,
    maxFiles,
    llmSelect,
    candidates: base.files.map((item) => ({
      path: item.path,
      name: item.name,
      description: item.description,
      type: item.type,
    })),
  });
  if (!picked || picked.length === 0) return base;
  const pickSet = new Set(picked);
  return {
    ...base,
    files: base.files.filter((item) => pickSet.has(item.path)).slice(0, maxFiles),
  };
};

export const buildProjectMemoryContextPrompt = (recall: ProjectMemoryRecall) => {
  const block = buildRecallPromptBlock(recall).trim();
  if (!block) return "";
  return ["Project memory context:", block].join("\n\n");
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const upsertIndexEntry = async ({
  indexPath,
  fileName,
  title,
  description,
}: {
  indexPath: string;
  fileName: string;
  title: string;
  description: string;
}) => {
  const raw = await fs.readFile(indexPath, "utf8").catch(() => "# Project Memory\n\n");
  const lines = raw.split("\n");
  const link = `- [${title}](${fileName}) — ${description}`;
  const pattern = new RegExp(`\\(${escapeRegExp(fileName)}\\)`);
  let replaced = false;
  const next = lines.map((line) => {
    if (!pattern.test(line)) return line;
    replaced = true;
    return link;
  });
  if (!replaced) {
    next.push(link);
  }
  const trimmed = trimIndexContent(next.join("\n"));
  await fs.writeFile(indexPath, `${trimmed.content.trim()}\n`, "utf8");
};

const buildCandidateFromMessages = (messages: Array<{ role: string; content: unknown }>) => {
  const lastUser = [...messages].reverse().find((msg) => msg.role === "user");
  if (!lastUser) return null;
  const text = String(lastUser.content || "").trim();
  if (!text) return null;

  const lowered = text.toLowerCase();
  const asksRemember = /记住|以后|偏好|习惯|remember|preference|always|never/.test(lowered);
  const isProfile = /我是|我是一名|my role|i am|i'm/.test(lowered);

  if (!asksRemember && !isProfile) return null;

  const type: ProjectMemoryType = isProfile ? "user" : "feedback";
  const name = isProfile ? "user_profile" : "user_preference";
  const description = isProfile ? "User self-described role/profile" : "User collaboration preference";
  const body = text.slice(0, 1000);

  return {
    name,
    description,
    type,
    body,
  };
};

const extractCandidatesByModel = async ({
  messages,
  llmExtract,
}: {
  messages: Array<{ role: string; content: unknown }>;
  llmExtract?: (input: { system: string; user: string }) => Promise<string>;
}): Promise<MemoryExtractionCandidate[] | null> => {
  if (!llmExtract) return null;

  const compactMessages = messages.slice(-12).map((item) => ({
    role: item.role,
    content: String(item.content || "").slice(0, 1200),
  }));
  const system = [
    "You are a memory extraction subagent for project memory.",
    "Extract durable cross-session facts only.",
    "Never output transient task state.",
    "Allowed types: user, feedback, project, reference.",
    "Return strict JSON only.",
    'Schema: {"memories":[{"name":"...","description":"...","type":"user|feedback|project|reference","body":"..."}]}',
    "Return 0-3 memories.",
  ].join("\n");
  const user = JSON.stringify(
    {
      recentMessages: compactMessages,
    },
    null,
    2
  );

  const answer = await llmExtract({ system, user }).catch(() => "");
  const parsed = parseJsonObject<{ memories?: unknown }>(answer);
  if (!parsed || !Array.isArray(parsed.memories)) return null;
  const memories = parsed.memories
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    .map((item) => {
      const name = typeof item.name === "string" ? item.name.trim() : "";
      const description = typeof item.description === "string" ? item.description.trim() : "";
      const type = normalizeType(typeof item.type === "string" ? item.type : "project");
      const body = typeof item.body === "string" ? item.body.trim() : "";
      if (!name || !description || !body) return null;
      return { name, description, type, body: body.slice(0, 2000) } as MemoryExtractionCandidate;
    })
    .filter((item): item is MemoryExtractionCandidate => Boolean(item))
    .slice(0, 3);
  return memories;
};

export const extractAndPersistProjectMemories = async ({
  projectToken,
  messages,
  llmExtract,
}: {
  projectToken: string;
  messages: Array<{ role: string; content: unknown }>;
  llmExtract?: (input: { system: string; user: string }) => Promise<string>;
}): Promise<ProjectMemoryUpdateResult> => {
  const modelCandidates = await extractCandidatesByModel({ messages, llmExtract });
  const fallbackCandidate = modelCandidates && modelCandidates.length > 0 ? null : buildCandidateFromMessages(messages);
  const candidates = modelCandidates && modelCandidates.length > 0 ? modelCandidates : fallbackCandidate ? [fallbackCandidate] : [];
  if (candidates.length === 0) {
    return {
      updated: false,
      writtenPaths: [],
    };
  }

  const { root, indexPath } = await ensureDir(projectToken);
  const writtenPaths: string[] = [];
  for (const candidate of candidates) {
    const fileName = `${toSlug(candidate.name)}.md`;
    const absPath = path.join(root, fileName);
    const fileContent = formatMemoryFile(candidate);

    await fs.writeFile(absPath, fileContent, "utf8");
    await upsertIndexEntry({
      indexPath,
      fileName,
      title: candidate.name,
      description: candidate.description,
    });
    writtenPaths.push(`/${fileName}`);
  }

  return {
    updated: writtenPaths.length > 0,
    writtenPaths,
  };
};

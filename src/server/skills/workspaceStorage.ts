import { getProject, updateFiles } from "@server/projects/projectStorage";

export type SkillWorkspaceFile = { code: string };

export type SkillWorkspace = {
  id: string;
  userId: string;
  projectToken: string;
  createdAt: string;
  updatedAt: string;
  files: Record<string, SkillWorkspaceFile>;
};

export type WorkspaceActionInput =
  | { action: "list" }
  | { action: "read"; path: string }
  | { action: "write"; path: string; content: string }
  | { action: "replace"; path: string; query: string; replace: string }
  | { action: "search"; query: string; limit?: number };

const SKILLS_ROOT = "/skills";

const normalizeSkillPath = (input: string) => {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("文件路径不能为空");
  const withSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  if (withSlash.includes("\\") || withSlash.includes("\0") || withSlash.includes("..")) {
    throw new Error("文件路径不安全");
  }
  if (!withSlash.startsWith(SKILLS_ROOT)) {
    throw new Error("仅允许操作 /skills 目录");
  }
  return withSlash;
};

const filterSkillFiles = (files: Record<string, { code: string }>): Record<string, SkillWorkspaceFile> =>
  Object.fromEntries(
    Object.entries(files)
      .filter(([filePath]) => filePath === SKILLS_ROOT || filePath.startsWith(`${SKILLS_ROOT}/`))
      .sort(([a], [b]) => a.localeCompare(b))
  );

const filterNonSkillFiles = (files: Record<string, { code: string }>) =>
  Object.fromEntries(
    Object.entries(files).filter(([filePath]) => !(filePath === SKILLS_ROOT || filePath.startsWith(`${SKILLS_ROOT}/`)))
  );

const ensureSkillReadme = async (projectToken: string, files: Record<string, { code: string }>) => {
  if (files[`${SKILLS_ROOT}/README.md`]) return files;
  const next = {
    ...files,
    [`${SKILLS_ROOT}/README.md`]: {
      code: [
        "# Skills",
        "",
        "Store project-bound skills here, for example:",
        "- /skills/my-skill/SKILL.md",
      ].join("\n"),
    },
  };
  await updateFiles(projectToken, next);
  return next;
};

const countOccurrences = (haystack: string, needle: string): number => {
  if (!needle) return 0;
  return haystack.split(needle).length - 1;
};

const replaceAll = (haystack: string, needle: string, replacement: string) => {
  if (!needle) throw new Error("替换内容不能为空");
  const count = countOccurrences(haystack, needle);
  const content = haystack.split(needle).join(replacement);
  return { content, count };
};

const collectMatches = (content: string, query: string, limit: number) => {
  const matches: Array<{ line: number; column: number; snippet: string }> = [];
  if (!query) return matches;
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    let index = line.indexOf(query);
    while (index !== -1) {
      matches.push({ line: i + 1, column: index + 1, snippet: line.trim().slice(0, 160) });
      if (matches.length >= limit) return matches;
      index = line.indexOf(query, index + query.length);
    }
  }
  return matches;
};

export const createSkillWorkspace = async (userId: string, projectToken: string): Promise<SkillWorkspace> => {
  const project = await getProject(projectToken);
  if (!project) throw new Error("项目不存在");
  if (project.userId !== userId) throw new Error("无权访问该项目");

  const files = await ensureSkillReadme(projectToken, project.files || {});
  return {
    id: projectToken,
    userId,
    projectToken,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    files: filterSkillFiles(files),
  };
};

export const requireSkillWorkspace = async (
  workspaceId: string,
  userId: string,
  projectToken?: string
) => {
  const token = (projectToken || workspaceId || "").trim();
  if (!token) throw new Error("缺少 projectToken");
  if (workspaceId && workspaceId !== token) {
    throw new Error("workspace 与项目不匹配");
  }
  const project = await getProject(token);
  if (!project) throw new Error("项目不存在");
  if (project.userId !== userId) throw new Error("无权访问该项目");
  return project;
};

export const getSkillWorkspace = async (
  workspaceId: string,
  userId: string,
  projectToken?: string
): Promise<SkillWorkspace> => {
  const project = await requireSkillWorkspace(workspaceId, userId, projectToken);
  const files = await ensureSkillReadme(project.token, project.files || {});
  return {
    id: project.token,
    userId: project.userId,
    projectToken: project.token,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    files: filterSkillFiles(files),
  };
};

export const writeSkillWorkspaceFile = async ({
  workspaceId,
  userId,
  projectToken,
  path,
  content,
}: {
  workspaceId: string;
  userId: string;
  projectToken?: string;
  path: string;
  content: string;
}) => {
  const project = await requireSkillWorkspace(workspaceId, userId, projectToken);
  const filePath = normalizeSkillPath(path);
  const nextFiles = {
    ...(project.files || {}),
    [filePath]: { code: content },
  };
  await updateFiles(project.token, nextFiles);
  return filterSkillFiles(nextFiles);
};

export const replaceSkillWorkspaceFiles = async ({
  workspaceId,
  userId,
  projectToken,
  files,
}: {
  workspaceId: string;
  userId: string;
  projectToken?: string;
  files: Record<string, SkillWorkspaceFile>;
}) => {
  const project = await requireSkillWorkspace(workspaceId, userId, projectToken);
  const normalizedSkillFiles = Object.fromEntries(
    Object.entries(files).map(([path, file]) => {
      const filePath = normalizeSkillPath(path);
      return [filePath, { code: typeof file?.code === "string" ? file.code : "" }];
    })
  );

  const mergedFiles = {
    ...filterNonSkillFiles(project.files || {}),
    ...normalizedSkillFiles,
  };
  await updateFiles(project.token, mergedFiles);
  return filterSkillFiles(mergedFiles);
};

export const runWorkspaceAction = async (workspaceId: string, input: WorkspaceActionInput) => {
  const project = await getProject(workspaceId);
  if (!project) throw new Error("项目不存在");

  const files = project.files || {};
  const skillFiles = filterSkillFiles(files);

  if (input.action === "list") {
    const paths = Object.keys(skillFiles).sort();
    return {
      ok: true,
      action: "list",
      message: `共 ${paths.length} 个文件。`,
      data: { files: paths },
    };
  }

  if (input.action === "read") {
    const filePath = normalizeSkillPath(input.path);
    const code = skillFiles[filePath]?.code || "";
    if (!code) {
      return { ok: false, action: "read", message: `未找到文件 ${filePath}` };
    }
    return {
      ok: true,
      action: "read",
      message: `已读取 ${filePath}`,
      data: { path: filePath, content: code },
    };
  }

  if (input.action === "write") {
    const filePath = normalizeSkillPath(input.path);
    const nextFiles = {
      ...files,
      [filePath]: { code: input.content },
    };
    await updateFiles(project.token, nextFiles);
    return {
      ok: true,
      action: "write",
      message: `已写入 ${filePath}`,
      data: { path: filePath },
      files: filterSkillFiles(nextFiles),
    };
  }

  if (input.action === "replace") {
    const filePath = normalizeSkillPath(input.path);
    const source = skillFiles[filePath]?.code || "";
    if (!source) {
      return { ok: false, action: "replace", message: `未找到文件 ${filePath}` };
    }
    const { content, count } = replaceAll(source, input.query, input.replace);
    const nextFiles = {
      ...files,
      [filePath]: { code: content },
    };
    await updateFiles(project.token, nextFiles);
    return {
      ok: true,
      action: "replace",
      message: `已在 ${filePath} 中替换 ${count} 处`,
      data: { path: filePath, replaced: count },
      files: filterSkillFiles(nextFiles),
    };
  }

  const query = input.query || "";
  if (!query) {
    return { ok: false, action: "search", message: "请提供 query" };
  }

  const limit = input.limit ?? 50;
  const results = Object.entries(skillFiles)
    .map(([filePath, file]) => ({
      path: filePath,
      matches: collectMatches(file.code, query, limit),
    }))
    .filter((item) => item.matches.length > 0);

  return {
    ok: true,
    action: "search",
    message: `搜索 "${query}" 完成`,
    data: { results },
  };
};

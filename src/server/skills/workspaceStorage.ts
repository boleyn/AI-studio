import { getProject, updateFiles } from "@server/projects/projectStorage";
import { createUserSkill, getUserSkill, updateUserSkill } from "@server/skills/skillStorage";

export type SkillWorkspaceFile = { code: string };

export type SkillWorkspace = {
  id: string;
  userId: string;
  source: "skill" | "project";
  projectToken?: string;
  skillId?: string;
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
const SKILL_FILE_PATTERN = /^\/skills\/.+\/SKILL\.md$/i;

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

const skillToFiles = (name: string, content: string): Record<string, SkillWorkspaceFile> => ({
  [`/skills/${name}/SKILL.md`]: {
    code: content,
  },
});

const pickSkillContentFromFiles = (files: Record<string, SkillWorkspaceFile>) => {
  const entry = Object.entries(files).find(([path]) => SKILL_FILE_PATTERN.test(path));
  if (!entry) {
    throw new Error("缺少 /skills/<skill-name>/SKILL.md 文件");
  }
  return {
    path: entry[0],
    content: typeof entry[1]?.code === "string" ? entry[1].code : "",
  };
};

const resolveWorkspace = async ({
  workspaceId,
  userId,
  projectToken,
  skillId,
}: {
  workspaceId: string;
  userId: string;
  projectToken?: string;
  skillId?: string;
}): Promise<SkillWorkspace> => {
  const safeWorkspaceId = workspaceId.trim();
  const safeProjectToken = (projectToken || "").trim();
  const safeSkillId = (skillId || "").trim();
  const preferSkillId = safeSkillId || (!safeProjectToken ? safeWorkspaceId : "");

  if (preferSkillId) {
    const skill = await getUserSkill({ token: preferSkillId, userId });
    if (skill) {
      return {
        id: skill.token,
        userId,
        source: "skill",
        skillId: skill.token,
        createdAt: skill.createdAt,
        updatedAt: skill.updatedAt,
        files: skillToFiles(skill.name, skill.content),
      };
    }
  }

  const token = safeProjectToken || safeWorkspaceId;
  if (!token) throw new Error("缺少 workspaceId");
  const project = await getProject(token);
  if (!project) throw new Error("workspace 不存在");
  if (project.userId !== userId) throw new Error("无权访问该 workspace");

  const files = await ensureSkillReadme(project.token, project.files || {});
  return {
    id: project.token,
    userId,
    source: "project",
    projectToken: project.token,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    files: filterSkillFiles(files),
  };
};

export const createSkillWorkspace = async ({
  userId,
  projectToken,
  skillId,
}: {
  userId: string;
  projectToken?: string;
  skillId?: string;
}): Promise<SkillWorkspace> => {
  const safeProjectToken = (projectToken || "").trim();
  const safeSkillId = (skillId || "").trim();

  if (!safeProjectToken && !safeSkillId) {
    const created = await createUserSkill({
      userId,
      sourceType: "custom",
      name: "new-skill",
    });
    return {
      id: created.token,
      userId,
      source: "skill",
      skillId: created.token,
      createdAt: created.createdAt,
      updatedAt: created.updatedAt,
      files: skillToFiles(created.name, created.content),
    };
  }

  return resolveWorkspace({
    workspaceId: safeSkillId || safeProjectToken,
    userId,
    projectToken: safeProjectToken || undefined,
    skillId: safeSkillId || undefined,
  });
};

export const getSkillWorkspace = async (
  workspaceId: string,
  userId: string,
  projectToken?: string,
  skillId?: string
): Promise<SkillWorkspace> => {
  return resolveWorkspace({
    workspaceId,
    userId,
    projectToken,
    skillId,
  });
};

export const writeSkillWorkspaceFile = async ({
  workspaceId,
  userId,
  projectToken,
  skillId,
  path,
  content,
}: {
  workspaceId: string;
  userId: string;
  projectToken?: string;
  skillId?: string;
  path: string;
  content: string;
}) => {
  const workspace = await resolveWorkspace({ workspaceId, userId, projectToken, skillId });
  normalizeSkillPath(path);

  if (workspace.source === "project") {
    throw new Error("项目绑定 workspace 为兼容只读模式，无法写入");
  }

  const updated = await updateUserSkill({
    token: workspace.skillId || workspace.id,
    userId,
    updates: {
      content,
    },
  });
  if (!updated) throw new Error("skill 不存在");
  return skillToFiles(updated.name, updated.content);
};

export const replaceSkillWorkspaceFiles = async ({
  workspaceId,
  userId,
  projectToken,
  skillId,
  files,
}: {
  workspaceId: string;
  userId: string;
  projectToken?: string;
  skillId?: string;
  files: Record<string, SkillWorkspaceFile>;
}) => {
  const workspace = await resolveWorkspace({ workspaceId, userId, projectToken, skillId });

  if (workspace.source === "project") {
    throw new Error("项目绑定 workspace 为兼容只读模式，无法写入");
  }

  const normalizedSkillFiles = Object.fromEntries(
    Object.entries(files).map(([filePath, file]) => {
      const nextPath = normalizeSkillPath(filePath);
      return [nextPath, { code: typeof file?.code === "string" ? file.code : "" }];
    })
  );

  const next = pickSkillContentFromFiles(normalizedSkillFiles);
  const updated = await updateUserSkill({
    token: workspace.skillId || workspace.id,
    userId,
    updates: {
      content: next.content,
    },
  });
  if (!updated) throw new Error("skill 不存在");
  return skillToFiles(updated.name, updated.content);
};

export const runWorkspaceAction = async (
  context: {
    workspaceId: string;
    userId: string;
    projectToken?: string;
    skillId?: string;
  },
  input: WorkspaceActionInput
) => {
  const workspace = await resolveWorkspace(context);
  const skillFiles = workspace.files;

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
    if (workspace.source === "project") {
      return { ok: false, action: "write", message: "项目绑定 workspace 为兼容只读模式，无法写入" };
    }
    const filePath = normalizeSkillPath(input.path);
    const updatedFiles = await writeSkillWorkspaceFile({
      workspaceId: workspace.id,
      userId: workspace.userId,
      skillId: workspace.skillId,
      path: filePath,
      content: input.content,
    });
    return {
      ok: true,
      action: "write",
      message: `已写入 ${filePath}`,
      data: { path: filePath },
      files: updatedFiles,
    };
  }

  if (input.action === "replace") {
    if (workspace.source === "project") {
      return { ok: false, action: "replace", message: "项目绑定 workspace 为兼容只读模式，无法写入" };
    }
    const filePath = normalizeSkillPath(input.path);
    const source = skillFiles[filePath]?.code || "";
    if (!source) {
      return { ok: false, action: "replace", message: `未找到文件 ${filePath}` };
    }
    const { content, count } = replaceAll(source, input.query, input.replace);
    const updatedFiles = await writeSkillWorkspaceFile({
      workspaceId: workspace.id,
      userId: workspace.userId,
      skillId: workspace.skillId,
      path: filePath,
      content,
    });
    return {
      ok: true,
      action: "replace",
      message: `已在 ${filePath} 中替换 ${count} 处`,
      data: { path: filePath, replaced: count },
      files: updatedFiles,
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

export { filterNonSkillFiles, filterSkillFiles };

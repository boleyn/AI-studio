type HubSkillDetailPayload = {
  skill?: {
    slug?: string;
    displayName?: string;
    summary?: string | null;
  };
  latestVersion?: {
    version?: string;
    readmeText?: string | null;
    files?: Array<{ path?: string; size?: number }>;
  };
};

export type HubSkillDetail = {
  slug: string;
  displayName: string;
  summary: string;
  latestVersion: {
    version: string;
    readmeText: string;
    files: string[];
    fileContents: Record<string, string>;
  };
};

const MAX_INLINE_FILE_BYTES = 512 * 1024;

const normalizeSkillName = (raw: string) =>
  raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "") || "imported-skill";

const sanitizeRelativePath = (rawPath: string) => {
  const normalized = rawPath.replace(/\\/g, "/").replace(/^\/+/, "").trim();
  if (!normalized || normalized.includes("..")) return "";
  return normalized;
};

const stripFrontmatter = (content: string) => {
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!normalized.startsWith("---")) return normalized;
  const match = normalized.match(/^---\s*\n[\s\S]*?\n---\s*\n?/);
  if (!match) return normalized;
  return normalized.slice(match[0].length);
};

const buildSkillMd = (skillName: string, description: string, rawCode: string) => {
  const body = stripFrontmatter(rawCode || "").trim() || "# Skill";
  const safeDescription = description.trim() || "Imported from ClawHub";
  return ["---", `name: ${skillName}`, `description: ${JSON.stringify(safeDescription)}`, "---", "", body, ""].join(
    "\n"
  );
};

export const fetchHubSkillDetail = async (slug: string): Promise<HubSkillDetail> => {
  const hubBase = process.env.SKILL_HUB?.trim();
  if (!hubBase) throw new Error("SKILL_HUB 未配置");
  const token = process.env.SKILL_TOKEN?.trim();
  const safeSlug = slug.trim().toLowerCase();
  if (!safeSlug) throw new Error("缺少 hubSlug");

  const apiUrl = `${hubBase.replace(/\/+$/, "")}/api/v1/skills/${encodeURIComponent(safeSlug)}`;
  const response = await fetch(apiUrl, {
    method: "GET",
    headers: {
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  const payload = (await response.json().catch(() => ({}))) as HubSkillDetailPayload;
  if (!response.ok) {
    throw new Error(`读取 ClawHub 技能详情失败（${response.status}）`);
  }

  const version = payload.latestVersion?.version?.trim() || "1.0.0";
  const rawFiles = Array.isArray(payload.latestVersion?.files) ? payload.latestVersion?.files : [];
  const files = rawFiles
    .map((item) => ({
      path: typeof item?.path === "string" ? item.path.trim() : "",
      size: typeof item?.size === "number" ? item.size : 0,
    }))
    .filter((item) => Boolean(item.path));

  const fileContents: Record<string, string> = {};
  await Promise.all(
    files.map(async (item) => {
      if (item.size > MAX_INLINE_FILE_BYTES) {
        fileContents[item.path] = `[文件过大，已跳过预览：${item.size} bytes]`;
        return;
      }
      const downloadUrl =
        `${hubBase.replace(/\/+$/, "")}/api/v1/download?namespace=skills` +
        `&slug=${encodeURIComponent(safeSlug)}` +
        `&version=${encodeURIComponent(version)}` +
        `&path=${encodeURIComponent(item.path)}`;
      try {
        const fileResp = await fetch(downloadUrl, {
          method: "GET",
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        });
        if (!fileResp.ok) {
          fileContents[item.path] = "";
          return;
        }
        const buf = await fileResp.arrayBuffer();
        fileContents[item.path] = new TextDecoder("utf-8").decode(buf);
      } catch {
        fileContents[item.path] = "";
      }
    })
  );

  return {
    slug: payload.skill?.slug || safeSlug,
    displayName: payload.skill?.displayName || payload.skill?.slug || safeSlug,
    summary: payload.skill?.summary || "",
    latestVersion: {
      version,
      readmeText: payload.latestVersion?.readmeText || "",
      files: files.map((item) => item.path),
      fileContents,
    },
  };
};

export const buildWorkspaceFilesFromHubSkill = (detail: HubSkillDetail) => {
  const skillName = normalizeSkillName(detail.slug || detail.displayName || "imported-skill");
  const files: Record<string, { code: string }> = {};
  for (const relPathRaw of detail.latestVersion.files || []) {
    const relPath = sanitizeRelativePath(relPathRaw);
    if (!relPath) continue;
    files[`/skills/${skillName}/${relPath}`] = {
      code: detail.latestVersion.fileContents?.[relPath] || "",
    };
  }
  const skillMdPath = `/skills/${skillName}/SKILL.md`;
  const existingSkillMd =
    files[skillMdPath]?.code || detail.latestVersion.fileContents?.["SKILL.md"] || detail.latestVersion.readmeText || "";
  files[skillMdPath] = {
    code: buildSkillMd(skillName, detail.summary || detail.displayName || "", existingSkillMd),
  };
  return {
    name: skillName,
    description: detail.summary || detail.displayName || "Imported from ClawHub",
    files,
  };
};

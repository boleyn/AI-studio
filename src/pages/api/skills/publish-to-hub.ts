import { createHash } from "crypto";
import yaml from "js-yaml";
import type { NextApiRequest, NextApiResponse } from "next";

import { requireAuth } from "@server/auth/session";
import { getSkillWorkspace } from "@server/skills/workspaceStorage";

type WorkspaceFileMap = Record<string, { code: string }>;

type PublishRequest = {
  workspaceId?: string;
  projectToken?: string;
  skillId?: string;
  preview?: boolean;
  slug?: string;
  displayName?: string;
  summary?: string;
  tags?: string[] | string;
  changelog?: string;
  version?: string;
};

type ParsedFrontmatter = {
  name?: string;
  description?: string;
  tags?: string[] | string;
  changelog?: string;
};

const INTERNAL_SKILL_FILE_PATTERN = /^\/skills\/([^/]+)\/SKILL\.md$/i;
const PUBLIC_SKILL_FILE_PATTERN = /^\/([^/]+)\/SKILL\.md$/i;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:[-+].*)?$/;

const toPatchVersion = (latest?: string) => {
  const normalized = (latest || "").trim();
  const matched = normalized.match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  if (!matched) return "1.0.0";
  const major = Number.parseInt(matched[1], 10);
  const minor = Number.parseInt(matched[2], 10);
  const patch = Number.parseInt(matched[3], 10);
  if (![major, minor, patch].every((value) => Number.isFinite(value) && value >= 0)) return "1.0.0";
  return `${major}.${minor}.${patch + 1}`;
};

const parseFrontmatter = (content: string): ParsedFrontmatter => {
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const match = normalized.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (!match) return {};
  try {
    const parsed = yaml.load(match[1]);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const data = parsed as Record<string, unknown>;
    return {
      name: typeof data.name === "string" ? data.name.trim() : undefined,
      description: typeof data.description === "string" ? data.description.trim() : undefined,
      tags: Array.isArray(data.tags)
        ? data.tags.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean)
        : typeof data.tags === "string"
        ? data.tags.trim()
        : undefined,
      changelog: typeof data.changelog === "string" ? data.changelog.trim() : undefined,
    };
  } catch {
    return {};
  }
};

const normalizeSlug = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "") || "imported-skill";

const normalizeTagList = (tags: ParsedFrontmatter["tags"]) => {
  if (!tags) return ["latest"];
  if (Array.isArray(tags)) return tags.length > 0 ? tags : ["latest"];
  const parsed = tags
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 8);
  return parsed.length > 0 ? parsed : ["latest"];
};

const normalizeTagInput = (tags: PublishRequest["tags"], fallback: string[]) => {
  if (Array.isArray(tags)) {
    const parsed = tags.map((item) => String(item).trim()).filter(Boolean).slice(0, 8);
    return parsed.length > 0 ? parsed : fallback;
  }
  if (typeof tags === "string") {
    const parsed = tags
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 8);
    return parsed.length > 0 ? parsed : fallback;
  }
  return fallback;
};

const getHubLatestVersion = async (hubBase: string, token: string | undefined, slug: string) => {
  const apiUrl = `${hubBase.replace(/\/+$/, "")}/api/v1/skills/${encodeURIComponent(slug)}`;
  const response = await fetch(apiUrl, {
    method: "GET",
    headers: {
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (response.status === 404) return "";
  if (!response.ok) {
    throw new Error(`读取 ClawHub 版本信息失败（${response.status}）`);
  }
  const payload = (await response.json().catch(() => ({}))) as {
    latestVersion?: { version?: string };
  };
  return payload.latestVersion?.version?.trim() || "";
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    res.status(405).json({ error: `方法 ${req.method} 不被允许` });
    return;
  }

  const auth = await requireAuth(req, res);
  if (!auth) return;
  const userId = auth.user._id != null ? String(auth.user._id) : "";
  if (!userId) {
    res.status(401).json({ error: "用户身份无效" });
    return;
  }

  const body = (req.body || {}) as PublishRequest;
  const isPreview = Boolean(body.preview);
  const workspaceId = typeof body.workspaceId === "string" ? body.workspaceId.trim() : "";
  const projectToken = typeof body.projectToken === "string" ? body.projectToken.trim() : "";
  const skillId = typeof body.skillId === "string" ? body.skillId.trim() : "";
  if (!workspaceId) {
    res.status(400).json({ error: "缺少 workspaceId" });
    return;
  }

  const hubBase = process.env.SKILL_HUB?.trim();
  if (!hubBase) {
    res.status(500).json({ error: "SKILL_HUB 未配置" });
    return;
  }
  const token = process.env.SKILL_TOKEN?.trim();

  try {
    const workspace = await getSkillWorkspace(workspaceId, userId, projectToken || undefined, skillId || undefined);
    const files = (workspace.files || {}) as WorkspaceFileMap;

    const skillEntry = Object.entries(files).find(([path]) => {
      return INTERNAL_SKILL_FILE_PATTERN.test(path) || PUBLIC_SKILL_FILE_PATTERN.test(path);
    });
    if (!skillEntry) {
      res.status(400).json({ error: "未找到 /<slug>/SKILL.md" });
      return;
    }
    const skillPath = skillEntry[0];
    const skillContent = skillEntry[1]?.code || "";
    const internalMatched = skillPath.match(INTERNAL_SKILL_FILE_PATTERN);
    const publicMatched = skillPath.match(PUBLIC_SKILL_FILE_PATTERN);
    const skillDirName = internalMatched?.[1] || publicMatched?.[1] || "";
    const frontmatter = parseFrontmatter(skillContent);
    const slug = normalizeSlug(frontmatter.name || skillDirName || "imported-skill");
    const displayName = frontmatter.name?.trim() || slug;
    const summary = frontmatter.description?.trim() || "Published from AI Studio";
    const tags = normalizeTagList(frontmatter.tags);
    const changelog = frontmatter.changelog || "Published from AI Studio";
    const latestVersion = await getHubLatestVersion(hubBase, token, slug);
    const nextVersion = toPatchVersion(latestVersion);

    const chosenSlug = normalizeSlug(typeof body.slug === "string" ? body.slug : slug);
    const chosenDisplayName = typeof body.displayName === "string" && body.displayName.trim() ? body.displayName.trim() : displayName;
    const chosenSummary = typeof body.summary === "string" && body.summary.trim() ? body.summary.trim() : summary;
    const chosenTags = normalizeTagInput(body.tags, tags);
    const chosenChangelog =
      typeof body.changelog === "string" && body.changelog.trim() ? body.changelog.trim() : changelog;
    const chosenVersionRaw =
      typeof body.version === "string" && body.version.trim() ? body.version.trim() : nextVersion;
    if (!SEMVER_PATTERN.test(chosenVersionRaw)) {
      res.status(400).json({ error: "version 必须是合法 semver" });
      return;
    }

    const skillFiles = Object.entries(files)
      .map(([path, file]) => {
        if (!skillDirName) return null;
        const internalPrefix = `/skills/${skillDirName}/`;
        const publicPrefix = `/${skillDirName}/`;
        if (path.startsWith(internalPrefix)) {
          return {
            relativePath: path.slice(internalPrefix.length),
            content: typeof file?.code === "string" ? file.code : "",
          };
        }
        if (!path.startsWith(publicPrefix)) return null;
        return {
          relativePath: path.slice(publicPrefix.length),
          content: typeof file?.code === "string" ? file.code : "",
        };
      })
      .filter((item): item is { relativePath: string; content: string } => Boolean(item?.relativePath));

    if (skillFiles.length === 0) {
      res.status(400).json({ error: "没有可发布的 skill 文件" });
      return;
    }

    if (isPreview) {
      res.status(200).json({
        ok: true,
        preview: {
          slug: chosenSlug,
          displayName: chosenDisplayName,
          summary: chosenSummary,
          tags: chosenTags,
          changelog: chosenChangelog,
          latestVersion,
          nextVersion,
          version: chosenVersionRaw,
          fileCount: skillFiles.length,
        },
      });
      return;
    }

    const uploaded: Array<{
      path: string;
      size: number;
      storageId: string;
      sha256: string;
      contentType?: string;
    }> = [];

    for (const file of skillFiles) {
      const contentBuffer = Buffer.from(file.content, "utf-8");
      const form = new FormData();
      form.set("namespace", "skills");
      form.set("slug", chosenSlug);
      form.set("version", chosenVersionRaw);
      form.set("path", file.relativePath);
      form.set("visibility", "public");
      form.set("file", new Blob([contentBuffer], { type: "text/plain; charset=utf-8" }), file.relativePath);

      const uploadResp = await fetch(`${hubBase.replace(/\/+$/, "")}/api/v1/uploads`, {
        method: "POST",
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: form,
      });
      const uploadPayload = (await uploadResp.json().catch(() => ({}))) as {
        storageId?: string;
        error?: string;
        statusMessage?: string;
      };
      if (!uploadResp.ok || !uploadPayload.storageId) {
        throw new Error(uploadPayload.error || uploadPayload.statusMessage || "上传文件失败");
      }
      uploaded.push({
        path: file.relativePath,
        size: contentBuffer.byteLength,
        storageId: uploadPayload.storageId,
        sha256: createHash("sha256").update(contentBuffer).digest("hex"),
        contentType: "text/plain",
      });
    }

    const publishResp = await fetch(`${hubBase.replace(/\/+$/, "")}/api/v1/skills/publish`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        slug: chosenSlug,
        displayName: chosenDisplayName,
        summary: chosenSummary,
        version: chosenVersionRaw,
        changelog: chosenChangelog,
        tags: chosenTags,
        files: uploaded,
      }),
    });
    const publishPayload = (await publishResp.json().catch(() => ({}))) as {
      error?: string;
      statusMessage?: string;
      owner?: { handle?: string | null };
    };
    if (!publishResp.ok) {
      throw new Error(publishPayload.error || publishPayload.statusMessage || "发布失败");
    }

    const ownerHandle = publishPayload.owner?.handle?.trim() || "";
    const skillUrl = ownerHandle ? `${hubBase.replace(/\/+$/, "")}/${ownerHandle}/${chosenSlug}` : "";

    res.status(200).json({
      ok: true,
      slug: chosenSlug,
      version: chosenVersionRaw,
      skillUrl,
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "发布到 ClawHub 失败",
    });
  }
}

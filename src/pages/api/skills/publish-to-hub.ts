import { createHash } from "crypto";
import yaml from "js-yaml";
import type { NextApiRequest, NextApiResponse } from "next";

import { requireAuth } from "@server/auth/session";
import { markUserSkillPublished } from "@server/skills/skillStorage";
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

type HubSkillDetailPayload = {
  skill?: {
    slug?: string;
    ownerUserId?: string | null;
  };
  owner?: {
    handle?: string | null;
    displayName?: string | null;
    name?: string | null;
  } | null;
  latestVersion?: {
    version?: string;
    files?: Array<{ path?: string; size?: number }>;
  };
  permissions?: {
    canUpdate?: boolean;
  };
  canUpdate?: boolean;
  statusMessage?: string;
  error?: string;
};

type PublishDiffStatus = "added" | "removed" | "changed" | "same";
type PublishDiffItem = {
  path: string;
  status: PublishDiffStatus;
  localCode: string;
  incomingCode: string;
};

type PublishDiffPayload = {
  files: PublishDiffItem[];
  summary: {
    added: number;
    removed: number;
    changed: number;
    same: number;
  };
};

type HubSkillSnapshot = {
  exists: boolean;
  latestVersion: string;
  ownerName: string;
  ownerHandle: string;
  ownerUserId: string;
  canUpdateFromHub: boolean | null;
  files: Record<string, string>;
};

const INTERNAL_SKILL_FILE_PATTERN = /^\/skills\/([^/]+)\/SKILL\.md$/i;
const PUBLIC_SKILL_FILE_PATTERN = /^\/([^/]+)\/SKILL\.md$/i;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:[-+].*)?$/;
const FEISHU_OPEN_ID_HEADER = "X-ClawHub-Feishu-Open-Id";
const FEISHU_UNION_ID_HEADER = "X-ClawHub-Feishu-Union-Id";
const PROXY_SECRET_HEADER = "X-ClawHub-Proxy-Secret";
const MAX_INLINE_FILE_BYTES = 512 * 1024;

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

const normalizeCodeForCompare = (code: string) => code.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");

const buildPublishDiff = (
  localFiles: Record<string, string>,
  incomingFiles: Record<string, string>
): PublishDiffPayload => {
  const paths = Array.from(new Set([...Object.keys(localFiles), ...Object.keys(incomingFiles)])).sort((a, b) =>
    a.localeCompare(b)
  );

  const rank: Record<PublishDiffStatus, number> = {
    changed: 0,
    added: 1,
    removed: 2,
    same: 3,
  };

  const files = paths
    .map((path) => {
      const localCode = localFiles[path] || "";
      const incomingCode = incomingFiles[path] || "";
      const normalizedLocal = normalizeCodeForCompare(localCode);
      const normalizedIncoming = normalizeCodeForCompare(incomingCode);
      let status: PublishDiffStatus = "same";
      if (path in localFiles && !(path in incomingFiles)) status = "removed";
      else if (!(path in localFiles) && path in incomingFiles) status = "added";
      else if (normalizedLocal !== normalizedIncoming) status = "changed";
      return {
        path,
        status,
        localCode,
        incomingCode,
      };
    })
    .sort((a, b) => {
      const diff = rank[a.status] - rank[b.status];
      if (diff !== 0) return diff;
      return a.path.localeCompare(b.path);
    });

  return {
    files,
    summary: {
      added: files.filter((item) => item.status === "added").length,
      removed: files.filter((item) => item.status === "removed").length,
      changed: files.filter((item) => item.status === "changed").length,
      same: files.filter((item) => item.status === "same").length,
    },
  };
};

const toRelativeSkillFiles = (
  files: WorkspaceFileMap,
  skillDirName: string
): Array<{ relativePath: string; content: string }> => {
  return Object.entries(files)
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
};

const toSkillFileMap = (files: Array<{ relativePath: string; content: string }>) => {
  const mapped: Record<string, string> = {};
  files.forEach((item) => {
    mapped[item.relativePath] = item.content;
  });
  return mapped;
};

const buildClawHubPublishHeaders = (input: {
  proxySecret?: string;
  feishuOpenId?: string;
  feishuUnionId?: string;
}) => {
  const headers: Record<string, string> = {};
  if (input.proxySecret && (input.feishuOpenId || input.feishuUnionId)) {
    headers[PROXY_SECRET_HEADER] = input.proxySecret;
    if (input.feishuOpenId) {
      headers[FEISHU_OPEN_ID_HEADER] = input.feishuOpenId;
    }
    if (input.feishuUnionId) {
      headers[FEISHU_UNION_ID_HEADER] = input.feishuUnionId;
    }
  }
  return headers;
};

const buildClawHubReadHeaders = (proxySecret: string) => ({
  [PROXY_SECRET_HEADER]: proxySecret,
});

const maskIdentity = (value?: string) => {
  const v = typeof value === "string" ? value.trim() : "";
  if (!v) return "(empty)";
  if (v.length <= 8) return `${v.slice(0, 2)}***${v.slice(-2)}`;
  return `${v.slice(0, 4)}***${v.slice(-4)}`;
};

const resolveResponseMessage = (payload: unknown, fallback: string) => {
  if (!payload) return fallback;
  if (typeof payload === "string") return payload.trim() || fallback;
  if (typeof payload === "boolean") return fallback;
  if (typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    const candidates = [record.error, record.statusMessage, record.message, record.detail]
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean);
    if (candidates[0]) return candidates[0];
  }
  return fallback;
};

const fetchHubSkillSnapshot = async (input: {
  hubBase: string;
  slug: string;
  readHeaders: Record<string, string>;
}): Promise<HubSkillSnapshot> => {
  const apiUrl = `${input.hubBase.replace(/\/+$/, "")}/api/v1/skills/${encodeURIComponent(input.slug)}`;
  const response = await fetch(apiUrl, {
    method: "GET",
    headers: {
      Accept: "application/json",
      ...input.readHeaders,
    },
  });

  if (response.status === 404) {
    return {
      exists: false,
      latestVersion: "",
      ownerName: "",
      ownerHandle: "",
      ownerUserId: "",
      canUpdateFromHub: null,
      files: {},
    };
  }

  const payload = (await response.json().catch(() => ({}))) as HubSkillDetailPayload;
  if (!response.ok) {
    throw new Error(resolveResponseMessage(payload, `读取 ClawHub 技能信息失败（${response.status}）`));
  }

  const latestVersion = payload.latestVersion?.version?.trim() || "";
  const ownerUserId = typeof payload.skill?.ownerUserId === "string" ? payload.skill.ownerUserId.trim() : "";
  const ownerHandle = payload.owner?.handle?.trim() || "";
  const ownerName = payload.owner?.displayName?.trim() || payload.owner?.name?.trim() || ownerHandle || "原作者";

  const canUpdateRaw =
    typeof payload.canUpdate === "boolean"
      ? payload.canUpdate
      : typeof payload.permissions?.canUpdate === "boolean"
      ? payload.permissions.canUpdate
      : null;

  const files: Record<string, string> = {};
  const fileEntries = Array.isArray(payload.latestVersion?.files)
    ? payload.latestVersion.files
        .map((item) => ({
          path: typeof item?.path === "string" ? item.path.trim() : "",
          size: typeof item?.size === "number" ? item.size : 0,
        }))
        .filter((item) => Boolean(item.path))
    : [];

  await Promise.all(
    fileEntries.map(async (item) => {
      if (item.size > MAX_INLINE_FILE_BYTES) {
        files[item.path] = "";
        return;
      }
      const downloadUrl =
        `${input.hubBase.replace(/\/+$/, "")}/api/v1/download?namespace=skills` +
        `&slug=${encodeURIComponent(input.slug)}` +
        `&version=${encodeURIComponent(latestVersion)}` +
        `&path=${encodeURIComponent(item.path)}`;
      try {
        const fileResp = await fetch(downloadUrl, {
          method: "GET",
          headers: input.readHeaders,
        });
        if (!fileResp.ok) {
          files[item.path] = "";
          return;
        }
        const buf = await fileResp.arrayBuffer();
        files[item.path] = new TextDecoder("utf-8").decode(buf);
      } catch {
        files[item.path] = "";
      }
    })
  );

  return {
    exists: true,
    latestVersion,
    ownerName,
    ownerHandle,
    ownerUserId,
    canUpdateFromHub: canUpdateRaw,
    files,
  };
};

const resolveCanUpdate = (_snapshot: HubSkillSnapshot, _feishuOpenId: string) => true;

const waitForPublishedVersion = async (input: {
  hubBase: string;
  slug: string;
  readHeaders: Record<string, string>;
  expectedVersion: string;
  attempts?: number;
  intervalMs?: number;
}) => {
  const attempts = Math.max(1, input.attempts || 4);
  const intervalMs = Math.max(50, input.intervalMs || 450);

  for (let index = 0; index < attempts; index += 1) {
    const snapshot = await fetchHubSkillSnapshot({
      hubBase: input.hubBase,
      slug: input.slug,
      readHeaders: input.readHeaders,
    });
    if (snapshot.latestVersion === input.expectedVersion) {
      return true;
    }
    if (index < attempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  return false;
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
  const proxySecret = process.env.SKILL_HUB_PROXY_SECRET?.trim();
  const feishuOpenId = typeof auth.user.feishuOpenId === "string" ? auth.user.feishuOpenId.trim() : "";
  const feishuUnionId = typeof auth.user.feishuUnionId === "string" ? auth.user.feishuUnionId.trim() : "";
  if (!proxySecret) {
    res.status(500).json({ error: "SKILL_HUB_PROXY_SECRET 未配置" });
    return;
  }
  if (!feishuOpenId && !feishuUnionId) {
    res.status(400).json({ error: "当前账号缺少飞书身份标识（open_id/union_id），请重新使用飞书登录后再发布" });
    return;
  }

  const hubAuthHeaders = buildClawHubPublishHeaders({
    proxySecret,
    feishuOpenId,
    feishuUnionId,
  });
  const hubReadHeaders = buildClawHubReadHeaders(proxySecret);

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

    const inferredSlug = normalizeSlug(frontmatter.name || skillDirName || "imported-skill");
    const chosenSlug = normalizeSlug(typeof body.slug === "string" ? body.slug : inferredSlug);

    const snapshot = await fetchHubSkillSnapshot({
      hubBase,
      slug: chosenSlug,
      readHeaders: hubReadHeaders,
    });

    const displayName = frontmatter.name?.trim() || inferredSlug;
    const summary = frontmatter.description?.trim() || "Published from AI Studio";
    const tags = normalizeTagList(frontmatter.tags);
    const changelog = frontmatter.changelog || "Published from AI Studio";
    const nextVersion = toPatchVersion(snapshot.latestVersion);

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

    if (snapshot.exists && snapshot.latestVersion && chosenVersionRaw === snapshot.latestVersion) {
      res.status(400).json({ error: "版本号与线上一致，请先递增版本再发布" });
      return;
    }

    const canUpdate = resolveCanUpdate(snapshot, feishuOpenId);
    const skillFiles = toRelativeSkillFiles(files, skillDirName);
    if (skillFiles.length === 0) {
      res.status(400).json({ error: "没有可发布的 skill 文件" });
      return;
    }

    const publishDiff = snapshot.exists ? buildPublishDiff(toSkillFileMap(skillFiles), snapshot.files) : buildPublishDiff(toSkillFileMap(skillFiles), {});

    if (isPreview) {
      res.status(200).json({
        ok: true,
        preview: {
          slug: chosenSlug,
          displayName: chosenDisplayName,
          summary: chosenSummary,
          tags: chosenTags,
          changelog: chosenChangelog,
          latestVersion: snapshot.latestVersion,
          nextVersion,
          version: chosenVersionRaw,
          fileCount: skillFiles.length,
          hubStatus: {
            exists: snapshot.exists,
            canUpdate,
            ownerName: snapshot.ownerName,
            ownerHandle: snapshot.ownerHandle,
          },
          publishDiff,
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
        headers: hubAuthHeaders,
        body: form,
      });
      const uploadPayload = await uploadResp.json().catch(() => null);
      if (!uploadResp.ok || !uploadPayload || typeof uploadPayload !== "object" || !("storageId" in uploadPayload)) {
        throw new Error(resolveResponseMessage(uploadPayload, "上传文件失败"));
      }
      const storageId = typeof (uploadPayload as { storageId?: unknown }).storageId === "string"
        ? (uploadPayload as { storageId: string }).storageId
        : "";
      if (!storageId) {
        throw new Error("上传文件失败");
      }
      uploaded.push({
        path: file.relativePath,
        size: contentBuffer.byteLength,
        storageId,
        sha256: createHash("sha256").update(contentBuffer).digest("hex"),
        contentType: "text/plain",
      });
    }

    const publishResp = await fetch(`${hubBase.replace(/\/+$/, "")}/api/v1/skills/publish`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...hubAuthHeaders,
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
    const publishPayload = await publishResp.json().catch(() => null);
    if (!publishResp.ok) {
      const message = resolveResponseMessage(publishPayload, "发布失败");
      if (/No ClawHub user is linked to this Feishu open_id\/union_id/i.test(message)) {
        res.status(400).json({
          error:
            "ClawHub 未找到与你当前飞书身份绑定的用户，请先在 ClawHub 完成同一飞书账号登录/绑定后再发布。" +
            `（当前 open_id=${maskIdentity(feishuOpenId)}, union_id=${maskIdentity(feishuUnionId)}）`,
        });
        return;
      }
      if (publishResp.status === 409) {
        const ownerName = snapshot.ownerName || snapshot.ownerHandle || "原作者";
        res.status(409).json({
          error: message || `该 slug 发布冲突（归属：${ownerName}），请稍后重试`,
          canUpdate,
          ownerName,
          ownerHandle: snapshot.ownerHandle,
        });
        return;
      }
      throw new Error(message);
    }

    const synced = await waitForPublishedVersion({
      hubBase,
      slug: chosenSlug,
      readHeaders: hubReadHeaders,
      expectedVersion: chosenVersionRaw,
      attempts: 5,
      intervalMs: 500,
    });
    if (!synced) {
      throw new Error("ClawHub 尚未同步到目标版本，请稍后刷新后重试");
    }

    const ownerHandle =
      publishPayload && typeof publishPayload === "object" && "owner" in publishPayload
        ? ((publishPayload as { owner?: { handle?: string | null } }).owner?.handle?.trim() || "")
        : snapshot.ownerHandle;
    const skillUrl = ownerHandle ? `${hubBase.replace(/\/+$/, "")}/${ownerHandle}/${chosenSlug}` : "";

    if (skillId) {
      try {
        await markUserSkillPublished({
          token: skillId,
          userId,
          version: chosenVersionRaw,
        });
      } catch {
        // Ignore local marker failure to avoid blocking successful hub publish.
      }
    }

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

import { createSkillWorkspace } from "@server/skills/workspaceStorage";
import { requireAuth } from "@server/auth/session";
import { getProject } from "@server/projects/projectStorage";
import { createUserSkill, getUserSkill, listUserSkills, updateUserSkill } from "@server/skills/skillStorage";
import { buildWorkspaceFilesFromHubSkill, fetchHubSkillDetail } from "@server/skills/hubBridge";
import { toWorkspacePublicFiles } from "@server/skills/workspaceStorage";
import type { NextApiRequest, NextApiResponse } from "next";

const toMetaVersion = (files: Record<string, { code: string }>, skillName: string) => {
  const candidates = [`/skills/${skillName}/_meta.json`, `/${skillName}/_meta.json`];
  for (const path of candidates) {
    const raw = files[path]?.code;
    if (!raw || typeof raw !== "string") continue;
    try {
      const parsed = JSON.parse(raw) as { version?: unknown };
      if (typeof parsed.version === "string" && parsed.version.trim()) {
        return parsed.version.trim();
      }
    } catch {
      continue;
    }
  }
  return "";
};

type DiffStatus = "added" | "removed" | "changed" | "same";
const isRuntimeSupportPath = (path: string) =>
  /^\/__skill_runtime__(\/|$)/i.test(path) || /^\/skills\/__skill_runtime__(\/|$)/i.test(path);
const normalizeCodeForCompare = (code: string) => code.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");

const buildImportDiff = (
  localFiles: Record<string, { code: string }>,
  incomingFiles: Record<string, { code: string }>
) => {
  const paths = Array.from(
    new Set([...Object.keys(localFiles), ...Object.keys(incomingFiles)].filter((path) => !isRuntimeSupportPath(path)))
  ).sort((a, b) => a.localeCompare(b));

  const statusRank: Record<DiffStatus, number> = {
    changed: 0,
    added: 1,
    removed: 2,
    same: 3,
  };

  const files = paths
    .map((path) => {
      const localCode = localFiles[path]?.code || "";
      const incomingCode = incomingFiles[path]?.code || "";
      const normalizedLocalCode = normalizeCodeForCompare(localCode);
      const normalizedIncomingCode = normalizeCodeForCompare(incomingCode);
      let status: DiffStatus = "same";
      if (path in localFiles && !(path in incomingFiles)) status = "removed";
      else if (!(path in localFiles) && path in incomingFiles) status = "added";
      else if (normalizedLocalCode !== normalizedIncomingCode) status = "changed";
      return {
        path,
        status,
        localCode,
        incomingCode,
      };
    })
    .sort((a, b) => {
      const diff = statusRank[a.status] - statusRank[b.status];
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
  const projectToken = typeof req.body?.projectToken === "string" ? req.body.projectToken.trim() : "";
  const skillId = typeof req.body?.skillId === "string" ? req.body.skillId.trim() : "";
  const hubSlug = typeof req.body?.hubSlug === "string" ? req.body.hubSlug.trim().toLowerCase() : "";
  const hubKey = typeof req.body?.hubKey === "string" ? req.body.hubKey.trim() : "";
  const importStrategy = typeof req.body?.importStrategy === "string" ? req.body.importStrategy.trim() : "";
  const targetSkillId = typeof req.body?.targetSkillId === "string" ? req.body.targetSkillId.trim() : "";

  if (hubSlug) {
    const expectedKey = process.env.AI_STUDIO_KEY?.trim();
    if (!expectedKey) {
      res.status(500).json({ error: "AI_STUDIO_KEY 未配置" });
      return;
    }
    if (!hubKey || hubKey !== expectedKey) {
      res.status(403).json({ error: "无效的 AI_STUDIO_KEY" });
      return;
    }

    try {
      const hubDetail = await fetchHubSkillDetail(hubSlug);
      const normalized = buildWorkspaceFilesFromHubSkill(hubDetail);
      const userSkills = await listUserSkills({ userId, query: normalized.name });
      const sameNameSkill = userSkills.find((item) => item.name.toLowerCase() === normalized.name.toLowerCase()) || null;
      const incomingVersion = toMetaVersion(normalized.files, normalized.name) || hubDetail.latestVersion.version || "";
      const incomingPublicFiles = toWorkspacePublicFiles(normalized.files as Record<string, { code: string }>);

      if (sameNameSkill) {
        const existing = await getUserSkill({
          token: targetSkillId || sameNameSkill.token,
          userId,
        });
        if (!existing) {
          res.status(404).json({ error: "同名 skill 不存在或无权限访问" });
          return;
        }

        const existingFiles = (existing.files || {}) as Record<string, { code: string }>;
        const existingPublicFiles = toWorkspacePublicFiles(existingFiles);
        const importDiff = buildImportDiff(existingPublicFiles, incomingPublicFiles);
        const localVersion = toMetaVersion(existingFiles, existing.name);
        const sameVersion = Boolean(incomingVersion && localVersion && incomingVersion === localVersion);

        if (importStrategy !== "overwrite") {
          res.status(200).json({
            workspaceId: existing.token,
            skillId: existing.token,
            source: "skill",
            createdAt: existing.createdAt,
            updatedAt: existing.updatedAt,
            files: toWorkspacePublicFiles(existingFiles),
            importStatus: "conflict",
            overwriteRequired: true,
            importDiff,
            versionCheck: {
              incomingVersion,
              localVersion,
              sameVersion,
            },
          });
          return;
        }

        const updated = await updateUserSkill({
          token: existing.token,
          userId,
          updates: {
            files: normalized.files,
          },
        });
        if (!updated) {
          res.status(500).json({ error: "覆盖同名 skill 失败" });
          return;
        }

        res.status(200).json({
          workspaceId: updated.token,
          skillId: updated.token,
          source: "skill",
          createdAt: updated.createdAt,
          updatedAt: updated.updatedAt,
          files: toWorkspacePublicFiles((updated.files || normalized.files) as Record<string, { code: string }>),
          importStatus: "overwritten",
          overwriteRequired: false,
          importDiff: buildImportDiff(
            toWorkspacePublicFiles((existing.files || {}) as Record<string, { code: string }>),
            toWorkspacePublicFiles((updated.files || normalized.files) as Record<string, { code: string }>)
          ),
          versionCheck: {
            incomingVersion,
            localVersion,
            sameVersion,
          },
        });
        return;
      }

      const created = await createUserSkill({
        userId,
        sourceType: "custom",
        name: normalized.name,
        description: normalized.description,
        files: normalized.files,
      });

      res.status(200).json({
        workspaceId: created.token,
        skillId: created.token,
        source: "skill",
        createdAt: created.createdAt,
        updatedAt: created.updatedAt,
        files: toWorkspacePublicFiles((created.files || normalized.files) as Record<string, { code: string }>),
        importStatus: "created",
        overwriteRequired: false,
        importDiff: buildImportDiff({}, incomingPublicFiles),
        versionCheck: {
          incomingVersion,
          localVersion: "",
          sameVersion: false,
        },
      });
      return;
    } catch (error) {
      res.status(502).json({
        error: error instanceof Error ? error.message : "导入 ClawHub skill 失败",
      });
      return;
    }
  }

  if (projectToken) {
    const project = await getProject(projectToken);
    if (!project) {
      res.status(404).json({ error: "项目不存在" });
      return;
    }
    if (project.userId !== userId) {
      res.status(403).json({ error: "无权访问该项目" });
      return;
    }
  }

  if (skillId) {
    const skill = await getUserSkill({ token: skillId, userId });
    if (!skill) {
      res.status(404).json({ error: "skill 不存在" });
      return;
    }
  }

  try {
    const shouldCreateEditableSkillWorkspace = Boolean(projectToken) && !skillId;
    const workspace = await createSkillWorkspace({
      userId,
      projectToken: shouldCreateEditableSkillWorkspace ? undefined : projectToken || undefined,
      skillId: skillId || undefined,
    });
    res.status(200).json({
      workspaceId: workspace.id,
      projectToken: workspace.projectToken || projectToken || undefined,
      skillId: workspace.skillId,
      source: workspace.source,
      createdAt: workspace.createdAt,
      updatedAt: workspace.updatedAt,
      files: toWorkspacePublicFiles(workspace.files),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "创建 workspace 失败";
    res.status(500).json({ error: message });
  }
}

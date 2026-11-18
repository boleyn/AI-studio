import { z } from "zod";
import { toReadableProjectDir } from "@/agent/sandbox/paths";
import { requestProjectGrant } from "@server/localDevice/requestProjectGrant";
import type { ProjectWorkspace } from "@/types/projectWorkspace";
import type { NextApiRequest, NextApiResponse } from "next";
import type { SandpackPredefinedTemplate } from "@codesandbox/sandpack-react";
import {
  DEFAULT_PROJECT_TEMPLATE,
  isCommonProjectTemplate,
  toSandpackTemplate,
} from "@shared/sandpack/projectTemplates";
import { loadProjectTemplateDefaults } from "@server/projects/projectTemplateLoader";
import {
  listProjects,
  getProject,
  saveProject,
  updateProjectMeta,
  generateToken,
  deleteProject as deleteProjectStorage,
  type ProjectData,
} from "@server/projects/projectStorage";
import { listConversations, purgeAllConversations } from "@server/conversations/conversationStorage";
import { requireAuth } from "@server/auth/session";

type CreateProjectRequest = {
  workspace?: unknown;
  name?: string;
  description?: string;
  template?: SandpackPredefinedTemplate;
  files?: Record<string, { code: string }>;
  dependencies?: Record<string, string>;
};

const workspaceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("remote-vm") }).strict(),
  z.object({
    kind: z.literal("connector"),
    deviceId: z.string().uuid(),
    workdir: z.string().trim().min(1).max(4096).optional(),
  }).strict(),
]);

const hasFilesObject = (files: unknown): files is Record<string, { code: string }> => {
  return Boolean(files && typeof files === "object");
};

const hasDependenciesObject = (dependencies: unknown): dependencies is Record<string, string> => {
  return Boolean(dependencies && typeof dependencies === "object");
};

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  const auth = await requireAuth(req, res);
  if (!auth) return;

  const userId = auth.user._id != null ? String(auth.user._id) : "";
  if (!userId) {
    res.status(401).json({ error: "用户身份无效" });
    return;
  }

  if (req.method === "GET") {
    res.setHeader("Cache-Control", "private, no-store, must-revalidate");
    try {
      const projects = await listProjects(userId);
      const includeConversations =
        req.query.includeConversations === "1" || req.query.includeConversations === "true";
      if (!includeConversations) {
        res.status(200).json(projects);
        return;
      }
      const enriched = await Promise.all(
        projects.map(async (project) => {
          const conversations = await listConversations(project.token).catch(() => []);
          return {
            ...project,
            conversations: conversations.map((c) => ({
              id: c.id,
              title: c.title,
              updatedAt: c.updatedAt,
            })),
          };
        }),
      );
      res.status(200).json(enriched);
    } catch (error) {
      console.error("Failed to list projects:", error);
      res.status(500).json({ error: "获取项目列表失败" });
    }
    return;
  }

  if (req.method === "POST") {
    try {
      const body = req.body as CreateProjectRequest;
      const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : null;
      if (!name) {
        res.status(400).json({ error: "请输入项目名称" });
        return;
      }
      const selection = workspaceSchema.safeParse(body.workspace === undefined ? { kind: "remote-vm" } : body.workspace);
      if (!selection.success) {
        res.status(400).json({ error: "请选择工作空间位置，本地电脑需要选择设备" });
        return;
      }
      const token = generateToken();
      const now = new Date().toISOString();
      const requestedTemplate = isCommonProjectTemplate(body.template)
        ? body.template
        : DEFAULT_PROJECT_TEMPLATE;
      const sandpackTemplate = toSandpackTemplate(requestedTemplate);
      const templateDefaults = isCommonProjectTemplate(body.template)
        ? await loadProjectTemplateDefaults(requestedTemplate)
        : { files: {}, dependencies: {} };

      let workspace: ProjectWorkspace = {
        kind: "remote-vm",
        directoryName: `${toReadableProjectDir(name, token)}-${token}`,
      };
      if (selection.data.kind === "connector") {
        try {
          const grant = await requestProjectGrant({
            userId,
            memberName: auth.user.displayName || auth.user.username || userId,
            project: { token, name },
            deviceId: selection.data.deviceId,
            initialWorkdir: selection.data.workdir,
          });
          workspace = {
            kind: "connector",
            deviceId: selection.data.deviceId,
            grantId: grant.grantId,
            workdir: grant.workdir,
          };
        } catch (error) {
          res.status(400).json({ error: error instanceof Error && error.message === "grant_workdir_invalid"
            ? "所选目录不可用，请选择其他目录"
            : "无法授权本地工作空间，请确认连接器在线并在本机批准" });
          return;
        }
      }

      const project: ProjectData = {
        workspace,
        token,
        name,
        description: body.description?.trim() || undefined,
        template: sandpackTemplate,
        userId,
        files: hasFilesObject(body.files) ? body.files : templateDefaults.files,
        dependencies: hasDependenciesObject(body.dependencies)
          ? body.dependencies
          : templateDefaults.dependencies,
        createdAt: now,
        updatedAt: now,
      };

      await saveProject(project);

      res.status(201).json({
        workspace: project.workspace,
        token: project.token,
        name: project.name,
        description: project.description,
        template: project.template,
        files: project.files,
        dependencies: project.dependencies,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
      });
    } catch (error) {
      console.error("Failed to create project:", error);
      res.status(500).json({ error: "创建项目失败" });
    }
    return;
  }

  if (req.method === "PATCH") {
    if (req.body && Object.hasOwn(req.body, "workspace")) {
      res.status(400).json({ error: "项目创建后无法更改工作空间" });
      return;
    }
    const token =
      typeof req.query.token === "string"
        ? req.query.token
        : typeof req.body?.token === "string"
          ? req.body.token
          : "";
    if (!token) {
      res.status(400).json({ error: "缺少 token 参数" });
      return;
    }
    try {
      const project = await getProject(token);
      if (!project) {
        res.status(404).json({ error: "项目不存在" });
        return;
      }
      if (project.userId !== userId) {
        res.status(403).json({ error: "无权修改该项目" });
        return;
      }
      const nextName =
        typeof req.body?.name === "string" ? req.body.name.trim() : undefined;
      if (nextName !== undefined && !nextName) {
        res.status(400).json({ error: "项目名称不能为空" });
        return;
      }
      const nextDescription =
        typeof req.body?.description === "string"
          ? req.body.description.trim()
          : undefined;
      await updateProjectMeta(token, {
        ...(nextName !== undefined ? { name: nextName } : {}),
        ...(nextDescription !== undefined ? { description: nextDescription } : {}),
      });
      res.status(200).json({
        token,
        name: nextName ?? project.name,
        description: nextDescription ?? project.description,
      });
    } catch (error) {
      console.error("Failed to update project:", error);
      res.status(500).json({ error: "更新项目失败" });
    }
    return;
  }

  if (req.method === "DELETE") {
    const token = typeof req.query.token === "string" ? req.query.token : "";
    if (!token) {
      res.status(400).json({ error: "缺少 token 参数" });
      return;
    }
    try {
      const project = await getProject(token);
      if (!project) {
        res.status(404).json({ error: "项目不存在" });
        return;
      }
      if (project.userId !== userId) {
        res.status(403).json({ error: "无权删除该项目" });
        return;
      }
      await purgeAllConversations(token);
      await deleteProjectStorage(token);
      res.status(200).json({ success: true });
    } catch (error) {
      console.error("Failed to delete project:", error);
      res.status(500).json({ error: "删除项目失败" });
    }
    return;
  }

  res.setHeader("Allow", ["GET", "POST", "PATCH", "DELETE"]);
  res.status(405).json({ error: `方法 ${req.method} 不被允许` });
};

export default handler;

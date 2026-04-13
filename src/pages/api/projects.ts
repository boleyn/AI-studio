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
  generateToken,
  deleteProject as deleteProjectStorage,
  type ProjectData,
} from "@server/projects/projectStorage";
import { purgeAllConversations } from "@server/conversations/conversationStorage";
import { requireAuth } from "@server/auth/session";

type ProjectListItem = {
  token: string;
  name: string;
  description?: string;
  fileCount?: number;
  createdAt: string;
  updatedAt: string;
};

type CreateProjectRequest = {
  name?: string;
  description?: string;
  template?: SandpackPredefinedTemplate;
  files?: Record<string, { code: string }>;
  dependencies?: Record<string, string>;
};

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
      res.status(200).json(projects);
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
      const token = generateToken();
      const now = new Date().toISOString();
      const requestedTemplate = isCommonProjectTemplate(body.template)
        ? body.template
        : DEFAULT_PROJECT_TEMPLATE;
      const sandpackTemplate = toSandpackTemplate(requestedTemplate);
      const templateDefaults = await loadProjectTemplateDefaults(requestedTemplate);

      const project: ProjectData = {
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

  res.setHeader("Allow", ["GET", "POST", "DELETE"]);
  res.status(405).json({ error: `方法 ${req.method} 不被允许` });
};

export default handler;

import type { NextApiRequest, NextApiResponse } from "next";
import type { SandpackPredefinedTemplate } from "@codesandbox/sandpack-react";
import type { SandpackCompileInfo } from "@shared/sandpack/compileInfo";
import { normalizeSandpackCompileInfo } from "@shared/sandpack/compileInfo";
import { normalizeSandpackReactTemplateFiles } from "@shared/sandpack/reactTemplate";
import JSZip from "jszip";
import {
  createProjectFileViewUrl,
  getProject,
  readProjectFile,
  updateProjectMeta,
  updateFile,
  updateFiles,
} from "@server/projects/projectStorage";
import { requireAuth } from "@server/auth/session";

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "50mb",
    },
  },
};

type PatchProjectRequest = {
  name?: string;
  description?: string;
  template?: SandpackPredefinedTemplate;
  dependencies?: Record<string, string>;
  sandpackCompileInfo?: SandpackCompileInfo;
};

type UpdateFileRequest = {
  path: string;
  code: string;
};

type UpdateFilesRequest = {
  files: Record<string, { code: string }>;
  name?: string;
  template?: SandpackPredefinedTemplate;
  dependencies?: Record<string, string>;
  compileInfo?: SandpackCompileInfo;
};

const hasNonEmptyFiles = (files: unknown): files is Record<string, { code: string }> => {
  if (!files || typeof files !== "object") return false;
  return Object.keys(files as Record<string, unknown>).length > 0;
};

const normalizeZipPath = (filePath: string): string | null => {
  const normalized = filePath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized.includes("..")) {
    return null;
  }
  return normalized;
};

const normalizeFilename = (name: string): string => {
  const cleaned = name.trim().replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, " ");
  return cleaned || "project";
};

const toAsciiFilename = (name: string): string => {
  const ascii = name.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "_").trim();
  return ascii || "project.zip";
};

const parseBase64DataUrl = (value: string): { mime: string; bytes: Buffer } | null => {
  const match = value.match(/^data:([^;,]+)?;base64,([\s\S]+)$/i);
  if (!match) return null;
  const mime = (match[1] || "application/octet-stream").trim() || "application/octet-stream";
  const base64Body = match[2].replace(/\s+/g, "");
  try {
    return {
      mime,
      bytes: Buffer.from(base64Body, "base64"),
    };
  } catch {
    return null;
  }
};

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  const auth = await requireAuth(req, res);
  if (!auth) return;

  const userId = String(auth.user._id);
  const token = typeof req.query.token === "string" ? req.query.token : "";

  if (!token) {
    res.status(400).json({ error: "缺少token参数" });
    return;
  }

  if (req.method === "GET") {
    try {
      const project = await getProject(token);
      if (!project) {
        res.status(404).json({ error: "项目不存在" });
        return;
      }
      if (project.userId && project.userId !== userId) {
        res.status(403).json({ error: "无权访问该项目" });
        return;
      }

      const action = typeof req.query.action === "string" ? req.query.action : "";

      if (action === "view") {
        const filePath = typeof req.query.path === "string" ? req.query.path : "";
        if (!filePath) {
          res.status(400).json({ error: "缺少 path 参数" });
          return;
        }
        try {
          const { buffer, contentType, contentLength } = await readProjectFile(token, filePath);
          res.setHeader("Cache-Control", "private, no-store, must-revalidate");
          res.setHeader("Content-Type", contentType || "application/octet-stream");
          if (typeof contentLength === "number" && contentLength >= 0) {
            res.setHeader("Content-Length", String(contentLength));
          } else {
            res.setHeader("Content-Length", String(buffer.length));
          }
          res.status(200).send(buffer);
        } catch {
          res.status(404).json({ error: "文件不存在" });
        }
        return;
      }

      if (action === "view-url") {
        const filePath = typeof req.query.path === "string" ? req.query.path : "";
        if (!filePath) {
          res.status(400).json({ error: "缺少 path 参数" });
          return;
        }
        try {
          const url = await createProjectFileViewUrl(token, filePath, 900);
          res.status(200).json({ url });
        } catch {
          res.status(404).json({ error: "文件不存在" });
        }
        return;
      }

      if (action === "download") {
        const zip = new JSZip();
        Object.entries(project.files).forEach(([filePath, file]) => {
          const zipPath = normalizeZipPath(filePath);
          if (!zipPath) return;
          const code = file.code ?? "";
          const dataUrl = parseBase64DataUrl(code);
          if (dataUrl) {
            zip.file(zipPath, dataUrl.bytes);
            return;
          }
          zip.file(zipPath, code);
        });

        if (Object.keys(zip.files).length === 0) {
          res.status(400).json({ error: "项目文件为空，无法下载" });
          return;
        }

        const zipBuffer = await zip.generateAsync({
          type: "nodebuffer",
          compression: "DEFLATE",
          compressionOptions: { level: 9 },
        });
        const filename = `${normalizeFilename(project.name || "project")}.zip`;
        const asciiFilename = toAsciiFilename(filename);

        res.setHeader("Cache-Control", "private, no-store, must-revalidate");
        res.setHeader("Content-Type", "application/zip");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodeURIComponent(filename)}`
        );
        res.setHeader("Content-Length", String(zipBuffer.length));
        res.status(200).send(zipBuffer);
        return;
      }

      // 返回Sandpack格式的数据
      res.status(200).json({
        template: project.template,
        files: project.files,
        dependencies: project.dependencies || {},
        sandpackCompileInfo: project.sandpackCompileInfo || null,
        name: project.name,
        description: project.description,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
      });
    } catch (error) {
      console.error("Failed to get project:", error);
      res.status(500).json({ error: "获取项目失败" });
    }
    return;
  }

  if (req.method === "PATCH") {
    try {
      const project = await getProject(token);
      if (!project) {
        res.status(404).json({ error: "项目不存在" });
        return;
      }
      if (project.userId && project.userId !== userId) {
        res.status(403).json({ error: "无权访问该项目" });
        return;
      }

      const body = req.body as PatchProjectRequest;
      await updateProjectMeta(token, {
        name: body.name,
        description: body.description,
        template: body.template,
        dependencies: body.dependencies,
        sandpackCompileInfo: body.sandpackCompileInfo,
      });

      const updatedProject = await getProject(token);
      res.status(200).json({
        token: updatedProject!.token,
        name: updatedProject!.name,
        description: updatedProject!.description,
        template: updatedProject!.template,
        dependencies: updatedProject!.dependencies,
        sandpackCompileInfo: updatedProject!.sandpackCompileInfo,
        updatedAt: updatedProject!.updatedAt,
      });
    } catch (error) {
      console.error("Failed to update project:", error);
      res.status(500).json({ error: "更新项目失败" });
    }
    return;
  }

  if (req.method === "PUT") {
    // 更新文件（支持单文件或批量）
    const action = typeof req.query.action === "string" ? req.query.action : "files";
    const body = req.body as Partial<UpdateFileRequest & UpdateFilesRequest>;

    if (action === "compile-info") {
      try {
        const project = await getProject(token);
        if (!project) {
          res.status(404).json({ error: "项目不存在" });
          return;
        }
        if (project.userId && project.userId !== userId) {
          res.status(403).json({ error: "无权访问该项目" });
          return;
        }

        const compileInfo = normalizeSandpackCompileInfo(body.compileInfo);
        if (!compileInfo) {
          res.status(400).json({ error: "compileInfo 参数无效" });
          return;
        }

        await updateProjectMeta(token, { sandpackCompileInfo: compileInfo });
        res.status(200).json({ success: true, sandpackCompileInfo: compileInfo });
      } catch (error) {
        console.error("Failed to update compile info:", error);
        res.status(500).json({ error: "更新编译信息失败" });
      }
      return;
    }

    // 优先识别单文件更新，避免误触发批量更新删除其它文件
    const isSingleFileUpdate = typeof body.path === "string" && typeof body.code === "string";

    if (action === "file" || isSingleFileUpdate) {
      try {
        const project = await getProject(token);
        if (!project) {
          res.status(404).json({ error: "项目不存在" });
          return;
        }
        if (project.userId && project.userId !== userId) {
          res.status(403).json({ error: "无权访问该项目" });
          return;
        }

        if (!body.path || typeof body.code !== "string") {
          res.status(400).json({ error: "缺少path或code参数" });
          return;
        }

        await updateFile(token, body.path, body.code);
        res.status(200).json({ success: true });
      } catch (error) {
        console.error("Failed to update file:", error);
        res.status(500).json({ error: "更新文件失败" });
      }
      return;
    }

    if (action === "merge-files") {
      try {
        const project = await getProject(token);
        if (!project) {
          res.status(404).json({ error: "项目不存在" });
          return;
        }
        if (project.userId && project.userId !== userId) {
          res.status(403).json({ error: "无权访问该项目" });
          return;
        }

        if (!body.files || typeof body.files !== "object") {
          res.status(400).json({ error: "缺少files参数" });
          return;
        }

        if (!hasNonEmptyFiles(body.files)) {
          res.status(400).json({ error: "files 不能为空" });
          return;
        }

        const mergedFiles = normalizeSandpackReactTemplateFiles({
          ...project.files,
          ...body.files,
        }).files;

        await updateFiles(token, mergedFiles);
        res.status(200).json({ success: true });
      } catch (error) {
        console.error("Failed to merge files:", error);
        res.status(500).json({ error: "合并文件失败" });
      }
      return;
    }

    // 更新多个文件（批量更新）
    try {
      const project = await getProject(token);
      if (!project) {
        res.status(404).json({ error: "项目不存在" });
        return;
      }
      if (project.userId && project.userId !== userId) {
        res.status(403).json({ error: "无权访问该项目" });
        return;
      }

      if (!body.files || typeof body.files !== "object") {
        res.status(400).json({ error: "缺少files参数" });
        return;
      }

      if (!hasNonEmptyFiles(body.files)) {
        res.status(400).json({ error: "files 不能为空" });
        return;
      }

      if (body.name !== undefined || body.template !== undefined || body.dependencies !== undefined) {
        await updateProjectMeta(token, {
          name: body.name,
          template: body.template,
          dependencies: body.dependencies,
        });
      }

      await updateFiles(token, normalizeSandpackReactTemplateFiles(body.files).files);
      res.status(200).json({ success: true });
    } catch (error) {
      console.error("Failed to update files:", error);
      res.status(500).json({ error: "更新文件失败" });
    }
    return;
  }

  res.setHeader("Allow", ["GET", "PATCH", "PUT"]);
  res.status(405).json({ error: `方法 ${req.method} 不被允许` });
};

export default handler;

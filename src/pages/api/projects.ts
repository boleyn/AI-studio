import type { NextApiRequest, NextApiResponse } from "next";
import type { SandpackPredefinedTemplate } from "@codesandbox/sandpack-react";
import {
  listProjects,
  getProject,
  saveProject,
  generateToken,
  deleteProject as deleteProjectStorage,
  type ProjectData,
} from "@server/projects/projectStorage";
import { deleteAllConversations } from "@server/conversations/conversationStorage";
import { requireAuth } from "@server/auth/session";

type ProjectListItem = {
  token: string;
  name: string;
  updatedAt: string;
};

type CreateProjectRequest = {
  name?: string;
  template?: SandpackPredefinedTemplate;
  files?: Record<string, { code: string }>;
  dependencies?: Record<string, string>;
};

const hasNonEmptyFiles = (files: unknown): files is Record<string, { code: string }> => {
  if (!files || typeof files !== "object") return false;
  return Object.keys(files as Record<string, unknown>).length > 0;
};

// 默认项目模板（Node + React）
const DEFAULT_TEMPLATE: SandpackPredefinedTemplate = "react";
const DEFAULT_FILES: Record<string, { code: string }> = {
  "/index.js": {
    code: `import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

const root = createRoot(document.getElementById("root"));
root.render(<App />);
`,
  },
  "/App.js": {
    code: `import { useState } from "react";

export default function App() {
  const [count, setCount] = useState(0);
  return (
    <main className="app">
      <header>
        <p className="badge">Node + React Starter</p>
        <h1>欢迎来到 AI Studio</h1>
        <p className="subtle">从这里开始构建你的全栈组件。</p>
      </header>
      <section className="card">
        <h2>交互示例</h2>
        <p>点击计数器：{count}</p>
        <button onClick={() => setCount((prev) => prev + 1)}>Click me</button>
      </section>
    </main>
  );
}`,
  },
  "/styles.css": {
    code: `.app {
  font-family: "Sora", sans-serif;
  color: #f7f5ff;
  background: radial-gradient(circle at top, #3b2f6d, #101018 65%);
  min-height: 100vh;
  padding: 64px;
}

h1 {
  font-size: 40px;
  letter-spacing: -0.02em;
  margin: 16px 0;
}

p {
  opacity: 0.7;
  margin-top: 12px;
}

.badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  padding: 6px 12px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
  color: #f7f5ff;
}

.subtle {
  opacity: 0.75;
  max-width: 520px;
}

.card {
  margin-top: 32px;
  padding: 24px;
  border-radius: 16px;
  background: rgba(16, 16, 24, 0.65);
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: 0 24px 60px rgba(8, 8, 16, 0.3);
}

button {
  margin-top: 12px;
  border: 0;
  padding: 10px 16px;
  border-radius: 999px;
  background: #f7f5ff;
  color: #111018;
  font-weight: 600;
  cursor: pointer;
}

h2 {
  margin: 0 0 8px;
}

}`,
  },
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

      const project: ProjectData = {
        token,
        name,
        template: body.template || DEFAULT_TEMPLATE,
        userId,
        files: hasNonEmptyFiles(body.files) ? body.files : DEFAULT_FILES,
        dependencies: body.dependencies || {},
        createdAt: now,
        updatedAt: now,
      };

      await saveProject(project);

      res.status(201).json({
        token: project.token,
        name: project.name,
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
      await deleteAllConversations(token);
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

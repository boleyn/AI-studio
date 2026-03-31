import { promises as fs } from "fs";
import path from "path";
import { Volume } from "memfs";
import {
  getProject,
  hasProjectFilesDir,
  updateBinaryFile,
  updateFile,
} from "@server/projects/projectStorage";
import { runSearchInFiles, type SearchInFilesInput } from "@server/agent/searchInFiles";
import {
  BINARY_EXT_MIME,
  MAX_SESSIONS_PER_PROJECT,
  MAX_SINGLE_FILE_BYTES,
  MAX_WORKSPACE_TOTAL_BYTES,
  SESSION_TTL_MS,
  WORKSPACE_ROOT,
} from "./constants";
import { ensureInside, isLikelyBinaryBuffer, normalizeProjectPath, toSafeSegment } from "./pathUtils";
import { logWorkspaceEvent } from "./telemetry";
import { collectWorkspaceFiles } from "./workspaceFiles";

export type ProjectWorkspaceSummary = {
  projectToken: string;
  sessionId: string;
  workspaceRoot: string;
  changedFiles: string[];
};

type ProjectWorkspaceState = {
  workspaceRoot: string;
  hydrated: boolean;
  vol: Volume;
  fileSizeByPath: Map<string, number>;
  totalBytes: number;
};

export class ProjectWorkspaceManager {
  private readonly safeSessionId: string;
  private readonly fallbackProjectToken?: string;
  private readonly byProject = new Map<string, ProjectWorkspaceState>();

  constructor(input: { sessionId?: string; fallbackProjectToken?: string }) {
    this.safeSessionId = toSafeSegment(input.sessionId || "default");
    this.fallbackProjectToken = input.fallbackProjectToken?.trim() || undefined;
  }

  private ensureToken(projectToken?: string) {
    const resolved = (projectToken || this.fallbackProjectToken || "").trim();
    if (!resolved) throw new Error("缺少 projectToken");
    return resolved;
  }

  private getWorkspaceRoot(projectToken: string) {
    const safeToken = toSafeSegment(projectToken);
    return path.join(WORKSPACE_ROOT, safeToken, "sessions", this.safeSessionId, "ws");
  }

  private getProjectSessionsRoot(projectToken: string) {
    const safeToken = toSafeSegment(projectToken);
    return path.join(WORKSPACE_ROOT, safeToken, "sessions");
  }

  private async enforceSessionRetention(projectToken: string, currentSessionId: string) {
    const sessionsRoot = this.getProjectSessionsRoot(projectToken);
    const entries = await fs.readdir(sessionsRoot, { withFileTypes: true }).catch(() => []);
    if (entries.length === 0) return;

    const now = Date.now();
    const sessions = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => {
          const sessionPath = path.join(sessionsRoot, entry.name);
          const wsPath = path.join(sessionPath, "ws");
          const stat = await fs.stat(wsPath).catch(() => null);
          return {
            name: entry.name,
            sessionPath,
            wsPath,
            mtimeMs: stat?.mtimeMs || 0,
          };
        })
    );

    const stale = sessions.filter(
      (item) => item.name !== currentSessionId && item.mtimeMs > 0 && now - item.mtimeMs > SESSION_TTL_MS
    );
    for (const item of stale) {
      await fs.rm(item.sessionPath, { recursive: true, force: true }).catch(() => undefined);
    }

    const active = sessions
      .filter((item) => item.name !== currentSessionId && (item.mtimeMs > 0 ? now - item.mtimeMs <= SESSION_TTL_MS : true))
      .sort((a, b) => b.mtimeMs - a.mtimeMs);

    if (active.length <= MAX_SESSIONS_PER_PROJECT) return;
    const toDelete = active.slice(MAX_SESSIONS_PER_PROJECT);
    for (const item of toDelete) {
      await fs.rm(item.sessionPath, { recursive: true, force: true }).catch(() => undefined);
    }

    if (stale.length > 0 || toDelete.length > 0) {
      logWorkspaceEvent("session_pruned", {
        projectToken,
        currentSessionId,
        staleRemoved: stale.length,
        lruRemoved: toDelete.length,
      });
    }
  }

  private getState(projectToken: string) {
    const existing = this.byProject.get(projectToken);
    if (existing) return existing;

    const vol = new Volume();

    const created: ProjectWorkspaceState = {
      workspaceRoot: this.getWorkspaceRoot(projectToken),
      hydrated: false,
      vol,
      fileSizeByPath: new Map<string, number>(),
      totalBytes: 0,
    };
    this.byProject.set(projectToken, created);
    return created;
  }

  async prepare(projectToken?: string): Promise<ProjectWorkspaceSummary> {
    const token = this.ensureToken(projectToken);
    const state = this.getState(token);
    await fs.mkdir(state.workspaceRoot, { recursive: true });
    await this.enforceSessionRetention(token, this.safeSessionId);
    await fs.utimes(state.workspaceRoot, new Date(), new Date()).catch(() => undefined);
    return {
      projectToken: token,
      sessionId: this.safeSessionId,
      workspaceRoot: state.workspaceRoot,
      changedFiles: [],
    };
  }

  async hydrate(projectToken?: string): Promise<ProjectWorkspaceSummary> {
    const startedAt = Date.now();
    const token = this.ensureToken(projectToken);
    const state = this.getState(token);
    if (state.hydrated) {
      return {
        projectToken: token,
        sessionId: this.safeSessionId,
        workspaceRoot: state.workspaceRoot,
        changedFiles: [],
      };
    }

    await this.prepare(token);

    const project = await getProject(token);
    if (!project) throw new Error("项目不存在");
    const hasFiles = await hasProjectFilesDir(token);
    if (!hasFiles) throw new Error("项目文件目录缺失，请先保存一次项目文件后再试");

    await fs.rm(state.workspaceRoot, { recursive: true, force: true });
    await fs.mkdir(state.workspaceRoot, { recursive: true });

    state.vol.reset();
    state.fileSizeByPath.clear();
    state.totalBytes = 0;

    const files = project.files || {};
    const sortedPaths = Object.keys(files).sort((a, b) => a.localeCompare(b));

    for (const filePath of sortedPaths) {
      const normalized = normalizeProjectPath(filePath);
      const content = typeof files[filePath]?.code === "string" ? files[filePath].code : "";
      const bytes = Buffer.byteLength(content, "utf8");
      if (bytes > MAX_SINGLE_FILE_BYTES) {
        throw new Error(`文件过大，拒绝加载: ${normalized}`);
      }
      const nextTotal = state.totalBytes + bytes;
      if (nextTotal > MAX_WORKSPACE_TOTAL_BYTES) {
        throw new Error("项目工作区超出大小上限，拒绝加载");
      }

      const absPath = path.join(state.workspaceRoot, normalized.replace(/^\/+/, ""));
      ensureInside(state.workspaceRoot, absPath, "文件路径");
      await fs.mkdir(path.dirname(absPath), { recursive: true });
      await fs.writeFile(absPath, content, "utf8");
      state.vol.mkdirSync(path.posix.dirname(normalized), { recursive: true });
      state.vol.writeFileSync(normalized, content, { encoding: "utf8" });
      state.fileSizeByPath.set(normalized, bytes);
      state.totalBytes = nextTotal;
    }

    state.hydrated = true;
    logWorkspaceEvent("hydrate_complete", {
      projectToken: token,
      sessionId: this.safeSessionId,
      fileCount: state.fileSizeByPath.size,
      totalBytes: state.totalBytes,
      durationMs: Date.now() - startedAt,
    });
    return {
      projectToken: token,
      sessionId: this.safeSessionId,
      workspaceRoot: state.workspaceRoot,
      changedFiles: [],
    };
  }

  private async assertHydrated(projectToken?: string) {
    const token = this.ensureToken(projectToken);
    const state = this.getState(token);
    if (!state.hydrated) {
      await this.hydrate(token);
    }
    return { token, state };
  }

  async resolveCwd(projectToken: string, cwd?: string) {
    const { state } = await this.assertHydrated(projectToken);
    const root = state.workspaceRoot;
    const candidate = cwd && cwd.trim() ? cwd.trim() : ".";
    const resolved = path.isAbsolute(candidate) ? path.resolve(candidate) : path.resolve(root, candidate);
    ensureInside(root, resolved, "cwd");
    return resolved;
  }

  async resolvePathInWorkspace(projectToken: string, filePath: string, cwd?: string) {
    const { state } = await this.assertHydrated(projectToken);
    const base = await this.resolveCwd(projectToken, cwd);
    const resolved = path.isAbsolute(filePath) ? path.resolve(filePath) : path.resolve(base, filePath);
    ensureInside(state.workspaceRoot, resolved, "路径");
    return resolved;
  }

  async listFiles(projectToken?: string) {
    const { state } = await this.assertHydrated(projectToken);
    return [...state.fileSizeByPath.keys()].sort((a, b) => a.localeCompare(b));
  }

  async readFile(projectToken: string, filePath: string) {
    const { state } = await this.assertHydrated(projectToken);
    const normalized = normalizeProjectPath(filePath);
    if (!state.vol.existsSync(normalized)) return null;
    const content = String(state.vol.readFileSync(normalized, { encoding: "utf8" }));
    return { path: normalized, content };
  }

  private ensureQuotaAfterWrite(state: ProjectWorkspaceState, normalizedPath: string, nextBytes: number) {
    if (nextBytes > MAX_SINGLE_FILE_BYTES) {
      throw new Error(`文件过大，超过限制 (${MAX_SINGLE_FILE_BYTES} bytes): ${normalizedPath}`);
    }
    const prevBytes = state.fileSizeByPath.get(normalizedPath) || 0;
    const nextTotal = state.totalBytes - prevBytes + nextBytes;
    if (nextTotal > MAX_WORKSPACE_TOTAL_BYTES) {
      throw new Error(`项目工作区超过总大小限制 (${MAX_WORKSPACE_TOTAL_BYTES} bytes)`);
    }
    state.totalBytes = nextTotal;
    state.fileSizeByPath.set(normalizedPath, nextBytes);
  }

  async writeFile(projectToken: string, filePath: string, content: string) {
    const { token, state } = await this.assertHydrated(projectToken);
    const normalized = normalizeProjectPath(filePath);
    const nextBytes = Buffer.byteLength(content, "utf8");
    this.ensureQuotaAfterWrite(state, normalized, nextBytes);

    const absPath = path.join(state.workspaceRoot, normalized.replace(/^\/+/, ""));
    ensureInside(state.workspaceRoot, absPath, "文件路径");
    await fs.mkdir(path.dirname(absPath), { recursive: true });
    await fs.writeFile(absPath, content, "utf8");

    state.vol.mkdirSync(path.posix.dirname(normalized), { recursive: true });
    state.vol.writeFileSync(normalized, content, { encoding: "utf8" });

    await updateFile(token, normalized, content);
    await fs.utimes(state.workspaceRoot, new Date(), new Date()).catch(() => undefined);
    logWorkspaceEvent("write_file", {
      projectToken: token,
      sessionId: this.safeSessionId,
      path: normalized,
      bytes: nextBytes,
      workspaceBytes: state.totalBytes,
    });
    return { path: normalized, bytes: nextBytes };
  }

  async replaceInFile(projectToken: string, filePath: string, query: string, replace: string) {
    const existing = await this.readFile(projectToken, filePath);
    if (!existing) {
      return { ok: false as const, message: `未找到文件 ${normalizeProjectPath(filePath)}` };
    }
    if (!query) throw new Error("替换内容不能为空");

    const existingContent = String(existing.content);
    const replaced = existingContent.split(query).length - 1;
    const nextContent = existingContent.split(query).join(replace);
    const writeResult = await this.writeFile(projectToken, existing.path, nextContent);
    return {
      ok: true as const,
      path: existing.path,
      replaced,
      bytes: writeResult.bytes,
    };
  }

  async searchInFiles(projectToken: string, input: SearchInFilesInput) {
    const { state } = await this.assertHydrated(projectToken);
    const files: Record<string, { code: string }> = {};

    for (const filePath of state.fileSizeByPath.keys()) {
      const raw = state.vol.readFileSync(filePath) as Buffer | string;
      const buffer = Buffer.isBuffer(raw) ? raw : Buffer.from(raw, "utf8");
      if (isLikelyBinaryBuffer(buffer)) continue;
      files[filePath] = { code: buffer.toString("utf8") };
    }

    return runSearchInFiles({ files, input });
  }

  private inferMime(filePath: string) {
    const ext = path.posix.extname(filePath).toLowerCase();
    return BINARY_EXT_MIME[ext] || "application/octet-stream";
  }

  async flushChangedFiles(projectToken?: string): Promise<ProjectWorkspaceSummary> {
    const startedAt = Date.now();
    const { token, state } = await this.assertHydrated(projectToken);

    const diskFiles = await collectWorkspaceFiles(state.workspaceRoot);
    let totalBytes = 0;
    for (const item of diskFiles) {
      totalBytes += item.buffer.length;
      if (item.buffer.length > MAX_SINGLE_FILE_BYTES) {
        throw new Error(`文件过大，拒绝回写: ${item.path}`);
      }
    }
    if (totalBytes > MAX_WORKSPACE_TOTAL_BYTES) {
      throw new Error(`项目工作区超过总大小限制 (${MAX_WORKSPACE_TOTAL_BYTES} bytes)`);
    }

    const changedFiles: string[] = [];
    for (const file of diskFiles) {
      const normalized = normalizeProjectPath(file.path);
      const prevRaw = state.vol.existsSync(normalized) ? state.vol.readFileSync(normalized) : null;
      const prevBuffer =
        prevRaw == null ? null : Buffer.isBuffer(prevRaw) ? prevRaw : Buffer.from(String(prevRaw), "utf8");
      const unchanged = prevBuffer && Buffer.compare(prevBuffer, file.buffer) === 0;
      if (unchanged) continue;

      const isBinary = isLikelyBinaryBuffer(file.buffer);
      if (isBinary) {
        await updateBinaryFile(token, normalized, file.buffer, this.inferMime(normalized));
        state.vol.mkdirSync(path.posix.dirname(normalized), { recursive: true });
        state.vol.writeFileSync(normalized, file.buffer);
      } else {
        const content = file.buffer.toString("utf8");
        await updateFile(token, normalized, content);
        state.vol.mkdirSync(path.posix.dirname(normalized), { recursive: true });
        state.vol.writeFileSync(normalized, content, { encoding: "utf8" });
      }
      state.fileSizeByPath.set(normalized, file.buffer.length);
      changedFiles.push(normalized);
    }

    state.totalBytes = totalBytes;
    await fs.utimes(state.workspaceRoot, new Date(), new Date()).catch(() => undefined);
    logWorkspaceEvent("flush_complete", {
      projectToken: token,
      sessionId: this.safeSessionId,
      changedCount: changedFiles.length,
      totalBytes,
      durationMs: Date.now() - startedAt,
    });

    return {
      projectToken: token,
      sessionId: this.safeSessionId,
      workspaceRoot: state.workspaceRoot,
      changedFiles,
    };
  }
}

/**
 * Sandbox 抽象（对应 Hermes Agent 的 tools/environments）。
 *
 * 每个用户/项目的工作空间都通过一个 Sandbox 暴露给 Agent：
 * - remote-vm : 每人一台虚拟机沙盒（projects/agent-sandbox exec-server），本地镜像目录 + S3 持久化
 * - local     : 开发模式，直接在服务器本地目录执行（不要在生产环境开启）
 * - connector : 通过用户本机运行的连接器挂载本机目录作为工作空间
 *
 * 所有路径对 Agent 来说都是"虚拟绝对路径"，以工作空间根目录为 `/`。
 */

export type SandboxKind = "remote-vm" | "local" | "connector";

export type SandboxDirEntry = {
  name: string;
  /** 虚拟绝对路径，例如 /src/App.tsx */
  path: string;
  type: "file" | "directory";
  size?: number;
};

export type SandboxExecOptions = {
  /** 虚拟工作目录，默认 / */
  cwd?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
};

export type SandboxExecResult = {
  code: number;
  stdout: string;
  stderr: string;
};

export interface SandboxFileSystem {
  readFile(virtualPath: string): Promise<Buffer>;
  readText(virtualPath: string): Promise<string>;
  writeFile(virtualPath: string, content: string | Buffer): Promise<void>;
  exists(virtualPath: string): Promise<boolean>;
  stat(virtualPath: string): Promise<{ type: "file" | "directory"; size: number; mtimeMs: number } | null>;
  readdir(virtualPath: string): Promise<SandboxDirEntry[]>;
  remove(virtualPath: string): Promise<void>;
  mkdir(virtualPath: string): Promise<void>;
}

export interface Sandbox {
  readonly kind: SandboxKind;
  /** 工作空间唯一标识（通常是项目 token / skill workspace id） */
  readonly workspaceKey: string;
  readonly fs: SandboxFileSystem;
  exec(command: string, options?: SandboxExecOptions): Promise<SandboxExecResult>;
  /** 将本轮修改持久化（S3 / 连接器无需） */
  persist(): Promise<void>;
  /** 导出工作空间内可同步回编辑器的文本文件 */
  exportProjectFiles(): Promise<Record<string, { code: string }>>;
  dispose(): Promise<void>;
}

export type ProjectFiles = Record<string, { code?: string }>;

export type CreateSandboxInput = {
  workspaceKey: string;
  kind?: SandboxKind;
  /** 首轮种子文件（已存在的文件不会覆盖） */
  projectFiles?: ProjectFiles;
  /** 每轮强制刷新的运行时文件（如系统 skills），不进入持久化 */
  runtimeFiles?: ProjectFiles;
  /** connector 模式下的连接信息 */
  connector?: { url: string; token?: string };
};

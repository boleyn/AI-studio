import { createConnectorSandbox } from "./environments/connector";
import { createLocalDeviceSandbox } from "./environments/localDevice";
import { HostDirFileSystem } from "./environments/hostDirFs";
import { execOnHost } from "./environments/localExec";
import { execOnRemoteVm } from "./environments/remoteVm";
import { toReadableProjectDir, toSafeSegment } from "./paths";
import type { CreateSandboxInput, Sandbox, SandboxKind } from "./types";
import { prepareAgentSandboxWorkspace } from "./workspace";

export * from "./types";
export * from "./paths";
export { collectSystemSkillFiles, excludeProjectOverrides } from "./runtimeFiles";
export { clearAgentSandboxWorkspace } from "./workspace";

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const withRetry = async (fn: () => Promise<void>, attempts = 3, baseDelayMs = 150) => {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await fn();
      return;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await delay(baseDelayMs * attempt);
    }
  }
  throw new Error(
    `agent_sandbox_persist_failed_after_${attempts}_attempts: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
};

/** 默认沙盒类型：AGENT_SANDBOX_MODE=remote-vm|local，未配置时生产用 remote-vm，开发用 local */
export const resolveSandboxKind = (requested?: SandboxKind): SandboxKind => {
  if (requested) return requested;
  const env = (process.env.AGENT_SANDBOX_MODE || "").trim().toLowerCase();
  if (env === "local" || env === "remote-vm" || env === "connector") return env;
  return process.env.NODE_ENV === "production" ? "remote-vm" : "local";
};

/** 创建工作空间沙盒（Hermes: tools/environments 工厂） */
export const createSandbox = async (input: CreateSandboxInput): Promise<Sandbox> => {
  const kind = resolveSandboxKind(input.kind);
  const projectKey = toSafeSegment(input.workspaceKey);
  const hostUserId = typeof input.hostUserId === "string" ? input.hostUserId.trim() : "";

  if (kind === "connector") {
    if (input.connector?.deviceId && input.connector?.grantId && input.connector?.userId) {
      return createLocalDeviceSandbox({
        workspaceKey: projectKey,
        deviceId: input.connector.deviceId,
        grantId: input.connector.grantId,
        workdir: input.connector.workdir,
        userId: input.connector.userId,
        runtimeFiles: input.runtimeFiles,
      });
    }
    if (!input.connector?.url) throw new Error("connector sandbox requires connector.url or deviceId+grantId");
    return createConnectorSandbox({ workspaceKey: projectKey, url: input.connector.url, token: input.connector.token, runtimeFiles: input.runtimeFiles });
  }

  // 每用户绑定一台云主机（user-<userId>），各个项目作为主机内 projects/<可读项目名> 文件夹共享 CLI / 依赖 / skills
  const hostWorkspaceKey = hostUserId ? toSafeSegment(`user-${hostUserId}`) : projectKey;
  const readableDir = hostUserId
    ? input.projectDirectory ?? toReadableProjectDir(input.projectName, projectKey)
    : undefined;
  const projectSubdir = readableDir ? `projects/${readableDir}` : undefined;

  const prepared = await prepareAgentSandboxWorkspace({
    baseCwd: process.cwd(),
    workspaceIdentity: hostWorkspaceKey,
    projectSubdir,
    projectFiles: input.projectFiles,
    runtimeFiles: input.runtimeFiles,
  });
  const fs = new HostDirFileSystem(prepared.projectRoot);
  const resolveExecCwd = (cwd?: string) => {
    if (!projectSubdir) return cwd;
    const rel = (cwd || "/").replace(/^\/+/, "");
    return rel ? `/${projectSubdir}/${rel}` : `/${projectSubdir}`;
  };

  return {
    kind,
    workspaceKey: prepared.workspaceKey,
    fs,
    exec: (command, options) => {
      const scopedOptions = projectSubdir
        ? { ...options, cwd: resolveExecCwd(options?.cwd) }
        : options;
      return kind === "remote-vm"
        ? execOnRemoteVm(prepared.workspaceRoot, prepared.workspaceKey, command, scopedOptions)
        : execOnHost(prepared.workspaceRoot, command, scopedOptions);
    },
    persist: () => {
      // 用户云主机持久卷模式下，运行期间直接读写本地持久目录，退出/休眠时由 userCloudHostManager 统一归档 S3
      const persistEveryTurn =
        !hostUserId || process.env.AGENT_SANDBOX_PERSIST_MODE === "every-turn";
      return persistEveryTurn ? withRetry(prepared.persistToS3) : Promise.resolve();
    },
    exportProjectFiles: () => fs.exportTextFiles(),
    async dispose() {},
  };
};

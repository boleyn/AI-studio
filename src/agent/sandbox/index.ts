import { createConnectorSandbox } from "./environments/connector";
import { HostDirFileSystem } from "./environments/hostDirFs";
import { execOnHost } from "./environments/localExec";
import { execOnRemoteVm } from "./environments/remoteVm";
import { toSafeSegment } from "./paths";
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
  const workspaceKey = toSafeSegment(input.workspaceKey);

  if (kind === "connector") {
    if (!input.connector?.url) throw new Error("connector sandbox requires connector.url");
    return createConnectorSandbox({ workspaceKey, url: input.connector.url, token: input.connector.token });
  }

  const prepared = await prepareAgentSandboxWorkspace({
    baseCwd: process.cwd(),
    workspaceIdentity: workspaceKey,
    projectFiles: input.projectFiles,
    runtimeFiles: input.runtimeFiles,
  });
  const fs = new HostDirFileSystem(prepared.workspaceRoot);

  return {
    kind,
    workspaceKey: prepared.workspaceKey,
    fs,
    exec: (command, options) =>
      kind === "remote-vm"
        ? execOnRemoteVm(prepared.workspaceRoot, prepared.workspaceKey, command, options)
        : execOnHost(prepared.workspaceRoot, command, options),
    persist: () => withRetry(prepared.persistToS3),
    exportProjectFiles: () => fs.exportTextFiles(),
    async dispose() {},
  };
};

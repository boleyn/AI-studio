import path from "node:path";
import { applySandboxWorkspaceSnapshot, collectSandboxWorkspaceSnapshot, type SandboxWorkspaceSnapshot } from "../snapshot";
import {
  devirtualizeCloudHostPaths,
  normalizeVirtualPath,
  virtualizeCloudHostPaths,
} from "../paths";
import type { SandboxExecOptions, SandboxExecResult } from "../types";

/** 与 projects/agent-sandbox/exec-server.ts 的协议版本保持一致 */
export const AGENT_SANDBOX_PROTOCOL_VERSION = 1;

const getExecEndpoint = () => ({
  url: (process.env.AGENT_SANDBOX_EXEC_URL || "http://agent-sandbox:8091/exec").trim(),
  token: (process.env.AGENT_SANDBOX_EXEC_TOKEN || "").trim(),
});

/**
 * 在用户专属虚拟机沙盒中执行命令：
 * 1. 把本地镜像目录打包成快照发给 exec-server
 * 2. exec-server 在 /workspace/<workspaceKey> 还原后执行，再把结果快照回传
 * 3. 回写到本地镜像目录（随后由 workspace.persist 写入 S3）
 */
export const execOnRemoteVm = async (
  mirrorRoot: string,
  workspaceKey: string,
  command: string,
  options: SandboxExecOptions = {},
): Promise<SandboxExecResult> => {
  const { url, token } = getExecEndpoint();
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers["x-fastgpt-exec-token"] = token;

  const effectiveWorkspaceKey = workspaceKey || path.basename(mirrorRoot);
  const cwdRelative = normalizeVirtualPath(options.cwd || "/").slice(1) || ".";
  const effectiveCwdRelative = ".";
  const normalizedCommand = devirtualizeCloudHostPaths(command, effectiveWorkspaceKey);
  const effectiveCommand =
    cwdRelative === "."
      ? normalizedCommand
      : (() => {
          const safeCwd = cwdRelative.replace(/'/g, "'\\''");
          return `mkdir -p '${safeCwd}' && cd '${safeCwd}' && {\n${normalizedCommand}\n}`;
        })();
  const snapshot = await collectSandboxWorkspaceSnapshot(mirrorRoot);

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers,
      signal: options.signal,
      body: JSON.stringify({
        command: effectiveCommand,
        cwdRelative: effectiveCwdRelative,
        workspaceKey: workspaceKey || path.basename(mirrorRoot),
        timeoutMs: options.timeoutMs ?? 120_000,
        protocolVersion: AGENT_SANDBOX_PROTOCOL_VERSION,
        preservePersistentState: true,
        snapshot,
      }),
    });
  } catch (error) {
    return {
      code: 126,
      stdout: "",
      stderr: `Sandbox VM unreachable (${url}): ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    return { code: 126, stdout: "", stderr: text.trim() || `Sandbox exec request failed with status ${response.status}.` };
  }

  const data = (await response.json().catch(() => ({}))) as {
    code?: unknown;
    stdout?: unknown;
    stderr?: unknown;
    protocolVersion?: unknown;
    snapshot?: unknown;
  };
  if (data.protocolVersion !== AGENT_SANDBOX_PROTOCOL_VERSION || !data.snapshot || typeof data.snapshot !== "object") {
    throw new Error("Agent sandbox protocol mismatch. Rebuild/restart the agent-sandbox service.");
  }
  await applySandboxWorkspaceSnapshot(mirrorRoot, data.snapshot as SandboxWorkspaceSnapshot, {
    preserveExcludedPaths: true,
  });
  return {
    code: typeof data.code === "number" && Number.isFinite(data.code) ? data.code : 1,
    stdout: virtualizeCloudHostPaths(
      typeof data.stdout === "string" ? data.stdout : "",
      effectiveWorkspaceKey,
      mirrorRoot,
    ),
    stderr: virtualizeCloudHostPaths(
      typeof data.stderr === "string" ? data.stderr : "",
      effectiveWorkspaceKey,
      mirrorRoot,
    ),
  };
};

import type { AgentToolDefinition } from "./types";
import {
  DEFAULT_TOOL_TIMEOUT_MS,
  MAX_TOOL_TIMEOUT_MS,
  clampToolTimeout,
  runStructuredCommand,
} from "./commandRunner";
import { buildSessionIsolatedEnv } from "./sessionEnv";
import { ProjectWorkspaceManager } from "../workspace/projectWorkspaceManager";
import { validateStructuredCommand } from "./bashValidation";

const splitCommandTokens = (segment: string) =>
  segment.match(/"[^"]*"|'[^']*'|[^\s]+/g)?.map((token) => token.trim()).filter(Boolean) || [];

const stripWrappingQuotes = (token: string) =>
  token.replace(/^"(.*)"$/s, "$1").replace(/^'(.*)'$/s, "$1");

const normalizeStructuredCommandInput = (cmdRaw: string, argsRaw: string[]) => {
  const cmdTrimmed = cmdRaw.trim();
  const args = [...argsRaw];
  if (args.length === 0 && /\s/.test(cmdTrimmed)) {
    const tokens = splitCommandTokens(cmdTrimmed).map(stripWrappingQuotes);
    if (tokens.length > 0) {
      return {
        cmd: tokens[0] || "",
        args: tokens.slice(1),
      };
    }
  }
  return {
    cmd: cmdTrimmed,
    args,
  };
};

export const createBashTool = (options?: {
  sessionId?: string;
  workspaceManager?: ProjectWorkspaceManager;
  fallbackProjectToken?: string;
  allowedProjectToken?: string;
}): AgentToolDefinition => {
  const workspaceManager =
    options?.workspaceManager ||
    new ProjectWorkspaceManager({
      sessionId: options?.sessionId,
      fallbackProjectToken: options?.fallbackProjectToken,
    });

  return {
    name: "bash",
    description:
      "Run query-oriented commands in a project-isolated workspace. Uses structured command input and non-shell execution.",
    parameters: {
      type: "object",
      properties: {
        cmd: { type: "string", description: "Executable command name (whitelisted)." },
        args: { type: "array", items: { type: "string" }, description: "Command arguments." },
        cwd: { type: "string", description: "Relative working directory inside project workspace." },
        timeoutMs: {
          type: "integer",
          minimum: 1000,
          maximum: MAX_TOOL_TIMEOUT_MS,
          description: `Execution timeout in milliseconds (optional, default ${DEFAULT_TOOL_TIMEOUT_MS}).`,
        },
      },
      required: ["cmd"],
    },
    run: async (input) => {
      const payload = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
      const normalizedProjectToken = (options?.allowedProjectToken || options?.fallbackProjectToken || "").trim();
      const cmdInput = typeof payload.cmd === "string" ? payload.cmd : "";
      const argsInput = Array.isArray(payload.args) ? payload.args.map((item) => String(item)) : [];
      const normalizedCommand = normalizeStructuredCommandInput(cmdInput, argsInput);
      const cmd = normalizedCommand.cmd;
      const args = normalizedCommand.args;
      const cwdInput = typeof payload.cwd === "string" ? payload.cwd : "";
      const timeoutMs = clampToolTimeout(payload.timeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS);

      if (!normalizedProjectToken) {
        throw new Error("当前会话未绑定项目，无法执行 bash。");
      }
      if (options?.allowedProjectToken && normalizedProjectToken !== options.allowedProjectToken) {
        throw new Error("无权限访问该项目的 bash 执行环境。");
      }
      if (!cmd) throw new Error("缺少 cmd 参数。");

      const prepared = await workspaceManager.prepare(normalizedProjectToken);
      await workspaceManager.hydrate(normalizedProjectToken);
      const cwd = await workspaceManager.resolveCwd(normalizedProjectToken, cwdInput);

      const invalidReason = await validateStructuredCommand({
        projectToken: normalizedProjectToken,
        cmd,
        args,
        cwd,
        workspaceManager,
      });
      if (invalidReason) {
        throw new Error(`${invalidReason} 允许示例: {"cmd":"ls","args":["-la"]}`);
      }

      const isolatedEnv = await buildSessionIsolatedEnv({
        sessionId: prepared.sessionId,
        workspaceRoot: prepared.workspaceRoot,
      });
      const result = await runStructuredCommand({
        command: cmd,
        args,
        cwd,
        timeoutMs,
        env: isolatedEnv,
      });
      const flushed = await workspaceManager.flushChangedFiles(normalizedProjectToken);

      return {
        ok: result.ok,
        sandbox: "project_workspace",
        sessionId: isolatedEnv.AISTUDIO_SESSION_ID,
        workspaceRoot: prepared.workspaceRoot,
        projectToken: normalizedProjectToken,
        cwd,
        cmd,
        args,
        exitCode: result.exitCode,
        killed: result.killed,
        signal: result.signal,
        stdout: result.stdout,
        stderr: result.stderr,
        error: result.error,
        changedFiles: flushed.changedFiles,
      };
    },
  };
};

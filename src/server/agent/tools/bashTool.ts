import path from "path";
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
  if (/\s/.test(cmdTrimmed)) {
    const tokens = splitCommandTokens(cmdTrimmed).map(stripWrappingQuotes);
    if (tokens.length > 0) {
      return {
        cmd: tokens[0] || "",
        args: [...tokens.slice(1), ...args],
      };
    }
  }
  return {
    cmd: cmdTrimmed,
    args,
  };
};

const normalizeWorkspaceLikePath = (value: string) => {
  const raw = value.trim();
  if (!raw) return raw;
  // Users/models often treat "/files" as workspace root. Map to workspace-relative.
  if (raw === "/files" || raw === "/.files") return ".files";
  if (raw.startsWith("/files/")) return `.files/${raw.slice("/files/".length)}`;
  if (raw.startsWith("/.files/")) return `.files/${raw.slice("/.files/".length)}`;
  return raw;
};

const INLINE_CODE_FLAGS = new Set(["-c", "-e", "--eval", "--command"]);
const INLINE_CODE_COMMANDS = new Set(["bash", "sh", "zsh", "python", "python3", "node", "nodejs"]);
const FILE_OP_COMMANDS = new Set(["rm", "cp", "mv"]);

const normalizeInlineCodePathMentions = (value: string) =>
  value
    .replace(/(^|[^\w./-])\/\.files(?=\/|$)/g, "$1.files")
    .replace(/(^|[^\w./-])\/files(?=\/|$)/g, "$1.files");

const normalizeFsPath = (value: string) => value.replace(/\\/g, "/");

const sanitizeWorkspaceAbsolutePathInText = (value: string, workspaceRoot: string) => {
  if (!value) return value;
  const root = normalizeFsPath(path.resolve(workspaceRoot)).replace(/\/+$/, "");
  if (!root) return value;
  return normalizeFsPath(value)
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (trimmed === root) {
        return line.replace(root, "/");
      }
      return line.split(`${root}/`).join("/");
    })
    .join("\n");
};

const normalizeStructuredArgs = (cmdRaw: string, argsRaw: string[]) => {
  const cmd = cmdRaw.trim().toLowerCase();
  const normalizedArgs = argsRaw.map((arg) => normalizeWorkspaceLikePath(arg));
  if (FILE_OP_COMMANDS.has(cmd)) {
    for (let i = 0; i < normalizedArgs.length; i += 1) {
      const token = normalizedArgs[i];
      if (!token || token === "/" || token.startsWith("-")) continue;
      // list_files returns project paths with leading "/", convert to workspace-relative for file ops.
      if (token.startsWith("/")) {
        normalizedArgs[i] = token.slice(1);
      }
    }
  }
  if (!INLINE_CODE_COMMANDS.has(cmd)) return normalizedArgs;
  for (let i = 0; i < normalizedArgs.length - 1; i += 1) {
    if (!INLINE_CODE_FLAGS.has(normalizedArgs[i])) continue;
    normalizedArgs[i + 1] = normalizeInlineCodePathMentions(normalizedArgs[i + 1]);
  }
  return normalizedArgs;
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
      "Run query-oriented commands in a project-isolated workspace. Supports Claude-style `command` and structured `cmd/args` input.",
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "Claude-compatible command string. Example: `ls -la src`.",
        },
        cmd: { type: "string", description: "Executable command name (whitelisted)." },
        args: { type: "array", items: { type: "string" }, description: "Command arguments." },
        cwd: { type: "string", description: "Relative working directory inside project workspace." },
        timeout: {
          type: "integer",
          minimum: 1000,
          maximum: MAX_TOOL_TIMEOUT_MS,
          description: `Claude-compatible timeout in milliseconds (default ${DEFAULT_TOOL_TIMEOUT_MS}).`,
        },
        timeoutMs: {
          type: "integer",
          minimum: 1000,
          maximum: MAX_TOOL_TIMEOUT_MS,
          description: `Execution timeout in milliseconds (optional, default ${DEFAULT_TOOL_TIMEOUT_MS}).`,
        },
        run_in_background: {
          type: "boolean",
          description: "Claude-compatible field. Current runtime does not support background tasks.",
        },
      },
      required: [],
    },
    run: async (input) => {
      const payload = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
      const normalizedProjectToken = (options?.allowedProjectToken || options?.fallbackProjectToken || "").trim();
      const commandInput = typeof payload.command === "string" ? payload.command : "";
      const cmdInput = typeof payload.cmd === "string" ? payload.cmd : commandInput;
      const argsInput = Array.isArray(payload.args) ? payload.args.map((item) => String(item)) : [];
      const normalizedCommand = normalizeStructuredCommandInput(cmdInput, argsInput);
      const cmd = normalizedCommand.cmd;
      const args = normalizeStructuredArgs(cmd, normalizedCommand.args);
      const cwdInputRaw = typeof payload.cwd === "string" ? payload.cwd : "";
      const cwdInput = normalizeWorkspaceLikePath(cwdInputRaw);
      const timeoutMs = clampToolTimeout(payload.timeoutMs ?? payload.timeout ?? DEFAULT_TOOL_TIMEOUT_MS);
      const runInBackground = payload.run_in_background === true;

      if (!normalizedProjectToken) {
        throw new Error("当前会话未绑定项目，无法执行 bash。");
      }
      if (options?.allowedProjectToken && normalizedProjectToken !== options.allowedProjectToken) {
        throw new Error("无权限访问该项目的 bash 执行环境。");
      }
      if (!cmd) throw new Error("缺少 cmd 参数。");
      if (runInBackground) {
        throw new Error("当前 bash 工具暂不支持 run_in_background=true，请改为前台执行。");
      }

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
      const withFallback = async () => {
        if (!result.error?.includes("ENOENT")) return result;
        if (cmd === "python") {
          return runStructuredCommand({
            command: "python3",
            args,
            cwd,
            timeoutMs,
            env: isolatedEnv,
          });
        }
        if (cmd === "pip") {
          return runStructuredCommand({
            command: "pip3",
            args,
            cwd,
            timeoutMs,
            env: isolatedEnv,
          });
        }
        return result;
      };
      const finalResult = await withFallback();
      const flushed = await workspaceManager.flushChangedFiles(normalizedProjectToken);
      const relativeCwd = path.relative(prepared.workspaceRoot, cwd).split(path.sep).join("/") || ".";
      const sanitizedStdout = sanitizeWorkspaceAbsolutePathInText(finalResult.stdout, prepared.workspaceRoot);
      const sanitizedStderr = sanitizeWorkspaceAbsolutePathInText(finalResult.stderr, prepared.workspaceRoot);
      const sanitizedError = sanitizeWorkspaceAbsolutePathInText(finalResult.error || "", prepared.workspaceRoot);

      return {
        ok: finalResult.ok,
        cwd: relativeCwd === "" ? "." : relativeCwd,
        cmd,
        args,
        exitCode: finalResult.exitCode,
        killed: finalResult.killed,
        signal: finalResult.signal,
        stdout: sanitizedStdout,
        stderr: sanitizedStderr,
        error: sanitizedError,
        changedFiles: flushed.changedFiles,
      };
    },
  };
};

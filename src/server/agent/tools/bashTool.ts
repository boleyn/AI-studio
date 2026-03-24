import type { AgentToolDefinition } from "./types";
import fs from "fs/promises";
import path from "path";
import {
  DEFAULT_TOOL_TIMEOUT_MS,
  MAX_TOOL_TIMEOUT_MS,
  clampToolTimeout,
  runShellCommand,
} from "./commandRunner";
import { buildSessionIsolatedEnv } from "./sessionEnv";

const resolveWorkspaceBoundCwd = (cwd?: string) => {
  const workspaceRoot = path.resolve(process.cwd());
  const candidate = cwd && cwd.trim() ? path.resolve(cwd.trim()) : workspaceRoot;
  const relative = path.relative(workspaceRoot, candidate);
  const inside =
    candidate === workspaceRoot ||
    (relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative));
  if (!inside) {
    throw new Error(`cwd 越界：仅允许在仓库目录内执行命令 (${workspaceRoot})`);
  }
  return candidate;
};

const DANGEROUS_PATTERN_RULES: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /(^|[\s;&|()])rm(\s|$)/i,
    reason: "禁止执行 rm 删除命令。",
  },
  {
    pattern:
      /(^|[\s;&|()])(sudo|su|passwd|useradd|usermod|userdel|groupadd|groupdel|chown|chgrp|chmod|systemctl|service|launchctl|sysctl|mount|umount|shutdown|reboot|halt|poweroff|init|mkfs|fdisk|parted|iptables|ufw|netplan|sc|reg)(\s|$)/i,
    reason: "禁止执行系统配置/权限变更类命令。",
  },
  {
    pattern: /(^|[\s;&|()])(apt|apt-get|yum|dnf|pacman|apk|brew)(\s|$)/i,
    reason: "禁止执行系统包管理命令。",
  },
];

const MAX_SCRIPT_SCAN_BYTES = 256 * 1024;

const ALLOWED_QUERY_COMMANDS = new Set([
  "ls",
  "pwd",
  "cat",
  "head",
  "tail",
  "grep",
  "rg",
  "find",
  "wc",
  "uname",
  "arch",
  "whoami",
  "id",
  "ps",
  "env",
  "printenv",
  "date",
  "stat",
  "du",
  "df",
  "free",
  "uptime",
  "which",
  "whereis",
  "file",
  "readlink",
  "realpath",
  "echo",
  "sed",
  "awk",
  "sort",
  "uniq",
  "cut",
  "tr",
  "column",
  "tree",
  "git",
]);

const ALLOWED_SCRIPT_COMMANDS = new Set([
  "node",
  "nodejs",
  "python",
  "python3",
  "bash",
  "sh",
  "zsh",
  "tsx",
  "ts-node",
  "deno",
  "ruby",
  "perl",
  "php",
  "make",
  "npm",
  "yarn",
  "pnpm",
  "bun",
  "pip",
  "pip3",
]);

const isScriptPath = (token: string) =>
  /^(\.?\/)?[^\s]+\.(sh|bash|zsh|py|js|mjs|cjs|ts)$/i.test(token);

const SCRIPT_LAUNCHER_COMMANDS = new Set([
  "bash",
  "sh",
  "zsh",
  "python",
  "python3",
  "node",
  "nodejs",
  "tsx",
  "ts-node",
  "deno",
  "ruby",
  "perl",
  "php",
]);

const splitCommandTokens = (segment: string) =>
  segment.match(/"[^"]*"|'[^']*'|[^\s]+/g)?.map((token) => token.trim()).filter(Boolean) || [];

const stripWrappingQuotes = (token: string) =>
  token.replace(/^"(.*)"$/s, "$1").replace(/^'(.*)'$/s, "$1");

const findScriptTokenInSegment = (segment: string): string | null => {
  const tokens = splitCommandTokens(segment).map(stripWrappingQuotes);
  if (tokens.length === 0) return null;
  const [first, second] = tokens;
  if (!first) return null;

  const firstLower = first.toLowerCase();
  if (isScriptPath(first)) return first;
  if (!SCRIPT_LAUNCHER_COMMANDS.has(firstLower)) return null;
  if (!second || second.startsWith("-")) return null;
  if (isScriptPath(second)) return second;
  if (second.startsWith("./") || second.startsWith("../") || second.includes("/")) return second;
  return null;
};

const resolveWorkspacePath = (cwd: string, fileToken: string) => {
  const workspaceRoot = path.resolve(process.cwd());
  const candidate = path.resolve(cwd, fileToken);
  const relative = path.relative(workspaceRoot, candidate);
  const inside =
    candidate === workspaceRoot ||
    (relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative));
  if (!inside) {
    throw new Error(`脚本路径越界：仅允许读取仓库目录内脚本 (${workspaceRoot})`);
  }
  return candidate;
};

const validateScriptFile = async (cwd: string, fileToken: string): Promise<string | null> => {
  const scriptPath = resolveWorkspacePath(cwd, fileToken);
  let stat;
  try {
    stat = await fs.stat(scriptPath);
  } catch {
    return `脚本不存在或不可访问: ${fileToken}`;
  }
  if (!stat.isFile()) return `脚本路径不是文件: ${fileToken}`;
  if (stat.size > MAX_SCRIPT_SCAN_BYTES) {
    return `脚本过大，拒绝执行（>${MAX_SCRIPT_SCAN_BYTES} bytes）: ${fileToken}`;
  }

  let content = "";
  try {
    content = await fs.readFile(scriptPath, "utf8");
  } catch {
    return `脚本读取失败: ${fileToken}`;
  }

  for (const rule of DANGEROUS_PATTERN_RULES) {
    if (rule.pattern.test(content)) {
      return `脚本扫描未通过（${fileToken}）：${rule.reason}`;
    }
  }
  return null;
};

const getFirstExecutableToken = (segment: string) => {
  const normalized = segment.trim();
  if (!normalized) return "";
  const match = normalized.match(
    /^(?:[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|[^\s]+)\s+)*(?<cmd>[^\s]+)/
  );
  return (match?.groups?.cmd || "").toLowerCase();
};

const validateBashCommand = async (command: string, cwd: string): Promise<string | null> => {
  for (const rule of DANGEROUS_PATTERN_RULES) {
    if (rule.pattern.test(command)) return rule.reason;
  }

  const segments = command
    .split(/&&|\|\||;|\n/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (segments.length === 0) return "命令为空，无法执行。";

  const scannedScripts = new Set<string>();
  for (const segment of segments) {
    const firstToken = getFirstExecutableToken(segment);
    if (!firstToken) return "命令格式不受支持，请使用查询命令或脚本执行命令。";
    if (
      ALLOWED_QUERY_COMMANDS.has(firstToken) ||
      ALLOWED_SCRIPT_COMMANDS.has(firstToken) ||
      isScriptPath(firstToken)
    ) {
      const scriptToken = findScriptTokenInSegment(segment);
      if (scriptToken && !scannedScripts.has(scriptToken)) {
        scannedScripts.add(scriptToken);
        const scriptValidateError = await validateScriptFile(cwd, scriptToken);
        if (scriptValidateError) return scriptValidateError;
      }
      continue;
    }
    return `仅允许查询类和脚本执行类命令，当前命令不允许: ${firstToken}`;
  }

  return null;
};

export const createBashTool = (options?: { sessionId?: string }): AgentToolDefinition => {
  return {
    name: "bash",
    description:
      "Run query-oriented shell commands and script execution in the workspace. Destructive or system-setting commands are blocked.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "The shell command to execute." },
        cwd: { type: "string", description: "The working directory (optional)." },
        timeoutMs: {
          type: "integer",
          minimum: 1000,
          maximum: MAX_TOOL_TIMEOUT_MS,
          description: `Execution timeout in milliseconds (optional, default ${DEFAULT_TOOL_TIMEOUT_MS}).`,
        },
      },
      required: ["command"],
    },
    run: async (input) => {
      const payload = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
      const command = typeof payload.command === "string" ? payload.command.trim() : "";
      const cwdInput = typeof payload.cwd === "string" ? payload.cwd : "";
      const cwd = resolveWorkspaceBoundCwd(cwdInput);
      const timeoutMs = clampToolTimeout(payload.timeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS);

      if (!command) throw new Error("缺少 command 参数。");
      const invalidReason = await validateBashCommand(command, cwd);
      if (invalidReason) {
        throw new Error(
          `${invalidReason} 允许示例: ls, cat, rg, find, uname, node script.js, python script.py, bash script.sh`
        );
      }

      const isolatedEnv = await buildSessionIsolatedEnv({
        sessionId: options?.sessionId,
      });
      const result = await runShellCommand({ command, cwd, timeoutMs, env: isolatedEnv });
      return {
        ok: result.ok,
        sandbox: "host",
        sessionId: isolatedEnv.AISTUDIO_SESSION_ID,
        cwd,
        command,
        exitCode: result.exitCode,
        killed: result.killed,
        signal: result.signal,
        stdout: result.stdout,
        stderr: result.stderr,
        error: result.error,
      };
    },
  };
};

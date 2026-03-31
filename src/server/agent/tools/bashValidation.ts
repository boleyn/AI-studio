import fs from "fs/promises";
import { ProjectWorkspaceManager } from "../workspace/projectWorkspaceManager";

const MAX_SCRIPT_SCAN_BYTES = 256 * 1024;
const MAX_ARG_COUNT = 64;
const MAX_ARG_LENGTH = 2048;

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

const ALLOWED_COMMANDS = new Set([
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

const SCRIPT_LAUNCHERS = new Set([
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

const isLikelyScriptPath = (token: string) =>
  /^(\.?\/)?[^\s]+\.(sh|bash|zsh|py|js|mjs|cjs|ts|rb|php)$/i.test(token);

const extractScriptArg = (cmd: string, args: string[]) => {
  if (!SCRIPT_LAUNCHERS.has(cmd)) return null;
  const scriptArg = args.find((arg) => arg && !arg.startsWith("-"));
  if (!scriptArg) return null;
  return isLikelyScriptPath(scriptArg) || scriptArg.includes("/") ? scriptArg : null;
};

const validateScriptFile = async (absolutePath: string): Promise<string | null> => {
  let stat;
  try {
    stat = await fs.stat(absolutePath);
  } catch {
    return `脚本不存在或不可访问: ${absolutePath}`;
  }
  if (!stat.isFile()) return `脚本路径不是文件: ${absolutePath}`;
  if (stat.size > MAX_SCRIPT_SCAN_BYTES) {
    return `脚本过大，拒绝执行（>${MAX_SCRIPT_SCAN_BYTES} bytes）`;
  }

  let content = "";
  try {
    content = await fs.readFile(absolutePath, "utf8");
  } catch {
    return `脚本读取失败: ${absolutePath}`;
  }

  for (const rule of DANGEROUS_PATTERN_RULES) {
    if (rule.pattern.test(content)) {
      return `脚本扫描未通过：${rule.reason}`;
    }
  }
  return null;
};

export const validateStructuredCommand = async (input: {
  projectToken: string;
  cmd: string;
  args: string[];
  cwd: string;
  workspaceManager: ProjectWorkspaceManager;
}) => {
  if (!input.projectToken.trim()) return "缺少 projectToken 参数。";
  if (!input.cmd.trim()) return "缺少 cmd 参数。";

  const cmd = input.cmd.trim().toLowerCase();
  if (!ALLOWED_COMMANDS.has(cmd)) {
    return `当前命令不允许: ${cmd}`;
  }

  if (input.args.length > MAX_ARG_COUNT) {
    return `参数数量过多，最多 ${MAX_ARG_COUNT} 个。`;
  }
  for (const arg of input.args) {
    if (typeof arg !== "string") return "args 仅允许字符串。";
    if (arg.length > MAX_ARG_LENGTH) return `参数长度过长（>${MAX_ARG_LENGTH}）。`;
    if (arg.includes("\0")) return "参数包含非法字符。";
  }

  const scriptArg = extractScriptArg(cmd, input.args);
  if (scriptArg) {
    const absoluteScriptPath = await input.workspaceManager.resolvePathInWorkspace(
      input.projectToken,
      scriptArg,
      input.cwd
    );
    const scriptError = await validateScriptFile(absoluteScriptPath);
    if (scriptError) return scriptError;
  }

  return null;
};

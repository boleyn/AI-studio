import fs from "fs/promises";
import path from "path";
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
  "pandoc",
  "unzip",
  "zip",
  "rm",
  "cp",
  "mv",
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
  // Inline code modes should not be treated as script-path execution.
  if (args.includes("-c") || args.includes("-e") || args.includes("--eval") || args.includes("--command")) {
    return null;
  }
  const scriptArg = args.find((arg) => arg && !arg.startsWith("-"));
  if (!scriptArg) return null;
  return isLikelyScriptPath(scriptArg) || scriptArg.includes("/") ? scriptArg : null;
};

const FILE_OP_COMMANDS = new Set(["rm", "cp", "mv"]);
const SEARCH_TOOL_COMMANDS = new Set(["rg", "grep", "find"]);

const collectPathLikeArgs = (cmd: string, args: string[]) => {
  // Keep only non-flag arguments as path candidates.
  // `--` means remaining args are positional.
  const positional: string[] = [];
  let afterDoubleDash = false;
  for (const arg of args) {
    if (!afterDoubleDash && arg === "--") {
      afterDoubleDash = true;
      continue;
    }
    if (!afterDoubleDash && arg.startsWith("-")) continue;
    positional.push(arg);
  }

  if (cmd === "rm") return positional;
  if (cmd === "cp" || cmd === "mv") return positional;
  return [];
};

const isUnsafePathArg = (arg: string) => {
  if (!arg) return true;
  if (arg.startsWith("/")) return true;
  const normalized = arg.replace(/\\/g, "/");
  const segments = normalized.split("/").filter(Boolean);
  return segments.includes("..");
};

const validateScriptFile = async (absolutePath: string): Promise<string | null> => {
  const fileName = path.basename(absolutePath) || "script";
  let stat;
  try {
    stat = await fs.stat(absolutePath);
  } catch {
    return `脚本不存在或不可访问: ${fileName}`;
  }
  if (!stat.isFile()) return `脚本路径不是文件: ${fileName}`;
  if (stat.size > MAX_SCRIPT_SCAN_BYTES) {
    return `脚本过大，拒绝执行（>${MAX_SCRIPT_SCAN_BYTES} bytes）`;
  }

  let content = "";
  try {
    content = await fs.readFile(absolutePath, "utf8");
  } catch {
    return `脚本读取失败: ${fileName}`;
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
  if (SEARCH_TOOL_COMMANDS.has(cmd)) {
    return "搜索命令应使用 Glob/Grep 工具，不要通过 bash 执行 rg/grep/find。";
  }

  if (input.args.length > MAX_ARG_COUNT) {
    return `参数数量过多，最多 ${MAX_ARG_COUNT} 个。`;
  }
  for (const arg of input.args) {
    if (typeof arg !== "string") return "args 仅允许字符串。";
    if (arg.length > MAX_ARG_LENGTH) return `参数长度过长（>${MAX_ARG_LENGTH}）。`;
    if (arg.includes("\0")) return "参数包含非法字符。";
  }

  if (FILE_OP_COMMANDS.has(cmd)) {
    const pathArgs = collectPathLikeArgs(cmd, input.args);
    if (cmd === "rm" && pathArgs.length < 1) {
      return "rm 至少需要一个项目内路径参数。";
    }
    if ((cmd === "cp" || cmd === "mv") && pathArgs.length < 2) {
      return `${cmd} 至少需要源路径和目标路径（项目内）。`;
    }
    for (const arg of pathArgs) {
      if (isUnsafePathArg(arg)) {
        return `${cmd} 仅允许项目内相对路径，禁止绝对路径或 .. 越界路径: ${arg}`;
      }
    }
  }

  const scriptArg = extractScriptArg(cmd, input.args);
  if (scriptArg) {
    const isAbsolute = scriptArg.startsWith("/");
    const absoluteScriptPath = isAbsolute
      ? scriptArg
      : await input.workspaceManager.resolvePathInWorkspace(input.projectToken, scriptArg, input.cwd);
    const scriptError = await validateScriptFile(absoluteScriptPath);
    if (scriptError) return scriptError;
  }

  return null;
};

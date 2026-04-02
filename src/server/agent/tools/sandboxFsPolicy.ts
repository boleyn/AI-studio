const SHELL_OPERATOR_TOKENS = new Set(["&&", "||", "|", ";", ">", ">>", "<", "<<"]);

const isLikelyUrl = (value: string) => /^https?:\/\//i.test(value.trim());

const isLikelyPathToken = (value: string) => {
  if (!value) return false;
  if (value.startsWith("/") || value.startsWith("./") || value.startsWith("../") || value === "." || value === "..") {
    return true;
  }
  return value.includes("/");
};

const hasUnsafeTraversal = (value: string) => {
  const normalized = value.replace(/\\/g, "/");
  const segments = normalized.split("/").filter(Boolean);
  return segments.includes("..");
};

export const validateWorkspaceArgToken = (token: string): string | null => {
  const trimmed = token.trim();
  if (!trimmed) return null;
  if (trimmed.includes("\0")) return `参数包含非法字符: ${token}`;
  if (SHELL_OPERATOR_TOKENS.has(trimmed)) {
    return `禁止在结构化命令参数中使用 shell 操作符: ${trimmed}`;
  }
  if (isLikelyUrl(trimmed)) return null;
  if (!isLikelyPathToken(trimmed)) return null;
  if (trimmed.startsWith("/")) {
    return `仅允许工作区内相对路径，禁止绝对路径: ${trimmed}`;
  }
  if (hasUnsafeTraversal(trimmed)) {
    return `仅允许工作区内相对路径，禁止 . 或 .. 越界路径: ${trimmed}`;
  }
  return null;
};

export const validateWorkspaceArgv = (args: string[]) => {
  for (const arg of args) {
    const error = validateWorkspaceArgToken(arg);
    if (error) return error;
  }
  return null;
};

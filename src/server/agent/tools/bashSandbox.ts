const parseBooleanEnv = (value: string | undefined, fallback: boolean) => {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
};

export type BashSandboxConfig = {
  enabled: boolean;
  allowUnsandboxedCommands: boolean;
  excludedCommands: string[];
};

export const getBashSandboxConfig = (): BashSandboxConfig => {
  const enabled = parseBooleanEnv(process.env.AI_BASH_SANDBOX_ENABLED, true);
  const allowUnsandboxedCommands = parseBooleanEnv(process.env.AI_BASH_ALLOW_UNSANDBOXED, false);
  const excludedCommands = (process.env.AI_BASH_SANDBOX_EXCLUDED_COMMANDS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return {
    enabled,
    allowUnsandboxedCommands,
    excludedCommands,
  };
};

export const shouldUseProjectSandbox = (input: {
  cmd: string;
  commandText: string;
  dangerouslyDisableSandbox: boolean;
}) => {
  const config = getBashSandboxConfig();
  if (!config.enabled) {
    return { useSandbox: false, reason: "sandbox_disabled", config };
  }
  if (input.dangerouslyDisableSandbox) {
    if (config.allowUnsandboxedCommands) {
      return { useSandbox: false, reason: "dangerously_disable_sandbox", config };
    }
    return { useSandbox: true, reason: "dangerously_disable_rejected", config };
  }
  const text = `${input.cmd} ${input.commandText}`.toLowerCase();
  const matchedExcluded = config.excludedCommands.find((item) => text.includes(item.toLowerCase()));
  if (matchedExcluded) {
    return { useSandbox: false, reason: `excluded_command:${matchedExcluded}`, config };
  }
  return { useSandbox: true, reason: "default", config };
};

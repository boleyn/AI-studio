import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type {
  HookConfig,
  HookEventName,
  PostToolHookInput,
  PostToolHookResult,
  PreToolHookInput,
  PreToolHookResult,
  SubagentHookInput,
} from "./types";

const execFileAsync = promisify(execFile);
const DEFAULT_TIMEOUT_MS = 10_000;

type HooksFileConfig = {
  hooks?: Array<{
    event?: string;
    command?: string;
    timeoutMs?: number;
  }>;
};

let cache: { loadedAt: number; hooks: HookConfig[] } | null = null;
let fileCacheMeta: { path: string; mtimeMs: number } | null = null;

const normalizeEvent = (value: string): HookEventName | null => {
  if (value === "PreToolUse") return "PreToolUse";
  if (value === "PostToolUse") return "PostToolUse";
  if (value === "PostToolUseFailure") return "PostToolUseFailure";
  if (value === "SubagentStart") return "SubagentStart";
  if (value === "SubagentStop") return "SubagentStop";
  return null;
};

const normalizeHooks = (raw: string): HookConfig[] => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as HooksFileConfig;
    const list = Array.isArray(parsed.hooks) ? parsed.hooks : [];
    const normalized = list
      .map((item) => {
        const event = normalizeEvent(typeof item.event === "string" ? item.event : "");
        const command = typeof item.command === "string" ? item.command.trim() : "";
        if (!event || !command) return null;
        const timeoutMs =
          typeof item.timeoutMs === "number" && Number.isFinite(item.timeoutMs)
            ? Math.max(500, Math.floor(item.timeoutMs))
            : undefined;
        const config: HookConfig = {
          event,
          command,
          ...(timeoutMs ? { timeoutMs } : {}),
        };
        return config;
      })
      .filter((item): item is HookConfig => Boolean(item));
    return normalized;
  } catch {
    return [];
  }
};

const resolveHooksConfigPath = () => {
  const fromEnv = (process.env.AISTUDIO_AGENT_HOOKS_FILE || "").trim();
  if (fromEnv) return path.resolve(fromEnv);
  return path.resolve(process.cwd(), ".aistudio", "agent-hooks.json");
};

const parseHooksFromConfigFile = async (): Promise<HookConfig[]> => {
  const filePath = resolveHooksConfigPath();
  try {
    const stat = await fs.stat(filePath);
    if (
      fileCacheMeta &&
      fileCacheMeta.path === filePath &&
      fileCacheMeta.mtimeMs === stat.mtimeMs &&
      cache
    ) {
      return cache.hooks;
    }
    const raw = await fs.readFile(filePath, "utf8");
    const hooks = normalizeHooks(raw);
    fileCacheMeta = { path: filePath, mtimeMs: stat.mtimeMs };
    return hooks;
  } catch {
    fileCacheMeta = null;
    return [];
  }
};

const parseHooksFromEnv = (): HookConfig[] => {
  const raw = (process.env.AISTUDIO_AGENT_HOOKS || "").trim();
  return normalizeHooks(raw);
};

const getHooks = async () => {
  const now = Date.now();
  if (cache && now - cache.loadedAt < 5_000) return cache.hooks;
  const fileHooks = await parseHooksFromConfigFile();
  const hooks = fileHooks.length > 0 ? fileHooks : parseHooksFromEnv();
  cache = { loadedAt: now, hooks };
  return hooks;
};

const executeHook = async (hook: HookConfig, payload: unknown): Promise<string> => {
  const { stdout } = await execFileAsync("zsh", ["-lc", hook.command], {
    timeout: hook.timeoutMs || DEFAULT_TIMEOUT_MS,
    maxBuffer: 2 * 1024 * 1024,
    env: {
      ...process.env,
      AISTUDIO_HOOK_PAYLOAD: JSON.stringify(payload),
    },
  });
  return stdout || "";
};

const parseHookJson = (stdout: string): Record<string, unknown> | null => {
  const text = (stdout || "").trim();
  if (!text) return null;
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      const parsed = JSON.parse(lines[i]);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // ignore
    }
  }
  return null;
};

export const runPreToolUseHooks = async (input: PreToolHookInput): Promise<PreToolHookResult> => {
  const hooks = (await getHooks()).filter((hook) => hook.event === "PreToolUse");
  let updatedInput = input.toolInput;
  for (const hook of hooks) {
    try {
      const stdout = await executeHook(hook, { ...input, toolInput: updatedInput });
      const json = parseHookJson(stdout);
      if (!json) continue;
      const decisionRaw =
        json.decision === "block" || json.decision === "allow" || json.decision === "ask"
          ? json.decision
          : json.permissionDecision === "deny"
          ? "block"
          : json.permissionDecision === "allow"
          ? "allow"
          : json.permissionDecision === "ask"
          ? "ask"
          : undefined;
      const decision =
        decisionRaw === "block" || decisionRaw === "allow" || decisionRaw === "ask"
          ? decisionRaw
          : undefined;
      const reason = typeof json.reason === "string" ? json.reason : undefined;
      if (Object.prototype.hasOwnProperty.call(json, "updatedInput")) {
        updatedInput = json.updatedInput;
      }
      if (Object.prototype.hasOwnProperty.call(json, "updated_input")) {
        updatedInput = json.updated_input;
      }
      if (decision === "block" || decision === "ask") {
        return {
          decision,
          reason,
          updatedInput,
        };
      }
    } catch {
      // swallow hook failures
    }
  }
  return {
    decision: "allow",
    updatedInput,
  };
};

export const runPostToolUseHooksWithResult = async (
  input: PostToolHookInput
): Promise<PostToolHookResult> => {
  const hooks = (await getHooks()).filter((hook) => hook.event === input.event);
  let currentOutput = input.toolResponse;
  let additionalContext = "";
  for (const hook of hooks) {
    try {
      const stdout = await executeHook(hook, {
        ...input,
        toolResponse: currentOutput,
      });
      const json = parseHookJson(stdout);
      if (!json) continue;
      if (Object.prototype.hasOwnProperty.call(json, "updatedToolOutput")) {
        currentOutput = json.updatedToolOutput;
      }
      if (Object.prototype.hasOwnProperty.call(json, "updatedMCPToolOutput")) {
        currentOutput = json.updatedMCPToolOutput;
      }
      if (typeof json.additionalContext === "string" && json.additionalContext.trim()) {
        additionalContext = json.additionalContext.trim();
      }
    } catch {
      // swallow hook failures
    }
  }
  return {
    ...(currentOutput !== undefined ? { updatedToolOutput: currentOutput } : {}),
    ...(additionalContext ? { additionalContext } : {}),
  };
};

export const runPostToolUseHooks = async (input: PostToolHookInput): Promise<void> => {
  await runPostToolUseHooksWithResult(input);
};

export const runSubagentHooks = async (input: SubagentHookInput): Promise<void> => {
  const hooks = (await getHooks()).filter((hook) => hook.event === input.event);
  for (const hook of hooks) {
    try {
      await executeHook(hook, input);
    } catch {
      // swallow hook failures
    }
  }
};

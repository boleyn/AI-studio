import { exec, execFile } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

export const MAX_TOOL_TIMEOUT_MS = 180_000;
export const DEFAULT_TOOL_TIMEOUT_MS = 60_000;
export const MAX_TOOL_OUTPUT_CHARS = 200_000;

export const clampToolTimeout = (value: unknown) => {
  const timeoutMsRaw = Number(value ?? DEFAULT_TOOL_TIMEOUT_MS);
  if (!Number.isFinite(timeoutMsRaw)) return DEFAULT_TOOL_TIMEOUT_MS;
  return Math.min(Math.max(Math.trunc(timeoutMsRaw), 1000), MAX_TOOL_TIMEOUT_MS);
};

export const trimToolOutput = (value: string) => {
  if (value.length <= MAX_TOOL_OUTPUT_CHARS) return value;
  return `${value.slice(0, MAX_TOOL_OUTPUT_CHARS)}\n...[truncated]`;
};

export const ensureString = (value: unknown) =>
  typeof value === "string" ? value : String(value ?? "");

export const runShellCommand = async (input: {
  command: string;
  cwd: string;
  timeoutMs: number;
}) => {
  try {
    const result = await execAsync(input.command, {
      cwd: input.cwd,
      timeout: input.timeoutMs,
      maxBuffer: 4 * 1024 * 1024,
      encoding: "utf8",
    });
    return {
      ok: true,
      stdout: trimToolOutput(ensureString(result.stdout)),
      stderr: trimToolOutput(ensureString(result.stderr)),
      exitCode: 0,
      killed: false,
      signal: null as string | null,
      error: "",
    };
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException & {
      stdout?: string;
      stderr?: string;
      code?: string | number;
      signal?: string;
      killed?: boolean;
    };
    return {
      ok: false,
      stdout: trimToolOutput(ensureString(nodeError.stdout)),
      stderr: trimToolOutput(ensureString(nodeError.stderr)),
      exitCode: typeof nodeError.code === "number" ? nodeError.code : -1,
      killed: Boolean(nodeError.killed),
      signal: nodeError.signal || null,
      error: error instanceof Error ? error.message : String(error ?? "执行失败"),
    };
  }
};

export const runExecFile = async (input: {
  command: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
}) => {
  try {
    const result = await execFileAsync(input.command, input.args, {
      cwd: input.cwd,
      timeout: input.timeoutMs,
      maxBuffer: 4 * 1024 * 1024,
      encoding: "utf8",
    });
    return {
      ok: true,
      stdout: trimToolOutput(ensureString(result.stdout)),
      stderr: trimToolOutput(ensureString(result.stderr)),
      exitCode: 0,
      killed: false,
      signal: null as string | null,
      error: "",
      enoent: false,
    };
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException & {
      stdout?: string;
      stderr?: string;
      code?: string | number;
      signal?: string;
      killed?: boolean;
    };
    return {
      ok: false,
      stdout: trimToolOutput(ensureString(nodeError.stdout)),
      stderr: trimToolOutput(ensureString(nodeError.stderr)),
      exitCode: typeof nodeError.code === "number" ? nodeError.code : -1,
      killed: Boolean(nodeError.killed),
      signal: nodeError.signal || null,
      error: error instanceof Error ? error.message : String(error ?? "执行失败"),
      enoent: nodeError.code === "ENOENT",
    };
  }
};

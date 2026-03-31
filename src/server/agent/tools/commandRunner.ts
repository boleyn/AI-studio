import { exec, execFile, spawn } from "child_process";
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
  env?: NodeJS.ProcessEnv;
}) => {
  try {
    const result = await execAsync(input.command, {
      cwd: input.cwd,
      timeout: input.timeoutMs,
      maxBuffer: 4 * 1024 * 1024,
      encoding: "utf8",
      env: input.env,
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
  env?: NodeJS.ProcessEnv;
}) => {
  try {
    const result = await execFileAsync(input.command, input.args, {
      cwd: input.cwd,
      timeout: input.timeoutMs,
      maxBuffer: 4 * 1024 * 1024,
      encoding: "utf8",
      env: input.env,
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

export const runStructuredCommand = async (input: {
  command: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  env?: NodeJS.ProcessEnv;
}) => {
  const maxBytes = 4 * 1024 * 1024;
  const child = spawn(input.command, input.args, {
    cwd: input.cwd,
    env: input.env,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let killedByTimeout = false;
  let timedOut = false;
  let resolved = false;
  let exitCode = -1;
  let signal: string | null = null;
  let errorText = "";

  const appendChunk = (target: "stdout" | "stderr", chunk: Buffer | string) => {
    const text = ensureString(chunk);
    const chunkBytes = Buffer.byteLength(text, "utf8");
    if (target === "stdout") {
      if (stdoutBytes >= maxBytes) return;
      const remain = maxBytes - stdoutBytes;
      if (chunkBytes <= remain) {
        stdout += text;
        stdoutBytes += chunkBytes;
        return;
      }
      const sliced = Buffer.from(text, "utf8").subarray(0, remain).toString("utf8");
      stdout += sliced;
      stdoutBytes = maxBytes;
      return;
    }
    if (stderrBytes >= maxBytes) return;
    const remain = maxBytes - stderrBytes;
    if (chunkBytes <= remain) {
      stderr += text;
      stderrBytes += chunkBytes;
      return;
    }
    const sliced = Buffer.from(text, "utf8").subarray(0, remain).toString("utf8");
    stderr += sliced;
    stderrBytes = maxBytes;
  };

  child.stdout?.on("data", (chunk) => appendChunk("stdout", chunk));
  child.stderr?.on("data", (chunk) => appendChunk("stderr", chunk));

  const timer = setTimeout(() => {
    timedOut = true;
    killedByTimeout = child.kill("SIGTERM");
  }, input.timeoutMs);

  const result = await new Promise<{
    ok: boolean;
    stdout: string;
    stderr: string;
    exitCode: number;
    killed: boolean;
    signal: string | null;
    error: string;
  }>((resolve) => {
    const finalize = () => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      resolve({
        ok: exitCode === 0 && !errorText,
        stdout: trimToolOutput(stdout),
        stderr: trimToolOutput(stderr),
        exitCode,
        killed: killedByTimeout,
        signal,
        error: errorText,
      });
    };

    child.on("error", (error) => {
      errorText = error instanceof Error ? error.message : String(error ?? "执行失败");
      exitCode = -1;
      signal = null;
      finalize();
    });

    child.on("close", (code, closeSignal) => {
      exitCode = typeof code === "number" ? code : -1;
      signal = closeSignal || null;
      if (timedOut) {
        errorText = `命令执行超时（>${input.timeoutMs}ms）`;
      } else if (exitCode !== 0) {
        errorText = `命令退出码非 0: ${exitCode}`;
      }
      finalize();
    });
  });

  return result;
};

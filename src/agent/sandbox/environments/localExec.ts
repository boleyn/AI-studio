import { spawn } from "node:child_process";
import path from "node:path";
import { maskHostPaths, resolveInsideRoot } from "../paths";
import type { SandboxExecOptions, SandboxExecResult } from "../types";

const MAX_OUTPUT_CHARS = 200_000;

const clip = (text: string) =>
  text.length > MAX_OUTPUT_CHARS ? `${text.slice(0, MAX_OUTPUT_CHARS)}\n...[output truncated]` : text;

/**
 * 在宿主机目录内执行命令（仅用于本地开发：AGENT_SANDBOX_MODE=local）。
 * 这里没有任何隔离，生产环境必须使用 remote-vm。
 */
export const execOnHost = (root: string, command: string, options: SandboxExecOptions = {}): Promise<SandboxExecResult> =>
  new Promise((resolve) => {
    let cwd: string;
    try {
      cwd = resolveInsideRoot(root, options.cwd || "/");
    } catch (error) {
      resolve({ code: 1, stdout: "", stderr: error instanceof Error ? error.message : String(error) });
      return;
    }
    const child = spawn("/bin/bash", ["-lc", command], {
      cwd,
      env: { ...process.env, HOME: path.join(root, ".home"), PWD: cwd },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let finished = false;
    const finish = (result: SandboxExecResult) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      resolve({
        code: result.code,
        stdout: clip(maskHostPaths(result.stdout, root)),
        stderr: clip(maskHostPaths(result.stderr, root)),
      });
    };
    const onAbort = () => {
      child.kill("SIGKILL");
      finish({ code: 130, stdout, stderr: `${stderr}\nCommand aborted.` });
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({ code: 124, stdout, stderr: `${stderr}\nCommand timed out after ${options.timeoutMs}ms.` });
    }, Math.max(1000, options.timeoutMs ?? 120_000));
    options.signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.on("data", (chunk) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk) => (stderr += chunk.toString()));
    child.on("error", (error) => finish({ code: 127, stdout, stderr: error.message }));
    child.on("close", (code) => finish({ code: code ?? 1, stdout, stderr }));
  });

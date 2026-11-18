import { createOutputCapture } from "../outputCapture";
import { spawn } from "node:child_process";
import path from "node:path";
import { maskHostPaths, resolveInsideRoot } from "../paths";
import type { SandboxExecOptions, SandboxExecResult } from "../types";

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
    const capture = createOutputCapture(root, () => child.kill("SIGKILL"));
    const child = spawn("/bin/bash", ["-lc", command], {
      cwd,
      env: { ...process.env, HOME: path.join(root, ".home"), PWD: cwd },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let finished = false;
    const finish = (result: SandboxExecResult) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      const output = capture.finish();
      resolve({
        code: output.limited ? 125 : result.code,
        stdout: maskHostPaths(output.stdout, root),
        stderr: maskHostPaths(`${output.stderr}${result.stderr}`, root),
      });
    };
    const onAbort = () => {
      child.kill("SIGKILL");
      finish({ code: 130, stdout: "", stderr: "\nCommand aborted." });
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({ code: 124, stdout: "", stderr: `\nCommand timed out after ${options.timeoutMs}ms.` });
    }, Math.max(1000, options.timeoutMs ?? 120_000));
    options.signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.on("data", capture.stdout);
    child.stderr.on("data", capture.stderr);
    child.on("error", (error) => finish({ code: 127, stdout: "", stderr: error.message }));
    child.on("close", (code) => finish({ code: code ?? 1, stdout: "", stderr: "" }));
  });

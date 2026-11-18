import { defineTool } from "../types";
import type { Sandbox } from "../../sandbox/types";

const DEFAULT_TIMEOUT_MS = Number(process.env.AGENT_BASH_TIMEOUT_MS || 120_000);
const MAX_TIMEOUT_MS = 10 * 60 * 1000;

/** 终端工具（Hermes terminal_tool）：命令在当前工作空间沙盒内执行。 */
export const BashTool = defineTool<{ command: string; timeout?: number; cwd?: string; description?: string }>({
  name: "Bash",
  toolset: "terminal",
  description: [
    "Run a shell command with its working directory set to the workspace. The cwd parameter uses virtual paths rooted at `/`.",
    "Inside command text use workspace-relative paths (e.g. bash ./script.sh or cat .aistudio/context/output.txt). Absolute shell paths refer to the execution host, not the virtual file-tool root; they are not rewritten.",
    "Use it for installing packages, running scripts, tests, git, etc.",
    "Do NOT start long-running dev servers; for frontend preview use compile_project instead.",
    "Prefer the Read/Write/Edit/Glob/Grep tools for file operations.",
  ].join("\n"),
  parameters: {
    type: "object",
    properties: {
      command: { type: "string", description: "The command to execute" },
      timeout: { type: "number", description: `Timeout in ms (default ${DEFAULT_TIMEOUT_MS}, max ${MAX_TIMEOUT_MS})` },
      cwd: { type: "string", description: "Virtual working directory (default /)" },
      description: { type: "string", description: "Short description of what this command does" },
    },
    required: ["command"],
  },
  handler: (input, { sandbox, signal }) => runTerminalCommand(input, sandbox.exec, signal),
});

export async function runTerminalCommand(
  input: { command: string; timeout?: number; cwd?: string },
  exec: Sandbox["exec"],
  signal?: AbortSignal,
) {
  const command = String(input.command || "").trim();
  if (!command) return { content: "command is required", isError: true };
  const timeoutMs = Math.min(MAX_TIMEOUT_MS, Math.max(1000, Number(input.timeout) || DEFAULT_TIMEOUT_MS));
  const result = await exec(command, { cwd: input.cwd, timeoutMs, signal });
  const parts = [];
  if (result.stdout.trim()) parts.push(result.stdout.trimEnd());
  if (result.stderr.trim()) parts.push(`[stderr]\n${result.stderr.trimEnd()}`);
  parts.push(`[exit code: ${result.code}]`);
  return { content: parts.join("\n"), isError: result.code !== 0 };
}

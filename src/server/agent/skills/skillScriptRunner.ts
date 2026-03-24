import { promises as fs } from "fs";
import path from "path";
import type { RuntimeSkill } from "./types";
import { runExecFile } from "../tools/commandRunner";
import { buildSessionIsolatedEnv } from "../tools/sessionEnv";

const isPathInside = (baseDir: string, targetPath: string) => {
  const relative = path.relative(baseDir, targetPath);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
};

const resolveSkillScriptPath = (skill: RuntimeSkill, script: string) => {
  const baseDir = path.resolve(skill.baseDir);
  const candidate = path.isAbsolute(script) ? path.resolve(script) : path.resolve(baseDir, script);
  if (!isPathInside(baseDir, candidate)) {
    throw new Error(`脚本路径越界，不允许访问 skill 目录外文件: ${script}`);
  }
  return candidate;
};

const resolveSkillCwd = (skill: RuntimeSkill, cwd?: string) => {
  const baseDir = path.resolve(skill.baseDir);
  if (!cwd || !cwd.trim()) return baseDir;
  const resolved = path.isAbsolute(cwd) ? path.resolve(cwd) : path.resolve(baseDir, cwd);
  if (resolved !== baseDir && !isPathInside(baseDir, resolved)) {
    throw new Error(`cwd 越界，不允许访问 skill 目录外路径: ${cwd}`);
  }
  return resolved;
};

const detectRuntime = (scriptPath: string, runtime?: string) => {
  if (runtime && runtime !== "auto") return runtime;
  const ext = path.extname(scriptPath).toLowerCase();
  if (ext === ".py") return "python";
  if (ext === ".js" || ext === ".mjs" || ext === ".cjs") return "node";
  if (ext === ".sh") return "sh";
  if (ext === ".bash") return "bash";
  return "auto";
};

export const runSkillScript = async (input: {
  skill: RuntimeSkill;
  script: string;
  args: string[];
  runtime: "auto" | "python" | "node" | "sh" | "bash";
  cwd?: string;
  timeoutMs: number;
  sessionId?: string;
}) => {
  const scriptPath = resolveSkillScriptPath(input.skill, input.script);
  const scriptStat = await fs.stat(scriptPath).catch(() => null);
  if (!scriptStat || !scriptStat.isFile()) {
    throw new Error(`脚本文件不存在: ${scriptPath}`);
  }

  const execCwd = resolveSkillCwd(input.skill, input.cwd);
  const isolatedEnv = await buildSessionIsolatedEnv({
    sessionId: input.sessionId,
  });
  const detectedRuntime = detectRuntime(scriptPath, input.runtime);
  const scriptInvocationArgs = [scriptPath, ...input.args];
  const candidates: Array<{ command: string; args: string[] }> = [];

  if (detectedRuntime === "python") {
    candidates.push({ command: "python3", args: scriptInvocationArgs });
    candidates.push({ command: "python", args: scriptInvocationArgs });
  } else if (detectedRuntime === "node") {
    candidates.push({ command: "node", args: scriptInvocationArgs });
  } else if (detectedRuntime === "sh") {
    candidates.push({ command: "sh", args: scriptInvocationArgs });
  } else if (detectedRuntime === "bash") {
    candidates.push({ command: "bash", args: scriptInvocationArgs });
  } else {
    candidates.push({ command: scriptPath, args: input.args });
    candidates.push({ command: "bash", args: scriptInvocationArgs });
    candidates.push({ command: "sh", args: scriptInvocationArgs });
  }

  for (const candidate of candidates) {
    const result = await runExecFile({
      command: candidate.command,
      args: candidate.args,
      cwd: execCwd,
      timeoutMs: input.timeoutMs,
      env: isolatedEnv,
    });
    if (!result.enoent) {
      return {
        ...result,
        skill: input.skill.name,
        script: scriptPath,
        runtime: detectedRuntime,
        cwd: execCwd,
        sessionId: isolatedEnv.AISTUDIO_SESSION_ID,
        command: candidate.command,
        commandArgs: candidate.args,
      };
    }
  }

  throw new Error(
    `未找到可用脚本解释器。请确认环境中已安装对应命令（尝试过: ${candidates.map((item) => item.command).join(", ")}）。`
  );
};

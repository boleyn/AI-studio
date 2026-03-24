import { buildSkillContentBlock } from "./prompt";
import { getRuntimeSkills, sampleSkillFiles } from "./registry";
import { runSkillScript } from "./skillScriptRunner";
import type { RuntimeSkill } from "./types";
import type { AgentToolDefinition } from "../tools/types";
import { DEFAULT_TOOL_TIMEOUT_MS, MAX_TOOL_TIMEOUT_MS, clampToolTimeout } from "../tools/commandRunner";

const NO_SKILL_PARAMETERS: Record<string, unknown> = {
  type: "object",
  properties: {
    name: {
      type: "string",
      description: "The exact skill name from available_skills.",
    },
  },
  required: ["name"],
};

const resolveSkillByName = (skills: RuntimeSkill[], name: string) => {
  const skill = skills.find((item) => item.name === name) || null;
  if (skill) return skill;
  const available = skills.map((item) => item.name).sort((a, b) => a.localeCompare(b));
  throw new Error(
    `未找到 skill "${name}"。可用 skills: ${available.length > 0 ? available.join(", ") : "none"}`
  );
};

export const createSkillLoadTool = async (
  options?: {
    skills?: RuntimeSkill[];
  }
): Promise<AgentToolDefinition | null> => {
  const skills = options?.skills && options.skills.length > 0 ? options.skills : await getRuntimeSkills();
  if (skills.length === 0) return null;

  return {
    name: "skill_load",
    description:
      "Load one skill's full instructions from this project's skills catalog. Use exact name from available_skills. After loading, use skill_run_script to execute scripts in that skill when needed.",
    parameters: NO_SKILL_PARAMETERS,
    run: async (input) => {
      const name =
        input && typeof input === "object" && typeof (input as { name?: unknown }).name === "string"
          ? (input as { name: string }).name.trim()
          : "";
      if (!name) {
        throw new Error("缺少 name 参数。");
      }

      const skill = resolveSkillByName(skills, name);

      const sampledFiles = await sampleSkillFiles(skill, 10);
      return buildSkillContentBlock(skill, sampledFiles);
    },
  };
};

const SKILL_RUN_SCRIPT_PARAMETERS: Record<string, unknown> = {
  type: "object",
  properties: {
    name: {
      type: "string",
      description: "The exact skill name from available_skills.",
    },
    script: {
      type: "string",
      description: "脚本路径。支持 skill 目录内相对路径或其绝对路径。",
    },
    args: {
      type: "array",
      items: { type: "string" },
      description: "脚本参数数组（可选）。",
    },
    runtime: {
      type: "string",
      enum: ["auto", "python", "node", "sh", "bash"],
      description: "脚本运行时，默认 auto 自动识别。",
    },
    cwd: {
      type: "string",
      description: "执行目录（相对于 skill 基目录或其绝对路径）。默认 skill 基目录。",
    },
    timeoutMs: {
      type: "integer",
      minimum: 1000,
      maximum: MAX_TOOL_TIMEOUT_MS,
      description: `执行超时毫秒数，默认 ${DEFAULT_TOOL_TIMEOUT_MS}，最大 ${MAX_TOOL_TIMEOUT_MS}。`,
    },
  },
  required: ["name", "script"],
};

export const createSkillRunScriptTool = async (
  options?: {
    skills?: RuntimeSkill[];
  }
): Promise<AgentToolDefinition | null> => {
  const skills = options?.skills && options.skills.length > 0 ? options.skills : await getRuntimeSkills();
  if (skills.length === 0) return null;

  return {
    name: "skill_run_script",
    description:
      "Run a script bundled in a loaded skill directory. Supports python/node/sh/bash and auto-detection by extension.",
    parameters: SKILL_RUN_SCRIPT_PARAMETERS,
    run: async (input) => {
      const payload = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
      const name = typeof payload.name === "string" ? payload.name.trim() : "";
      const script = typeof payload.script === "string" ? payload.script.trim() : "";
      const runtime = typeof payload.runtime === "string" ? payload.runtime.trim().toLowerCase() : "auto";
      const args = Array.isArray(payload.args) ? payload.args.map((item) => String(item)) : [];
      const timeoutMs = clampToolTimeout(payload.timeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS);
      const cwd = typeof payload.cwd === "string" ? payload.cwd.trim() : "";

      if (!name) throw new Error("缺少 name 参数。");
      if (!script) throw new Error("缺少 script 参数。");
      if (!["auto", "python", "node", "sh", "bash"].includes(runtime)) {
        throw new Error(`不支持 runtime=${runtime}。可选: auto/python/node/sh/bash`);
      }

      const skill = resolveSkillByName(skills, name);

      const result = await runSkillScript({
        skill,
        script,
        args,
        runtime: runtime as "auto" | "python" | "node" | "sh" | "bash",
        cwd,
        timeoutMs,
      });

      return {
        ok: result.ok,
        skill: result.skill,
        script: result.script,
        runtime: result.runtime,
        cwd: result.cwd,
        command: result.command,
        commandArgs: result.commandArgs,
        exitCode: result.exitCode,
        signal: result.signal,
        killed: result.killed,
        stdout: result.stdout,
        stderr: result.stderr,
        error: result.error,
      };
    },
  };
};

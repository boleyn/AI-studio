import { buildSkillContentBlock } from "./prompt";
import { getRuntimeSkills, sampleSkillFiles } from "./registry";
import type { RuntimeSkill } from "./types";
import type { AgentToolDefinition } from "../tools/types";

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
      "Load one skill's full instructions from this project's skills catalog. Use exact name from available_skills.",
    parameters: NO_SKILL_PARAMETERS,
    run: async (input) => {
      const name =
        input && typeof input === "object" && typeof (input as { name?: unknown }).name === "string"
          ? (input as { name: string }).name.trim()
          : "";
      if (!name) {
        throw new Error("缺少 name 参数。");
      }

      const skill = skills.find((item) => item.name === name) || null;
      const available = skills.map((item) => item.name).sort((a, b) => a.localeCompare(b));
      if (!skill) {
        throw new Error(
          `未找到 skill "${name}"。可用 skills: ${available.length > 0 ? available.join(", ") : "none"}`
        );
      }

      const sampledFiles = await sampleSkillFiles(skill, 10);
      return buildSkillContentBlock(skill, sampledFiles);
    },
  };
};

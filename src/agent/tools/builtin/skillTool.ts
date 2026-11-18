import { defineTool } from "../types";
import { createSkillCatalog } from "../../skills/catalog";

export const SkillTool = defineTool<{ skill: string; args?: string; resource?: string; offset?: number; limit?: number; query?: string }>({
  name: "Skill",
  toolset: "skills",
  readOnly: true,
  description:
    "Load a skill's full instructions (SKILL.md) from /skills or /.aistudio/skills by name. " +
    "Pass skill='list' to inspect skills (query and offset/limit supported). Loading returns reference filenames; use resource to read a selected reference with offset/limit.",
  parameters: {
    type: "object",
    properties: {
      skill: { type: "string", description: "Skill name to load, or 'list' to list available skills" },
      resource: { type: "string" },
      query: { type: "string" },
      offset: { type: "integer", minimum: 1 },
      limit: { type: "integer", minimum: 1, maximum: 200 },
      args: { type: "string", description: "Optional arguments for the skill" },
    },
    required: ["skill"],
  },
  async handler(input, { sandbox, skills: providedCatalog }) {
    const catalog = providedCatalog ?? createSkillCatalog(sandbox);
    const requested = String(input.skill || "").trim();
    const skills = await catalog.list();
    const offset = Math.max(0, (input.offset || 1) - 1);
    const limit = Math.min(200, input.limit || 40);
    if (input.resource) {
      const text = await catalog.readReference?.(requested, input.resource);
      if (text === undefined) return { content: "Skill reference not found", isError: true };
      const lines = text.split("\n");
      return { content: `Reference ${requested}/${input.resource}; ${lines.length} lines\n` + lines.slice(offset, offset + limit).map((line, index) => `${offset + index + 1}: ${line.slice(0, 2000)}`).join("\n") };
    }
    if (!requested || requested.toLowerCase() === "list") {
      if (skills.length === 0) return { content: "No skills installed in /skills or /.aistudio/skills." };
      return {
        content: skills.filter(s => !input.query || `${s.name} ${s.description}`.toLowerCase().includes(input.query.toLowerCase())).slice(offset, offset + limit).map((s) => `- ${s.name}${s.description ? `: ${s.description}` : ""} (${s.path})`).join("\n"),
      };
    }

    const loaded = await catalog.load(requested);
    const matched = loaded?.skill;
    if (!matched) {
      const available = skills.map((s) => s.name).join(", ") || "(none)";
      return { content: `Skill "${requested}" not found. Available: ${available}`, isError: true };
    }

    const content = loaded!.content;
    const argsLine = input.args ? `\n\n[Skill Arguments]\n${String(input.args)}` : "";
    return { content: `# Skill: ${matched.name} (${matched.path})\n\n${content}${argsLine}\n\nReferences (filenames only; use Skill resource to read):\n${(loaded!.references || []).join("\n")}\nRelated tools (discover schemas with search_tools): ${(matched.tools || []).join(", ") || "none"}` };
  },
});

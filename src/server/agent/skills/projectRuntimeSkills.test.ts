import { describe, expect, test } from "bun:test";
import { collectProjectRuntimeSkills } from "./projectRuntimeSkills";

describe("collectProjectRuntimeSkills", () => {
  test("loads skills from both /skills and /.claude/skills paths", () => {
    const parsed = collectProjectRuntimeSkills({
      "/skills/builtin-demo/SKILL.md": {
        code: "---\nname: builtin-demo\ndescription: from skills root\n---\n# builtin\n",
      },
      "/.claude/skills/project-demo/SKILL.md": {
        code: "---\nname: project-demo\ndescription: from claude root\n---\n# project\n",
      },
    });

    expect(parsed.skills.map((item) => item.name).sort((a, b) => a.localeCompare(b))).toEqual([
      "builtin-demo",
      "project-demo",
    ]);
    expect(parsed.entries.every((entry) => entry.isLoadable)).toBe(true);
    expect(parsed.entries.map((entry) => entry.relativeLocation)).toEqual([
      "/.claude/skills/project-demo/SKILL.md",
      "/skills/builtin-demo/SKILL.md",
    ]);
  });
});

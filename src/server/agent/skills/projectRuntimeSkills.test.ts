import { describe, expect, test } from "bun:test";
import { collectProjectRuntimeSkills } from "./projectRuntimeSkills";

describe("collectProjectRuntimeSkills", () => {
  test("loads skills from /skills and /.aistudio/skills paths", () => {
    const parsed = collectProjectRuntimeSkills({
      "/skills/builtin-demo/SKILL.md": {
        code: "---\nname: builtin-demo\ndescription: from skills root\n---\n# builtin\n",
      },
      "/.aistudio/skills/project-demo/SKILL.md": {
        code: "---\nname: project-demo\ndescription: from aistudio root\n---\n# project\n",
      },
    });

    expect(parsed.skills.map((item) => item.name).sort((a, b) => a.localeCompare(b))).toEqual([
      "builtin-demo",
      "project-demo",
    ]);
    expect(parsed.entries.every((entry) => entry.isLoadable)).toBe(true);
    expect(parsed.entries.map((entry) => entry.relativeLocation)).toContain("/skills/builtin-demo/SKILL.md");
    expect(parsed.entries.map((entry) => entry.relativeLocation)).toContain(
      "/.aistudio/skills/project-demo/SKILL.md"
    );
  });
});

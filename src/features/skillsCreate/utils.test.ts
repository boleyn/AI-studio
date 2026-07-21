import { describe, expect, test } from "bun:test";

import { normalizeAgentSkillFiles } from "./utils";

const currentFiles = {
  "/drawio-generator/SKILL.md": { code: "old skill" },
  "/drawio-generator/scripts/generate_drawio_url.py": { code: "old script" },
};

describe("normalizeAgentSkillFiles", () => {
  test("maps sandbox root-relative paths onto the active skill root", () => {
    expect(
      normalizeAgentSkillFiles(
        {
          "/SKILL.md": { code: "new skill" },
          "/scripts/generate_drawio_url.py": { code: "new script" },
        },
        currentFiles
      )
    ).toEqual({
      "/drawio-generator/SKILL.md": { code: "new skill" },
      "/drawio-generator/scripts/generate_drawio_url.py": { code: "new script" },
    });
  });

  test("maps stored skill paths onto the editor-visible skill root", () => {
    expect(
      normalizeAgentSkillFiles(
        {
          "/skills/drawio-generator/SKILL.md": { code: "new skill" },
        },
        currentFiles
      )
    ).toEqual({
      "/drawio-generator/SKILL.md": { code: "new skill" },
    });
  });
});

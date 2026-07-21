import { describe, expect, test } from "bun:test";

import { toPublicSkillRuntimeFiles, toStoredSkillRuntimeFiles } from "./runtimeFilePaths";

describe("skill runtime file paths", () => {
  test("converts editor paths to canonical stored paths", () => {
    expect(
      toStoredSkillRuntimeFiles(
        {
          "/drawio-generator/SKILL.md": { code: "updated skill" },
          "/drawio-generator/scripts/generate_drawio_url.py": { code: "updated script" },
        },
        "drawio-generator"
      )
    ).toEqual({
      "/skills/drawio-generator/SKILL.md": { code: "updated skill" },
      "/skills/drawio-generator/scripts/generate_drawio_url.py": { code: "updated script" },
    });
  });

  test("converts sandbox root-relative paths to canonical stored paths", () => {
    expect(
      toStoredSkillRuntimeFiles(
        {
          "/SKILL.md": { code: "updated skill" },
          "/scripts/generate_drawio_url.py": { code: "updated script" },
        },
        "drawio-generator"
      )
    ).toEqual({
      "/skills/drawio-generator/SKILL.md": { code: "updated skill" },
      "/skills/drawio-generator/scripts/generate_drawio_url.py": { code: "updated script" },
    });
  });

  test("returns sandbox updates using the editor-visible paths", () => {
    expect(
      toPublicSkillRuntimeFiles({
        "/skills/drawio-generator/SKILL.md": { code: "updated skill" },
        "/skills/drawio-generator/scripts/generate_drawio_url.py": { code: "updated script" },
      })
    ).toEqual({
      "/drawio-generator/SKILL.md": { code: "updated skill" },
      "/drawio-generator/scripts/generate_drawio_url.py": { code: "updated script" },
    });
  });

  test("collapses a stale duplicate before the new sandbox update is merged", () => {
    const canonicalExisting = toStoredSkillRuntimeFiles(
      {
        "/skills/drawio-generator/SKILL.md": { code: "old stored value" },
        "/drawio-generator/SKILL.md": { code: "stale duplicate" },
      },
      "drawio-generator"
    );
    const merged = {
      ...canonicalExisting,
      "/skills/drawio-generator/SKILL.md": { code: "new sandbox value" },
    };

    expect(merged).toEqual({
      "/skills/drawio-generator/SKILL.md": { code: "new sandbox value" },
    });
    expect(toPublicSkillRuntimeFiles(merged)).toEqual({
      "/drawio-generator/SKILL.md": { code: "new sandbox value" },
    });
  });
});

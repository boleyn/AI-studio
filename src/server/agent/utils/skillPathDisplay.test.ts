import { describe, expect, mock, test } from "bun:test";

mock.module("env-paths", () => ({
  default: (_appName: string) => ({
    data: "/tmp/aistudio-data",
    config: "/tmp/aistudio-config",
    cache: "/tmp/aistudio-cache",
    log: "/tmp/aistudio-log",
    temp: "/tmp/aistudio-temp",
  }),
}));

mock.module("src/bootstrap/state.js", () => ({
  getProjectRoot: () => "/virtual/project",
  getSessionId: () => "test-session-id",
}));

const { runWithVirtualProjectRoot } = await import("src/utils/fsOperations.js");
const { toModelVisibleSkillPath, withSkillBaseDirForModel } = await import(
  "src/utils/skillPathDisplay.js"
);

describe("skillPathDisplay", () => {
  test("maps real project-root host paths to model-visible virtual paths", () => {
    const result = runWithVirtualProjectRoot("/virtual/project/.aistudio/demo", () =>
      toModelVisibleSkillPath("/virtual/project/skills/demo/SKILL.md")
    );
    expect(result).toBe("/skills/demo/SKILL.md");
  });

  test("maps in-virtual-root paths to slash-prefixed model paths", () => {
    const result = runWithVirtualProjectRoot("/virtual/project/.aistudio/demo", () =>
      toModelVisibleSkillPath("/virtual/project/.aistudio/demo/.aistudio/skills/demo")
    );
    expect(result).toBe("/.aistudio/skills/demo");
  });

  test("does not infer virtual paths from repeated host directory names outside the project roots", () => {
    const result = runWithVirtualProjectRoot("/virtual/project/.aistudio/demo", () =>
      toModelVisibleSkillPath("/tmp/project-copy/skills/demo/virtual/project/skills/demo/SKILL.md")
    );
    expect(result).toBe("<outside-project-path>");
  });

  test("prefixes skill content with virtualized base directory and masks host paths", () => {
    const result = runWithVirtualProjectRoot("/virtual/project/.aistudio/demo", () =>
      withSkillBaseDirForModel(
        "Read /virtual/project/skills/demo/SKILL.md and inspect /virtual/project/.aistudio/demo/src/app.ts",
        "/virtual/project/.aistudio/demo/skills/demo"
      )
    );
    expect(result).toContain("Base directory for this skill: <outside-project-path>");
    expect(result).toContain("Read /skills/demo/SKILL.md");
    expect(result).toContain("/src/app.ts");
  });
});

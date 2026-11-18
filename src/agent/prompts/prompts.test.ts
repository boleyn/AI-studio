import { describe, expect, test } from "bun:test";
import { buildSystemPrompt, buildTurnContext } from "./index";

const context = {
  sandboxKind: "connector" as const,
  permissionMode: "plan",
  selectedSkills: ["demo"],
  availableSkills: [
    { name: "demo", description: "Demo", path: "/skills/demo/SKILL.md" },
  ],
  systemDirectives: [],
  currentAttachments: [],
  projectFilePaths: [],
};

describe("capability-aware prompt composition", () => {
  test("disabled capabilities do not leave instructions referring to missing tools", () => {
    const prompt = buildSystemPrompt({ ...context, toolNames: new Set() });
    for (const name of [
      "compile_project",
      "AskUserQuestion",
      "ExitPlanMode",
      "`Skill`",
      "demo",
    ])
      expect(prompt).not.toContain(name);
    expect(prompt).toContain("PLAN MODE");
    expect(prompt).toContain("LOCAL CONNECTOR");
  });
  test("active capability instructions and plugin sections compose with user context", () => {
    const prompt = buildSystemPrompt({
      ...context,
      toolNames: new Set(["Skill", "AskUserQuestion"]),
    });
    expect(prompt).not.toContain("demo: Demo");
    expect(buildTurnContext({ ...context, toolNames: new Set(["Skill"]) })).toContain("demo: Demo");
    expect(prompt).toContain("AskUserQuestion");
    expect(prompt).not.toContain("Trusted plugin instruction");
    expect(prompt).not.toContain("ExitPlanMode");
  });
});

test("changing attachments, memories and file lists does not change system prefix", () => {
  const initial = { ...context, toolNames: new Set(["Read", "Skill"]) };
  expect(buildSystemPrompt(initial)).toBe(buildSystemPrompt({ ...initial, memoryBlock: "new memory", currentAttachments: ["new.pdf"], projectFilePaths: ["/new.ts"] }));
});

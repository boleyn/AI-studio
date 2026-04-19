import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildProjectMemfsOverlay } from "./claudeQueryAdapter";

describe("buildProjectMemfsOverlay virtual root boundary", () => {
  const projectRoot = "/virtual/project";

  test("allows read/write operations inside virtual project root", async () => {
    const fs = buildProjectMemfsOverlay(projectRoot, {
      "src/index.ts": { code: "export const ok = true;\n" },
    });

    const content = fs.readFileSync(path.join(projectRoot, "src/index.ts"), {
      encoding: "utf8",
    });
    expect(content).toContain("ok = true");

    await fs.mkdir(path.join(projectRoot, "src/lib"), { mode: 0o755 });
    await fs.readFile(path.join(projectRoot, "src/index.ts"), {
      encoding: "utf8",
    });
    fs.appendFileSync(path.join(projectRoot, "src/index.ts"), "// tail\n");

    const updated = fs.readFileSync(path.join(projectRoot, "src/index.ts"), {
      encoding: "utf8",
    });
    expect(updated.endsWith("// tail\n")).toBe(true);
  });

  test("treats parent directory escape as non-existent for read probes", async () => {
    const fs = buildProjectMemfsOverlay(projectRoot, {
      "src/index.ts": { code: "safe\n" },
    });

    expect(() =>
      fs.readFileSync("../outside.txt", {
        encoding: "utf8",
      }),
    ).toThrow(/ENOENT/i);

    await expect(
      fs.readFile("../outside.txt", {
        encoding: "utf8",
      }),
    ).rejects.toThrow(/ENOENT/i);
  });

  test("treats absolute host path outside virtual project root as non-existent for read probes", () => {
    const fs = buildProjectMemfsOverlay(projectRoot, {
      "src/index.ts": { code: "safe\n" },
    });

    expect(fs.existsSync("/Users/real/secrets.txt")).toBe(false);
    expect(() =>
      fs.readFileSync("/Users/real/secrets.txt", {
        encoding: "utf8",
      }),
    ).toThrow(/ENOENT/i);
  });

  test("still blocks write operations outside virtual project root", async () => {
    const fs = buildProjectMemfsOverlay(projectRoot, {
      "src/index.ts": { code: "safe\n" },
    });

    await expect(
      fs.mkdir("/Users/real/should-not-create", { mode: 0o755 }),
    ).rejects.toThrow(/outside virtual project root/i);
  });

  test("returns false for existsSync outside root (non-fatal probe behavior)", () => {
    const fs = buildProjectMemfsOverlay(projectRoot, {
      "src/index.ts": { code: "safe\n" },
    });

    expect(fs.existsSync("/Users/santain/.claude/.config.json")).toBe(false);
  });

  test("maps /skills files into /.claude/skills for runtime skill discovery", () => {
    const fs = buildProjectMemfsOverlay(projectRoot, {
      "/skills/demo/SKILL.md": { code: "---\nname: demo\n---\n# demo\n" },
      "/skills/demo/scripts/run.sh": { code: "echo demo\n" },
    });

    const skill = fs.readFileSync(path.join(projectRoot, ".claude/skills/demo/SKILL.md"), {
      encoding: "utf8",
    });
    const script = fs.readFileSync(path.join(projectRoot, ".claude/skills/demo/scripts/run.sh"), {
      encoding: "utf8",
    });
    expect(skill).toContain("name: demo");
    expect(script).toContain("echo demo");
  });

  test("keeps explicit /.claude/skills file when both paths exist", () => {
    const fs = buildProjectMemfsOverlay(projectRoot, {
      "/skills/demo/SKILL.md": { code: "---\nname: demo\n---\n# from skills\n" },
      "/.claude/skills/demo/SKILL.md": {
        code: "---\nname: demo\n---\n# from claude skills\n",
      },
    });

    const content = fs.readFileSync(path.join(projectRoot, ".claude/skills/demo/SKILL.md"), {
      encoding: "utf8",
    });
    expect(content).toContain("from claude skills");
    expect(content).not.toContain("from skills");
  });

  test("loads built-in skills from system skills root into /skills and /.claude/skills", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aistudio-system-skills-"));
    const systemSkillsRoot = path.join(tempDir, "skills");
    fs.mkdirSync(path.join(systemSkillsRoot, "builtin-one"), { recursive: true });
    fs.writeFileSync(
      path.join(systemSkillsRoot, "builtin-one", "SKILL.md"),
      "---\nname: builtin-one\n---\n# builtin one\n",
      "utf8"
    );
    fs.mkdirSync(path.join(systemSkillsRoot, "builtin-one", "scripts"), { recursive: true });
    fs.writeFileSync(
      path.join(systemSkillsRoot, "builtin-one", "scripts", "run.sh"),
      "echo builtin\n",
      "utf8"
    );

    const overlay = buildProjectMemfsOverlay(
      projectRoot,
      {},
      {
        systemSkillsRoot,
      }
    );

    const inSkillsRoot = overlay.readFileSync(path.join(projectRoot, "skills/builtin-one/SKILL.md"), {
      encoding: "utf8",
    });
    const inClaudeSkills = overlay.readFileSync(path.join(projectRoot, ".claude/skills/builtin-one/SKILL.md"), {
      encoding: "utf8",
    });
    expect(inSkillsRoot).toContain("builtin-one");
    expect(inClaudeSkills).toContain("builtin-one");
  });

  test("project-provided /skills files override system built-in skill files", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aistudio-system-skills-override-"));
    const systemSkillsRoot = path.join(tempDir, "skills");
    fs.mkdirSync(path.join(systemSkillsRoot, "demo"), { recursive: true });
    fs.writeFileSync(
      path.join(systemSkillsRoot, "demo", "SKILL.md"),
      "---\nname: demo\n---\n# from system\n",
      "utf8"
    );

    const overlay = buildProjectMemfsOverlay(
      projectRoot,
      {
        "/skills/demo/SKILL.md": { code: "---\nname: demo\n---\n# from project\n" },
      },
      {
        systemSkillsRoot,
      }
    );

    const content = overlay.readFileSync(path.join(projectRoot, ".claude/skills/demo/SKILL.md"), {
      encoding: "utf8",
    });
    expect(content).toContain("from project");
    expect(content).not.toContain("from system");
  });
});

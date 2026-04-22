import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildProjectMemfsOverlay, exportProjectFilesFromFs } from "./claudeQueryAdapter";
import { writeTextContent } from "../utils/file";
import { getClaudeConfigHomeDir, runWithClaudeConfigHomeDir } from "../utils/envUtils";
import { runWithFsImplementation, runWithVirtualProjectRoot } from "../utils/fsOperations";

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
    ).rejects.toThrow(
      /Access denied: path "<masked-outside-path>" is outside the project sandbox/i
    );
  });

  test("treats absolute virtual paths as project-root relative for write operations", async () => {
    const fs = buildProjectMemfsOverlay(projectRoot, {});
    await fs.mkdir("/nested", { mode: 0o755 });
    fs.appendFileSync("/nested/styles.css", ".app { color: red; }\n");
    const content = fs.readFileSync(path.join(projectRoot, "nested/styles.css"), {
      encoding: "utf8",
    });
    expect(content).toContain("color: red");
  });

  test("returns false for existsSync outside root (non-fatal probe behavior)", () => {
    const fs = buildProjectMemfsOverlay(projectRoot, {
      "src/index.ts": { code: "safe\n" },
    });

    expect(fs.existsSync("/Users/santain/.claude/.config.json")).toBe(false);
  });

  test("maps /skills files into /.aistudio/skills for runtime skill discovery", () => {
    const fs = buildProjectMemfsOverlay(projectRoot, {
      "/skills/demo/SKILL.md": { code: "---\nname: demo\n---\n# demo\n" },
      "/skills/demo/scripts/run.sh": { code: "echo demo\n" },
    });

    const skill = fs.readFileSync(path.join(projectRoot, ".aistudio/skills/demo/SKILL.md"), {
      encoding: "utf8",
    });
    const script = fs.readFileSync(path.join(projectRoot, ".aistudio/skills/demo/scripts/run.sh"), {
      encoding: "utf8",
    });
    expect(skill).toContain("name: demo");
    expect(script).toContain("echo demo");
  });

  test("keeps explicit /.aistudio/skills file when both paths exist", () => {
    const fs = buildProjectMemfsOverlay(projectRoot, {
      "/skills/demo/SKILL.md": { code: "---\nname: demo\n---\n# from skills\n" },
      "/.aistudio/skills/demo/SKILL.md": {
        code: "---\nname: demo\n---\n# from aistudio skills\n",
      },
    });

    const content = fs.readFileSync(path.join(projectRoot, ".aistudio/skills/demo/SKILL.md"), {
      encoding: "utf8",
    });
    expect(content).toContain("from aistudio skills");
    expect(content).not.toContain("from skills");
  });

  test("loads built-in skills from system skills root into /skills and /.aistudio/skills", () => {
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
    const inAistudioSkills = overlay.readFileSync(path.join(projectRoot, ".aistudio/skills/builtin-one/SKILL.md"), {
      encoding: "utf8",
    });
    const scriptViaAbsoluteVirtualPath = overlay.readFileSync("/skills/builtin-one/scripts/run.sh", {
      encoding: "utf8",
    });
    expect(inSkillsRoot).toContain("builtin-one");
    expect(inAistudioSkills).toContain("builtin-one");
    expect(scriptViaAbsoluteVirtualPath).toContain("builtin");
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

    const content = overlay.readFileSync(path.join(projectRoot, ".aistudio/skills/demo/SKILL.md"), {
      encoding: "utf8",
    });
    expect(content).toContain("from project");
    expect(content).not.toContain("from system");
  });

  test("remaps host project absolute paths back into the virtual project root", () => {
    const hostProjectRoot = process.cwd();
    const overlay = buildProjectMemfsOverlay(projectRoot, {
      "/.aistudio/skills/demo/SKILL.md": { code: "---\nname: demo\n---\n# demo\n" },
      "/src/app.ts": { code: "export const app = true;\n" },
    });

    const hostAbsoluteSkillPath = path.join(
      hostProjectRoot,
      ".aistudio",
      "skills",
      "demo",
      "SKILL.md"
    );
    const hostAbsoluteSourcePath = path.join(hostProjectRoot, "src", "app.ts");

    const skillContent = overlay.readFileSync(hostAbsoluteSkillPath, {
      encoding: "utf8",
    });
    const sourceContent = overlay.readFileSync(hostAbsoluteSourcePath, {
      encoding: "utf8",
    });

    expect(skillContent).toContain("name: demo");
    expect(sourceContent).toContain("app = true");
  });

  test("remaps host home probes into the virtual project home", () => {
    const overlay = buildProjectMemfsOverlay(projectRoot, {});
    const hostHome = os.homedir();

    expect(overlay.existsSync(hostHome)).toBe(true);
    expect(() => overlay.readdirSync(hostHome)).not.toThrow();
  });

  test("uses a virtual .aistudio config home while running inside a virtual project", () => {
    const virtualRoot = path.join(projectRoot, ".aistudio-virtual", "demo-token");
    const configHome = path.join(virtualRoot, ".aistudio");

    const result = runWithClaudeConfigHomeDir(configHome, () => getClaudeConfigHomeDir());

    expect(result).toBe(configHome);
    expect(result).not.toContain(`${path.sep}.claude`);
  });

  test("exports updated project files from virtual filesystem snapshot", () => {
    const overlay = buildProjectMemfsOverlay(projectRoot, {
      "/App.js": { code: "<h1>old</h1>\n" },
    });

    overlay.appendFileSync(path.join(projectRoot, "App.js"), "<p>new</p>\n");
    overlay.mkdirSync(path.join(projectRoot, ".aistudio", "tmp"));
    overlay.appendFileSync(path.join(projectRoot, ".aistudio", "tmp", "ignored.txt"), "ignore\n");

    const exported = exportProjectFilesFromFs(overlay, projectRoot);

    expect(exported["/App.js"]?.code).toBe("<h1>old</h1>\n<p>new</p>\n");
    expect(exported["/.aistudio/tmp/ignored.txt"]).toBeUndefined();
  });

  test("decodes data-url base64 content for binary attachment files", () => {
    const overlay = buildProjectMemfsOverlay(projectRoot, {
      "/.files/sample.pdf": {
        code: "data:application/pdf;base64,JVBERi0xLjQK",
      },
    });

    const raw = overlay.readFileBytesSync(path.join(projectRoot, ".files", "sample.pdf")) as Buffer;
    expect(Buffer.isBuffer(raw)).toBe(true);
    expect(raw.subarray(0, 5).toString()).toBe("%PDF-");
  });

  test("does not export mirrored /.files attachments to updated editor files", () => {
    const overlay = buildProjectMemfsOverlay(projectRoot, {
      "/App.js": { code: "export const ok = true;\n" },
      "/.files/sample.pdf": {
        code: "data:application/pdf;base64,JVBERi0xLjQK",
      },
    });

    const exported = exportProjectFilesFromFs(overlay, projectRoot);
    expect(exported["/App.js"]?.code).toContain("ok = true");
    expect(exported["/.files/sample.pdf"]).toBeUndefined();
  });

  test("writeTextContent writes through virtual filesystem implementation", () => {
    const overlay = buildProjectMemfsOverlay(projectRoot, {
      "/App.js": { code: "<h1>old</h1>\n" },
    });

    runWithVirtualProjectRoot(projectRoot, () =>
      runWithFsImplementation(overlay, () => {
        writeTextContent(path.join(projectRoot, "App.js"), "<h1>new</h1>\n", "utf8", "LF");
      })
    );

    const exported = exportProjectFilesFromFs(overlay, projectRoot);
    expect(exported["/App.js"]?.code).toBe("<h1>new</h1>\n");
  });
});

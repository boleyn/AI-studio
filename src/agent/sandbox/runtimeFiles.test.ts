import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { prepareAgentSandboxWorkspace } from "./workspace";
import { collectSystemSkillFiles, excludeProjectOverrides } from "./runtimeFiles";

describe("runtime project files", () => {
  test("mounts repository skills under the sandbox /skills directory", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "aistudio-runtime-skills-"));
    try {
      const skillDir = path.join(root, "pdf-text-extractor");
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(
        path.join(skillDir, "SKILL.md"),
        "---\nname: pdf-text-extractor\n---\nExtract PDF text.\n",
      );
      fs.writeFileSync(path.join(skillDir, "index.js"), "export default {};\n");

      const files = collectSystemSkillFiles(root);
      expect(files["/skills/pdf-text-extractor/SKILL.md"]?.code).toContain(
        "name: pdf-text-extractor",
      );
      expect(files["/skills/pdf-text-extractor/index.js"]?.code).toContain(
        "export default",
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("makes mounted skills readable through the sandbox virtual filesystem", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "aistudio-runtime-skills-"));
    const baseCwd = fs.mkdtempSync(path.join(os.tmpdir(), "aistudio-runtime-workspace-"));
    try {
      const skillDir = path.join(root, "pdf-text-extractor");
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(
        path.join(skillDir, "SKILL.md"),
        "---\nname: pdf-text-extractor\n---\nExtract PDF text.\n",
      );

      const workspace = await prepareAgentSandboxWorkspace({
        baseCwd,
        workspaceIdentity: "runtime-skill-test",
        hostProjectRoot: baseCwd,
        projectFiles: {
          "/src/index.ts": { code: "project\n" },
        },
        runtimeFiles: collectSystemSkillFiles(root),
      });

      const skillText = fs.readFileSync(
        path.join(workspace.workspaceRoot, "skills/pdf-text-extractor/SKILL.md"),
        "utf8",
      );
      expect(skillText).toContain("name: pdf-text-extractor");
      expect(
        fs.readFileSync(path.join(workspace.workspaceRoot, "src/index.ts"), "utf8"),
      ).toBe("project\n");
      expect(
        fs.existsSync(
          path.join(workspace.workspaceRoot, "skills/pdf-text-extractor/SKILL.md"),
        ),
      ).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(baseCwd, { recursive: true, force: true });
    }
  });

  test("does not mount a runtime skill over an explicit project file", () => {
    const runtimeFiles = {
      "/skills/demo/SKILL.md": { code: "runtime\n" },
      "/skills/other/SKILL.md": { code: "other\n" },
    };
    const filtered = excludeProjectOverrides(runtimeFiles, {
      "skills/demo/SKILL.md": { code: "project\n" },
    });

    expect(filtered["/skills/demo/SKILL.md"]).toBeUndefined();
    expect(filtered["/skills/other/SKILL.md"]?.code).toBe("other\n");
  });
});

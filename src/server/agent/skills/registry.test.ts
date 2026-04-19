import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdtemp, mkdir, readdir, readFile, rm, stat, writeFile } from "fs/promises";
import os from "os";
import path from "path";

let testCwd = "";

function toPosix(input: string): string {
  return input.replaceAll("\\", "/");
}

mock.module("../utils/cwd.js", () => ({
  getCwd: () => testCwd,
}));

mock.module("../utils/file.js", () => ({
  maskVirtualPathForDisplay: (inputPath: string) => {
    const normalizedInput = path.resolve(inputPath);
    const normalizedRoot = path.resolve(testCwd);
    if (normalizedInput === normalizedRoot) return "<virtual-project-root>";
    if (!normalizedInput.startsWith(`${normalizedRoot}${path.sep}`)) {
      return normalizedInput;
    }
    const rel = toPosix(path.relative(normalizedRoot, normalizedInput));
    return rel ? `<virtual-project-root>/${rel}` : "<virtual-project-root>";
  },
}));

mock.module("../utils/fsOperations.js", () => ({
  getFsImplementation: () => ({
    async readdir(dirPath: string) {
      return readdir(dirPath, { withFileTypes: true });
    },
    async readFile(filePath: string, options: { encoding: BufferEncoding }) {
      return readFile(filePath, { encoding: options.encoding });
    },
    async mkdir(dirPath: string, _options?: { mode?: number }) {
      await mkdir(dirPath, { recursive: true });
    },
    async writeFile(filePath: string, content: string, encoding: BufferEncoding) {
      await writeFile(filePath, content, encoding);
    },
    async stat(filePath: string) {
      return stat(filePath);
    },
  }),
}));

const {
  createProjectSkill,
  getSkillSnapshot,
  sampleSkillFiles,
} = await import("./registry");

describe("skills registry virtual path behavior", () => {
  let tempRoot = "";

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "aistudio-skill-registry-"));
    testCwd = tempRoot;
    await mkdir(path.join(tempRoot, ".aistudio", "skills", "demo"), {
      recursive: true,
    });
    await writeFile(
      path.join(tempRoot, ".aistudio", "skills", "demo", "SKILL.md"),
      "---\nname: demo\ndescription: demo skill\n---\n\n# demo\n",
      "utf8",
    );
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  test("snapshot uses masked/virtualized paths", async () => {
    const snapshot = await getSkillSnapshot(true);
    expect(snapshot.rootDir).toBe("/.aistudio/skills + /skills");
    expect(snapshot.entries.length).toBe(1);

    expect(snapshot.entries.map(item => item.location)).toContain(
      "<virtual-project-root>/.aistudio/skills/demo/SKILL.md",
    );
  });

  test("createProjectSkill returns masked paths and sampleSkillFiles stays masked", async () => {
    const created = await createProjectSkill({
      name: "new skill",
      description: "hello",
      body: "# new\n",
    });

    expect(created.skillDir).toBe(
      "<virtual-project-root>/.aistudio/skills/new-skill",
    );
    expect(created.skillFile).toBe(
      "<virtual-project-root>/.aistudio/skills/new-skill/SKILL.md",
    );

    const snapshot = await getSkillSnapshot(true);
    const runtime = snapshot.skills.find(item => item.name === "new-skill");
    expect(runtime).toBeDefined();

    const sampled = await sampleSkillFiles(runtime!, 10);
    expect(sampled.length).toBeGreaterThan(0);
    for (const p of sampled) {
      expect(p.startsWith("<virtual-project-root>/")).toBe(true);
      expect(p.includes(tempRoot)).toBe(false);
    }
  });
});

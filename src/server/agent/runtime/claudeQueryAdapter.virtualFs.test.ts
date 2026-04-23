import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { prepareAgentSandboxWorkspace } from "./agentSandboxWorkspace";
import { writeTextContent } from "../utils/file";
import { runWithFsImplementation, runWithVirtualProjectRoot, type FsOperations } from "../utils/fsOperations";

type ProjectFilesInput = Record<string, { code?: string }>;

const VIRTUAL_PROJECT_ROOT = "/virtual/project";

const normalizeProjectFilePath = (filePath: string): string => {
  const normalized = filePath.replace(/\\/g, "/").trim();
  if (!normalized) return "/";
  return normalized.startsWith("/") ? normalized : `/${normalized}`;
};

const isExportableRuntimeProjectPath = (filePath: string): boolean => {
  const normalized = normalizeProjectFilePath(filePath);
  if (normalized === "/.aistudio" || normalized.startsWith("/.aistudio/")) return false;
  if (normalized === "/.aistudio-home" || normalized.startsWith("/.aistudio-home/")) return false;
  if (normalized === "/.files" || normalized.startsWith("/.files/")) return false;
  return true;
};

const exportProjectFilesFromScopedFs = (
  fsImplementation: FsOperations,
  projectRoot: string,
): Record<string, { code: string }> => {
  const files: Record<string, { code: string }> = {};
  const root = path.resolve(projectRoot);

  const walk = (absoluteDir: string) => {
    let entries: ReturnType<FsOperations["readdirSync"]>;
    try {
      entries = fsImplementation.readdirSync(absoluteDir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const absolutePath = path.join(absoluteDir, entry.name);
      const relativePath = `/${path.relative(root, absolutePath).replace(/\\/g, "/")}`;
      if (!isExportableRuntimeProjectPath(relativePath)) continue;
      if (entry.isDirectory()) {
        walk(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;
      files[normalizeProjectFilePath(relativePath)] = {
        code: fsImplementation.readFileSync(absolutePath, { encoding: "utf8" }),
      };
    }
  };

  walk(root);
  return files;
};

const createScopedSandboxFs = async (
  projectFiles: ProjectFilesInput,
  hostProjectRoot = VIRTUAL_PROJECT_ROOT,
) => {
  const baseCwd = fs.mkdtempSync(path.join(os.tmpdir(), "aistudio-sandbox-vfs-"));
  const workspaceIdentity = `test-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  const prepared = await prepareAgentSandboxWorkspace({
    baseCwd,
    workspaceIdentity,
    hostProjectRoot,
    projectFiles,
  });

  return {
    baseCwd,
    workspaceIdentity,
    scopedFs: prepared.scopedFs,
    workspaceRoot: prepared.workspaceRoot,
    persistToS3: prepared.persistToS3,
    cleanup: () => fs.rmSync(baseCwd, { recursive: true, force: true }),
  };
};

describe("agent sandbox workspace virtual root boundary", () => {
  test("allows read/write operations inside virtual project root", async () => {
    const sandbox = await createScopedSandboxFs({
      "src/index.ts": { code: "export const ok = true;\n" },
    });

    try {
      const filePath = path.join(VIRTUAL_PROJECT_ROOT, "src/index.ts");
      const content = sandbox.scopedFs.readFileSync(filePath, { encoding: "utf8" });
      expect(content).toContain("ok = true");

      await sandbox.scopedFs.mkdir(path.join(VIRTUAL_PROJECT_ROOT, "src/lib"), { mode: 0o755 });
      sandbox.scopedFs.appendFileSync(filePath, "// tail\n");
      const updated = sandbox.scopedFs.readFileSync(filePath, { encoding: "utf8" });
      expect(updated.endsWith("// tail\n")).toBe(true);
    } finally {
      sandbox.cleanup();
    }
  });

  test("treats parent directory escape as non-existent for read probes", async () => {
    const sandbox = await createScopedSandboxFs({
      "src/index.ts": { code: "safe\n" },
    });

    try {
      expect(() =>
        sandbox.scopedFs.readFileSync("../outside.txt", {
          encoding: "utf8",
        }),
      ).toThrow(/ENOENT/i);

      await expect(
        sandbox.scopedFs.readFile("../outside.txt", {
          encoding: "utf8",
        }),
      ).rejects.toThrow(/ENOENT/i);
    } finally {
      sandbox.cleanup();
    }
  });

  test("treats absolute host path outside virtual project root as non-existent for read probes", async () => {
    const sandbox = await createScopedSandboxFs({
      "src/index.ts": { code: "safe\n" },
    });

    try {
      expect(sandbox.scopedFs.existsSync("/Users/real/secrets.txt")).toBe(false);
      expect(() =>
        sandbox.scopedFs.readFileSync("/Users/real/secrets.txt", {
          encoding: "utf8",
        }),
      ).toThrow(/ENOENT/i);
    } finally {
      sandbox.cleanup();
    }
  });

  test("treats absolute virtual paths as project-root relative for write operations", async () => {
    const sandbox = await createScopedSandboxFs({});

    try {
      await sandbox.scopedFs.mkdir("/nested", { mode: 0o755 });
      sandbox.scopedFs.appendFileSync("/nested/styles.css", ".app { color: red; }\n");
      const content = sandbox.scopedFs.readFileSync(path.join(VIRTUAL_PROJECT_ROOT, "nested/styles.css"), {
        encoding: "utf8",
      });
      expect(content).toContain("color: red");
    } finally {
      sandbox.cleanup();
    }
  });

  test("remaps host project absolute paths back into sandbox workspace", async () => {
    const hostProjectRoot = process.cwd();
    const sandbox = await createScopedSandboxFs(
      {
        "/src/app.ts": { code: "export const app = true;\n" },
      },
      hostProjectRoot,
    );

    try {
      const hostAbsoluteSourcePath = path.join(hostProjectRoot, "src", "app.ts");
      const sourceContent = sandbox.scopedFs.readFileSync(hostAbsoluteSourcePath, {
        encoding: "utf8",
      });
      expect(sourceContent).toContain("app = true");
    } finally {
      sandbox.cleanup();
    }
  });

  test("decodes data-url base64 content for binary attachment files", async () => {
    const sandbox = await createScopedSandboxFs({
      "/.files/sample.pdf": {
        code: "data:application/pdf;base64,JVBERi0xLjQK",
      },
    });

    try {
      const raw = sandbox.scopedFs.readFileBytesSync(path.join(VIRTUAL_PROJECT_ROOT, ".files", "sample.pdf")) as Buffer;
      expect(Buffer.isBuffer(raw)).toBe(true);
      expect(raw.subarray(0, 5).toString()).toBe("%PDF-");
    } finally {
      sandbox.cleanup();
    }
  });

  test("exports updated project files from scoped filesystem snapshot", async () => {
    const sandbox = await createScopedSandboxFs({
      "/App.js": { code: "<h1>old</h1>\n" },
    });

    try {
      sandbox.scopedFs.appendFileSync(path.join(VIRTUAL_PROJECT_ROOT, "App.js"), "<p>new</p>\n");
      sandbox.scopedFs.mkdirSync(path.join(VIRTUAL_PROJECT_ROOT, ".aistudio", "tmp"));
      sandbox.scopedFs.appendFileSync(path.join(VIRTUAL_PROJECT_ROOT, ".aistudio", "tmp", "ignored.txt"), "ignore\n");

      const exported = exportProjectFilesFromScopedFs(sandbox.scopedFs, VIRTUAL_PROJECT_ROOT);
      expect(exported["/App.js"]?.code).toBe("<h1>old</h1>\n<p>new</p>\n");
      expect(exported["/.aistudio/tmp/ignored.txt"]).toBeUndefined();
    } finally {
      sandbox.cleanup();
    }
  });

  test("does not export mirrored /.files attachments to updated editor files", async () => {
    const sandbox = await createScopedSandboxFs({
      "/App.js": { code: "export const ok = true;\n" },
      "/.files/sample.pdf": {
        code: "data:application/pdf;base64,JVBERi0xLjQK",
      },
    });

    try {
      const exported = exportProjectFilesFromScopedFs(sandbox.scopedFs, VIRTUAL_PROJECT_ROOT);
      expect(exported["/App.js"]?.code).toContain("ok = true");
      expect(exported["/.files/sample.pdf"]).toBeUndefined();
    } finally {
      sandbox.cleanup();
    }
  });

  test("writeTextContent writes through scoped filesystem implementation", async () => {
    const sandbox = await createScopedSandboxFs({
      "/App.js": { code: "<h1>old</h1>\n" },
    });

    try {
      runWithVirtualProjectRoot(VIRTUAL_PROJECT_ROOT, () =>
        runWithFsImplementation(sandbox.scopedFs, () => {
          writeTextContent(path.join(VIRTUAL_PROJECT_ROOT, "App.js"), "<h1>new</h1>\n", "utf8", "LF");
        }),
      );

      const exported = exportProjectFilesFromScopedFs(sandbox.scopedFs, VIRTUAL_PROJECT_ROOT);
      expect(exported["/App.js"]?.code).toBe("<h1>new</h1>\n");
    } finally {
      sandbox.cleanup();
    }
  });
});

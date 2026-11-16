import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { HostDirFileSystem } from "../sandbox/environments/hostDirFs";
import type { Sandbox } from "../sandbox";
import { registry } from "./index";

const createTempSandbox = (): { sandbox: Sandbox; cleanup: () => void } => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-tools-test-"));
  const hostFs = new HostDirFileSystem(root);
  const sandbox: Sandbox = {
    kind: "local",
    workspaceKey: "test",
    fs: hostFs,
    async exec() {
      return { code: 0, stdout: "ok", stderr: "" };
    },
    async persist() {},
    async exportProjectFiles() {
      return hostFs.exportTextFiles();
    },
    async dispose() {},
  };
  return {
    sandbox,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
};

describe("Hermes tool registry & built-in tools", () => {
  test("Write, Read, Edit, Glob, Grep work end-to-end inside sandbox", async () => {
    const { sandbox, cleanup } = createTempSandbox();
    const ctx = {
      sandbox,
      toolUseId: "tu_1",
      emit: () => {},
      requestInteraction: async () => null,
      permissionMode: "default",
    };

    try {
      const writeRes = await registry.dispatch("Write", { file_path: "/src/hello.ts", content: "const x = 1;\n" }, ctx);
      expect(writeRes.isError).toBeUndefined();
      expect(writeRes.changedPaths).toEqual(["/src/hello.ts"]);

      const editRes = await registry.dispatch(
        "Edit",
        { file_path: "/src/hello.ts", old_string: "const x = 1;", new_string: "const x = 42;" },
        ctx,
      );
      expect(editRes.isError).toBeUndefined();

      const readRes = await registry.dispatch("Read", { file_path: "/src/hello.ts" }, ctx);
      expect(readRes.content).toContain("const x = 42;");

      const globRes = await registry.dispatch("Glob", { pattern: "**/*.ts" }, ctx);
      expect(globRes.content).toContain("/src/hello.ts");

      const grepRes = await registry.dispatch("Grep", { pattern: "42", output_mode: "content" }, ctx);
      expect(grepRes.content).toContain("/src/hello.ts:1:const x = 42;");
    } finally {
      cleanup();
    }
  });

  test("Skill tool discovers and reads SKILL.md", async () => {
    const { sandbox, cleanup } = createTempSandbox();
    const ctx = {
      sandbox,
      toolUseId: "tu_2",
      emit: () => {},
      requestInteraction: async () => null,
      permissionMode: "default",
    };
    try {
      await sandbox.fs.writeFile("/skills/demo/SKILL.md", "---\nname: demo\ndescription: Demo skill\n---\nHello skill");
      const listRes = await registry.dispatch("Skill", { skill: "list" }, ctx);
      expect(listRes.content).toContain("demo: Demo skill");

      const loadRes = await registry.dispatch("Skill", { skill: "demo" }, ctx);
      expect(loadRes.content).toContain("Hello skill");
    } finally {
      cleanup();
    }
  });
});

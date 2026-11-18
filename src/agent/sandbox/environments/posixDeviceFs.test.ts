import { test, expect } from "bun:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPosixDeviceFileSystem } from "./posixDeviceFs";
import { prepareConnectorWorkspace } from "../connectorWorkspace";
import { createSkillCatalog } from "../../skills/catalog";
import type { Sandbox } from "../types";

test("native POSIX transport mounts skills, recovers large binary files and exports only changes", async () => {
  const root = await mkdtemp(join(tmpdir(), "device-fs-"));
  const execute = promisify(execFile);
  let largestOutput = 0;
  const fs = createPosixDeviceFileSystem(root, async command => {
    try {
      const { stdout, stderr } = await execute("/bin/bash", ["-c", command], { cwd: root, maxBuffer: 1024 * 1024 });
      largestOutput = Math.max(largestOutput, Buffer.byteLength(stdout));
      return { code: 0, stdout: stdout.slice(0, 128 * 1024), stderr };
    } catch (error) {
      const result = error as { code?: number; stdout?: string; stderr?: string };
      return { code: Number(result.code) || 1, stdout: result.stdout || "", stderr: result.stderr || "command failed" };
    }
  });
  try {
    await fs.writeFile("/existing.txt", "original");
    await fs.writeFile("/skills/custom/SKILL.md", "---\nname: custom\ndescription: User skill\n---\nUser SOP");
    const workspace = await prepareConnectorWorkspace(fs, {
      "/skills/custom/SKILL.md": { code: "must not overwrite" },
      "/skills/bundled/SKILL.md": { code: "---\nname: bundled\ndescription: Test bundled skill\n---\nRead references/example.txt" },
      "/skills/bundled/references/example.txt": { code: "reference contents" },
    });
    expect(await fs.readText("/skills/custom/SKILL.md")).toContain("User SOP");
    const skills = createSkillCatalog({ fs } as Sandbox);
    expect((await skills.load("bundled"))?.references).toEqual(["references/example.txt"]);
    expect(await skills.readReference!("bundled", "references/example.txt")).toBe("reference contents");
    const binary = Buffer.alloc(220000);
    for (let i = 0; i < binary.length; i++) binary[i] = i % 256;
    const filename = "/quote' tab\tline\n.bin";
    await fs.writeFile(filename, binary);
    expect(await fs.readFile(filename)).toEqual(binary);
    await fs.writeFile("/.aistudio/context/private.txt", "not published");
    await symlink(root, join(root, "cycle"));
    expect((await fs.readdir("/")).some(entry => entry.name === "cycle")).toBe(false);
    expect((await fs.readdir("/")).some(entry => entry.name === ".aistudio")).toBe(true);
    const changed = await workspace.exportChangedFiles();
    expect(Object.keys(changed)).toEqual([filename]);
    expect(changed[filename].code).toBe(`data:application/octet-stream;base64,${binary.toString("base64")}`);
    expect(largestOutput).toBeLessThan(128 * 1024);
  } finally { await rm(root, { recursive: true, force: true }); }
}, 20000);

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { collectWorkspaceFiles } from "./workspaceFiles";

test("collectWorkspaceFiles skips ignored directories", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "workspace-files-"));
  try {
    await fs.mkdir(path.join(root, "src"), { recursive: true });
    await fs.writeFile(path.join(root, "src", "app.ts"), "export const ok = true;");
    await fs.mkdir(path.join(root, ".next"), { recursive: true });
    await fs.writeFile(path.join(root, ".next", "cache.js"), "ignored");
    await fs.mkdir(path.join(root, "node_modules", "left-pad"), { recursive: true });
    await fs.writeFile(path.join(root, "node_modules", "left-pad", "index.js"), "ignored");

    const files = await collectWorkspaceFiles(root, {
      ignoreDirNames: new Set([".next", "node_modules"]),
    });
    const paths = files.map((item) => item.path).sort((a, b) => a.localeCompare(b));

    assert.deepEqual(paths, ["/src/app.ts"]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

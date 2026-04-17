import { describe, expect, test } from "bun:test";
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
});

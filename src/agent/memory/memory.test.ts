import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MemoryStore } from "./store";

describe("Hermes MemoryStore", () => {
  test("adds, replaces, removes and renders prompt snapshot", async () => {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-memory-test-"));
    try {
      const store = new MemoryStore("proj-1", baseDir);

      expect((await store.add("memory", "Use bun instead of npm")).ok).toBe(true);
      expect((await store.add("user", "Reply in Chinese")).ok).toBe(true);

      const block = await store.buildPromptBlock();
      expect(block).toContain("[Project Memory]");
      expect(block).toContain("Use bun instead of npm");
      expect(block).toContain("[User Preferences]");
      expect(block).toContain("Reply in Chinese");

      expect((await store.replace("memory", "bun instead", "Use bun@1.3")).ok).toBe(true);
      expect(await store.loadEntries("memory")).toEqual(["Use bun@1.3"]);

      expect((await store.remove("memory", "bun@1.3")).ok).toBe(true);
      expect(await store.loadEntries("memory")).toEqual([]);
    } finally {
      fs.rmSync(baseDir, { recursive: true, force: true });
    }
  });
});

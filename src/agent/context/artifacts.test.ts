import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostDirFileSystem } from "../sandbox/environments/hostDirFs";
import { ContextArtifacts } from "./artifacts";

test("large tool results are recoverable byte for byte and excluded from exported artifacts", async () => {
  const root = await mkdtemp(join(tmpdir(), "context-artifacts-"));
  try {
    const fs = new HostDirFileSystem(root);
    const artifacts = new ContextArtifacts(fs);
    const original = "财务日志中文🙂\n".repeat(10000);
    const capped = await artifacts.cap(original);
    expect(capped.length).toBeLessThanOrEqual(12000);
    const path = capped.match(/\/.aistudio\/context\/[a-f0-9]+\.txt/)![0];
    expect(await fs.readText(path)).toBe(original);
    expect(await artifacts.cap(original)).toBe(capped);
    expect(await fs.exportTextFiles()).toEqual({});
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("output storage failure preserves bounded observation without suggesting retry", async () => {
  const fs = { writeFile: async () => { throw new Error("disk full"); } } as unknown as import("../sandbox/types").SandboxFileSystem;
  const artifacts = new ContextArtifacts(fs);
  const result = await artifacts.capToolObservation("mutation succeeded\n" + "x".repeat(20000) + "\nfinal state");
  expect(result.length).toBeLessThanOrEqual(12000);
  expect(result).toContain("OUTPUT_ARCHIVE_FAILED");
  expect(result).toContain("mutation succeeded");
  expect(result).toContain("final state");
  expect(result).toContain("Do not repeat");
  // Compaction still fails closed; it may not discard history without an archive.
  expect(artifacts.cap("x".repeat(20000))).rejects.toThrow("disk full");
});

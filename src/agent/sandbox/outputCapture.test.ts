import { test, expect } from "bun:test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execOnHost } from "./environments/localExec";

test("command capture preserves output beyond old truncation boundary", async () => {
  const root = await mkdtemp(join(tmpdir(), "capture-test-"));
  try {
    const result = await execOnHost(root, "python3 -c \"print('A'*1100000 + 'TAIL_EVIDENCE')\"");
    expect(result.code).toBe(0);
    expect(result.stdout.length).toBeLessThan(7000);
    const reference = result.stdout.match(/\/.aistudio\/context\/exec-[a-z0-9.-]+\.txt/)![0];
    const full = await readFile(join(root, reference), "utf8");
    expect(full).toHaveLength(1100014);
    expect(full).toEndWith("TAIL_EVIDENCE\n");
  } finally { await rm(root, { recursive: true, force: true }); }
});

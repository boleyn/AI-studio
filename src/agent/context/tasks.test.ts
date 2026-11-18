import { test, expect } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentTaskStore } from "./tasks";

test("background jobs return before completion, persist results and isolate conversations", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-tasks-"));
  try {
    const store = new AgentTaskStore("user:chat", root);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const started = await store.start("test", async () => { await gate; return "result"; });
    expect(started.status).toBe("running");
    expect(await new AgentTaskStore("other:chat", root).get(started.id)).toBeUndefined();
    release();
    let result = await store.get(started.id);
    for (let i = 0; i < 30 && result?.status === "running"; i++) {
      await new Promise(resolve => setTimeout(resolve, 10)); result = await store.get(started.id);
    }
    expect(result?.status).toBe("completed");
    expect((await new AgentTaskStore("user:chat", root).get(started.id))?.result).toBe("result");
    expect(store.get("../escape")).rejects.toThrow("invalid_task_id");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("cancelled workers persist cancellation and orphaned workers are never rerun", async () => {
  const { contextIdentity } = await import("./transcript");
  const root = await mkdtemp(join(tmpdir(), "agent-task-cancel-"));
  try {
    const store = new AgentTaskStore("cancel-scope", root);
    let executed = 0;
    const started = await store.start("cancel this", async signal => {
      executed++;
      await new Promise<void>(resolve => {
        if (signal.aborted) resolve();
        else signal.addEventListener("abort", () => resolve(), { once: true });
      });
      return "stopped";
    });
    await store.cancel(started.id);
    let result = await store.get(started.id);
    for (let i = 0; i < 30 && result?.status === "running"; i++) {
      await new Promise(resolve => setTimeout(resolve, 10));
      result = await store.get(started.id);
    }
    expect(result?.status).toBe("cancelled");
    expect(executed).toBe(1);
    const directory = join(root, contextIdentity("orphan-scope"));
    await mkdir(directory);
    await writeFile(join(directory, `${started.id}.json`), JSON.stringify({ ...started, status: "running" }));
    const orphan = new AgentTaskStore("orphan-scope", root);
    const recovered = await orphan.get(started.id);
    expect(recovered?.status).toBe("interrupted");
    expect(recovered?.result).toContain("Inspect workspace before retrying");
    expect((await orphan.get(started.id))?.updatedAt).toBe(recovered?.updatedAt);
    expect(executed).toBe(1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

import { test, expect } from "bun:test";
import {
  access,
  rename,
  mkdtemp,
  rm,
  mkdir,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentTaskStore } from "./taskStore";

test("background jobs return before completion, persist results and isolate conversations", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-tasks-"));
  try {
    const store = new AgentTaskStore("user:chat", root);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = await store.start("test", async () => {
      await gate;
      return "result";
    });
    expect(started.status).toBe("running");
    expect(
      await new AgentTaskStore("other:chat", root).get(started.id),
    ).toBeUndefined();
    release();
    let result = await store.get(started.id);
    for (let i = 0; i < 30 && result?.status === "running"; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      result = await store.get(started.id);
    }
    expect(result?.status).toBe("completed");
    expect(
      (await new AgentTaskStore("user:chat", root).get(started.id))?.result,
    ).toBe("result");
    expect(store.get("../escape")).rejects.toThrow("invalid_task_id");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cancelled workers persist cancellation and orphaned workers are never rerun", async () => {
  const { contextIdentity } = await import("../context/transcript");
  const root = await mkdtemp(join(tmpdir(), "agent-task-cancel-"));
  try {
    const store = new AgentTaskStore("cancel-scope", root);
    let executed = 0;
    const started = await store.start("cancel this", async (signal) => {
      executed++;
      await new Promise<void>((resolve) => {
        if (signal.aborted) resolve();
        else signal.addEventListener("abort", () => resolve(), { once: true });
      });
      return "stopped";
    });
    await store.cancel(started.id);
    let result = await store.get(started.id);
    for (let i = 0; i < 30 && result?.status === "running"; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      result = await store.get(started.id);
    }
    expect(result?.status).toBe("cancelled");
    expect(executed).toBe(1);
    const directory = join(root, contextIdentity("orphan-scope"));
    await mkdir(directory);
    await writeFile(
      join(directory, `${started.id}.json`),
      JSON.stringify({ ...started, status: "running", leaseUntil: undefined }),
    );
    const orphan = new AgentTaskStore("orphan-scope", root);
    const recovered = await orphan.get(started.id);
    expect(recovered?.status).toBe("interrupted");
    expect(recovered?.result).toContain("Inspect workspace before retrying");
    expect((await orphan.get(started.id))?.updatedAt).toBe(
      recovered?.updatedAt,
    );
    expect(executed).toBe(1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("fresh foreign leases stay running and wait observes the owner's terminal result", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-task-lease-"));
  const { contextIdentity } = await import("../context/transcript");
  const directory = join(root, contextIdentity("shared"));
  const id = crypto.randomUUID();
  const file = join(directory, id + ".json");
  try {
    await mkdir(directory);
    const task = {
      id,
      prompt: "inspect",
      status: "running",
      updatedAt: Date.now(),
      leaseUntil: Date.now() + 60000,
    };
    await writeFile(file, JSON.stringify(task));
    const store = new AgentTaskStore("shared", root);
    expect((await store.get(id))?.status).toBe("running");
    await store.cancel(id);
    await access(file + ".cancel");
    const waiting = store.wait(id);
    await writeFile(
      file + ".tmp",
      JSON.stringify({ ...task, status: "cancelled" }),
    );
    await rename(file + ".tmp", file);
    expect((await waiting).status).toBe("cancelled");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a detached failed task reports completed model calls independently of a parent wait", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-usage-"));
  try {
    const store = new AgentTaskStore("usage", root);
    let receive!: (usage: unknown) => void;
    const recorded = new Promise(resolve => { receive = resolve; });
    const task = await store.start("detached", async (_, usage) => {
      usage(125);
      usage(75);
      throw new Error("final stream failed");
    }, async (_, usage) => receive(usage));
    expect(await recorded).toEqual({ calls: 2, totalTokens: 200 });
    expect((await store.get(task.id))?.status).toBe("failed");
  } finally { await rm(root, { recursive: true, force: true }); }
});

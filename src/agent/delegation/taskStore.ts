import { promises as fs } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { contextIdentity } from "../context/transcript";

const workerLeaseMs = 60_000;

export type AgentTaskRecord = {
  id: string;
  prompt: string;
  status: "running" | "completed" | "failed" | "cancelled" | "interrupted";
  createdAt: number;
  updatedAt: number;
  leaseUntil?: number;
  usage?: { calls: number; totalTokens: number };
  result?: string;
};
const runtime = globalThis as typeof globalThis & {
  __agentTaskControllers?: Map<string, AbortController>;
};
const controllers = (runtime.__agentTaskControllers ??= new Map<
  string,
  AbortController
>());

/** Durable status, bounded local workers. Never retry a side-effecting task after
 * process loss: surface interrupted status and let a subsequent turn decide. */
export class AgentTaskStore {
  private readonly directory: string;
  constructor(
    scope: string,
    root = path.join(process.cwd(), ".aistudio", "agent-tasks"),
  ) {
    this.directory = path.join(root, contextIdentity(scope));
  }
  private filename(id: string) {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("invalid_task_id");
    return path.join(this.directory, `${id}.json`);
  }
  private async save(record: AgentTaskRecord) {
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    const target = this.filename(record.id);
    const temporary = `${target}.${randomUUID()}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(record), { mode: 0o600 });
    await fs.rename(temporary, target);
  }
  async get(id: string): Promise<AgentTaskRecord | undefined> {
    let record: AgentTaskRecord;
    try {
      record = JSON.parse(await fs.readFile(this.filename(id), "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    if (
      record.status === "running" &&
      !controllers.has(this.filename(id)) &&
      (record.leaseUntil ?? 0) < Date.now()
    ) {
      record = {
        ...record,
        status: "interrupted",
        updatedAt: record.leaseUntil ?? record.updatedAt,
        result:
          "Worker process ended; operation outcome may be partial. Inspect workspace before retrying.",
      };
      // Derive the observed state without overwriting a concurrent owner update.
    }
    return record;
  }
  async list(): Promise<AgentTaskRecord[]> {
    let entries: string[];
    try {
      entries = await fs.readdir(this.directory);
    } catch {
      return [];
    }
    const records = await Promise.all(
      entries
        .filter((name) => name.endsWith(".json"))
        .map((name) => this.get(name.slice(0, -5))),
    );
    return records
      .filter((record): record is AgentTaskRecord => Boolean(record))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 20);
  }
  async start(
    prompt: string,
    runner: (signal: AbortSignal, onUsage: (tokens: number) => void) => Promise<string | { text: string; usage: NonNullable<AgentTaskRecord["usage"]> }>,
    recordUsage?: (id: string, usage: NonNullable<AgentTaskRecord["usage"]>) => Promise<void>,
  ): Promise<AgentTaskRecord> {
    if (
      controllers.size >= 8 ||
      [...controllers.keys()].filter((key) =>
        key.startsWith(this.directory + path.sep),
      ).length >= 2
    )
      throw new Error("background_task_capacity_reached");
    const record: AgentTaskRecord = {
      id: randomUUID(),
      prompt: prompt.slice(0, 4000),
      leaseUntil: Date.now() + workerLeaseMs,
      status: "running",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const key = this.filename(record.id);
    const controller = new AbortController();
    controllers.set(key, controller);
    try {
      await this.save(record);
    } catch (error) {
      controllers.delete(key);
      throw error;
    }
    const timer = setTimeout(() => controller.abort(), 10 * 60 * 1000);
    const heartbeatStop = new AbortController();
    let finishing = false;
    const heartbeat = (async () => {
      while (!finishing) {
        await delay(1000, undefined, { signal: heartbeatStop.signal });
        if (finishing) break;
        try {
          await fs.access(key + ".cancel");
          controller.abort();
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        if ((record.leaseUntil ?? 0) - Date.now() < workerLeaseMs / 2) {
          record.leaseUntil = Date.now() + workerLeaseMs;
          await this.save(record);
        }
      }
    })().catch((error) => {
      if (!finishing) {
        console.error("agent_task_heartbeat_failed", error);
        controller.abort();
      }
    });
    // All task errors become durable terminal states. The parent request owns no
    // worker resources, so its response can finish without disposing this worker.
    void (async () => {
      try {
        const result = await runner(controller.signal, tokens => {
          record.usage ??= { calls: 0, totalTokens: 0 };
          record.usage.calls++;
          record.usage.totalTokens += tokens;
        });
        record.status = controller.signal.aborted ? "cancelled" : "completed";
        if (typeof result !== "string") record.usage = result.usage;
        record.result = (typeof result === "string" ? result : result.text).slice(0, 6000);
      } catch (error) {
        record.status = controller.signal.aborted ? "cancelled" : "failed";
        record.result = error instanceof Error ? error.message : String(error);
      } finally {
        finishing = true;
        heartbeatStop.abort();
        await heartbeat;
        clearTimeout(timer);
        delete record.leaseUntil;
        record.updatedAt = Date.now();
        try {
          await this.save(record);
        } catch (error) {
          console.error("agent_task_persist_failed", error);
        }
        if (record.usage && recordUsage) {
          try { await recordUsage(record.id, record.usage); }
          catch (error) { console.error("background_usage_event_failed", record.id, error); }
        }
        controllers.delete(key);
        await fs.rm(key + ".cancel", { force: true }).catch(() => {});
      }
    })();
    return { ...record };
  }
  async wait(id: string, signal?: AbortSignal) {
    for (;;) {
      signal?.throwIfAborted();
      const task = await this.get(id);
      if (!task) throw new Error("task_not_found");
      if (task.status !== "running") return task;
      await delay(300, undefined, { signal });
    }
  }
  async cancel(id: string) {
    const task = await this.get(id);
    if (!task) throw new Error("task_not_found");
    if (task.status !== "running") return task;
    const key = this.filename(id);
    const local = controllers.get(key);
    if (local) local.abort();
    else await fs.writeFile(key + ".cancel", "", { mode: 0o600 });
    return task;
  }
}

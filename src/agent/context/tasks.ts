import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { contextIdentity } from "./transcript";

export type AgentTaskRecord = { id: string; prompt: string; status: "running" | "completed" | "failed" | "cancelled" | "interrupted"; createdAt: number; updatedAt: number; result?: string };
const runtime = globalThis as typeof globalThis & { __agentTaskControllers?: Map<string, AbortController> };
const controllers = runtime.__agentTaskControllers ??= new Map<string, AbortController>();

/** Durable status, bounded local workers. Never retry a side-effecting task after
 * process loss: surface interrupted status and let a subsequent turn decide. */
export class AgentTaskStore {
  private readonly directory: string;
  constructor(scope: string, root = path.join(process.cwd(), ".aistudio", "agent-tasks")) {
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
    try { record = JSON.parse(await fs.readFile(this.filename(id), "utf8")); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
    if (record.status === "running" && !controllers.has(this.filename(id))) {
      record = { ...record, status: "interrupted", updatedAt: Date.now(), result: "Worker process ended; operation outcome may be partial. Inspect workspace before retrying." };
      await this.save(record);
    }
    return record;
  }
  async list(): Promise<AgentTaskRecord[]> {
    let entries: string[];
    try { entries = await fs.readdir(this.directory); } catch { return []; }
    const records = await Promise.all(entries.filter(name => name.endsWith(".json")).map(name => this.get(name.slice(0, -5))));
    return records.filter((record): record is AgentTaskRecord => Boolean(record)).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 20);
  }
  async start(prompt: string, runner: (signal: AbortSignal) => Promise<string>): Promise<AgentTaskRecord> {
    if (controllers.size >= 8 || [...controllers.keys()].filter(key => key.startsWith(this.directory + path.sep)).length >= 2) throw new Error("background_task_capacity_reached");
    const record: AgentTaskRecord = { id: randomUUID(), prompt: prompt.slice(0, 4000), status: "running", createdAt: Date.now(), updatedAt: Date.now() };
    const key = this.filename(record.id);
    const controller = new AbortController();
    controllers.set(key, controller);
    try { await this.save(record); } catch (error) { controllers.delete(key); throw error; }
    const timer = setTimeout(() => controller.abort(), 10 * 60 * 1000);
    // All task errors become durable terminal states. The parent request owns no
    // worker resources, so its response can finish without disposing this worker.
    void (async () => {
      try {
        const result = await runner(controller.signal);
        record.status = controller.signal.aborted ? "cancelled" : "completed";
        record.result = result.slice(0, 6000);
      } catch (error) {
        record.status = controller.signal.aborted ? "cancelled" : "failed";
        record.result = error instanceof Error ? error.message : String(error);
      } finally {
        clearTimeout(timer);
        record.updatedAt = Date.now();
        try { await this.save(record); } catch (error) { console.error("agent_task_persist_failed", error); }
        controllers.delete(key);
      }
    })();
    return { ...record };
  }
  async cancel(id: string) {
    const task = await this.get(id);
    if (!task) throw new Error("task_not_found");
    controllers.get(this.filename(id))?.abort();
    return task;
  }
}

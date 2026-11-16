import { promises as fsp } from "node:fs";
import path from "node:path";
import { toSafeSegment } from "../sandbox/paths";

export type MemoryTarget = "memory" | "user";

const DELIMITER = "\n§\n";
const MAX_MEMORY_CHARS = 2800;

/**
 * Hermes 规范持久化记忆存储：
 * - memory: 项目/环境事实、约定与踩坑记录 (.aistudio/projects/<token>/memory/MEMORY.md)
 * - user:   用户偏好、工作风格与称呼习惯 (.aistudio/projects/<token>/memory/USER.md)
 */
export class MemoryStore {
  private readonly dir: string;

  constructor(projectToken: string, baseDir = process.cwd()) {
    this.dir = path.join(baseDir, ".aistudio", "projects", toSafeSegment(projectToken), "memory");
  }

  private filePath(target: MemoryTarget): string {
    return path.join(this.dir, target === "user" ? "USER.md" : "MEMORY.md");
  }

  async loadEntries(target: MemoryTarget): Promise<string[]> {
    try {
      const raw = await fsp.readFile(this.filePath(target), "utf8");
      return raw
        .split(/\n§\n|\n---\n/)
        .map((s) => s.trim())
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  private async saveEntries(target: MemoryTarget, entries: string[]): Promise<void> {
    await fsp.mkdir(this.dir, { recursive: true });
    await fsp.writeFile(this.filePath(target), entries.join(DELIMITER), "utf8");
  }

  async add(target: MemoryTarget, content: string): Promise<{ ok: boolean; message: string }> {
    const trimmed = content.trim();
    if (!trimmed) return { ok: false, message: "Memory content cannot be empty." };
    const entries = await this.loadEntries(target);
    if (entries.includes(trimmed)) return { ok: true, message: "Entry already exists." };
    const next = [...entries, trimmed];
    const totalChars = next.join(DELIMITER).length;
    if (totalChars > MAX_MEMORY_CHARS) {
      return {
        ok: false,
        message: `Memory budget exceeded (${totalChars}/${MAX_MEMORY_CHARS} chars). Remove or replace older entries first.`,
      };
    }
    await this.saveEntries(target, next);
    return { ok: true, message: `Saved to ${target} (${next.length} entries, ${totalChars}/${MAX_MEMORY_CHARS} chars).` };
  }

  async replace(target: MemoryTarget, oldText: string, newText: string): Promise<{ ok: boolean; message: string }> {
    const entries = await this.loadEntries(target);
    const idx = entries.findIndex((e) => e.includes(oldText.trim()));
    if (idx < 0) return { ok: false, message: `No ${target} entry matched "${oldText}".` };
    const next = [...entries];
    next[idx] = newText.trim();
    const totalChars = next.join(DELIMITER).length;
    if (totalChars > MAX_MEMORY_CHARS) {
      return { ok: false, message: `Memory budget exceeded (${totalChars}/${MAX_MEMORY_CHARS} chars).` };
    }
    await this.saveEntries(target, next);
    return { ok: true, message: `Updated ${target} entry #${idx + 1}.` };
  }

  async remove(target: MemoryTarget, matchText: string): Promise<{ ok: boolean; message: string }> {
    const entries = await this.loadEntries(target);
    const needle = matchText.trim();
    const next = entries.filter((e) => !e.includes(needle));
    if (next.length === entries.length) return { ok: false, message: `No ${target} entry matched "${matchText}".` };
    await this.saveEntries(target, next);
    return { ok: true, message: `Removed ${entries.length - next.length} entry(s) from ${target}.` };
  }

  /** 生成注入 System Prompt 的冻结快照 */
  async buildPromptBlock(): Promise<string | null> {
    const [mem, user] = await Promise.all([this.loadEntries("memory"), this.loadEntries("user")]);
    const sections: string[] = [];
    if (mem.length > 0) sections.push(`[Project Memory]\n${mem.map((e) => `- ${e}`).join("\n")}`);
    if (user.length > 0) sections.push(`[User Preferences]\n${user.map((e) => `- ${e}`).join("\n")}`);
    return sections.length > 0 ? sections.join("\n\n") : null;
  }
}

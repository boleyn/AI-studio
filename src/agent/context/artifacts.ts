import { createHash } from "node:crypto";
import type { SandboxFileSystem } from "../sandbox/types";

/** Immutable, content-addressed observations. Never rerun a mutation to recover output. */
export class ContextArtifacts {
  constructor(private readonly fs: SandboxFileSystem) {}

  async save(text: string): Promise<string> {
    const digest = createHash("sha256").update(text).digest("hex");
    const path = `/.aistudio/context/${digest}.txt`;
    await this.fs.writeFile(path, text);
    return path;
  }

  /** A completed mutation must not look unexecuted if output storage fails. */
  async capToolObservation(text: string, maxChars = 12000): Promise<string> {
    try { return await this.cap(text, maxChars); }
    catch {
      const preview = Math.max(0, Math.floor((maxChars - 600) / 2));
      return `OUTPUT_ARCHIVE_FAILED: The tool already returned. Its execution status is unchanged; only output storage failed. The following is a partial observation, and the omitted middle is unavailable. Do not repeat a mutating operation to recover output; inspect the resulting state first.\n\n${text.slice(0, preview)}\n\n[Middle unavailable]\n\n${text.slice(-preview)}`;
    }
  }

  async cap(text: string, maxChars = 12000): Promise<string> {
    if (text.length <= maxChars) return text;
    const path = await this.save(text);
    const preview = Math.max(0, Math.floor((maxChars - 600) / 2));
    return `Full observation saved: ${path}\nLength: ${text.length} characters. Read this file with offset/limit or search with Grep. Do not repeat the original operation to recover output.\n\n${text.slice(0, preview)}\n\n[Middle omitted; recover from file]\n\n${text.slice(-preview)}`;
  }
}

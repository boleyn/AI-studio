import { randomUUID } from "node:crypto";
import path from "node:path";
import { normalizeVirtualPath } from "../paths";
import type { SandboxFileSystem, SandboxDirEntry, SandboxExecOptions, SandboxExecResult } from "../types";

const shellQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;
export const resolveWorkdirPath = (workdir: string, virtualPath: string) => path.posix.join(workdir, normalizeVirtualPath(virtualPath).slice(1));

/** POSIX adapter for the native connector; chunk sizes stay below wire output caps. */
export function createPosixDeviceFileSystem(baseWorkdir: string, runExec: (command: string, options?: SandboxExecOptions) => Promise<SandboxExecResult>): SandboxFileSystem {
  const fs: SandboxFileSystem = {
    async readFile(virtualPath: string) {
      const target = resolveWorkdirPath(baseWorkdir, virtualPath);
      const sizeResult = await runExec(`wc -c < ${shellQuote(target)}`);
      if (sizeResult.code !== 0) throw new Error(sizeResult.stderr || `read_failed:${virtualPath}`);
      const size = Number(sizeResult.stdout.trim());
      if (!Number.isSafeInteger(size) || size < 0 || size > 32 * 1024 * 1024) throw new Error("file_read_size_limit");
      const chunks: Buffer[] = [];
      for (let offset = 0; offset < size; offset += 32768) {
        const res = await runExec(`dd if=${shellQuote(target)} bs=32768 skip=${Math.floor(offset / 32768)} count=1 2>/dev/null | base64 | tr -d '\\n'`);
        if (res.code !== 0) throw new Error(res.stderr || `read_failed:${virtualPath}`);
        chunks.push(Buffer.from(res.stdout.trim(), "base64"));
      }
      const buffer = Buffer.concat(chunks);
      if (buffer.length !== size) throw new Error("file_changed_during_read");
      return buffer;
    },
    async readText(virtualPath: string) {
      return (await this.readFile(virtualPath)).toString("utf8");
    },
    async writeFile(virtualPath: string, content: string | Buffer) {
      const target = resolveWorkdirPath(baseWorkdir, virtualPath);
      const buffer = typeof content === "string" ? Buffer.from(content, "utf8") : content;
      const dir = path.posix.dirname(target);
      const temporary = `${target}.agent-${randomUUID()}.tmp`;
      const created = await runExec(`mkdir -p ${shellQuote(dir)} && : > ${shellQuote(temporary)}`);
      if (created.code !== 0) throw new Error(created.stderr || "write_failed");
      try {
        for (let offset = 0; offset < buffer.length; offset += 16384) {
          const b64 = buffer.subarray(offset, offset + 16384).toString("base64");
          const res = await runExec(`printf '%s' ${shellQuote(b64)} | base64 -d >> ${shellQuote(temporary)}`);
          if (res.code !== 0) throw new Error(res.stderr || "write_failed");
        }
        const moved = await runExec(`mv ${shellQuote(temporary)} ${shellQuote(target)}`);
        if (moved.code !== 0) throw new Error(moved.stderr || "write_failed");
      } finally { await runExec(`rm -f ${shellQuote(temporary)}`); }
    },
    async exists(virtualPath: string) {
      return (await this.stat(virtualPath)) !== null;
    },
    async stat(virtualPath: string) {
      const target = resolveWorkdirPath(baseWorkdir, virtualPath);
      const res = await runExec(
        `if [ -d ${shellQuote(target)} ]; then echo "dir"; elif [ -f ${shellQuote(target)} ]; then wc -c < ${shellQuote(target)}; else exit 1; fi`,
      );
      if (res.code !== 0) return null;
      const out = res.stdout.trim();
      if (out === "dir") {
        return { type: "directory" as const, size: 0, mtimeMs: Date.now() };
      }
      return { type: "file" as const, size: Number(out) || 0, mtimeMs: Date.now() };
    },
    async readdir(virtualPath: string): Promise<SandboxDirEntry[]> {
      const base = normalizeVirtualPath(virtualPath).replace(/\/+$/, "");
      const target = resolveWorkdirPath(baseWorkdir, virtualPath);
      const res = await runExec(
        `for f in ${shellQuote(target)}/* ${shellQuote(target)}/.[!.]* ${shellQuote(target)}/..?*; do [ -e "$f" ] || continue; [ -L "$f" ] && continue; b=\${f##*/}; if [ -d "$f" ]; then printf 'd%s\\0' "$b"; elif [ -f "$f" ]; then printf 'f%s\\0' "$b"; fi; done`,
      );
      if (res.code !== 0) throw new Error(res.stderr || "directory_read_failed");
      if (res.stdout && !res.stdout.endsWith("\0")) throw new Error("directory_output_truncated");
      return res.stdout
        .split("\0")
        .filter(Boolean)
        .map((line) => {
          const kind = line[0];
          const name = line.slice(1);
          if (!["d", "f"].includes(kind) || !name || name.includes("/")) throw new Error("invalid_directory_entry");
          return {
            name,
            path: `${base}/${name}`,
            type: kind === "d" ? ("directory" as const) : ("file" as const),
          };
        });
    },
    async remove(virtualPath: string) {
      const target = resolveWorkdirPath(baseWorkdir, virtualPath);
      if (target === baseWorkdir) throw new Error("refuse_remove_root");
      await runExec(`rm -rf ${shellQuote(target)}`);
    },
    async mkdir(virtualPath: string) {
      const target = resolveWorkdirPath(baseWorkdir, virtualPath);
      await runExec(`mkdir -p ${shellQuote(target)}`);
    },
  };
  return fs;
}

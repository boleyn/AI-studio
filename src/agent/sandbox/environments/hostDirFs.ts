import { promises as fsp } from "node:fs";
import path from "node:path";
import type { SandboxDirEntry, SandboxFileSystem } from "../types";
import { isExportableProjectPath, isLikelyBinary, normalizeVirtualPath, resolveInsideRoot, toVirtualPath } from "../paths";

/** 基于宿主机目录的文件系统实现（local / remote-vm 共用：remote-vm 在本地保存镜像目录）。 */
export class HostDirFileSystem implements SandboxFileSystem {
  constructor(readonly root: string) {}

  private abs(virtualPath: string) {
    return resolveInsideRoot(this.root, virtualPath);
  }

  async readFile(virtualPath: string) {
    return fsp.readFile(this.abs(virtualPath));
  }

  async readText(virtualPath: string) {
    return fsp.readFile(this.abs(virtualPath), "utf8");
  }

  async writeFile(virtualPath: string, content: string | Buffer) {
    const target = this.abs(virtualPath);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, content);
  }

  async exists(virtualPath: string) {
    try {
      await fsp.access(this.abs(virtualPath));
      return true;
    } catch {
      return false;
    }
  }

  async stat(virtualPath: string) {
    try {
      const st = await fsp.stat(this.abs(virtualPath));
      return { type: st.isDirectory() ? ("directory" as const) : ("file" as const), size: st.size, mtimeMs: st.mtimeMs };
    } catch {
      return null;
    }
  }

  async readdir(virtualPath: string): Promise<SandboxDirEntry[]> {
    const dir = this.abs(virtualPath);
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    const base = normalizeVirtualPath(virtualPath);
    return entries
      .filter((entry) => entry.isFile() || entry.isDirectory())
      .map((entry) => ({
        name: entry.name,
        path: base === "/" ? `/${entry.name}` : `${base}/${entry.name}`,
        type: entry.isDirectory() ? ("directory" as const) : ("file" as const),
      }));
  }

  async remove(virtualPath: string) {
    const target = this.abs(virtualPath);
    if (target === path.resolve(this.root)) throw new Error("Refusing to remove sandbox root");
    await fsp.rm(target, { recursive: true, force: true });
  }

  async mkdir(virtualPath: string) {
    await fsp.mkdir(this.abs(virtualPath), { recursive: true });
  }

  /** 遍历导出可同步的文本文件 */
  async exportTextFiles(maxFileBytes = 2 * 1024 * 1024): Promise<Record<string, { code: string }>> {
    const files: Record<string, { code: string }> = {};
    const walk = async (dir: string) => {
      let entries: import("node:fs").Dirent[];
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const absolute = path.join(dir, entry.name);
        const virtualPath = toVirtualPath(this.root, absolute);
        if (!isExportableProjectPath(virtualPath)) continue;
        if (entry.isDirectory()) {
          await walk(absolute);
          continue;
        }
        if (!entry.isFile()) continue;
        try {
          const st = await fsp.stat(absolute);
          if (st.size > maxFileBytes) continue;
          const buffer = await fsp.readFile(absolute);
          if (isLikelyBinary(buffer)) continue;
          files[virtualPath] = { code: buffer.toString("utf8") };
        } catch {
          // 文件可能在遍历期间被删除
        }
      }
    };
    await walk(path.resolve(this.root));
    return files;
  }
}

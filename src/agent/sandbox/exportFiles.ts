import { encodeProjectFile, isExportableProjectPath } from "./paths";
import type { SandboxFileSystem } from "./types";

/** One bounded exporter for local and connector filesystems; never follows symlinks. */
export async function exportWorkspaceFiles(
  fs: SandboxFileSystem,
  maxFileBytes = 2 * 1024 * 1024,
) {
  const files: Record<string, { code: string }> = {};
  let bytes = 0;
  let count = 0;
  let directories = 0;
  const walk = async (dir: string) => {
    if (++directories > 2000 || count >= 2000 || bytes >= 32 * 1024 * 1024) return;
    for (const entry of await fs.readdir(dir)) {
      if (count >= 2000 || bytes >= 32 * 1024 * 1024) return;
      if (!isExportableProjectPath(entry.path)) continue;
      if (entry.type === "directory") {
        await walk(entry.path);
        continue;
      }
      const stat = await fs.stat(entry.path);
      if (
        !stat ||
        stat.size > maxFileBytes ||
        bytes + stat.size > 32 * 1024 * 1024 ||
        count >= 2000
      )
        continue;
      try {
        const content = await fs.readFile(entry.path);
        if (content.length > maxFileBytes || bytes + content.length > 32 * 1024 * 1024) continue;
        files[entry.path] = { code: encodeProjectFile(content) };
        bytes += content.length;
        count++;
      } catch {
        // A file may disappear while a command is updating the workspace.
      }
    }
  };
  await walk("/");
  return files;
}

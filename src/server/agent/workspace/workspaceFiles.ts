import { promises as fs } from "fs";
import path from "path";

type CollectWorkspaceFilesOptions = {
  ignoreDirNames?: Set<string>;
};

export const collectWorkspaceFiles = async (root: string, options?: CollectWorkspaceFilesOptions) => {
  const entries: Array<{ path: string; buffer: Buffer }> = [];
  const ignoreDirNames = options?.ignoreDirNames;

  const walk = async (dir: string) => {
    const children = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const child of children) {
      const absPath = path.join(dir, child.name);
      if (child.isDirectory()) {
        if (ignoreDirNames?.has(child.name)) continue;
        await walk(absPath);
        continue;
      }
      if (!child.isFile()) continue;
      const relative = path.relative(root, absPath).split(path.sep).join("/");
      if (!relative || relative.startsWith("..")) continue;
      const filePath = `/${relative}`;
      const buffer = await fs.readFile(absPath);
      entries.push({ path: filePath, buffer });
    }
  };

  await walk(root);
  return entries;
};

import { createHash } from "node:crypto";
import { decodeDataUrlToBuffer } from "./paths";
import { exportWorkspaceFiles } from "./exportFiles";
import type { ProjectFiles, SandboxFileSystem } from "./types";

/** Both connector transports preserve mounted files and publish only run changes. */
export async function prepareConnectorWorkspace(fs: SandboxFileSystem, runtimeFiles: ProjectFiles = {}) {
  for (const [filePath, file] of Object.entries(runtimeFiles)) {
    if (!await fs.exists(filePath)) {
      const code = file.code || "";
      await fs.writeFile(filePath, decodeDataUrlToBuffer(code) ?? code);
    }
  }
  const digest = (code: string) => createHash("sha256").update(code).digest("hex");
  const baseline = new Map(Object.entries(await exportWorkspaceFiles(fs)).map(([name, file]) => [name, digest(file.code)]));
  return {
    async exportChangedFiles() {
      const current = await exportWorkspaceFiles(fs);
      return Object.fromEntries(Object.entries(current).filter(([name, file]) => baseline.get(name) !== digest(file.code)));
    },
  };
}

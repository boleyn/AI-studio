import { encodeProjectFile } from "./paths";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import type { Dirent } from "node:fs";
import path from "node:path";

export type RuntimeProjectFiles = Record<string, { code?: string }>;

const normalizeRuntimePath = (filePath: string): string => {
  const normalized = filePath.replace(/\\/g, "/").trim();
  if (!normalized) return "/";
  return normalized.startsWith("/") ? normalized : `/${normalized}`;
};

export const collectSystemSkillFiles = (systemSkillsRoot: string): RuntimeProjectFiles => {
  const normalizedRoot = path.resolve(systemSkillsRoot);
  if (!existsSync(normalizedRoot)) return {};

  try {
    if (!statSync(normalizedRoot).isDirectory()) return {};
  } catch {
    return {};
  }

  const files: RuntimeProjectFiles = {};
  const walk = (currentDir: string) => {
    let entries: Dirent[];
    try {
      entries = readdirSync(currentDir, { withFileTypes: true }) as Dirent[];
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.name.startsWith(".") || ["node_modules", "__pycache__"].includes(entry.name)) continue;
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;

      const relative = path.relative(normalizedRoot, fullPath).replace(/\\/g, "/");
      if (!relative || relative.startsWith("..")) continue;
      try {
        files[`/skills/${relative}`] = { code: encodeProjectFile(readFileSync(fullPath)) };
      } catch {
        // A skill file may disappear during a development rebuild. Skip it and
        // let the next request rebuild the runtime overlay.
      }
    }
  };

  walk(normalizedRoot);
  return files;
};

/** Preserve the old overlay precedence: explicit project files win over the
 * repository skill baseline when both provide the same virtual path. */
export const excludeProjectOverrides = (
  runtimeFiles: RuntimeProjectFiles,
  projectFiles: RuntimeProjectFiles | undefined,
): RuntimeProjectFiles => {
  const projectPaths = new Set(
    Object.keys(projectFiles || {}).map(normalizeRuntimePath),
  );
  return Object.fromEntries(
    Object.entries(runtimeFiles).filter(
      ([filePath]) => !projectPaths.has(normalizeRuntimePath(filePath)),
    ),
  );
};

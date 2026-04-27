// @ts-nocheck
// @ts-nocheck
import { promises as fs } from "fs";
import path from "path";

import type { CommonProjectTemplate } from "@shared/sandpack/projectTemplates";

type TemplateManifest = {
  template: CommonProjectTemplate;
  dependencies?: Record<string, string>;
};

export type ProjectTemplateDefaults = {
  files: Record<string, { code: string }>;
  dependencies: Record<string, string>;
};

const TEMPLATE_ROOT = path.join(process.cwd(), "data", "project-templates");
const GLOBAL_SKILLS_ROOT = path.join(process.cwd(), "skills");

const toPosixPath = (relativePath: string): string =>
  `/${relativePath.split(path.sep).join(path.posix.sep)}`;

async function walkFiles(dir: string, ignorePatterns: RegExp[] = []): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (ignorePatterns.some(p => p.test(entry.name))) continue;

    const absPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(absPath, ignorePatterns)));
      continue;
    }
    files.push(absPath);
  }
  return files;
}

export async function loadProjectTemplateDefaults(
  template: CommonProjectTemplate
): Promise<ProjectTemplateDefaults> {
  const templateDir = path.join(TEMPLATE_ROOT, template);
  const manifestPath = path.join(templateDir, "manifest.json");
  const filesRoot = path.join(templateDir, "files");

  const manifestRaw = await fs.readFile(manifestPath, "utf8");
  const manifest = JSON.parse(manifestRaw) as TemplateManifest;

  const files: Record<string, { code: string }> = {};

  // 1. Load template files
  try {
    const absFiles = await walkFiles(filesRoot);
    await Promise.all(
      absFiles.map(async (absPath) => {
        const relative = path.relative(filesRoot, absPath);
        const filePath = toPosixPath(relative);
        const code = await fs.readFile(absPath, "utf8");
        files[filePath] = { code };
      })
    );
  } catch (err) {
    console.error(`Failed to load template files for ${template}:`, err);
  }

  // 2. Load global default skills and put them under .aistudio/skills/
  try {
    const ignorePatterns = [/^node_modules$/, /^\.git$/, /^\.DS_Store$/, /^__pycache__$/, /\.pyc$/];
    const skillFiles = await walkFiles(GLOBAL_SKILLS_ROOT, ignorePatterns);
    await Promise.all(
      skillFiles.map(async (absPath) => {
        const relative = path.relative(GLOBAL_SKILLS_ROOT, absPath);
        const filePath = `/.aistudio/skills${toPosixPath(relative)}`;
        const code = await fs.readFile(absPath, "utf8");
        files[filePath] = { code };
      })
    );
  } catch (err) {
    console.error(`Failed to load global skills:`, err);
  }

  return {
    files,
    dependencies: manifest.dependencies || {},
  };
}

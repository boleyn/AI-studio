import { promises as fs } from "fs";
import path from "path";

export type QueryEngineShadowProbeResult = {
  ready: boolean;
  reasons: string[];
  warnings: string[];
  bunBundleFiles: string[];
};

const exists = async (target: string): Promise<boolean> => {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
};

const hasToken = async (target: string, token: string): Promise<boolean> => {
  try {
    const content = await fs.readFile(target, "utf8");
    return content.includes(token);
  } catch {
    return false;
  }
};

export const runQueryEngineShadowProbe = async (): Promise<QueryEngineShadowProbeResult> => {
  const root = process.cwd();
  const queryEngineFile = path.join(root, "src/server/agent/QueryEngine.ts");
  const queryFile = path.join(root, "src/server/agent/query.ts");
  const toolFile = path.join(root, "src/server/agent/Tool.ts");

  const reasons: string[] = [];
  const warnings: string[] = [];
  const bunBundleFiles: string[] = [];

  if (!(await exists(queryEngineFile))) reasons.push("missing:QueryEngine.ts");
  if (!(await exists(queryFile))) reasons.push("missing:query.ts");
  if (!(await exists(toolFile))) reasons.push("missing:Tool.ts");

  if ((await exists(queryEngineFile)) && !(await hasToken(queryEngineFile, "export class QueryEngine"))) {
    reasons.push("invalid:QueryEngine_export");
  }
  if ((await exists(queryFile)) && !(await hasToken(queryFile, "export async function* query"))) {
    reasons.push("invalid:query_export");
  }
  if (await hasToken(queryEngineFile, "from 'bun:bundle'")) {
    warnings.push("runtime_warning:bun_bundle_import_detected");
  }
  if (await hasToken(queryEngineFile, "import { feature } from 'bun:bundle'")) {
    warnings.push("runtime_warning:feature_flag_depends_on_bun_bundle");
  }

  // Scan likely runtime path files for bun:bundle dependency hotspots.
  // This gives us a concrete migration checklist (copy-first, then replace).
  const scanRoots = [
    path.join(root, "src/server/agent"),
    path.join(root, "src/server/builtin-tools"),
  ];

  const walk = async (dir: string): Promise<void> => {
    let entries: string[] = [];
    try {
      entries = await fs.readdir(dir);
    } catch {
      return;
    }
    for (const item of entries) {
      const next = path.join(dir, item);
      let stat: Awaited<ReturnType<typeof fs.stat>> | null = null;
      try {
        stat = await fs.stat(next);
      } catch {
        continue;
      }
      if (!stat) continue;
      if (stat.isDirectory()) {
        await walk(next);
        continue;
      }
      if (!/\.(ts|tsx|js|mjs|cjs)$/.test(item)) continue;
      if (await hasToken(next, "bun:bundle")) {
        bunBundleFiles.push(path.relative(root, next).replace(/\\/g, "/"));
      }
    }
  };

  for (const scanRoot of scanRoots) {
    await walk(scanRoot);
  }
  if (bunBundleFiles.length > 0) {
    warnings.push(`runtime_warning:bun_bundle_files=${bunBundleFiles.length}`);
  }

  return {
    ready: reasons.length === 0,
    reasons,
    warnings,
    bunBundleFiles: bunBundleFiles.sort(),
  };
};

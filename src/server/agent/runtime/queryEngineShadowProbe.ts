export type QueryEngineShadowProbeResult = {
  ready: boolean;
  reasons: string[];
  warnings: string[];
  bunBundleFiles: string[];
};

type NamedExports = Record<string, unknown>;

const hasNamedExport = (mod: NamedExports, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(mod, key) && mod[key] !== undefined;

const safeImport = async (
  importer: () => Promise<unknown>
): Promise<{ ok: true; mod: NamedExports } | { ok: false; error: string }> => {
  try {
    const mod = (await importer()) as NamedExports;
    return { ok: true, mod };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message };
  }
};

const maybeCollectBunBundleWarnings = async (): Promise<{
  warnings: string[];
  bunBundleFiles: string[];
}> => {
  // Runtime-safety first: this scan is best-effort only and should never block readiness.
  // If source tree isn't present in production image, we simply skip scanning.
  try {
    const [{ promises: fs }, path] = await Promise.all([import('fs'), import('path')]);
    const root = process.cwd();
    const scanRoots = [
      path.join(root, 'src/server/agent'),
      path.join(root, 'src/server/builtin-tools'),
    ];
    const bunBundleFiles: string[] = [];

    const walk = async (dir: string): Promise<void> => {
      let entries: Array<{ name: string; isDirectory: () => boolean }> = [];
      try {
        entries = (await fs.readdir(dir, { withFileTypes: true })) as Array<{
          name: string;
          isDirectory: () => boolean;
        }>;
      } catch {
        return;
      }

      for (const entry of entries) {
        const next = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(next);
          continue;
        }
        if (!/\.(ts|tsx|js|mjs|cjs)$/.test(entry.name)) continue;
        try {
          const content = await fs.readFile(next, 'utf8');
          if (content.includes('bun:bundle')) {
            bunBundleFiles.push(path.relative(root, next).replace(/\\/g, '/'));
          }
        } catch {
          // best-effort only
        }
      }
    };

    for (const scanRoot of scanRoots) {
      await walk(scanRoot);
    }

    const warnings: string[] = [];
    if (bunBundleFiles.length > 0) {
      warnings.push(`runtime_warning:bun_bundle_files=${bunBundleFiles.length}`);
    }

    return { warnings, bunBundleFiles: bunBundleFiles.sort() };
  } catch {
    return { warnings: [], bunBundleFiles: [] };
  }
};

export const runQueryEngineShadowProbe = async (): Promise<QueryEngineShadowProbeResult> => {
  const reasons: string[] = [];
  const warnings: string[] = [];

  const [queryEngineProbe, queryProbe, toolProbe] = await Promise.all([
    safeImport(() => import('../QueryEngine')),
    safeImport(() => import('../query')),
    safeImport(() => import('../Tool')),
  ]);

  if (!queryEngineProbe.ok) {
    reasons.push('import_failed:QueryEngine');
    warnings.push(`runtime_warning:import_error:QueryEngine:${queryEngineProbe.error}`);
  } else if (!hasNamedExport(queryEngineProbe.mod, 'ask')) {
    reasons.push('invalid_export:QueryEngine.ask');
  }

  if (!queryProbe.ok) {
    reasons.push('import_failed:query');
    warnings.push(`runtime_warning:import_error:query:${queryProbe.error}`);
  } else if (!hasNamedExport(queryProbe.mod, 'query')) {
    reasons.push('invalid_export:query.query');
  }

  if (!toolProbe.ok) {
    reasons.push('import_failed:Tool');
    warnings.push(`runtime_warning:import_error:Tool:${toolProbe.error}`);
  } else if (!hasNamedExport(toolProbe.mod, 'getEmptyToolPermissionContext')) {
    reasons.push('invalid_export:Tool.getEmptyToolPermissionContext');
  }

  const bunBundle = await maybeCollectBunBundleWarnings();
  warnings.push(...bunBundle.warnings);

  return {
    ready: reasons.length === 0,
    reasons,
    warnings,
    bunBundleFiles: bunBundle.bunBundleFiles,
  };
};

import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import type { Plugin as EsbuildPlugin } from "esbuild";
import type { ProjectData } from "@server/projects/projectStorage";

const PUBLISHED_SITES_ROOT = path.resolve(process.cwd(), "data", "published-sites");
const BUILD_META_FILE = "build-meta.json";

const ENTRY_CANDIDATES = [
  "/src/main.tsx",
  "/src/main.jsx",
  "/src/main.ts",
  "/src/main.js",
  "/src/index.tsx",
  "/src/index.jsx",
  "/src/index.ts",
  "/src/index.js",
  "/index.tsx",
  "/index.jsx",
  "/index.ts",
  "/index.js",
  "/main.tsx",
  "/main.jsx",
  "/main.ts",
  "/main.js",
] as const;

const APP_COMPONENT_CANDIDATES = [
  "/src/App.tsx",
  "/src/App.jsx",
  "/App.tsx",
  "/App.jsx",
  "/App.ts",
  "/App.js",
] as const;

const HTML_CANDIDATES = ["/index.html", "/public/index.html"] as const;
const RESOLVE_EXTENSIONS = ["", ".tsx", ".ts", ".jsx", ".js", ".mjs", ".cjs", ".json", ".css"] as const;

export type StaticSiteBuildMeta = {
  shareId: string;
  projectToken: string;
  projectUpdatedAt: string;
  builtAt: string;
  status: "success" | "error";
  mode: "esbuild-bundle" | "static-html";
  entryFile: string | null;
  errors: string[];
  assetCount: number;
};

export type StaticSiteBuildResult = StaticSiteBuildMeta & {
  ok: boolean;
  outputDir: string;
};

const safeShareId = (shareId: string): string => {
  if (!/^[a-zA-Z0-9_-]{4,128}$/.test(shareId)) {
    throw new Error("Invalid shareId");
  }
  return shareId;
};

export function getPublishedSiteDir(shareId: string): string {
  return path.join(PUBLISHED_SITES_ROOT, safeShareId(shareId));
}

export async function removeStaticSiteBuild(shareId: string): Promise<void> {
  try {
    await fs.rm(getPublishedSiteDir(shareId), { recursive: true, force: true });
  } catch {
    // Ignore invalid shareId or already-removed directory.
  }
}

export async function readStaticSiteBuildMeta(shareId: string): Promise<StaticSiteBuildMeta | null> {
  try {
    const metaPath = path.join(getPublishedSiteDir(shareId), BUILD_META_FILE);
    const raw = await fs.readFile(metaPath, "utf8");
    return JSON.parse(raw) as StaticSiteBuildMeta;
  } catch {
    return null;
  }
}

function normalizeProjectFiles(rawFiles: ProjectData["files"]): Record<string, string> {
  const result: Record<string, string> = {};
  if (!rawFiles || typeof rawFiles !== "object") return result;
  for (const [rawPath, value] of Object.entries(rawFiles)) {
    const trimmed = rawPath.trim();
    if (!trimmed) continue;
    const normalized = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
    if (typeof value === "string") {
      result[normalized] = value;
    } else if (value && typeof value === "object" && "code" in value && typeof value.code === "string") {
      result[normalized] = value.code;
    }
  }
  return result;
}

function resolveVirtualFile(files: Record<string, string>, baseDir: string, specifier: string): string | null {
  const rawTarget = specifier.startsWith("/")
    ? path.posix.normalize(specifier)
    : path.posix.normalize(path.posix.join(baseDir, specifier));

  for (const ext of RESOLVE_EXTENSIONS) {
    const candidate = rawTarget + ext;
    if (candidate in files) return candidate;
  }
  for (const indexName of ["/index.tsx", "/index.ts", "/index.jsx", "/index.js"]) {
    const candidate = rawTarget.replace(/\/$/, "") + indexName;
    if (candidate in files) return candidate;
  }
  return null;
}

function loaderForPath(filePath: string): "tsx" | "ts" | "jsx" | "css" | "json" | "text" {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".tsx")) return "tsx";
  if (lower.endsWith(".ts")) return "ts";
  if (lower.endsWith(".jsx") || lower.endsWith(".js") || lower.endsWith(".mjs") || lower.endsWith(".cjs")) return "jsx";
  if (lower.endsWith(".css")) return "css";
  if (lower.endsWith(".json")) return "json";
  return "text";
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildHtmlDocument(params: {
  title: string;
  templateHtml?: string;
  hasCss: boolean;
  externalPackages: Map<string, string>;
}): string {
  const importMapScript =
    params.externalPackages.size > 0
      ? `<script type="importmap">${JSON.stringify({ imports: Object.fromEntries(params.externalPackages) })}</script>\n`
      : "";
  const cssLink = params.hasCss ? `<link rel="stylesheet" href="./bundle.css" />\n` : "";
  const bundleScript = `<script type="module" src="./bundle.js"></script>\n`;

  if (params.templateHtml) {
    let html = params.templateHtml;
    // Strip Vite/dev module scripts pointing to source files that are now bundled
    html = html.replace(/<script[^>]*type=["']module["'][^>]*src=["'][^"']*\/(?:src\/)?(?:main|index)\.[jt]sx?["'][^>]*><\/script>/gi, "");
    if (!/id=["']root["']/i.test(html) && /<body[^>]*>/i.test(html)) {
      html = html.replace(/<body[^>]*>/i, (match) => `${match}\n<div id="root"></div>`);
    }
    if (/<\/head>/i.test(html)) {
      html = html.replace(/<\/head>/i, `${importMapScript}${cssLink}</head>`);
    } else {
      html = `${importMapScript}${cssLink}${html}`;
    }
    if (/<\/body>/i.test(html)) {
      html = html.replace(/<\/body>/i, `${bundleScript}</body>`);
    } else {
      html = `${html}\n${bundleScript}`;
    }
    return html;
  }

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(params.title)}</title>
  ${importMapScript}${cssLink}
</head>
<body>
  <div id="root"></div>
  ${bundleScript}
</body>
</html>
`;
}

function shouldCopyAsStaticAsset(filePath: string): boolean {
  if (filePath === "/package.json" || filePath === "/package-lock.json" || filePath === "/tsconfig.json") return false;
  if (filePath.startsWith("/public/")) return true;
  return /\.(?:html|css|svg|png|jpe?g|gif|webp|ico|woff2?|ttf|eot|json|txt|xml|webmanifest)$/i.test(filePath);
}

async function writeStaticAssets(outputDir: string, files: Record<string, string>, skipRootIndexHtml: boolean): Promise<number> {
  let count = 0;
  for (const [filePath, content] of Object.entries(files)) {
    if (!shouldCopyAsStaticAsset(filePath)) continue;
    const relative = filePath.startsWith("/public/") ? filePath.slice("/public/".length) : filePath.replace(/^\/+/, "");
    if (!relative || relative.includes("..")) continue;
    if (skipRootIndexHtml && relative === "index.html") continue;
    const target = path.resolve(outputDir, relative);
    if (!target.startsWith(outputDir + path.sep)) continue;
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, "utf8");
    count += 1;
  }
  return count;
}

export function renderBuildErrorHtml(title: string, errors: string[]): string {
  const list = (errors.length ? errors : ["站点静态构建失败"]).map((e) => `<li><pre>${escapeHtml(e)}</pre></li>`).join("");
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)} - 构建失败</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #fafafa; color: #18181b; margin: 0; padding: 32px; }
    .card { max-width: 760px; margin: 40px auto; background: #fff; border: 1px solid #e4e4e7; border-radius: 12px; padding: 24px; }
    h1 { font-size: 18px; margin: 0 0 12px; color: #dc2626; }
    p { font-size: 14px; color: #52525b; margin: 0 0 16px; }
    ul { margin: 0; padding-left: 18px; }
    pre { background: #f4f4f5; padding: 10px 12px; border-radius: 8px; overflow-x: auto; font-size: 12px; white-space: pre-wrap; word-break: break-word; }
  </style>
</head>
<body>
  <div class="card">
    <h1>站点静态构建失败</h1>
    <p>请在工作区修复以下错误后重新保存或发布站点：</p>
    <ul>${list}</ul>
  </div>
</body>
</html>`;
}

export async function buildStaticSite(shareId: string, project: ProjectData): Promise<StaticSiteBuildResult> {
  const outputDir = getPublishedSiteDir(shareId);
  const builtAt = new Date().toISOString();
  const files = normalizeProjectFiles(project.files);

  await fs.mkdir(outputDir, { recursive: true });

  const entryFile = ENTRY_CANDIDATES.find((candidate) => Boolean(files[candidate])) || null;
  const appFile = entryFile ? null : APP_COMPONENT_CANDIDATES.find((candidate) => Boolean(files[candidate])) || null;
  const htmlFile = HTML_CANDIDATES.find((candidate) => Boolean(files[candidate])) || null;

  // Mode 1: Pure static HTML project (no JS/TS entry file)
  if (!entryFile && !appFile) {
    if (!htmlFile) {
      const meta: StaticSiteBuildMeta = {
        shareId,
        projectToken: project.token,
        projectUpdatedAt: project.updatedAt,
        builtAt,
        status: "error",
        mode: "static-html",
        entryFile: null,
        errors: ["项目中未找到入口文件（如 /index.html、/src/main.tsx、/App.tsx 或 /index.js）。"],
        assetCount: 0,
      };
      await fs.writeFile(path.join(outputDir, BUILD_META_FILE), JSON.stringify(meta, null, 2), "utf8");
      return { ...meta, ok: false, outputDir };
    }

    await fs.rm(outputDir, { recursive: true, force: true });
    await fs.mkdir(outputDir, { recursive: true });
    let assetCount = 0;
    for (const [filePath, content] of Object.entries(files)) {
      if (filePath === "/package.json") continue;
      const relative = filePath.startsWith("/public/") ? filePath.slice("/public/".length) : filePath.replace(/^\/+/, "");
      if (!relative || relative.includes("..")) continue;
      const target = path.resolve(outputDir, relative);
      if (!target.startsWith(outputDir + path.sep)) continue;
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, content, "utf8");
      assetCount += 1;
    }

    const meta: StaticSiteBuildMeta = {
      shareId,
      projectToken: project.token,
      projectUpdatedAt: project.updatedAt,
      builtAt,
      status: "success",
      mode: "static-html",
      entryFile: htmlFile,
      errors: [],
      assetCount,
    };
    await fs.writeFile(path.join(outputDir, BUILD_META_FILE), JSON.stringify(meta, null, 2), "utf8");
    return { ...meta, ok: true, outputDir };
  }

  // Mode 2: esbuild bundle for React / TS / JS projects
  const virtualEntryPath = "/__ai_studio_entry__.tsx";
  const effectiveFiles: Record<string, string> = { ...files };
  const resolvedEntry = entryFile || virtualEntryPath;
  if (!entryFile && appFile) {
    effectiveFiles[virtualEntryPath] = [
      `import React from "react";`,
      `import { createRoot } from "react-dom/client";`,
      `import App from ${JSON.stringify(appFile)};`,
      `const rootEl = document.getElementById("root") || document.body.appendChild(document.createElement("div"));`,
      `createRoot(rootEl).render(React.createElement(App));`,
    ].join("\n");
  }

  const hostRequire = createRequire(path.join(process.cwd(), "package.json"));
  const externalPackages = new Map<string, string>();
  const dependencies = project.dependencies || {};

  const virtualWorkspacePlugin: EsbuildPlugin = {
    name: "ai-studio-virtual-workspace",
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        if (args.kind === "entry-point") {
          return { path: args.path, namespace: "virtual" };
        }
        // Relative or workspace-absolute imports from virtual files
        if (args.namespace === "virtual" && (args.path.startsWith(".") || args.path.startsWith("/"))) {
          const baseDir = path.posix.dirname(args.importer || "/");
          const matched = resolveVirtualFile(effectiveFiles, baseDir, args.path);
          if (matched) {
            return { path: matched, namespace: "virtual" };
          }
          return {
            errors: [{ text: `Cannot resolve "${args.path}" from "${args.importer}" in project workspace.` }],
          };
        }
        // Bare module specifiers from virtual files: prefer local node_modules, fallback to esm.sh importmap
        if (args.namespace === "virtual") {
          try {
            const resolved = hostRequire.resolve(args.path);
            return { path: resolved };
          } catch {
            const pkgName = args.path.startsWith("@")
              ? args.path.split("/").slice(0, 2).join("/")
              : args.path.split("/")[0];
            const version = dependencies[pkgName];
            const versionSuffix = version && !/^[*^~]?latest$/i.test(version) ? `@${version.replace(/^[\^~]/, "")}` : "";
            const subpath = args.path.slice(pkgName.length);
            externalPackages.set(args.path, `https://esm.sh/${pkgName}${versionSuffix}${subpath}`);
            return { path: args.path, external: true };
          }
        }
        return null;
      });

      build.onLoad({ filter: /.*/, namespace: "virtual" }, (args) => {
        const contents = effectiveFiles[args.path];
        if (typeof contents !== "string") {
          return { errors: [{ text: `Virtual file not found: ${args.path}` }] };
        }
        return {
          contents,
          loader: loaderForPath(args.path),
          resolveDir: process.cwd(),
        };
      });
    },
  };

  try {
    const esbuild = await import("esbuild");
    const result = await esbuild.build({
      entryPoints: [resolvedEntry],
      bundle: true,
      write: false,
      format: "esm",
      platform: "browser",
      target: ["es2020"],
      jsx: "automatic",
      minify: true,
      outdir: "out",
      entryNames: "bundle",
      define: {
        "process.env.NODE_ENV": '"production"',
      },
      plugins: [virtualWorkspacePlugin],
    });

    await fs.rm(outputDir, { recursive: true, force: true });
    await fs.mkdir(outputDir, { recursive: true });

    let hasCss = false;
    let assetCount = 0;
    for (const outFile of result.outputFiles || []) {
      const fileName = path.basename(outFile.path);
      if (fileName === "bundle.css") hasCss = true;
      await fs.writeFile(path.join(outputDir, fileName), outFile.contents);
      assetCount += 1;
    }

    assetCount += await writeStaticAssets(outputDir, files, true);

    const html = buildHtmlDocument({
      title: project.name || "Published Site",
      templateHtml: htmlFile ? files[htmlFile] : undefined,
      hasCss,
      externalPackages,
    });
    await fs.writeFile(path.join(outputDir, "index.html"), html, "utf8");
    assetCount += 1;

    const meta: StaticSiteBuildMeta = {
      shareId,
      projectToken: project.token,
      projectUpdatedAt: project.updatedAt,
      builtAt,
      status: "success",
      mode: "esbuild-bundle",
      entryFile: entryFile || appFile,
      errors: [],
      assetCount,
    };
    await fs.writeFile(path.join(outputDir, BUILD_META_FILE), JSON.stringify(meta, null, 2), "utf8");
    return { ...meta, ok: true, outputDir };
  } catch (err) {
    const esbuildErrors =
      err && typeof err === "object" && "errors" in err && Array.isArray((err as { errors?: unknown[] }).errors)
        ? (err as { errors: Array<{ text?: string; location?: { file?: string; line?: number; column?: number } | null }> }).errors.map(
            (e) => {
              const loc = e.location?.file ? `${e.location.file}:${e.location.line ?? 0}:${e.location.column ?? 0} ` : "";
              return `${loc}${e.text || "Build error"}`.trim();
            },
          )
        : [err instanceof Error ? err.message : String(err)];

    const meta: StaticSiteBuildMeta = {
      shareId,
      projectToken: project.token,
      projectUpdatedAt: project.updatedAt,
      builtAt,
      status: "error",
      mode: "esbuild-bundle",
      entryFile: entryFile || appFile,
      errors: esbuildErrors,
      assetCount: 0,
    };
    await fs.writeFile(path.join(outputDir, BUILD_META_FILE), JSON.stringify(meta, null, 2), "utf8");
    return { ...meta, ok: false, outputDir };
  }
}

export async function ensureStaticSiteBuilt(shareId: string, project: ProjectData): Promise<StaticSiteBuildResult> {
  const existing = await readStaticSiteBuildMeta(shareId);
  const outputDir = getPublishedSiteDir(shareId);
  if (existing && existing.status === "success" && existing.projectUpdatedAt === project.updatedAt) {
    try {
      await fs.access(path.join(outputDir, "index.html"));
      return { ...existing, ok: true, outputDir };
    } catch {
      // Output missing on disk, rebuild below.
    }
  }
  return buildStaticSite(shareId, project);
}

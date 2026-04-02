import { promises as fs } from "fs";
import os from "os";
import path from "path";
import type { RuntimeSkill } from "./types";
import { runExecFile } from "../tools/commandRunner";
import { buildSessionIsolatedEnv } from "../tools/sessionEnv";
import { validateWorkspaceArgv } from "../tools/sandboxFsPolicy";
import { getObjectFromStorage } from "@server/storage/s3";

const isPathInside = (baseDir: string, targetPath: string) => {
  const relative = path.relative(baseDir, targetPath);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
};

const resolveSkillScriptPath = (skill: RuntimeSkill, script: string) => {
  const baseDir = path.resolve(skill.baseDir);
  const candidate = path.isAbsolute(script) ? path.resolve(script) : path.resolve(baseDir, script);
  if (!isPathInside(baseDir, candidate)) {
    throw new Error(`脚本路径越界，不允许访问 skill 目录外文件: ${script}`);
  }
  return candidate;
};

const resolveSkillCwd = (skill: RuntimeSkill, cwd?: string) => {
  const baseDir = path.resolve(skill.baseDir);
  if (!cwd || !cwd.trim()) return baseDir;
  const resolved = path.isAbsolute(cwd) ? path.resolve(cwd) : path.resolve(baseDir, cwd);
  if (resolved !== baseDir && !isPathInside(baseDir, resolved)) {
    throw new Error(`cwd 越界，不允许访问 skill 目录外路径: ${cwd}`);
  }
  return resolved;
};

const detectRuntime = (scriptPath: string, runtime?: string) => {
  if (runtime && runtime !== "auto") return runtime;
  const ext = path.extname(scriptPath).toLowerCase();
  if (ext === ".py") return "python";
  if (ext === ".js" || ext === ".mjs" || ext === ".cjs") return "node";
  if (ext === ".sh") return "sh";
  if (ext === ".bash") return "bash";
  return "auto";
};

const resolveNodeCommandCandidates = async () => {
  const candidates: string[] = [];
  const execPath = process.execPath;
  if (execPath) {
    const stat = await fs.stat(execPath).catch(() => null);
    if (stat?.isFile()) candidates.push(execPath);
  }
  candidates.push("node");
  return [...new Set(candidates)];
};

const extractChatUploadStorageKey = (value: string) => {
  const normalized = value.replace(/\\/g, "/").replace(/\/{2,}/g, "/").trim();
  if (!normalized) return "";
  const marker = "/chat_uploads/";
  const idx = normalized.indexOf(marker);
  const storageKey =
    idx >= 0
      ? normalized.slice(idx + 1)
      : normalized.startsWith("chat_uploads/")
      ? normalized
      : "";
  return /^chat_uploads\/.+/.test(storageKey) ? storageKey : "";
};

const parseBase64DataUrl = (raw: string): Buffer | null => {
  const trimmed = raw.trim();
  const match = trimmed.match(/^data:([^;,]+)?;base64,([\s\S]+)$/i);
  if (!match) return null;
  const base64Body = (match[2] || "").replace(/\s+/g, "");
  if (!base64Body) return null;
  try {
    return Buffer.from(base64Body, "base64");
  } catch {
    return null;
  }
};

const SUPPORTED_SCRIPT_EXTS = [".js", ".mjs", ".cjs", ".py", ".sh", ".bash"] as const;
const DEFAULT_PYPI_INDEX_URL = "https://pypi.mirrors.ustc.edu.cn/simple";
const DEFAULT_PYPI_TRUSTED_HOST = "pypi.mirrors.ustc.edu.cn";

const isSupportedScriptFile = (filePath: string) => {
  const ext = path.extname(filePath).toLowerCase();
  return SUPPORTED_SCRIPT_EXTS.includes(ext as (typeof SUPPORTED_SCRIPT_EXTS)[number]);
};

const isHttpUrl = (value: string) => /^https?:\/\//i.test(value.trim());

const collectSkillScriptFiles = async (baseDir: string, maxDepth = 3) => {
  const entries: string[] = [];
  const walk = async (dir: string, depth: number) => {
    if (depth > maxDepth) return;
    const children = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const child of children) {
      const childPath = path.join(dir, child.name);
      if (child.isDirectory()) {
        if (child.name === "node_modules" || child.name.startsWith(".")) continue;
        await walk(childPath, depth + 1);
        continue;
      }
      if (child.isFile() && isSupportedScriptFile(childPath)) {
        entries.push(childPath);
      }
    }
  };
  await walk(baseDir, 0);
  return entries;
};

const resolveFallbackScriptPath = async (skill: RuntimeSkill, requestedScript: string) => {
  const baseDir = path.resolve(skill.baseDir);
  const allScriptFiles = await collectSkillScriptFiles(baseDir, 3);
  if (allScriptFiles.length === 0) return null;

  const normalizedRequested = requestedScript.replace(/\\/g, "/");
  const requestedExt = path.extname(normalizedRequested).toLowerCase();
  const requestedStem = path.basename(normalizedRequested, requestedExt).toLowerCase();

  // 1) 优先同名（忽略扩展名）
  const sameStem = allScriptFiles.filter((item) => {
    const ext = path.extname(item).toLowerCase();
    const stem = path.basename(item, ext).toLowerCase();
    return requestedStem && stem === requestedStem;
  });
  if (sameStem.length === 1) return sameStem[0];

  // 2) 常见内置入口脚本
  const preferredRelatives = [
    "index.js",
    "index.mjs",
    "index.cjs",
    "index.py",
    "scripts/index.js",
    "scripts/index.mjs",
    "scripts/index.cjs",
    "bin/index.js",
    "run.js",
    "main.js",
  ];
  for (const rel of preferredRelatives) {
    const abs = path.join(baseDir, rel);
    if (allScriptFiles.includes(abs)) return abs;
  }

  // 3) 只有一个脚本文件时自动兜底
  if (allScriptFiles.length === 1) return allScriptFiles[0];

  return null;
};

export const runSkillScript = async (input: {
  skill: RuntimeSkill;
  script: string;
  args: string[];
  runtime: "auto" | "python" | "node" | "sh" | "bash";
  cwd?: string;
  timeoutMs: number;
  autoInstallDeps?: boolean;
  autoDownloadScript?: boolean;
  scriptDownloadUrl?: string;
  sessionId?: string;
  workspaceFiles?: Record<string, { code: string }>;
  workspaceRoot?: string;
}) => {
  const resolvedWorkspaceRoot = input.workspaceRoot ? path.resolve(input.workspaceRoot) : "";
  const shouldUseMountedWorkspaceRoot = Boolean(resolvedWorkspaceRoot);
  const SYSTEM_ABSOLUTE_PATH_PREFIXES = [
    "/tmp",
    "/var",
    "/usr",
    "/bin",
    "/sbin",
    "/etc",
    "/dev",
    "/proc",
    "/sys",
    "/opt",
    "/private",
    "/Users",
    "/home",
    "/Library",
    "/Applications",
  ];
  const isSystemAbsolutePath = (absPath: string) =>
    SYSTEM_ABSOLUTE_PATH_PREFIXES.some(
      (prefix) => absPath === prefix || absPath.startsWith(`${prefix}/`)
    );
  const toWorkspaceMountedPath = (absPath: string) => {
    if (!shouldUseMountedWorkspaceRoot) return absPath;
    const normalized = absPath.replace(/\\/g, "/").replace(/\/{2,}/g, "/");
    if (normalized === "/files" || normalized === "/.files") {
      return path.join(resolvedWorkspaceRoot, ".files");
    }
    if (normalized.startsWith("/files/")) {
      return path.join(resolvedWorkspaceRoot, ".files", normalized.slice("/files/".length));
    }
    if (normalized.startsWith("/.files/")) {
      return path.join(resolvedWorkspaceRoot, ".files", normalized.slice("/.files/".length));
    }
    if (isSystemAbsolutePath(normalized)) return absPath;
    return path.join(resolvedWorkspaceRoot, normalized.replace(/^\/+/, ""));
  };

  const materializeWorkspaceFiles = async (files?: Record<string, { code: string }>) => {
    if (shouldUseMountedWorkspaceRoot) {
      await fs.mkdir(resolvedWorkspaceRoot, { recursive: true });
      return {
        tempRoot: resolvedWorkspaceRoot,
        roots: new Set<string>(["."]),
        mountedWorkspaceRoot: true,
      };
    }
    if (!files || Object.keys(files).length === 0) return null;
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "skill-workspace-"));
    const roots = new Set<string>();

    for (const [filePath, file] of Object.entries(files)) {
      const normalized = filePath.replace(/\\/g, "/").replace(/\/{2,}/g, "/");
      if (!normalized.startsWith("/") || normalized.includes("\0") || normalized.includes("..")) continue;
      const parts = normalized.split("/").filter(Boolean);
      const root = parts[0] || ".";
      roots.add(root);
      const target = path.join(tempRoot, ...parts);
      await fs.mkdir(path.dirname(target), { recursive: true });
      const code = typeof file?.code === "string" ? file.code : "";
      const isAttachmentPath = normalized.startsWith("/.files/");
      const binaryAttachment = isAttachmentPath ? parseBase64DataUrl(code) : null;
      if (binaryAttachment) {
        await fs.writeFile(target, binaryAttachment);
      } else {
        await fs.writeFile(target, code, "utf8");
      }
    }

    if (roots.size === 0) {
      await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
      return null;
    }

    return { tempRoot, roots, mountedWorkspaceRoot: false };
  };

  const snapshotWorkspaceFiles = async (
    mount: { tempRoot: string; roots: Set<string>; mountedWorkspaceRoot: boolean } | null
  ) => {
    if (!mount || mount.mountedWorkspaceRoot) return undefined;
    const result: Record<string, { code: string }> = {};
    const walk = async (dir: string) => {
      const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(abs);
          continue;
        }
        if (!entry.isFile()) continue;
        const rel = path.relative(mount.tempRoot, abs).split(path.sep).join("/");
        if (!rel) continue;
        const normalizedPath = `/${rel.replace(/^\/+/, "")}`;
        const buffer = await fs.readFile(abs);
        const isBinary = buffer.includes(0);
        result[normalizedPath] = {
          code: isBinary ? `data:application/octet-stream;base64,${buffer.toString("base64")}` : buffer.toString("utf8"),
        };
      }
    };
    await walk(mount.tempRoot);
    return result;
  };

  const workspaceMount = await materializeWorkspaceFiles(input.workspaceFiles);
  const storageMaterializedByKey = new Map<string, string>();
  const extraTempRoots = new Set<string>();
  const resolvedSkillBaseDir = path.resolve(input.skill.baseDir);
  const tryMaterializeChatUploadArg = async (value: string): Promise<string | null> => {
    const storageKey = extractChatUploadStorageKey(value);
    if (!storageKey) return null;

    const cached = storageMaterializedByKey.get(storageKey);
    if (cached) return cached;

    const baseName = path.posix.basename(storageKey);
    const targetRoot =
      workspaceMount?.tempRoot ||
      (await fs.mkdtemp(path.join(os.tmpdir(), "skill-chat-upload-")));
    if (!workspaceMount) extraTempRoots.add(targetRoot);
    const targetPath = path.join(targetRoot, ".files", baseName);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });

    try {
      const object = await getObjectFromStorage({ key: storageKey, bucketType: "private" });
      await fs.writeFile(targetPath, object.buffer);
      storageMaterializedByKey.set(storageKey, targetPath);
      return targetPath;
    } catch {
      return null;
    }
  };
  const mapWorkspacePath = (value: string) => {
    if (!workspaceMount || !value) return value;

    const storageLike = value.replace(/\\/g, "/").replace(/\/{2,}/g, "/");
    const extractStorageKey = (raw: string) => {
      const marker = "/chat_uploads/";
      const idx = raw.indexOf(marker);
      if (idx >= 0) return raw.slice(idx + 1);
      return raw;
    };
    const storageKeyLike = extractStorageKey(storageLike);
    if (!path.isAbsolute(storageLike) && /^chat_uploads\/.+/.test(storageLike) && workspaceMount.roots.has(".files")) {
      const base = path.posix.basename(storageLike);
      return path.join(workspaceMount.tempRoot, ".files", base);
    }
    if (/^chat_uploads\/.+/.test(storageKeyLike) && workspaceMount.roots.has(".files")) {
      const base = path.posix.basename(storageKeyLike);
      return path.join(workspaceMount.tempRoot, ".files", base);
    }

    if (!path.isAbsolute(value)) return value;
    const resolvedAbs = path.resolve(value);
    // Never remap real files under the skill directory.
    if (resolvedAbs === resolvedSkillBaseDir || resolvedAbs.startsWith(`${resolvedSkillBaseDir}${path.sep}`)) {
      return resolvedAbs;
    }
    if (shouldUseMountedWorkspaceRoot) {
      return toWorkspaceMountedPath(resolvedAbs);
    }
    const normalized = resolvedAbs.replace(/\\/g, "/").replace(/\/{2,}/g, "/");
    const parts = normalized.split("/").filter(Boolean);
    const root = parts[0] || "";
    if (root && workspaceMount.roots.has(root)) {
      return path.join(workspaceMount.tempRoot, ...parts);
    }
    if (/^\/SKILL\.md$/i.test(normalized) && workspaceMount.roots.size === 1) {
      const onlyRoot = [...workspaceMount.roots][0];
      return path.join(workspaceMount.tempRoot, onlyRoot, "SKILL.md");
    }
    return value;
  };

  const resolveExtByRuntime = (runtime: "auto" | "python" | "node" | "sh" | "bash") => {
    if (runtime === "python") return ".py";
    if (runtime === "node") return ".js";
    if (runtime === "sh" || runtime === "bash") return ".sh";
    return "";
  };

  const downloadScriptToSkillDir = async (urlRaw: string, preferredName: string) => {
    const url = urlRaw.trim();
    if (!isHttpUrl(url)) {
      throw new Error(`不支持的脚本下载地址: ${urlRaw}`);
    }

    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), Math.min(Math.max(input.timeoutMs, 10_000), 120_000));
    let response: Response;
    try {
      response = await fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(timeoutHandle);
    }
    if (!response.ok) {
      throw new Error(`下载脚本失败: ${url} (HTTP ${response.status})`);
    }

    const body = Buffer.from(await response.arrayBuffer());
    const inferredName = (() => {
      const fromUrl = path.posix.basename(new URL(url).pathname);
      if (fromUrl && fromUrl !== "/") return fromUrl;
      return "";
    })();

    const sanitizedPreferredName = preferredName.replace(/\\/g, "/").split("/").pop() || "script";
    const baseName = inferredName || sanitizedPreferredName || "script";
    const ext = path.extname(baseName) || resolveExtByRuntime(input.runtime);
    const stem = path.basename(baseName, path.extname(baseName));

    const downloadDir = path.join(path.resolve(input.skill.baseDir), ".aistudio_downloads");
    await fs.mkdir(downloadDir, { recursive: true });
    const timestamp = Date.now();
    const fileName = `${stem || "script"}-${timestamp}${ext || ""}`;
    const filePath = path.join(downloadDir, fileName);
    await fs.writeFile(filePath, body);
    await fs.chmod(filePath, 0o755).catch(() => undefined);
    return filePath;
  };

  const resolveDownloadCandidates = () => {
    const candidates: string[] = [];
    if (input.scriptDownloadUrl && input.scriptDownloadUrl.trim()) {
      candidates.push(input.scriptDownloadUrl.trim());
    }
    if (isHttpUrl(input.script)) {
      candidates.push(input.script.trim());
    }
    const metadata = input.skill.metadata || {};
    const fromMetadata = [
      metadata.script_download_url,
      metadata.download_url,
      metadata.script_url,
    ].filter((item): item is string => typeof item === "string" && item.trim().length > 0);
    candidates.push(...fromMetadata.map((item) => item.trim()));
    return [...new Set(candidates)];
  };

  const resolveScriptPathOrNull = () => {
    if (isHttpUrl(input.script)) return null;
    return resolveSkillScriptPath(input.skill, input.script);
  };

  const resolvedScriptPath = resolveScriptPathOrNull();
  const mappedScriptPath = resolvedScriptPath ? mapWorkspacePath(resolvedScriptPath) : "";
  const scriptStat = mappedScriptPath ? await fs.stat(mappedScriptPath).catch(() => null) : null;

  let finalScriptPath = mappedScriptPath;
  if (!scriptStat || !scriptStat.isFile()) {
    const fallbackScript =
      resolvedScriptPath && !isHttpUrl(input.script)
        ? await resolveFallbackScriptPath(input.skill, input.script)
        : null;
    const mappedFallback = fallbackScript ? mapWorkspacePath(fallbackScript) : null;
    const fallbackStat = mappedFallback ? await fs.stat(mappedFallback).catch(() => null) : null;

    if (mappedFallback && fallbackStat?.isFile()) {
      finalScriptPath = mappedFallback;
    } else {
      const shouldAutoDownload = input.autoDownloadScript !== false;
      if (shouldAutoDownload) {
        const downloadCandidates = resolveDownloadCandidates();
        let lastError = "";
        for (const url of downloadCandidates) {
          try {
            finalScriptPath = await downloadScriptToSkillDir(url, input.script);
            break;
          } catch (error) {
            lastError = error instanceof Error ? error.message : String(error);
          }
        }
        const downloadedStat = finalScriptPath ? await fs.stat(finalScriptPath).catch(() => null) : null;
        if (downloadedStat?.isFile()) {
          // use downloaded script
        } else {
          const availableScripts = await collectSkillScriptFiles(path.resolve(input.skill.baseDir), 3);
          const listed = availableScripts
            .slice(0, 12)
            .map((file) => path.relative(path.resolve(input.skill.baseDir), file))
            .join(", ");
          const downloadHint =
            downloadCandidates.length > 0
              ? `。已尝试下载地址: ${downloadCandidates.join(", ")}${lastError ? `；最后错误: ${lastError}` : ""}`
              : "。未提供可用下载地址（可用 scriptDownloadUrl 或 skill metadata.script_download_url）。";
          throw new Error(
            `脚本文件不存在: ${mappedScriptPath || input.script}${
              listed ? `。该 skill 可用脚本: ${listed}` : "。该 skill 未发现可执行脚本文件"
            }${downloadHint}`
          );
        }
      } else {
        const availableScripts = await collectSkillScriptFiles(path.resolve(input.skill.baseDir), 3);
        const listed = availableScripts
          .slice(0, 12)
          .map((file) => path.relative(path.resolve(input.skill.baseDir), file))
          .join(", ");
        throw new Error(
          `脚本文件不存在: ${mappedScriptPath || input.script}${
            listed ? `。该 skill 可用脚本: ${listed}` : "。该 skill 未发现可执行脚本文件"
          }`
        );
      }
    }
  }

  const mappedCwd = mapWorkspacePath(input.cwd || "");
  const defaultSkillCwd = mapWorkspacePath(path.resolve(input.skill.baseDir));
  const execCwd = input.cwd
    ? mappedCwd && path.isAbsolute(mappedCwd)
      ? mappedCwd
      : resolveSkillCwd(input.skill, input.cwd)
    : defaultSkillCwd;
  const isolatedEnv = await buildSessionIsolatedEnv({
    sessionId: input.sessionId,
  });
  const detectedRuntime = detectRuntime(finalScriptPath, input.runtime);
  const workspaceArgError = validateWorkspaceArgv(input.args.map((item) => String(item)));
  if (workspaceArgError) {
    throw new Error(`脚本参数不符合工作区沙盒约束: ${workspaceArgError}`);
  }
  const resolvedArgs = (
    await Promise.all(
      input.args.map(async (item) => {
        const storageKey = extractChatUploadStorageKey(item);
        const materialized = await tryMaterializeChatUploadArg(item);
        if (storageKey && !materialized) {
          throw new Error(`附件下载失败，无法读取: ${storageKey}`);
        }
        return materialized || mapWorkspacePath(item);
      })
    )
  ).filter((item) => Boolean(item));
  const scriptInvocationArgs = [finalScriptPath, ...resolvedArgs];
  const dependencyInstall: {
    attempted: boolean;
    installed: boolean;
    command?: string;
    args?: string[];
    exitCode?: number;
    stdout?: string;
    stderr?: string;
    skippedReason?: string;
  } = {
    attempted: false,
    installed: false,
  };
  let pythonRequirementsEnsured = false;

  const ensureNodeDependencies = async () => {
    if (input.autoInstallDeps === false) {
      dependencyInstall.skippedReason = "auto_install_disabled";
      return;
    }
    if (detectedRuntime !== "node") {
      dependencyInstall.skippedReason = "runtime_not_node";
      return;
    }

    const packageDir = path.dirname(finalScriptPath);
    const packageJson = path.join(packageDir, "package.json");
    const hasPackageJson = await fs
      .stat(packageJson)
      .then((stat) => stat.isFile())
      .catch(() => false);
    if (!hasPackageJson) {
      dependencyInstall.skippedReason = "package_json_not_found";
      return;
    }

    const hasNodeModules = await fs
      .stat(path.join(packageDir, "node_modules"))
      .then((stat) => stat.isDirectory())
      .catch(() => false);
    if (hasNodeModules) {
      const pkgRaw = await fs.readFile(packageJson, "utf8").catch(() => "");
      let missingDeps = false;
      try {
        const pkg = JSON.parse(pkgRaw) as {
          dependencies?: Record<string, string>;
          optionalDependencies?: Record<string, string>;
        };
        const declared = {
          ...(pkg.dependencies || {}),
          ...(pkg.optionalDependencies || {}),
        };
        const depNames = Object.keys(declared);
        if (depNames.length > 0) {
          for (const depName of depNames) {
            const depPath = path.join(packageDir, "node_modules", ...depName.split("/"));
            const installed = await fs
              .stat(depPath)
              .then((stat) => stat.isDirectory())
              .catch(() => false);
            if (!installed) {
              missingDeps = true;
              break;
            }
          }
        }
      } catch {
        // package.json 解析失败时，保守执行一次安装
        missingDeps = true;
      }

      if (!missingDeps) {
        dependencyInstall.skippedReason = "node_modules_exists";
        return;
      }
    }

    const hasLockFile = await fs
      .stat(path.join(packageDir, "package-lock.json"))
      .then((stat) => stat.isFile())
      .catch(() => false);
    const command = "npm";
    const args = hasLockFile
      ? ["ci", "--no-audit", "--no-fund"]
      : ["install", "--no-audit", "--no-fund"];
    dependencyInstall.attempted = true;
    dependencyInstall.command = command;
    dependencyInstall.args = args;

    const installResult = await runExecFile({
      command,
      args,
      cwd: packageDir,
      timeoutMs: Math.max(input.timeoutMs, 120_000),
      env: isolatedEnv,
    });
    dependencyInstall.exitCode = installResult.exitCode;
    dependencyInstall.stdout = installResult.stdout;
    dependencyInstall.stderr = installResult.stderr;

    if (!installResult.ok) {
      const errText = installResult.stderr || installResult.error || "unknown install error";
      throw new Error(`依赖安装失败 (${command} ${args.join(" ")}): ${errText}`);
    }
    dependencyInstall.installed = true;
  };

  const ensurePythonDependenciesFromRequirements = async (pythonCommand: string) => {
    if (pythonRequirementsEnsured) return;
    if (input.autoInstallDeps === false) return;
    if (detectedRuntime !== "python") return;
    const searchDirs = [
      path.dirname(finalScriptPath),
      path.resolve(input.skill.baseDir),
      path.resolve(path.dirname(finalScriptPath), ".."),
      path.resolve(path.dirname(finalScriptPath), "../.."),
    ];
    const uniqueDirs = [...new Set(searchDirs)];
    let requirementsPath = "";
    for (const dir of uniqueDirs) {
      const candidate = path.join(dir, "requirements.txt");
      const exists = await fs
        .stat(candidate)
        .then((stat) => stat.isFile())
        .catch(() => false);
      if (exists) {
        requirementsPath = candidate;
        break;
      }
    }
    if (!requirementsPath) return;

    const pipArgs = [
      "-m",
      "pip",
      "install",
      "-r",
      requirementsPath,
      "-i",
      process.env.PIP_INDEX_URL || DEFAULT_PYPI_INDEX_URL,
      "--trusted-host",
      process.env.PIP_TRUSTED_HOST || DEFAULT_PYPI_TRUSTED_HOST,
    ];
    dependencyInstall.attempted = true;
    dependencyInstall.command = pythonCommand;
    dependencyInstall.args = pipArgs;
    const installResult = await runExecFile({
      command: pythonCommand,
      args: pipArgs,
      cwd: execCwd,
      timeoutMs: Math.max(input.timeoutMs, 120_000),
      env: isolatedEnv,
    });
    dependencyInstall.exitCode = installResult.exitCode;
    dependencyInstall.stdout = installResult.stdout;
    dependencyInstall.stderr = installResult.stderr;
    dependencyInstall.installed = installResult.ok;
    if (!installResult.ok) {
      const errText = installResult.stderr || installResult.error || "unknown pip install error";
      throw new Error(`Python 依赖安装失败 (${pythonCommand} ${pipArgs.join(" ")}): ${errText}`);
    }
    pythonRequirementsEnsured = true;
  };

  const extractMissingPythonModule = (stderr?: string, stdout?: string, errorText?: string) => {
    const source = `${stderr || ""}\n${stdout || ""}\n${errorText || ""}`;
    const match = source.match(/ModuleNotFoundError:\s*No module named ['"]([^'"]+)['"]/);
    return match?.[1]?.trim() || "";
  };

  const ensurePythonModule = async (pythonCommand: string, moduleName: string) => {
    if (!moduleName) return false;
    dependencyInstall.attempted = true;
    dependencyInstall.command = pythonCommand;
    const pipArgs = [
      "-m",
      "pip",
      "install",
      moduleName,
      "-i",
      process.env.PIP_INDEX_URL || DEFAULT_PYPI_INDEX_URL,
      "--trusted-host",
      process.env.PIP_TRUSTED_HOST || DEFAULT_PYPI_TRUSTED_HOST,
    ];
    dependencyInstall.args = pipArgs;
    const installResult = await runExecFile({
      command: pythonCommand,
      args: pipArgs,
      cwd: execCwd,
      timeoutMs: Math.max(input.timeoutMs, 120_000),
      env: isolatedEnv,
    });
    dependencyInstall.exitCode = installResult.exitCode;
    dependencyInstall.stdout = installResult.stdout;
    dependencyInstall.stderr = installResult.stderr;
    dependencyInstall.installed = installResult.ok;
    if (!installResult.ok) return false;
    return true;
  };

  await ensureNodeDependencies();
  const candidates: Array<{ command: string; args: string[] }> = [];

  if (detectedRuntime === "python") {
    candidates.push({ command: "python3", args: scriptInvocationArgs });
    candidates.push({ command: "python", args: scriptInvocationArgs });
  } else if (detectedRuntime === "node") {
    const nodeCommands = await resolveNodeCommandCandidates();
    nodeCommands.forEach((command) => candidates.push({ command, args: scriptInvocationArgs }));
  } else if (detectedRuntime === "sh") {
    candidates.push({ command: "sh", args: scriptInvocationArgs });
  } else if (detectedRuntime === "bash") {
    candidates.push({ command: "bash", args: scriptInvocationArgs });
  } else {
    candidates.push({ command: finalScriptPath, args: resolvedArgs });
    candidates.push({ command: "bash", args: scriptInvocationArgs });
    candidates.push({ command: "sh", args: scriptInvocationArgs });
  }

  try {
    for (const candidate of candidates) {
      if (detectedRuntime === "python" && !candidate.args.includes("-m")) {
        await ensurePythonDependenciesFromRequirements(candidate.command);
      }
      let result = await runExecFile({
        command: candidate.command,
        args: candidate.args,
        cwd: execCwd,
        timeoutMs: input.timeoutMs,
        env: isolatedEnv,
      });
      if (
        detectedRuntime === "python" &&
        input.autoInstallDeps !== false &&
        !result.ok &&
        !result.enoent
      ) {
        const missingModule = extractMissingPythonModule(result.stderr, result.stdout, result.error);
        if (missingModule) {
          const installed = await ensurePythonModule(candidate.command, missingModule);
          if (installed) {
            result = await runExecFile({
              command: candidate.command,
              args: candidate.args,
              cwd: execCwd,
              timeoutMs: input.timeoutMs,
              env: isolatedEnv,
            });
          }
        }
      }
      if (!result.enoent) {
        const workspaceFilesSnapshot = await snapshotWorkspaceFiles(workspaceMount || null);
        return {
          ...result,
          skill: input.skill.name,
          script: finalScriptPath,
          runtime: detectedRuntime,
          cwd: execCwd,
          sessionId: isolatedEnv.AISTUDIO_SESSION_ID,
          command: candidate.command,
          commandArgs: candidate.args,
          dependencyInstall,
          workspaceFiles: workspaceFilesSnapshot,
        };
      }
    }

    throw new Error(
      `未找到可用脚本解释器。请确认环境中已安装对应命令（尝试过: ${candidates.map((item) => item.command).join(", ")}）。`
    );
  } finally {
    if (workspaceMount?.tempRoot && !workspaceMount.mountedWorkspaceRoot) {
      await fs.rm(workspaceMount.tempRoot, { recursive: true, force: true }).catch(() => undefined);
    }
    for (const tempRoot of extraTempRoots) {
      await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
    }
  }
};

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import {
  Box,
  Flex,
  HStack,
  IconButton,
  Input,
  Menu,
  MenuButton,
  MenuItem,
  MenuList,
  Text,
  useToast,
} from "@chakra-ui/react";
import { useSandpack } from "@codesandbox/sandpack-react";

import { AddIcon, ChevronDownIcon, SearchIcon } from "../common/Icon";
import { withAuthHeaders } from "@features/auth/client/authClient";
import FileTree from "./fileExplorer/FileTree";
import { FileGlyph } from "./fileExplorer/icons";
import { useFileExplorerTheme } from "./fileExplorer/styleTokens";
import type { CreateMode, RenameTarget, SandpackFilesPayload } from "./fileExplorer/types";
import {
  buildFileMap,
  buildFolderMap,
  buildInitialFileCode,
  buildTree,
  collectFolderPaths,
  getParentPath,
  joinPath,
  toSandpackPath,
} from "./fileExplorer/utils";

const textFileExtSet = new Set([
  "txt",
  "md",
  "json",
  "js",
  "jsx",
  "ts",
  "tsx",
  "css",
  "scss",
  "less",
  "html",
  "htm",
  "xml",
  "yml",
  "yaml",
  "svg",
  "csv",
  "log",
  "env",
  "gitignore",
  "gitattributes",
  "npmrc",
  "editorconfig",
  "sh",
  "bash",
  "zsh",
  "py",
  "java",
  "go",
  "rs",
  "sql",
]);

const imageMimeByExt: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  ico: "image/x-icon",
  avif: "image/avif",
};

const extFromPath = (filePath: string) => filePath.split(".").pop()?.toLowerCase() || "";

const isTextLikePath = (filePath: string) => textFileExtSet.has(extFromPath(filePath));

const inferMimeFromPath = (filePath: string) => imageMimeByExt[extFromPath(filePath)] || "application/octet-stream";

const uint8ArrayToBase64 = (bytes: Uint8Array) => {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
};

const toDataUrl = (base64: string, contentType: string) => `data:${contentType};base64,${base64}`;

const readBrowserFileAsWorkspaceCode = async (file: File, filePath: string) => {
  if (file.type.startsWith("text/") || isTextLikePath(filePath)) {
    return file.text();
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const contentType = file.type || inferMimeFromPath(filePath);
  return toDataUrl(uint8ArrayToBase64(bytes), contentType);
};

const readZipEntryAsWorkspaceCode = async (
  entry: { async: (type: "string" | "base64") => Promise<string> },
  filePath: string
) => {
  if (isTextLikePath(filePath)) {
    return entry.async("string");
  }
  const base64 = await entry.async("base64");
  return toDataUrl(base64, inferMimeFromPath(filePath));
};

const isSkillsRootPath = (path: string) => /^\/skills(\/|$)/i.test(path);

const toSkillsScopedPath = (path: string, baseSkillFolder: string) => {
  if (isSkillsRootPath(path)) return path;
  const normalized = path.replace(/^\/+/, "");
  if (!normalized) return null;
  const base = baseSkillFolder.replace(/\/+$/, "") || "/skills/imported-skill";
  return `${base}/${normalized}`.replace(/\/{2,}/g, "/");
};

type FileExplorerPanelProps = {
  token: string;
  onOpenFile: (filePath: string) => void;
  onPersistFiles?: (files: SandpackFilesPayload) => Promise<void>;
  filePathFilter?: (path: string) => boolean;
  defaultFolderPath?: string;
  workspaceMode?: "project" | "skills";
};

const FileExplorerPanel = ({
  token,
  onOpenFile,
  onPersistFiles,
  filePathFilter,
  defaultFolderPath = "/",
  workspaceMode = "project",
}: FileExplorerPanelProps) => {
  const { sandpack } = useSandpack();
  const toast = useToast();
  const styles = useFileExplorerTheme();

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const [selectedPath, setSelectedPath] = useState<string>(
    sandpack.activeFile && (!filePathFilter || filePathFilter(sandpack.activeFile))
      ? sandpack.activeFile
      : defaultFolderPath
  );
  const [selectedType, setSelectedType] = useState<"file" | "folder">("file");

  const [createMode, setCreateMode] = useState<CreateMode>(null);
  const [createParentPath, setCreateParentPath] = useState<string>("/");
  const [createDraftName, setCreateDraftName] = useState("");

  const [renameTarget, setRenameTarget] = useState<RenameTarget>(null);
  const [renameDraftName, setRenameDraftName] = useState("");

  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set([defaultFolderPath, "/"]));

  const fileUploadInputRef = useRef<HTMLInputElement>(null);
  const zipUploadInputRef = useRef<HTMLInputElement>(null);
  const createInputRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const allFiles = sandpack.files as SandpackFilesPayload;
  const files = useMemo(() => {
    if (!filePathFilter) return allFiles;
    return Object.fromEntries(Object.entries(allFiles).filter(([path]) => filePathFilter(path)));
  }, [allFiles, filePathFilter]);
  const treeRoot = useMemo(() => buildTree(files), [files]);
  const folderByPath = useMemo(() => buildFolderMap(treeRoot), [treeRoot]);
  const fileByPath = useMemo(() => buildFileMap(treeRoot), [treeRoot]);
  const skillsDisplayRootPath = useMemo(() => {
    if (workspaceMode !== "skills") return null;
    const roots = Array.from(
      new Set(
        Object.keys(files)
          .map((path) => path.match(/^\/skills\/[^/]+/i)?.[0])
          .filter((v): v is string => Boolean(v))
      )
    );
    if (roots.length === 0) return null;
    if (selectedPath) {
      const fromSelected = roots.find((root) => selectedPath === root || selectedPath.startsWith(`${root}/`));
      if (fromSelected) return fromSelected;
    }
    return roots[0];
  }, [files, selectedPath, workspaceMode]);
  const renderRoot = useMemo(
    () => (skillsDisplayRootPath ? folderByPath.get(skillsDisplayRootPath) || treeRoot : treeRoot),
    [folderByPath, skillsDisplayRootPath, treeRoot]
  );

  const filePaths = useMemo(() => Object.keys(files), [files]);
  const filteredPaths = useMemo(() => {
    const keyword = searchQuery.trim().toLowerCase();
    if (!keyword) return [];
    return filePaths.filter((path) => path.toLowerCase().includes(keyword)).slice(0, 20);
  }, [filePaths, searchQuery]);

  const allFolderPaths = useMemo(() => collectFolderPaths(renderRoot), [renderRoot]);
  const expandableFolderPaths = useMemo(
    () => allFolderPaths.filter((path) => path !== "/"),
    [allFolderPaths]
  );

  useEffect(() => {
    if (selectedType === "file" && selectedPath && !files[selectedPath]) {
      setSelectedType("folder");
      setSelectedPath(defaultFolderPath);
    }
  }, [defaultFolderPath, files, selectedPath, selectedType]);
  const allExpanded = useMemo(
    () =>
      expandableFolderPaths.length > 0 &&
      expandableFolderPaths.every((path) => expandedFolders.has(path)),
    [expandableFolderPaths, expandedFolders]
  );

  const ensureFolderExpanded = useCallback((folderPath: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      const segments = folderPath.replace(/^\/+/, "").split("/").filter(Boolean);
      let acc = "";
      next.add("/");
      segments.forEach((segment) => {
        acc = `${acc}/${segment}`;
        next.add(acc);
      });
      return next;
    });
  }, []);

  const persistFullFiles = useCallback(
    async (nextFiles: SandpackFilesPayload) => {
      if (onPersistFiles) {
        await onPersistFiles(nextFiles);
        return;
      }

      const response = await fetch(`/api/code?token=${encodeURIComponent(token)}&action=files`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...withAuthHeaders(),
        },
        body: JSON.stringify({ files: nextFiles }),
      });

      if (!response.ok) {
        throw new Error(`保存失败: ${response.status}`);
      }
    },
    [onPersistFiles, token]
  );

  const syncLocalFiles = useCallback(
    (nextFiles: SandpackFilesPayload, nextActiveFile?: string) => {
      const currentKeys = Object.keys(files);
      sandpack.updateFile(nextFiles, undefined, true);
      currentKeys.forEach((key) => {
        if (!(key in nextFiles)) {
          sandpack.deleteFile(key, true);
        }
      });

      if (nextActiveFile) {
        onOpenFile(nextActiveFile);
        setSelectedType("file");
        setSelectedPath(nextActiveFile);
      }
    },
    [files, onOpenFile, sandpack]
  );

  const applyFullFiles = useCallback(
    async (nextFiles: SandpackFilesPayload, nextActiveFile?: string) => {
      syncLocalFiles(nextFiles, nextActiveFile);
      try {
        await persistFullFiles(nextFiles);
      } catch (error) {
        toast({
          status: "error",
          title: "文件保存失败",
          description: error instanceof Error ? error.message : "请稍后重试",
        });
      }
    },
    [persistFullFiles, syncLocalFiles, toast]
  );

  const openCreateAt = useCallback(
    (mode: Exclude<CreateMode, null>, parentPath: string) => {
      ensureFolderExpanded(parentPath);
      setCreateMode(mode);
      setCreateParentPath(parentPath);
      if (mode === "file") {
        const defaultFileName =
          workspaceMode === "skills" && /^\/skills\/[^/]+$/i.test(parentPath) ? "SKILL.md" : "untitled.tsx";
        setCreateDraftName(defaultFileName);
      } else {
        setCreateDraftName("new-folder");
      }
      setRenameTarget(null);
    },
    [ensureFolderExpanded, workspaceMode]
  );

  const openCreateFromSelection = useCallback(
    (mode: Exclude<CreateMode, null>) => {
      const parentPath = selectedType === "folder" ? selectedPath : getParentPath(selectedPath);
      openCreateAt(mode, parentPath || "/");
    },
    [openCreateAt, selectedPath, selectedType]
  );

  const cancelCreate = useCallback(() => {
    setCreateMode(null);
    setCreateDraftName("");
  }, []);

  const confirmCreate = useCallback(async () => {
    if (!createMode) return;

    const targetPath = joinPath(createParentPath, createDraftName);
    if (!targetPath) {
      toast({ status: "warning", title: "路径不合法" });
      return;
    }

    const nextFiles: SandpackFilesPayload = { ...files };

    if (createMode === "file") {
      if (nextFiles[targetPath]) {
        toast({ status: "warning", title: "文件已存在" });
        return;
      }
      nextFiles[targetPath] = { code: buildInitialFileCode(targetPath) };
      await applyFullFiles(nextFiles, targetPath);
      cancelCreate();
      return;
    }

    const folderMarker = `${targetPath.replace(/\/+$/, "")}/.gitkeep`;
    if (nextFiles[folderMarker]) {
      toast({ status: "warning", title: "文件夹已存在" });
      return;
    }

    nextFiles[folderMarker] = { code: "" };
    ensureFolderExpanded(targetPath);
    await applyFullFiles(nextFiles);
    cancelCreate();
  }, [
    applyFullFiles,
    cancelCreate,
    createDraftName,
    createMode,
    createParentPath,
    ensureFolderExpanded,
    files,
    toast,
  ]);

  const startRename = useCallback(
    (path: string, type: "file" | "folder") => {
      const currentName = type === "file" ? fileByPath.get(path)?.name : folderByPath.get(path)?.name;
      if (!currentName) return;
      setRenameTarget({ path, type });
      setRenameDraftName(currentName);
      setCreateMode(null);
    },
    [fileByPath, folderByPath]
  );

  const cancelRename = useCallback(() => {
    setRenameTarget(null);
    setRenameDraftName("");
  }, []);

  const confirmRename = useCallback(async () => {
    if (!renameTarget) return;

    const nextName = renameDraftName.trim();
    if (!nextName) {
      cancelRename();
      return;
    }

    if (renameTarget.type === "file") {
      const fromPath = renameTarget.path;
      const toPath = joinPath(getParentPath(fromPath), nextName);
      if (!toPath) {
        toast({ status: "warning", title: "文件名不合法" });
        return;
      }
      if (toPath === fromPath) {
        cancelRename();
        return;
      }
      if (files[toPath]) {
        toast({ status: "warning", title: "目标文件已存在" });
        return;
      }

      const nextFiles = { ...files, [toPath]: files[fromPath] };
      delete nextFiles[fromPath];
      await applyFullFiles(nextFiles, toPath);
      cancelRename();
      return;
    }

    const fromFolder = renameTarget.path;
    const toFolder = joinPath(getParentPath(fromFolder), nextName);
    if (!toFolder) {
      toast({ status: "warning", title: "目录名不合法" });
      return;
    }
    if (toFolder === fromFolder) {
      cancelRename();
      return;
    }

    const fromPrefix = `${fromFolder.replace(/\/+$/, "")}/`;
    const toPrefix = `${toFolder.replace(/\/+$/, "")}/`;
    const nextFiles: SandpackFilesPayload = {};

    Object.entries(files).forEach(([path, file]) => {
      if (path === fromFolder || path.startsWith(fromPrefix)) {
        const suffix = path.slice(fromFolder.length).replace(/^\/+/, "");
        const mapped = `/${toPrefix.replace(/^\/+/, "")}${suffix ? `/${suffix}` : ""}`.replace(/\/{2,}/g, "/");
        nextFiles[mapped] = file;
      } else {
        nextFiles[path] = file;
      }
    });

    ensureFolderExpanded(toFolder);
    await applyFullFiles(nextFiles);
    cancelRename();
  }, [applyFullFiles, cancelRename, ensureFolderExpanded, files, renameDraftName, renameTarget, toast]);

  const handleDeleteFile = useCallback(
    async (path: string) => {
      const nextFiles = { ...files };
      delete nextFiles[path];
      const nextActive = sandpack.activeFile === path ? Object.keys(nextFiles)[0] : sandpack.activeFile;
      await applyFullFiles(nextFiles, nextActive);
    },
    [applyFullFiles, files, sandpack.activeFile]
  );

  const handleDeleteFolder = useCallback(
    async (folderPath: string) => {
      const prefix = `${folderPath.replace(/\/+$/, "")}/`;
      const nextFiles: SandpackFilesPayload = {};
      Object.entries(files).forEach(([path, file]) => {
        if (path === folderPath || path.startsWith(prefix)) return;
        nextFiles[path] = file;
      });
      const nextActive = sandpack.activeFile.startsWith(prefix) ? Object.keys(nextFiles)[0] : sandpack.activeFile;
      await applyFullFiles(nextFiles, nextActive);
    },
    [applyFullFiles, files, sandpack.activeFile]
  );

  const handleUploadFiles = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const selectedFiles = Array.from(event.target.files || []);
      event.currentTarget.value = "";
      if (selectedFiles.length === 0) return;

      const nextFiles: SandpackFilesPayload = { ...files };
      const selectedParent =
        selectedType === "folder" ? selectedPath : getParentPath(selectedPath || defaultFolderPath);
      const baseSkillFolder = /^\/skills\/[^/]+$/i.test(selectedParent)
        ? selectedParent
        : "/skills/imported-skill";
      for (const file of selectedFiles) {
        const rawPath = toSandpackPath(file.webkitRelativePath || file.name);
        if (!rawPath) continue;
        const path =
          workspaceMode === "skills" ? toSkillsScopedPath(rawPath, baseSkillFolder) : rawPath;
        if (!path) continue;
        nextFiles[path] = { code: await readBrowserFileAsWorkspaceCode(file, path) };
      }

      const firstRawPath = toSandpackPath(selectedFiles[0].webkitRelativePath || selectedFiles[0].name);
      const firstPath =
        firstRawPath && workspaceMode === "skills"
          ? toSkillsScopedPath(firstRawPath, baseSkillFolder) || undefined
          : firstRawPath || undefined;
      await applyFullFiles(nextFiles, firstPath);
    },
    [applyFullFiles, defaultFolderPath, files, selectedPath, selectedType, workspaceMode]
  );

  const handleUploadZip = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.currentTarget.value = "";
      if (!file) return;

      try {
        const [{ default: JSZip }, zipBuffer] = await Promise.all([import("jszip"), file.arrayBuffer()]);
        const zip = await JSZip.loadAsync(zipBuffer);
        const nextFiles: SandpackFilesPayload = { ...files };
        let firstImportedPath: string | undefined;
        const selectedParent =
          selectedType === "folder" ? selectedPath : getParentPath(selectedPath || defaultFolderPath);
        const baseSkillFolder = /^\/skills\/[^/]+$/i.test(selectedParent)
          ? selectedParent
          : "/skills/imported-skill";

        const entries = Object.values(zip.files).filter((entry) => !entry.dir);
        for (const entry of entries) {
          const rawPath = toSandpackPath(entry.name);
          if (!rawPath) continue;
          const path =
            workspaceMode === "skills" ? toSkillsScopedPath(rawPath, baseSkillFolder) : rawPath;
          if (!path) continue;
          nextFiles[path] = { code: await readZipEntryAsWorkspaceCode(entry, path) };
          if (!firstImportedPath) firstImportedPath = path;
        }

        await applyFullFiles(nextFiles, firstImportedPath);
      } catch (error) {
        console.error("Failed to import zip:", error);
        toast({ status: "error", title: "Zip 导入失败", description: "请确认压缩包格式正确" });
      }
    },
    [applyFullFiles, defaultFolderPath, files, selectedPath, selectedType, toast, workspaceMode]
  );

  const handleToggleExpandAll = useCallback(() => {
    if (allExpanded) {
      setExpandedFolders(new Set(["/"]));
      return;
    }
    setExpandedFolders(new Set(allFolderPaths));
  }, [allExpanded, allFolderPaths]);

  const handleCopyPath = useCallback((path: string) => {
    void navigator.clipboard.writeText(path).catch(() => undefined);
  }, []);

  const handleDownloadFile = useCallback(
    (path: string, name: string) => {
      const code = files[path]?.code ?? "";
      const blob = new Blob([code], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = name;
      anchor.click();
      URL.revokeObjectURL(url);
    },
    [files]
  );

  const handleToggleFolder = useCallback((folderPath: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderPath)) {
        next.delete(folderPath);
      } else {
        next.add(folderPath);
      }
      return next;
    });
  }, []);

  const handleCreateSkill = useCallback(async () => {
    const skillBaseFolder =
      selectedType === "folder" && /^\/skills(\/.*)?$/i.test(selectedPath)
        ? selectedPath
        : defaultFolderPath;
    const nextSkillFolder = joinPath(skillBaseFolder, "new-skill");
    if (!nextSkillFolder) return;
    const skillFilePath = `${nextSkillFolder}/SKILL.md`;

    const nextFiles: SandpackFilesPayload = { ...files };
    let suffix = 1;
    let candidateFolder = nextSkillFolder;
    let candidateFile = skillFilePath;
    while (nextFiles[candidateFile]) {
      suffix += 1;
      candidateFolder = `${nextSkillFolder}-${suffix}`;
      candidateFile = `${candidateFolder}/SKILL.md`;
    }

    nextFiles[candidateFile] = { code: buildInitialFileCode(candidateFile) };
    ensureFolderExpanded(candidateFolder);
    await applyFullFiles(nextFiles, candidateFile);
  }, [applyFullFiles, defaultFolderPath, ensureFolderExpanded, files, selectedPath, selectedType]);

  useEffect(() => {
    if (!sandpack.activeFile) return;
    setSelectedType("file");
    setSelectedPath(sandpack.activeFile);
    ensureFolderExpanded(getParentPath(sandpack.activeFile));
  }, [ensureFolderExpanded, sandpack.activeFile]);

  useEffect(() => {
    if (!createMode) return;
    const timer = window.setTimeout(() => {
      createInputRef.current?.focus();
      createInputRef.current?.select();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [createMode]);

  useEffect(() => {
    if (!renameTarget) return;
    const timer = window.setTimeout(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [renameTarget]);

  return (
    <Flex
      direction="column"
      minW={styles.panel.minW}
      maxW={styles.panel.maxW}
      w={styles.panel.w || styles.panel.minW}
      flex={`0 0 ${styles.panel.w || styles.panel.minW}`}
      flexShrink={0}
      borderRight="1px solid"
      borderColor={styles.panel.borderColor}
      minH="0"
      bg={styles.panel.bg}
      backdropFilter="blur(16px)"
      overflow="hidden"
    >
      <input
        ref={fileUploadInputRef}
        type="file"
        multiple
        style={{ display: "none" }}
        onChange={handleUploadFiles}
      />
      <input
        ref={zipUploadInputRef}
        type="file"
        accept=".zip,application/zip"
        style={{ display: "none" }}
        onChange={handleUploadZip}
      />

      <Flex
        align="center"
        justify="space-between"
        px={styles.spacing.headerX}
        py={styles.spacing.headerY}
        borderBottom="1px solid"
        borderColor={styles.panel.borderColor}
        bg="var(--ws-surface-strong)"
      >
        <Text
          fontSize={styles.typography.title}
          color={styles.colors.rowText}
          fontWeight={styles.typography.titleWeight}
        >
          文件
        </Text>
        <HStack spacing={styles.spacing.menuActionsGap}>
          <IconButton
            aria-label="搜索文件"
            size="sm"
            variant="ghost"
            icon={<SearchIcon />}
            borderRadius="10px"
            color="var(--ws-text-subtle)"
            _hover={{ bg: "rgba(148,163,184,0.14)", color: "var(--ws-text-main)" }}
            onClick={() => setSearchOpen((prev) => !prev)}
          />
          <Menu placement="bottom-end" isLazy>
            <MenuButton
              as={IconButton}
              aria-label="新建或上传"
              size="sm"
              variant="ghost"
              icon={<AddIcon />}
              borderRadius="10px"
              color="var(--ws-text-subtle)"
              _hover={{ bg: "rgba(148,163,184,0.14)", color: "var(--ws-text-main)" }}
            />
            <MenuList minW={styles.sizes.createMenuListW}>
              {workspaceMode === "skills" ? (
                <MenuItem onClick={() => void handleCreateSkill()}>新建 Skill</MenuItem>
              ) : null}
              <MenuItem onClick={() => openCreateFromSelection("file")}>新建文件</MenuItem>
              <MenuItem onClick={() => openCreateFromSelection("folder")}>新建文件夹</MenuItem>
              <MenuItem onClick={() => fileUploadInputRef.current?.click()}>上传文件</MenuItem>
              <MenuItem onClick={() => zipUploadInputRef.current?.click()}>上传 zip 文件</MenuItem>
            </MenuList>
          </Menu>
          <IconButton
            aria-label={allExpanded ? "折叠全部文件夹" : "展开全部文件夹"}
            size="sm"
            variant="ghost"
            borderRadius="10px"
            color="var(--ws-text-subtle)"
            _hover={{ bg: "rgba(148,163,184,0.14)", color: "var(--ws-text-main)" }}
            icon={
              <Box
                as="span"
                display="inline-flex"
                alignItems="center"
                justifyContent="center"
                w="16px"
                h="16px"
                transform={allExpanded ? "rotate(180deg)" : "rotate(0deg)"}
                transformOrigin="50% 50%"
                transition={styles.motion.chevronTransition}
              >
                <ChevronDownIcon width="16px" height="16px" style={{ display: "block" }} />
              </Box>
            }
            onClick={handleToggleExpandAll}
          />
        </HStack>
      </Flex>

      {searchOpen ? (
        <Box
          px={styles.spacing.searchContainerX}
          py={styles.spacing.searchContainerY}
          borderBottom="1px solid"
          borderColor={styles.panel.borderColor}
          bg="var(--ws-surface-muted)"
        >
          <Input
            size="sm"
            placeholder="Search files"
            value={searchQuery}
            bg="var(--ws-surface-strong)"
            borderColor="var(--ws-border)"
            borderRadius="10px"
            _focusVisible={{ borderColor: "var(--ws-border-strong)", boxShadow: "0 0 0 1px var(--ws-border-strong)" }}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
          {searchQuery.trim() ? (
            <Box mt={2} maxH="160px" overflowY="auto">
              {filteredPaths.length > 0 ? (
                filteredPaths.map((filePath) => (
                  <HStack
                    key={filePath}
                    px={styles.spacing.searchResultX}
                    py={styles.spacing.searchResultY}
                    borderRadius={styles.spacing.rowRadius}
                    fontSize={styles.typography.meta}
                    color={styles.colors.searchResultText}
                    cursor="pointer"
                    spacing={styles.spacing.searchResultGap}
                    _hover={{ bg: styles.colors.searchResultHoverBg }}
                    onClick={() => {
                      onOpenFile(filePath);
                      setSelectedType("file");
                      setSelectedPath(filePath);
                      ensureFolderExpanded(getParentPath(filePath));
                      setSearchQuery("");
                    }}
                  >
                    <FileGlyph name={filePath.split("/").pop()} />
                    <Text fontSize={styles.typography.meta} noOfLines={1}>{filePath}</Text>
                  </HStack>
                ))
              ) : (
                <Text
                  fontSize={styles.typography.meta}
                  color={styles.colors.searchEmptyText}
                  px={styles.spacing.searchResultEmptyX}
                  py={styles.spacing.searchResultEmptyY}
                >
                  No matched files
                </Text>
              )}
            </Box>
          ) : null}
        </Box>
      ) : null}

      <Box
        flex="1"
        minH="0"
        overflowY="auto"
        overflowX="hidden"
        px={styles.spacing.treeX}
        py={styles.spacing.treeY}
        style={{ scrollbarGutter: "stable both-edges" }}
      >
        <FileTree
          root={renderRoot}
          files={files}
          expandedFolders={expandedFolders}
          selectedPath={selectedPath}
          selectedType={selectedType}
          createMode={createMode}
          createParentPath={createParentPath}
          createDraftName={createDraftName}
          createInputRef={createInputRef}
          renameTarget={renameTarget}
          renameDraftName={renameDraftName}
          renameInputRef={renameInputRef}
          onToggleFolder={handleToggleFolder}
          onSelectFolder={(folderPath) => {
            setSelectedType("folder");
            setSelectedPath(folderPath);
          }}
          onSelectFile={(filePath) => {
            setSelectedType("file");
            setSelectedPath(filePath);
            onOpenFile(filePath);
          }}
          onCreateDraftNameChange={setCreateDraftName}
          onConfirmCreate={confirmCreate}
          onCancelCreate={cancelCreate}
          onOpenCreateAt={openCreateAt}
          onStartRename={startRename}
          onRenameDraftNameChange={setRenameDraftName}
          onConfirmRename={confirmRename}
          onCancelRename={cancelRename}
          onDeleteFile={handleDeleteFile}
          onDeleteFolder={handleDeleteFolder}
          onCopyPath={handleCopyPath}
          onDownloadFile={handleDownloadFile}
        />
      </Box>
    </Flex>
  );
};

export default FileExplorerPanel;

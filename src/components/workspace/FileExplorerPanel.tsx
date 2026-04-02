import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import {
  Box,
  Flex,
  HStack,
  IconButton,
  Input,
  InputGroup,
  InputLeftElement,
  InputRightElement,
  Menu,
  MenuButton,
  MenuItem,
  MenuList,
  Spinner,
  Text,
  useToast,
} from "@chakra-ui/react";
import { useSandpack } from "@codesandbox/sandpack-react";
import { ChevronDown, ChevronUp, X } from "lucide-react";

import { AddIcon, SearchIcon } from "../common/Icon";
import { withAuthHeaders } from "@features/auth/client/authClient";
import FileTree from "./fileExplorer/FileTree";
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

const parseDataUrlToBytes = (value: string): { mime: string; bytes: Uint8Array } | null => {
  const match = value.match(/^data:([^;,]+)?;base64,([\s\S]+)$/i);
  if (!match) return null;
  const mime = (match[1] || "application/octet-stream").trim() || "application/octet-stream";
  const normalizedBase64 = match[2].replace(/\s+/g, "");
  try {
    const binary = atob(normalizedBase64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return { mime, bytes };
  } catch {
    return null;
  }
};

const readBrowserFileAsWorkspaceCode = async (file: File, filePath: string) => {
  if (file.type.startsWith("text/") || isTextLikePath(filePath)) {
    return file.text();
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const contentType = file.type || inferMimeFromPath(filePath);
  return toDataUrl(uint8ArrayToBase64(bytes), contentType);
};

const isAbsolutePath = (path: string) => path.startsWith("/");

const toSkillsScopedPath = (path: string, skillRoot?: string) => {
  const raw = isAbsolutePath(path) ? path.replace(/^\/+/, "") : path.replace(/^\/+/, "");
  if (!raw) return null;
  if (/^[^/]+\/.+/.test(raw)) {
    return `/${raw}`.replace(/\/{2,}/g, "/");
  }
  if (skillRoot && /^\/[^/]+$/.test(skillRoot)) {
    return `${skillRoot}/${raw}`.replace(/\/{2,}/g, "/");
  }
  return `/${raw}`.replace(/\/{2,}/g, "/");
};

const getSkillRootPath = (path: string) => {
  const match = path.match(/^\/[^/]+/);
  return match?.[0] || "";
};

const slugifySkillName = (value: string) => {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "") || "new-skill"
  );
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
  const uploadTargetFolderRef = useRef<string | null>(null);
  const createInputRef = useRef<HTMLInputElement>(null);
  const creatingRef = useRef(false);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const uploadToastIdRef = useRef("workspace-uploading");
  const [isUploading, setIsUploading] = useState(false);

  const allFiles = sandpack.files as SandpackFilesPayload;
  const files = useMemo(() => {
    if (!filePathFilter) return allFiles;
    return Object.fromEntries(Object.entries(allFiles).filter(([path]) => filePathFilter(path)));
  }, [allFiles, filePathFilter]);
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const isSearching = normalizedSearchQuery.length > 0;
  const visibleFiles = useMemo(() => {
    if (!isSearching) return files;
    return Object.fromEntries(
      Object.entries(files).filter(([path]) => path.toLowerCase().includes(normalizedSearchQuery))
    );
  }, [files, isSearching, normalizedSearchQuery]);

  const treeRoot = useMemo(() => buildTree(files), [files]);
  const visibleTreeRoot = useMemo(() => buildTree(visibleFiles), [visibleFiles]);
  const folderByPath = useMemo(() => buildFolderMap(treeRoot), [treeRoot]);
  const visibleFolderByPath = useMemo(() => buildFolderMap(visibleTreeRoot), [visibleTreeRoot]);
  const fileByPath = useMemo(() => buildFileMap(treeRoot), [treeRoot]);
  const skillsDisplayRootPath = useMemo(() => {
    if (workspaceMode !== "skills") return null;
    const roots = Array.from(
      new Set(
        Object.keys(files)
          .map((path) => path.match(/^\/[^/]+/i)?.[0])
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
    () =>
      skillsDisplayRootPath
        ? visibleFolderByPath.get(skillsDisplayRootPath) || visibleTreeRoot
        : visibleTreeRoot,
    [skillsDisplayRootPath, visibleFolderByPath, visibleTreeRoot]
  );

  const filePaths = useMemo(() => Object.keys(files), [files]);
  const matchedPaths = useMemo(() => {
    const keyword = searchQuery.trim().toLowerCase();
    if (!keyword) return [];
    return filePaths.filter((path) => path.toLowerCase().includes(keyword)).slice(0, 20);
  }, [filePaths, searchQuery]);
  const firstMatchedPath = matchedPaths[0];

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
        return true;
      } catch (error) {
        toast({
          status: "error",
          title: "文件保存失败",
          description: error instanceof Error ? error.message : "请稍后重试",
        });
        return false;
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
        const defaultFileName = workspaceMode === "skills" ? "SKILL.md" : "untitled.tsx";
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
    if (!createMode || creatingRef.current) return;
    creatingRef.current = true;

    try {
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
        cancelCreate();
        await applyFullFiles(nextFiles, targetPath);
        return;
      }

      const folderMarker = `${targetPath.replace(/\/+$/, "")}/.gitkeep`;
      if (nextFiles[folderMarker]) {
        toast({ status: "warning", title: "文件夹已存在" });
        return;
      }

      nextFiles[folderMarker] = { code: "" };
      ensureFolderExpanded(targetPath);
      cancelCreate();
      await applyFullFiles(nextFiles);
    } finally {
      creatingRef.current = false;
    }
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
      if (selectedFiles.length === 0) {
        uploadTargetFolderRef.current = null;
        return;
      }
      setIsUploading(true);
      toast({
        id: uploadToastIdRef.current,
        position: "top-right",
        duration: null,
        isClosable: false,
        render: () => (
          <Flex
            align="center"
            gap={2}
            px={3}
            py={2.5}
            borderRadius="10px"
            border="1px solid"
            borderColor="var(--ws-border)"
            bg="var(--ws-surface-strong)"
            color="var(--ws-text-main)"
            boxShadow="0 8px 24px rgba(15,23,42,0.12)"
          >
            <Spinner size="sm" color="var(--ws-text-subtle)" />
            <Text fontSize="sm" fontWeight={500}>
              正在上传 {selectedFiles.length} 个文件...
            </Text>
          </Flex>
        ),
      });

      try {
        const nextFiles: SandpackFilesPayload = { ...files };
        const explicitTargetFolder = uploadTargetFolderRef.current;
        uploadTargetFolderRef.current = null;
        const selectedParent =
          explicitTargetFolder ||
          (selectedType === "folder" ? selectedPath : getParentPath(selectedPath || defaultFolderPath)) ||
          "/";
        const selectedSkillRoot =
          workspaceMode === "skills"
            ? getSkillRootPath(selectedParent || skillsDisplayRootPath || selectedPath || "")
            : "";

        let firstPath: string | undefined;
        for (const file of selectedFiles) {
          const rawPath = toSandpackPath(file.webkitRelativePath || file.name);
          if (!rawPath) continue;
          const relativePath = rawPath.replace(/^\/+/, "");
          const pathInFolder = joinPath(selectedParent, relativePath);
          if (!pathInFolder) continue;
          const finalPath =
            workspaceMode === "skills"
              ? toSkillsScopedPath(pathInFolder, selectedSkillRoot || undefined)
              : pathInFolder;
          if (!finalPath) continue;
          if (!firstPath) firstPath = finalPath;
          nextFiles[finalPath] = { code: await readBrowserFileAsWorkspaceCode(file, finalPath) };
        }

        if (!firstPath) {
          toast.close(uploadToastIdRef.current);
          toast({
            position: "top-right",
            status: "warning",
            title: "没有可上传的文件",
            description: "请检查文件名或路径是否合法。",
          });
          return;
        }

        const persisted = await applyFullFiles(nextFiles, firstPath);
        toast.close(uploadToastIdRef.current);
        if (persisted) {
          toast({
            position: "top-right",
            status: "success",
            title: "上传完成",
            description: `已上传 ${selectedFiles.length} 个文件`,
          });
        } else {
          toast({
            position: "top-right",
            status: "warning",
            title: "上传未持久化",
            description: "文件在当前会话可见，但刷新后可能丢失，请重试。",
          });
        }
      } finally {
        uploadTargetFolderRef.current = null;
        setIsUploading(false);
      }
    },
    [
      applyFullFiles,
      defaultFolderPath,
      files,
      selectedPath,
      selectedType,
      skillsDisplayRootPath,
      toast,
      workspaceMode,
    ]
  );

  const openUploadAt = useCallback((folderPath: string) => {
    uploadTargetFolderRef.current = folderPath;
    fileUploadInputRef.current?.click();
  }, []);

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
      const binary = parseDataUrlToBytes(code);
      const blob = binary
        ? new Blob([binary.bytes], { type: binary.mime })
        : new Blob([code], { type: "text/plain;charset=utf-8" });
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
    const nextFiles: SandpackFilesPayload = { ...files };
    const usedRoots = new Set(
      Object.keys(nextFiles)
        .map((path) => getSkillRootPath(path).replace(/^\/+/, ""))
        .filter(Boolean)
    );
    let suffix = 1;
    let candidateSlug = "new-skill";
    while (usedRoots.has(candidateSlug)) {
      suffix += 1;
      candidateSlug = `new-skill-${suffix}`;
    }
    const safeSlug = slugifySkillName(candidateSlug);
    const candidateFile = `/${safeSlug}/SKILL.md`;

    nextFiles[candidateFile] = { code: buildInitialFileCode(candidateFile) };
    ensureFolderExpanded(`/${safeSlug}`);
    await applyFullFiles(nextFiles, candidateFile);
  }, [applyFullFiles, ensureFolderExpanded, files]);

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

  useEffect(() => {
    if (!searchOpen) return;
    const timer = window.setTimeout(() => searchInputRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [searchOpen]);

  useEffect(() => {
    const keyword = searchQuery.trim();
    if (!searchOpen || !keyword || !firstMatchedPath) return;

    ensureFolderExpanded(getParentPath(firstMatchedPath));
    if (selectedType !== "file" || selectedPath !== firstMatchedPath) {
      setSelectedType("file");
      setSelectedPath(firstMatchedPath);
      onOpenFile(firstMatchedPath);
    }
  }, [
    ensureFolderExpanded,
    firstMatchedPath,
    onOpenFile,
    searchOpen,
    searchQuery,
    selectedPath,
    selectedType,
  ]);

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

      <Flex
        align="center"
        justify="space-between"
        px={styles.spacing.headerX}
        py={0}
        minH="62px"
        borderBottom="1px solid"
        borderColor={styles.panel.borderColor}
        bg="#f6f8fc"
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
            onClick={() =>
              setSearchOpen((prev) => {
                const next = !prev;
                if (!next) setSearchQuery("");
                return next;
              })
            }
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
              <MenuItem
                isDisabled={isUploading}
                onClick={() => {
                  uploadTargetFolderRef.current = null;
                  fileUploadInputRef.current?.click();
                }}
              >
                {isUploading ? "上传中..." : "上传文件"}
              </MenuItem>
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
              <Box as="span" display="inline-flex" alignItems="center" justifyContent="center" w="16px" h="16px">
                {allExpanded ? <ChevronUp size={16} strokeWidth={2.2} /> : <ChevronDown size={16} strokeWidth={2.2} />}
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
          <InputGroup size="sm">
            <InputLeftElement pointerEvents="none">
              <Box as={SearchIcon} color="var(--ws-text-subtle)" boxSize="13px" />
            </InputLeftElement>
            <Input
              ref={searchInputRef}
              placeholder="输入文件名或路径，自动定位"
              value={searchQuery}
              bg="var(--ws-surface-strong)"
              borderColor="var(--ws-border)"
              borderRadius="10px"
              pr="32px"
              _focusVisible={{
                borderColor: "var(--ws-border-strong)",
                boxShadow: "0 0 0 1px var(--ws-border-strong)",
              }}
              onChange={(event) => setSearchQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setSearchQuery("");
                  setSearchOpen(false);
                }
              }}
            />
            {searchQuery ? (
              <InputRightElement>
                <IconButton
                  aria-label="清空搜索"
                  size="xs"
                  variant="ghost"
                  icon={<X size={12} />}
                  onClick={() => setSearchQuery("")}
                />
              </InputRightElement>
            ) : null}
          </InputGroup>
          {searchQuery.trim() ? (
            <Box mt={2} px={styles.spacing.searchResultX} py={styles.spacing.searchResultY}>
              {firstMatchedPath ? (
                <Text fontSize={styles.typography.meta} color={styles.colors.searchResultText} noOfLines={1}>
                  共 {matchedPaths.length} 条
                </Text>
              ) : (
                <Text fontSize={styles.typography.meta} color={styles.colors.searchEmptyText}>
                  未匹配到文件
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
          searchActive={isSearching}
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
          onUploadAt={openUploadAt}
          onCopyPath={handleCopyPath}
          onDownloadFile={handleDownloadFile}
        />
      </Box>
    </Flex>
  );
};

export default FileExplorerPanel;

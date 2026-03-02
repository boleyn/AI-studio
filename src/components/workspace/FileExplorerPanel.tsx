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

type FileExplorerPanelProps = {
  token: string;
};

const FileExplorerPanel = ({ token }: FileExplorerPanelProps) => {
  const { sandpack } = useSandpack();
  const toast = useToast();
  const styles = useFileExplorerTheme();

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const [selectedPath, setSelectedPath] = useState<string>(sandpack.activeFile || "/");
  const [selectedType, setSelectedType] = useState<"file" | "folder">("file");

  const [createMode, setCreateMode] = useState<CreateMode>(null);
  const [createParentPath, setCreateParentPath] = useState<string>("/");
  const [createDraftName, setCreateDraftName] = useState("");

  const [renameTarget, setRenameTarget] = useState<RenameTarget>(null);
  const [renameDraftName, setRenameDraftName] = useState("");

  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(["/"]));

  const fileUploadInputRef = useRef<HTMLInputElement>(null);
  const zipUploadInputRef = useRef<HTMLInputElement>(null);
  const createInputRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const files = sandpack.files as SandpackFilesPayload;
  const treeRoot = useMemo(() => buildTree(files), [files]);
  const folderByPath = useMemo(() => buildFolderMap(treeRoot), [treeRoot]);
  const fileByPath = useMemo(() => buildFileMap(treeRoot), [treeRoot]);

  const filePaths = useMemo(() => Object.keys(files), [files]);
  const filteredPaths = useMemo(() => {
    const keyword = searchQuery.trim().toLowerCase();
    if (!keyword) return [];
    return filePaths.filter((path) => path.toLowerCase().includes(keyword)).slice(0, 20);
  }, [filePaths, searchQuery]);

  const allFolderPaths = useMemo(() => collectFolderPaths(treeRoot), [treeRoot]);
  const expandableFolderPaths = useMemo(
    () => allFolderPaths.filter((path) => path !== "/"),
    [allFolderPaths]
  );
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
    [token]
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
        sandpack.setActiveFile(nextActiveFile);
        setSelectedType("file");
        setSelectedPath(nextActiveFile);
      }
    },
    [files, sandpack]
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
      setCreateDraftName(mode === "file" ? "untitled.tsx" : "new-folder");
      setRenameTarget(null);
    },
    [ensureFolderExpanded]
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
      for (const file of selectedFiles) {
        const path = toSandpackPath(file.webkitRelativePath || file.name);
        if (!path) continue;
        nextFiles[path] = { code: await file.text() };
      }

      const firstPath = toSandpackPath(selectedFiles[0].webkitRelativePath || selectedFiles[0].name) || undefined;
      await applyFullFiles(nextFiles, firstPath);
    },
    [applyFullFiles, files]
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

        const entries = Object.values(zip.files).filter((entry) => !entry.dir);
        for (const entry of entries) {
          const path = toSandpackPath(entry.name);
          if (!path) continue;
          nextFiles[path] = { code: await entry.async("string") };
          if (!firstImportedPath) firstImportedPath = path;
        }

        await applyFullFiles(nextFiles, firstImportedPath);
      } catch (error) {
        console.error("Failed to import zip:", error);
        toast({ status: "error", title: "Zip 导入失败", description: "请确认压缩包格式正确" });
      }
    },
    [applyFullFiles, files, toast]
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
      borderRight="1px solid"
      borderColor={styles.panel.borderColor}
      minH="0"
      bg={styles.panel.bg}
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
            aria-label="Search files"
            size="sm"
            variant="ghost"
            icon={<SearchIcon />}
            onClick={() => setSearchOpen((prev) => !prev)}
          />
          <Menu placement="bottom-end" isLazy>
            <MenuButton
              as={IconButton}
              aria-label="Create or upload"
              size="sm"
              variant="ghost"
              icon={<AddIcon />}
            />
            <MenuList minW={styles.sizes.createMenuListW}>
              <MenuItem onClick={() => openCreateFromSelection("file")}>Create new file</MenuItem>
              <MenuItem onClick={() => openCreateFromSelection("folder")}>Create new folder</MenuItem>
              <MenuItem onClick={() => fileUploadInputRef.current?.click()}>Upload files</MenuItem>
              <MenuItem onClick={() => zipUploadInputRef.current?.click()}>Upload zip file</MenuItem>
            </MenuList>
          </Menu>
          <IconButton
            aria-label={allExpanded ? "Collapse all folders" : "Expand all folders"}
            size="sm"
            variant="ghost"
            icon={
              <ChevronDownIcon
                width="16px"
                height="16px"
                style={{
                  display: "block",
                  transform: allExpanded ? "rotate(180deg)" : "rotate(0deg)",
                  transformOrigin: "center",
                  transition: styles.motion.chevronTransition,
                }}
              />
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
        >
          <Input
            size="sm"
            placeholder="Search files"
            value={searchQuery}
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
                      sandpack.setActiveFile(filePath);
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
        px={styles.spacing.treeX}
        py={styles.spacing.treeY}
      >
        <FileTree
          root={treeRoot}
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
            sandpack.setActiveFile(filePath);
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

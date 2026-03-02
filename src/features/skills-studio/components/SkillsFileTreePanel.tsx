import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

import { AddIcon, ChevronDownIcon, SearchIcon } from "@components/common/Icon";
import FileTree from "@components/workspace/fileExplorer/FileTree";
import { FileGlyph } from "@components/workspace/fileExplorer/icons";
import { useFileExplorerTheme } from "@components/workspace/fileExplorer/styleTokens";
import type { CreateMode, RenameTarget, SandpackFilesPayload } from "@components/workspace/fileExplorer/types";
import {
  buildFileMap,
  buildFolderMap,
  collectFolderPaths,
  getParentPath,
  joinPath,
} from "@components/workspace/fileExplorer/utils";
import type { FolderNode } from "@components/workspace/fileExplorer/types";

type SkillsFileTreePanelProps = {
  root: FolderNode;
  files: SandpackFilesPayload;
  activeFile: string;
  onSelectFile: (filePath: string) => void;
  onApplyFiles: (nextFiles: SandpackFilesPayload, nextActiveFile?: string) => Promise<void>;
};

const SkillsFileTreePanel = ({
  root,
  files,
  activeFile,
  onSelectFile,
  onApplyFiles,
}: SkillsFileTreePanelProps) => {
  const toast = useToast();
  const styles = useFileExplorerTheme();

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedPath, setSelectedPath] = useState<string>(activeFile || "/skills");
  const [selectedType, setSelectedType] = useState<"file" | "folder">("file");

  const [createMode, setCreateMode] = useState<CreateMode>(null);
  const [createParentPath, setCreateParentPath] = useState<string>("/skills");
  const [createDraftName, setCreateDraftName] = useState("");

  const [renameTarget, setRenameTarget] = useState<RenameTarget>(null);
  const [renameDraftName, setRenameDraftName] = useState("");

  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(["/skills"]));

  const createInputRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const folderByPath = useMemo(() => buildFolderMap(root), [root]);
  const fileByPath = useMemo(() => buildFileMap(root), [root]);
  const filePaths = useMemo(() => Object.keys(files), [files]);
  const filteredPaths = useMemo(() => {
    const keyword = searchQuery.trim().toLowerCase();
    if (!keyword) return [];
    return filePaths.filter((path) => path.toLowerCase().includes(keyword)).slice(0, 20);
  }, [filePaths, searchQuery]);

  const allFolderPaths = useMemo(() => collectFolderPaths(root), [root]);
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

  useEffect(() => {
    if (!activeFile) return;
    setSelectedType("file");
    setSelectedPath(activeFile);
    const parent = getParentPath(activeFile);
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      next.add(parent);
      return next;
    });
  }, [activeFile]);

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

  const openCreateAt = useCallback(
    (mode: Exclude<CreateMode, null>, parentPath: string) => {
      ensureFolderExpanded(parentPath);
      setCreateMode(mode);
      setCreateParentPath(parentPath);
      setCreateDraftName(mode === "file" ? "SKILL.md" : "new-folder");
      setRenameTarget(null);
    },
    [ensureFolderExpanded]
  );

  const openCreateFromSelection = useCallback(
    (mode: Exclude<CreateMode, null>) => {
      const parentPath = selectedType === "folder" ? selectedPath : getParentPath(selectedPath);
      openCreateAt(mode, parentPath || "/skills");
    },
    [openCreateAt, selectedPath, selectedType]
  );

  const cancelCreate = useCallback(() => {
    setCreateMode(null);
    setCreateDraftName("");
  }, []);

  const applyFiles = useCallback(
    async (nextFiles: SandpackFilesPayload, nextActiveFile?: string) => {
      try {
        await onApplyFiles(nextFiles, nextActiveFile);
        if (nextActiveFile) {
          setSelectedType("file");
          setSelectedPath(nextActiveFile);
        }
      } catch (error) {
        toast({
          status: "error",
          title: "文件保存失败",
          description: error instanceof Error ? error.message : "请稍后重试",
        });
      }
    },
    [onApplyFiles, toast]
  );

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
      nextFiles[targetPath] = { code: targetPath.endsWith("/SKILL.md") ? "" : "" };
      await applyFiles(nextFiles, targetPath);
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
    await applyFiles(nextFiles);
    cancelCreate();
  }, [applyFiles, cancelCreate, createDraftName, createMode, createParentPath, ensureFolderExpanded, files, toast]);

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
      await applyFiles(nextFiles, toPath);
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
    await applyFiles(nextFiles);
    cancelRename();
  }, [applyFiles, cancelRename, ensureFolderExpanded, files, renameDraftName, renameTarget, toast]);

  const handleDeleteFile = useCallback(
    async (path: string) => {
      const nextFiles = { ...files };
      delete nextFiles[path];
      const nextActive = activeFile === path ? Object.keys(nextFiles)[0] : activeFile;
      await applyFiles(nextFiles, nextActive);
    },
    [activeFile, applyFiles, files]
  );

  const handleDeleteFolder = useCallback(
    async (folderPath: string) => {
      const prefix = `${folderPath.replace(/\/+$/, "")}/`;
      const nextFiles: SandpackFilesPayload = {};
      Object.entries(files).forEach(([path, file]) => {
        if (path === folderPath || path.startsWith(prefix)) return;
        nextFiles[path] = file;
      });
      const nextActive = activeFile.startsWith(prefix) ? Object.keys(nextFiles)[0] : activeFile;
      await applyFiles(nextFiles, nextActive);
    },
    [activeFile, applyFiles, files]
  );

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

  const handleToggleExpandAll = useCallback(() => {
    if (allExpanded) {
      setExpandedFolders(new Set(["/"]));
      return;
    }
    setExpandedFolders(new Set(allFolderPaths));
  }, [allExpanded, allFolderPaths]);

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
            aria-label="搜索文件"
            size="sm"
            variant="ghost"
            icon={<SearchIcon />}
            onClick={() => setSearchOpen((prev) => !prev)}
          />
          <Menu placement="bottom-end" isLazy>
            <MenuButton as={IconButton} aria-label="新建或上传" size="sm" variant="ghost" icon={<AddIcon />} />
            <MenuList minW={styles.sizes.createMenuListW}>
              <MenuItem onClick={() => openCreateFromSelection("file")}>新建文件</MenuItem>
              <MenuItem onClick={() => openCreateFromSelection("folder")}>新建文件夹</MenuItem>
            </MenuList>
          </Menu>
          <IconButton
            aria-label={allExpanded ? "折叠全部文件夹" : "展开全部文件夹"}
            size="sm"
            variant="ghost"
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
                      onSelectFile(filePath);
                      setSelectedType("file");
                      setSelectedPath(filePath);
                      ensureFolderExpanded(getParentPath(filePath));
                      setSearchQuery("");
                    }}
                  >
                    <FileGlyph name={filePath.split("/").pop()} />
                    <Text fontSize={styles.typography.meta} noOfLines={1}>
                      {filePath}
                    </Text>
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

      <Box flex="1" minH="0" overflowY="auto" px={styles.spacing.treeX} py={styles.spacing.treeY}>
        <FileTree
          root={root}
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
            onSelectFile(filePath);
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

export default SkillsFileTreePanel;

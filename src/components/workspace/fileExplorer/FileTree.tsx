import { Box, Flex, HStack, IconButton, Input, Menu, MenuButton, MenuItem, MenuList, Text } from "@chakra-ui/react";
import type { ReactNode, RefObject } from "react";

import { FileGlyph, FolderGlyph } from "./icons";
import { getTreeIndent, useFileExplorerTheme } from "./styleTokens";
import type { CreateMode, FileNode, FolderNode, RenameTarget, SandpackFilesPayload } from "./types";

type FileTreeProps = {
  root: FolderNode;
  files: SandpackFilesPayload;
  expandedFolders: Set<string>;
  selectedPath: string;
  selectedType: "file" | "folder";
  createMode: CreateMode;
  createParentPath: string;
  createDraftName: string;
  createInputRef: RefObject<HTMLInputElement>;
  renameTarget: RenameTarget;
  renameDraftName: string;
  renameInputRef: RefObject<HTMLInputElement>;
  onToggleFolder: (folderPath: string) => void;
  onSelectFolder: (folderPath: string) => void;
  onSelectFile: (filePath: string) => void;
  onCreateDraftNameChange: (value: string) => void;
  onConfirmCreate: () => void | Promise<void>;
  onCancelCreate: () => void;
  onOpenCreateAt: (mode: Exclude<CreateMode, null>, parentPath: string) => void;
  onStartRename: (path: string, type: "file" | "folder") => void;
  onRenameDraftNameChange: (value: string) => void;
  onConfirmRename: () => void | Promise<void>;
  onCancelRename: () => void;
  onDeleteFile: (path: string) => void | Promise<void>;
  onDeleteFolder: (path: string) => void | Promise<void>;
  onCopyPath: (path: string) => void;
  onDownloadFile: (path: string, name: string) => void;
};

const FileTree = ({
  root,
  files,
  expandedFolders,
  selectedPath,
  selectedType,
  createMode,
  createParentPath,
  createDraftName,
  createInputRef,
  renameTarget,
  renameDraftName,
  renameInputRef,
  onToggleFolder,
  onSelectFolder,
  onSelectFile,
  onCreateDraftNameChange,
  onConfirmCreate,
  onCancelCreate,
  onOpenCreateAt,
  onStartRename,
  onRenameDraftNameChange,
  onConfirmRename,
  onCancelRename,
  onDeleteFile,
  onDeleteFolder,
  onCopyPath,
  onDownloadFile,
}: FileTreeProps) => {
  const styles = useFileExplorerTheme();

  const renderCreateInput = (depth: number) => {
    if (!createMode) return null;

    return (
      <HStack spacing={2} pl={getTreeIndent(depth)} pr={2} py={styles.spacing.createRowY} align="center">
        {createMode === "folder" ? <FolderGlyph /> : <FileGlyph name={createDraftName} />}
        <Input
          ref={createInputRef}
          size="sm"
          variant="unstyled"
          value={createDraftName}
          px={2}
          py={1}
          borderRadius={styles.spacing.rowRadius}
          border="1px solid"
          borderColor={styles.colors.inputFocusBorder}
          onChange={(event) => onCreateDraftNameChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void onConfirmCreate();
            }
            if (event.key === "Escape") {
              event.preventDefault();
              onCancelCreate();
            }
          }}
          onBlur={() => {
            void onConfirmCreate();
          }}
        />
      </HStack>
    );
  };

  const renderFileRow = (fileNode: FileNode, depth: number) => {
    const isSelected = selectedType === "file" && selectedPath === fileNode.path;
    const isRenaming = renameTarget?.type === "file" && renameTarget.path === fileNode.path;

    return (
      <Flex
        role="group"
        key={`file-${fileNode.path}`}
        align="center"
        justify="space-between"
        pl={getTreeIndent(depth)}
        pr={styles.spacing.rowRight}
        py={styles.spacing.rowY}
        borderRadius={styles.spacing.rowRadius}
        bg={isSelected ? styles.colors.rowSelectedBg : "transparent"}
        _hover={{ bg: styles.colors.rowHoverBg }}
        onClick={() => onSelectFile(fileNode.path)}
      >
        <HStack spacing={2.5} minW={0} flex={1}>
          <FileGlyph name={fileNode.name} />
          {isRenaming ? (
            <Input
              ref={renameInputRef}
              size="sm"
              variant="unstyled"
              value={renameDraftName}
              px={2}
              py={1}
              borderRadius={styles.spacing.rowRadius}
              border="1px solid"
              borderColor={styles.colors.inputFocusBorder}
              onChange={(event) => onRenameDraftNameChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void onConfirmRename();
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  onCancelRename();
                }
              }}
              onBlur={() => {
                void onConfirmRename();
              }}
            />
          ) : (
            <Text
              fontSize={styles.typography.row}
              fontWeight={styles.typography.rowWeight}
              color={styles.colors.rowText}
              noOfLines={1}
            >
              {fileNode.name}
            </Text>
          )}
        </HStack>
        <Menu placement="bottom-end" isLazy>
          <MenuButton
            as={IconButton}
            size="xs"
            variant="ghost"
            aria-label="行操作"
            icon={<Text lineHeight="1" fontSize={styles.sizes.rowActionIcon}>⋮</Text>}
            opacity={isSelected ? 1 : 0}
            _groupHover={{ opacity: 1 }}
            onClick={(event) => event.stopPropagation()}
          />
          <MenuList minW={styles.sizes.menuListW}>
            <MenuItem onClick={() => onSelectFile(fileNode.path)}>在编辑器中打开</MenuItem>
            <MenuItem onClick={() => onStartRename(fileNode.path, "file")}>重命名</MenuItem>
            <MenuItem onClick={() => void onDeleteFile(fileNode.path)}>删除</MenuItem>
            <MenuItem onClick={() => onCopyPath(fileNode.path)}>复制路径</MenuItem>
            <MenuItem onClick={() => onDownloadFile(fileNode.path, fileNode.name)}>下载</MenuItem>
          </MenuList>
        </Menu>
      </Flex>
    );
  };

  const renderFolder = (folder: FolderNode, depth: number): ReactNode => {
    const isExpanded = expandedFolders.has(folder.path);
    const isSelected = selectedType === "folder" && selectedPath === folder.path;
    const isRenaming = renameTarget?.type === "folder" && renameTarget.path === folder.path;
    const showCreateInputHere = createMode && createParentPath === folder.path;

    const folderRow = folder.path === "/" ? null : (
      <Flex
        role="group"
        key={`folder-${folder.path}`}
        align="center"
        justify="space-between"
        pl={getTreeIndent(depth)}
        pr={styles.spacing.rowRight}
        py={styles.spacing.rowY}
        borderRadius={styles.spacing.rowRadius}
        bg={isSelected ? styles.colors.rowSelectedBg : "transparent"}
        _hover={{ bg: styles.colors.rowHoverBg }}
        onClick={() => {
          onSelectFolder(folder.path);
          onToggleFolder(folder.path);
        }}
      >
          <HStack spacing={2.5} minW={0} flex={1}>
            <FolderGlyph />
            {isRenaming ? (
            <Input
              ref={renameInputRef}
              size="sm"
              variant="unstyled"
              value={renameDraftName}
              px={2}
              py={1}
              borderRadius={styles.spacing.rowRadius}
              border="1px solid"
              borderColor={styles.colors.inputFocusBorder}
              onChange={(event) => onRenameDraftNameChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void onConfirmRename();
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  onCancelRename();
                }
              }}
              onBlur={() => {
                void onConfirmRename();
              }}
            />
          ) : (
            <Text
              fontSize={styles.typography.row}
              fontWeight={styles.typography.rowWeight}
              color={styles.colors.rowText}
              noOfLines={1}
            >
              {folder.name}
            </Text>
          )}
        </HStack>

        <Menu placement="bottom-end" isLazy>
          <MenuButton
            as={IconButton}
            size="xs"
            variant="ghost"
            aria-label="行操作"
            icon={<Text lineHeight="1" fontSize={styles.sizes.rowActionIcon}>⋮</Text>}
            opacity={isSelected ? 1 : 0}
            _groupHover={{ opacity: 1 }}
            onClick={(event) => event.stopPropagation()}
          />
          <MenuList minW={styles.sizes.menuListW}>
            <MenuItem onClick={() => onOpenCreateAt("file", folder.path)}>新建文件</MenuItem>
            <MenuItem onClick={() => onOpenCreateAt("folder", folder.path)}>新建文件夹</MenuItem>
            <MenuItem onClick={() => onStartRename(folder.path, "folder")}>重命名</MenuItem>
            <MenuItem onClick={() => void onDeleteFolder(folder.path)}>删除</MenuItem>
            <MenuItem onClick={() => onCopyPath(folder.path)}>复制路径</MenuItem>
          </MenuList>
        </Menu>
      </Flex>
    );

    const rows: ReactNode[] = [];

    if (folder.path !== "/") {
      rows.push(folderRow);
    }

    if (isExpanded || folder.path === "/") {
      folder.entries.forEach((entry) => {
        if (entry.kind === "folder") {
          const folderName = entry.path.split("/").filter(Boolean).pop();
          const child = folderName ? folder.folderMap.get(folderName) : undefined;
          if (!child) return;
          rows.push(renderFolder(child, depth + (folder.path === "/" ? 0 : 1)));
          return;
        }

        const fileName = entry.path.split("/").filter(Boolean).pop();
        const fileNode = fileName ? folder.fileMap.get(fileName) : undefined;
        if (!fileNode) return;
        rows.push(renderFileRow(fileNode, depth + (folder.path === "/" ? 0 : 1)));
      });

      if (showCreateInputHere) {
        rows.push(<Box key={`create-${folder.path}`}>{renderCreateInput(depth + (folder.path === "/" ? 0 : 1))}</Box>);
      }
    }

    return <Box key={`wrap-${folder.path}`}>{rows}</Box>;
  };

  return <>{renderFolder(root, 0)}</>;
};

export default FileTree;

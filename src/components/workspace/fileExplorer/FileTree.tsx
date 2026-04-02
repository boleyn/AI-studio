import { Box, Flex, HStack, Text } from "@chakra-ui/react";
import type { ReactNode, RefObject } from "react";

import MyTooltip from "../../ui/MyTooltip";
import { FileGlyph, FolderGlyph } from "./icons";
import { getTreeIndent, useFileExplorerTheme } from "./styleTokens";
import TreeInlineInput from "./TreeInlineInput";
import TreeRowActionMenu from "./TreeRowActionMenu";
import type { CreateMode, FileNode, FolderNode, RenameTarget, SandpackFilesPayload } from "./types";

type FileTreeProps = {
  root: FolderNode;
  files: SandpackFilesPayload;
  searchActive?: boolean;
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
  onUploadAt: (folderPath: string) => void;
  onCopyPath: (path: string) => void;
  onDownloadFile: (path: string, name: string) => void;
};

const FileTree = ({
  root,
  files,
  searchActive = false,
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
  onUploadAt,
  onCopyPath,
  onDownloadFile,
}: FileTreeProps) => {
  const styles = useFileExplorerTheme();

  const renderCreateInput = (depth: number) => {
    if (!createMode) return null;

    return (
      <HStack spacing={2} pl={getTreeIndent(depth)} pr={2} py={styles.spacing.createRowY} align="center">
        {createMode === "folder" ? <FolderGlyph expanded={false} /> : <FileGlyph name={createDraftName} />}
        <TreeInlineInput
          inputRef={createInputRef}
          value={createDraftName}
          borderRadius={styles.spacing.rowRadius}
          borderColor={styles.colors.inputFocusBorder}
          onValueChange={onCreateDraftNameChange}
          onConfirm={onConfirmCreate}
          onCancel={onCancelCreate}
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
        border="1px solid"
        borderColor={isSelected ? "rgba(59,130,246,0.45)" : "transparent"}
        transition="background-color 0.16s ease, border-color 0.16s ease"
        _hover={{ bg: styles.colors.rowHoverBg, borderColor: "rgba(148,163,184,0.26)" }}
        overflow="hidden"
        cursor="pointer"
        onClick={() => onSelectFile(fileNode.path)}
      >
        <HStack spacing={2.5} minW={0} flex={1}>
          <FileGlyph name={fileNode.name} />
          {isRenaming ? (
            <TreeInlineInput
              inputRef={renameInputRef}
              value={renameDraftName}
              borderRadius={styles.spacing.rowRadius}
              borderColor={styles.colors.inputFocusBorder}
              onValueChange={onRenameDraftNameChange}
              onConfirm={onConfirmRename}
              onCancel={onCancelRename}
            />
          ) : (
            <MyTooltip label={fileNode.name} placement="top-start" openDelay={220}>
              <Text
                fontSize={styles.typography.row}
                fontWeight={styles.typography.rowWeight}
                color={styles.colors.rowText}
                noOfLines={1}
              >
                {fileNode.name}
              </Text>
            </MyTooltip>
          )}
        </HStack>
        <TreeRowActionMenu
          isVisible={isSelected}
          iconSize={styles.sizes.rowActionIcon}
          menuWidth={styles.sizes.menuListW}
          actions={[
            { label: "在编辑器中打开", onClick: () => onSelectFile(fileNode.path) },
            { label: "重命名", onClick: () => onStartRename(fileNode.path, "file") },
            { label: "删除", onClick: () => void onDeleteFile(fileNode.path) },
            { label: "复制路径", onClick: () => onCopyPath(fileNode.path) },
            { label: "下载", onClick: () => onDownloadFile(fileNode.path, fileNode.name) },
          ]}
        />
      </Flex>
    );
  };

  const renderFolder = (folder: FolderNode, depth: number): ReactNode => {
    const isExpanded = searchActive ? true : expandedFolders.has(folder.path);
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
        border="1px solid"
        borderColor={isSelected ? "rgba(59,130,246,0.45)" : "transparent"}
        transition="background-color 0.16s ease, border-color 0.16s ease"
        _hover={{ bg: styles.colors.rowHoverBg, borderColor: "rgba(148,163,184,0.26)" }}
        overflow="hidden"
        cursor="pointer"
        onClick={() => {
          onSelectFolder(folder.path);
          onToggleFolder(folder.path);
        }}
      >
        <HStack spacing={2.5} minW={0} flex={1}>
          <FolderGlyph expanded={isExpanded} />
          {isRenaming ? (
            <TreeInlineInput
              inputRef={renameInputRef}
              value={renameDraftName}
              borderRadius={styles.spacing.rowRadius}
              borderColor={styles.colors.inputFocusBorder}
              onValueChange={onRenameDraftNameChange}
              onConfirm={onConfirmRename}
              onCancel={onCancelRename}
            />
          ) : (
            <MyTooltip label={folder.name} placement="top-start" openDelay={220}>
              <Text
                fontSize={styles.typography.row}
                fontWeight={styles.typography.rowWeight}
                color={styles.colors.rowText}
                noOfLines={1}
              >
                {folder.name}
              </Text>
            </MyTooltip>
          )}
        </HStack>
        <TreeRowActionMenu
          isVisible={isSelected}
          iconSize={styles.sizes.rowActionIcon}
          menuWidth={styles.sizes.menuListW}
          actions={[
            { label: "新建文件", onClick: () => onOpenCreateAt("file", folder.path) },
            { label: "新建文件夹", onClick: () => onOpenCreateAt("folder", folder.path) },
            { label: "上传文件", onClick: () => onUploadAt(folder.path) },
            { label: "重命名", onClick: () => onStartRename(folder.path, "folder") },
            { label: "删除", onClick: () => void onDeleteFolder(folder.path) },
            { label: "复制路径", onClick: () => onCopyPath(folder.path) },
          ]}
        />
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

import Link from "next/link";
import {
  Box,
  Button,
  Flex,
  Heading,
  IconButton,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Portal,
  Text,
  Tooltip,
} from "@chakra-ui/react";
import { Bell, Plus, Files, Users, Library, PanelLeftClose, Search, Trash2 } from "lucide-react";
import { libraryActivityTime, type LibraryFile } from "@/types/library";
import type { WorkspaceLocation } from "@shared/workspaceRoute";
import { formatRelativeTime } from "./relativeTime";
import LibraryItemIcon from "./LibraryItemIcon";
import AttachmentFilename from "@features/chat/components/AttachmentFilename";
import WorkspaceSidebar, {
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_ICON_SIZE,
  SidebarHeaderIconButton,
  SidebarSectionHeader,
  sidebarNavItemProps,
} from "./WorkspaceSidebar";
import { type ReactNode, useRef, useState } from "react";

const categories = [
  { name: "全部", icon: Library },
  { name: "你的条目", icon: Files },
  { name: "与你共享", icon: Users },
];

type Props = {
  driveConnected: boolean;
  width?: number;
  setWidth: (width: number) => void;
  createMenu: ReactNode;
  recentPageActions: (page: LibraryFile) => ReactNode;
  spaceActions: (space: LibraryFile) => ReactNode;
  onNewSpace: () => void;
  section?: string;
  activeSpaceId?: string;
  files: LibraryFile[];
  sectionHref: (section: string) => WorkspaceLocation;
  onSectionNavigate: () => void;
  onSection: (section: string) => void;
  onFile: (file: LibraryFile) => void;
  onSearch: () => void;
  onCollapse: () => void;
};

export default function LibrarySidebar({
  driveConnected,
  width,
  setWidth,
  createMenu,
  recentPageActions,
  spaceActions,
  onNewSpace,
  section,
  activeSpaceId,
  files,
  sectionHref,
  onSectionNavigate,
  onSection,
  onFile,
  onSearch,
  onCollapse,
}: Props) {
  const [recentLimit, setRecentLimit] = useState(5);
  const focusNewRecent = useRef<number>();
  const [recent, setRecent] = useState(true);
  const [spaces, setSpaces] = useState(true);
  const items = files.filter((file) => !file.deleted);
  const recentItems = [...items].sort((a, b) =>
    libraryActivityTime(b).localeCompare(libraryActivityTime(a)),
  );
  const invitations = items
    .filter((file) => file.shareId)
    .sort((a, b) => (b.invitedAt || b.time).localeCompare(a.invitedAt || a.time));
  const [activityOpen, setActivityOpen] = useState(false);

  return (
    <WorkspaceSidebar
      as="nav"
      aria-label="资料空间导航"
      widthPx={width ?? SIDEBAR_DEFAULT_WIDTH}
      onWidthChange={setWidth}
      resizeLabel="调整资料空间侧栏宽度"
      title={
        <Heading
          as="h1"
          fontSize="inherit"
          fontWeight="inherit"
          lineHeight="inherit"
          display="flex"
          alignItems="center"
        >
          <Button
            variant="unstyled"
            height="auto"
            minW={0}
            fontSize="inherit"
            fontWeight="inherit"
            lineHeight="inherit"
            onClick={() => onSection("全部")}
          >
            资料空间
          </Button>
        </Heading>
      }
      headerActions={
        <>
          <Popover
            isOpen={activityOpen}
            onOpen={() => setActivityOpen(true)}
            onClose={() => setActivityOpen(false)}
            placement="bottom-start"
            gutter={5}
            isLazy
          >
            <PopoverTrigger>
              <SidebarHeaderIconButton
                aria-label="动态"
                title="动态"
                icon={<Bell size={SIDEBAR_ICON_SIZE} />}
              />
            </PopoverTrigger>
            <Portal>
              <PopoverContent
                aria-label="动态"
                width="min(384px, calc(100vw - 24px))"
                height="320px"
                borderRadius="12px"
                boxShadow="lg"
              >
                <Text px={4} py={3} fontWeight="600">
                  动态
                </Text>
                {invitations.length ? (
                  <Box as="ul" overflowY="auto" listStyleType="none" px={2} pb={2}>
                    {invitations.map((file) => (
                      <Box as="li" key={file.id}>
                        <Button
                          variant="ghost"
                          w="full"
                          h="auto"
                          py={2}
                          justifyContent="start"
                          gap={2}
                          onClick={() => {
                            setActivityOpen(false);
                            onFile(file);
                          }}
                        >
                          <LibraryItemIcon item={file} />
                          <Box minW={0} textAlign="left">
                            <Text fontSize="sm" isTruncated>
                              {file.name}
                            </Text>
                            <Text fontSize="xs" fontWeight="normal" color="gray.600">
                              {file.project} 与你共享
                              {file.invitedAt || file.time
                                ? " · " + formatRelativeTime(file.invitedAt || file.time)
                                : ""}
                            </Text>
                          </Box>
                        </Button>
                      </Box>
                    ))}
                  </Box>
                ) : (
                  <Flex
                    flex="1"
                    direction="column"
                    align="center"
                    justify="center"
                    px={8}
                    pb={8}
                    textAlign="center"
                    gap={2}
                  >
                    <Bell size={22} aria-hidden="true" />
                    <Heading as="h2" size="sm">
                      暂无通知
                    </Heading>
                    <Text fontSize="sm" color="gray.600">
                      有人提及你、在你的页面上发表评论，或回复你参与的对话时，你会收到通知。
                    </Text>
                  </Flex>
                )}
              </PopoverContent>
            </Portal>
          </Popover>
          <Tooltip label="搜索">
            <SidebarHeaderIconButton
              aria-label="搜索"
              aria-haspopup="dialog"
              icon={<Search size={SIDEBAR_ICON_SIZE} />}
              onClick={onSearch}
            />
          </Tooltip>
          <Tooltip label="收起侧边栏">
            <SidebarHeaderIconButton
              aria-expanded={true}
              aria-label="显示/隐藏侧边栏"
              icon={<PanelLeftClose size={SIDEBAR_ICON_SIZE} />}
              onClick={onCollapse}
            />
          </Tooltip>
        </>
      }
      primaryAction={createMenu}
      topContent={
        <Flex direction="column" gap="2px">
          {categories.map(({ name, icon: Icon }) => {
            const loc = sectionHref(name);
            return (
              <Link
                key={name}
                href={loc.href}
                as={loc.as}
                shallow
                scroll={false}
                prefetch={false}
                legacyBehavior
                passHref
                onNavigate={onSectionNavigate}
              >
                <Button
                  as="a"
                  {...sidebarNavItemProps}
                  aria-current={section === name ? "page" : undefined}
                  bg={section === name ? "surface.active" : undefined}
                  _hover={{ bg: section === name ? "surface.active" : "surface.hover" }}
                  leftIcon={<Icon size={SIDEBAR_ICON_SIZE} />}
                >
                  {name}
                </Button>
              </Link>
            );
          })}
          {driveConnected && (() => {
            const loc = sectionHref("Google Drive");
            return (
              <Link
                href={loc.href}
                as={loc.as}
                shallow
                scroll={false}
                prefetch={false}
                legacyBehavior
                passHref
                onNavigate={onSectionNavigate}
              >
                <Button
                  as="a"
                  {...sidebarNavItemProps}
                  aria-current={section === "Google Drive" ? "page" : undefined}
                  bg={section === "Google Drive" ? "surface.active" : undefined}
                  _hover={{ bg: section === "Google Drive" ? "surface.active" : "surface.hover" }}
                  leftIcon={
                    <Flex boxSize="16px" align="center" justify="center">
                      <Box as="img" src="/icons/google-drive.png" alt="" boxSize="15px" />
                    </Flex>
                  }
                >
                  Google Drive
                </Button>
              </Link>
            );
          })()}
        </Flex>
      }
      footer={
        <Button
          {...sidebarNavItemProps}
          aria-current={section === "回收站" ? "page" : undefined}
          bg={section === "回收站" ? "surface.active" : undefined}
          _hover={{ bg: section === "回收站" ? "surface.active" : "surface.hover" }}
          leftIcon={<Trash2 size={SIDEBAR_ICON_SIZE} />}
          onClick={() => onSection("回收站")}
        >
          回收站
        </Button>
      }
    >
      <SidebarSectionHeader
        label="资料空间"
        mt={1}
        isExpanded={spaces}
        onToggle={() => setSpaces(!spaces)}
        action={
          <Tooltip label="创建资料空间">
            <IconButton
              size="xs"
              boxSize="24px"
              minW="24px"
              borderRadius="6px"
              variant="ghost"
              color="ink.muted"
              _hover={{ bg: "surface.hover", color: "ink.primary" }}
              aria-label="创建资料空间"
              icon={<Plus size={14} />}
              onClick={onNewSpace}
            />
          </Tooltip>
        }
      />
      {spaces && (
        <Flex direction="column" gap="2px">
          {items
            .filter((item) => item.kind === "资料空间")
            .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)))
            .map((item) => (
              <Flex
                key={item.id}
                align="center"
                borderRadius="8px"
                bg={activeSpaceId === item.id ? "surface.active" : undefined}
                _hover={{ bg: activeSpaceId === item.id ? "surface.active" : "surface.hover" }}
              >
                <Button
                  minW={0}
                  {...sidebarNavItemProps}
                  flex="1"
                  w="auto"
                  bg="transparent"
                  _hover={{ bg: "transparent" }}
                  aria-current={activeSpaceId === item.id ? "page" : undefined}
                  title={item.name}
                  leftIcon={<LibraryItemIcon item={item} compact />}
                  onClick={() => onFile(item)}
                >
                  <Text isTruncated>{item.name}</Text>
                </Button>
                {spaceActions(item)}
              </Flex>
            ))}
        </Flex>
      )}

      <SidebarSectionHeader
        label="最近"
        mt={3}
        isExpanded={recent}
        onToggle={() => setRecent(!recent)}
      />
      {recent && recentItems.length > 0 && (
        <Flex direction="column" gap="2px">
          {recentItems.slice(0, recentLimit).map((file, index) => (
            <Flex
              key={file.id}
              align="center"
              borderRadius="8px"
              _hover={{ bg: "surface.hover" }}
              sx={{
                "@media (hover:hover) and (pointer:fine)": {
                  "&:not(:hover):not(:focus-within) [data-page-actions]:not(:has([aria-expanded=true]))":
                    { opacity: 0 },
                },
              }}
            >
              <Button
                minW={0}
                flex="1"
                ref={
                  index === focusNewRecent.current
                    ? (node) => {
                        if (node) {
                          focusNewRecent.current = undefined;
                          node.focus();
                        }
                      }
                    : undefined
                }
                {...sidebarNavItemProps}
                bg="transparent"
                _hover={{ bg: "transparent" }}
                title={file.name}
                onClick={() => onFile(file)}
                leftIcon={<LibraryItemIcon item={file} compact />}
              >
                {(file.kind === "上传" || file.kind === "生成") && !file.sharedPage ? (
                  <AttachmentFilename name={file.name} fontSize="inherit" />
                ) : (
                  <Text isTruncated>{file.name}</Text>
                )}
              </Button>
              {(file.kind === "页面" || file.sharedPage) && (
                <Flex data-page-actions="" align="center">
                  {recentPageActions(file)}
                </Flex>
              )}
            </Flex>
          ))}
          {recentItems.length > recentLimit && (
            <Button
              alignSelf="start"
              h="30px"
              px={2.5}
              borderRadius="8px"
              variant="ghost"
              size="xs"
              color="ink.muted"
              fontWeight="400"
              _hover={{ bg: "surface.hover", color: "ink.primary" }}
              onClick={(event) => {
                focusNewRecent.current = event.detail === 0 ? recentLimit : undefined;
                setRecentLimit((limit) => limit + 5);
              }}
            >
              展开显示
            </Button>
          )}
        </Flex>
      )}
    </WorkspaceSidebar>
  );
}

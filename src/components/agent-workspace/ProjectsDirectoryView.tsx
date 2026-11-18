import { useMemo, useState } from "react";
import {
  Box,
  Button,
  Flex,
  HStack,
  IconButton,
  Input,
  InputGroup,
  InputLeftElement,
  Menu,
  MenuButton,
  MenuDivider,
  MenuItem,
  MenuList,
  Text,
  Tooltip,
  VStack,
} from "@chakra-ui/react";
import {
  ArrowDown,
  Folder,
  HardDrive,
  MoreHorizontal,
  Pencil,
  Pin,
  Plus,
  Search,
  SquarePen,
  Trash2,
} from "lucide-react";
import type { ProjectWithConversations } from "../AgentWorkspace";

function formatRelativeTime(isoString?: string): string {
  if (!isoString) return "";
  const time = new Date(isoString).getTime();
  if (Number.isNaN(time)) return "";
  const diffSec = Math.max(0, Math.floor((Date.now() - time) / 1000));
  if (diffSec < 60) return "刚刚";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} 分钟前`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} 小时前`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 7) return `${diffDay} 天前`;
  const diffWeek = Math.floor(diffDay / 7);
  if (diffWeek < 5) return `${diffWeek} 周前`;
  const diffMonth = Math.floor(diffDay / 30);
  return `${Math.max(1, diffMonth)} 个月前`;
}

type ProjectsDirectoryViewProps = {
  projects: ProjectWithConversations[];
  pinnedTokens: string[];
  onSelectProject: (token: string) => void;
  onCreateProject: () => void;
  onTogglePin: (token: string) => void;
  onOpenSettings: (project: ProjectWithConversations) => void;
  onRequestDelete: (project: ProjectWithConversations) => void;
};

export default function ProjectsDirectoryView({
  projects,
  pinnedTokens,
  onSelectProject,
  onCreateProject,
  onTogglePin,
  onOpenSettings,
  onRequestDelete,
}: ProjectsDirectoryViewProps) {
  const [query, setQuery] = useState("");
  const [sortDesc, setSortDesc] = useState(true);

  const visibleProjects = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? projects.filter(
          (p) =>
            p.name.toLowerCase().includes(q) ||
            (p.description || "").toLowerCase().includes(q),
        )
      : projects;

    return [...filtered].sort((a, b) => {
      const aPinned = pinnedTokens.includes(a.token) ? 1 : 0;
      const bPinned = pinnedTokens.includes(b.token) ? 1 : 0;
      if (aPinned !== bPinned) return bPinned - aPinned;
      const ta = new Date(a.updatedAt || 0).getTime();
      const tb = new Date(b.updatedAt || 0).getTime();
      return sortDesc ? tb - ta : ta - tb;
    });
  }, [pinnedTokens, projects, query, sortDesc]);

  return (
    <Box flex="1" h="100%" overflowY="auto" bg="surface.canvas" px={{ base: 4, md: 10 }} py={7}>
      <Box maxW="980px" mx="auto">
        {/* 顶部标题 + 搜索框 + 创建按钮（1:1 对齐 ChatGPT 项目列表页） */}
        <Flex align="center" justify="space-between" gap={4} mb={7} wrap="wrap">
          <Text as="h1" fontSize="22px" fontWeight="600" color="ink.primary">
            项目
          </Text>

          <HStack spacing={2.5}>
            <InputGroup size="sm" w={{ base: "180px", sm: "240px" }}>
              <InputLeftElement pointerEvents="none" h="36px">
                <Search size={14} color="#8f8f8f" />
              </InputLeftElement>
              <Input
                h="36px"
                borderRadius="full"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                type="search"
                aria-label="搜索项目"
                placeholder="搜索项目"
                fontSize="13.5px"
              />
            </InputGroup>
            <Button
              variant="primary"
              h="36px"
              px={4}
              borderRadius="full"
              fontSize="13.5px"
              leftIcon={<Plus size={15} />}
              onClick={onCreateProject}
            >
              创建
            </Button>
          </HStack>
        </Flex>

        {/* 表头 */}
        <Flex
          align="center"
          justify="space-between"
          px={3}
          py={2.5}
          borderBottom="1px solid"
          borderColor="stroke.light"
          fontSize="12px"
          color="ink.muted"
          fontWeight="500"
        >
          <Text>名称</Text>
          <HStack spacing={16} pr={2}>
            <HStack
              as="button"
              type="button"
              spacing={1}
              cursor="pointer"
              _hover={{ color: "ink.primary" }}
              onClick={() => setSortDesc((v) => !v)}
            >
              <Text>已更新</Text>
              <Box
                transform={sortDesc ? "rotate(0deg)" : "rotate(180deg)"}
                transition="transform 0.15s"
              >
                <ArrowDown size={12} />
              </Box>
            </HStack>
            <Box w="84px" />
          </HStack>
        </Flex>

        {/* 项目列表行 */}
        {visibleProjects.length === 0 ? (
          <VStack py={16} spacing={3}>
            <Text fontSize="14px" color="ink.muted">
              {query.trim() ? "没有匹配的项目" : "还没有项目，点击右上角「创建」开始工作"}
            </Text>
            {!query.trim() && (
              <Button variant="primary" size="sm" borderRadius="full" leftIcon={<Plus size={14} />} onClick={onCreateProject}>
                创建项目
              </Button>
            )}
          </VStack>
        ) : (
          <VStack align="stretch" spacing={0}>
            {visibleProjects.map((project) => {
              const isConnector = project.workspace?.kind === "connector";
              const isPinned = pinnedTokens.includes(project.token);

              return (
                <Flex
                  key={project.token}
                  align="center"
                  justify="space-between"
                  px={3}
                  py={3.5}
                  borderBottom="1px solid"
                  borderColor="stroke.light"
                  cursor="pointer"
                  transition="background 0.12s"
                  _hover={{ bg: "surface.sidebar" }}
                  onClick={() => onSelectProject(project.token)}
                >
                  <HStack spacing={3} minW={0} flex="1">
                    <Box color="ink.secondary" flexShrink={0}>
                      {isConnector ? <HardDrive size={17} /> : <Folder size={17} />}
                    </Box>
                    <Box minW={0}>
                      <Text fontSize="14px" fontWeight="500" color="ink.primary" noOfLines={1}>
                        {project.name}
                      </Text>
                      {project.description ? (
                        <Text fontSize="12px" color="ink.muted" noOfLines={1} mt={0.5}>
                          {project.description}
                        </Text>
                      ) : null}
                    </Box>
                  </HStack>

                  <HStack spacing={6} flexShrink={0} onClick={(e) => e.stopPropagation()}>
                    <Text fontSize="12.5px" color="ink.muted" minW="76px" textAlign="right">
                      {formatRelativeTime(project.updatedAt)}
                    </Text>

                    <HStack spacing={1}>
                      <Menu placement="bottom-end" isLazy>
                        <MenuButton
                          as={IconButton}
                          aria-label={project.name + "的更多操作"}
                          icon={<MoreHorizontal size={15} />}
                          size="xs"
                          variant="ghost"
                          color="ink.secondary"
                        />
                        <MenuList minW="168px">
                          <MenuItem
                            icon={<Pencil size={14} />}
                            onClick={() => onOpenSettings(project)}
                          >
                            项目设置与说明
                          </MenuItem>
                          <MenuDivider />
                          <MenuItem
                            icon={<Trash2 size={14} />}
                            color="red.600"
                            onClick={() => onRequestDelete(project)}
                          >
                            删除项目
                          </MenuItem>
                        </MenuList>
                      </Menu>

                      <Tooltip label={isPinned ? "取消置顶" : "置顶项目"}>
                        <IconButton
                          aria-label={isPinned ? "取消置顶" : "置顶项目"}
                          icon={<Pin size={14} fill={isPinned ? "currentColor" : "none"} />}
                          size="xs"
                          variant="ghost"
                          color={isPinned ? "ink.primary" : "ink.secondary"}
                          onClick={() => onTogglePin(project.token)}
                        />
                      </Tooltip>

                      <Tooltip label="编辑项目">
                        <IconButton
                          aria-label="编辑项目"
                          icon={<SquarePen size={14} />}
                          size="xs"
                          variant="ghost"
                          color="ink.secondary"
                          onClick={() => onOpenSettings(project)}
                        />
                      </Tooltip>
                    </HStack>
                  </HStack>
                </Flex>
              );
            })}
          </VStack>
        )}
      </Box>
    </Box>
  );
}

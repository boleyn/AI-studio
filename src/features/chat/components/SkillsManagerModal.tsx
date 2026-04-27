import {
  Box,
  Divider,
  Drawer,
  DrawerBody,
  DrawerCloseButton,
  DrawerContent,
  DrawerHeader,
  DrawerOverlay,
  Flex,
  IconButton,
  Input,
  InputGroup,
  InputRightElement,
  Select,
  Spinner,
  Tag,
  Text,
  useToast,
} from "@chakra-ui/react";
import { CloseIcon, CollapseDetailIcon, RefreshIcon, RunIcon } from "@/components/common/Icon";
import SkillDetailPreview from "@/components/workspace/SkillDetailPreview";
import MyTooltip from "@/components/ui/MyTooltip";
import { withAuthHeaders } from "@features/auth/client/authClient";
import { ArrowDownUp, Package, ShieldCheck, Sparkles, Star } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getClawHubSkillDetail,
  listClawHubSkills,
  type ClawHubSkillDetailResponse,
  type ClawHubSkillItem,
  type ClawHubSort,
  type ClawHubSortDir,
} from "../services/skills";

type SkillsManagerModalProps = {
  isOpen: boolean;
  onClose: () => void;
  projectToken: string;
  onUseSkill?: (name: string) => void;
  onFilesApplied?: (files: Record<string, { code: string }>) => void;
  onCreateViaChat?: () => void;
};

const CLAWHUB_SORT_OPTIONS: Array<{ value: ClawHubSort; label: string }> = [
  { value: "downloads", label: "下载量" },
  { value: "updated", label: "最近更新" },
  { value: "newest", label: "最新发布" },
  { value: "stars", label: "收藏数" },
  { value: "name", label: "名称" },
  { value: "relevance", label: "相关度" },
  { value: "installs", label: "安装量" },
];

const SkillsManagerModal = ({
  isOpen,
  onClose,
  projectToken,
  onUseSkill,
  onFilesApplied,
}: SkillsManagerModalProps) => {
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [clawHubSort, setClawHubSort] = useState<ClawHubSort>("downloads");
  const [clawHubDir, setClawHubDir] = useState<ClawHubSortDir>("desc");
  const [clawHubHighlightedOnly, setClawHubHighlightedOnly] = useState(false);
  const [clawHubNonSuspiciousOnly, setClawHubNonSuspiciousOnly] = useState(false);
  const [isListLoading, setIsListLoading] = useState(false);
  const [skills, setSkills] = useState<ClawHubSkillItem[]>([]);
  const [total, setTotal] = useState(0);
  const [selectedSlug, setSelectedSlug] = useState("");
  const [detail, setDetail] = useState<ClawHubSkillDetailResponse | null>(null);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [isApplying, setIsApplying] = useState(false);

  const loadList = useCallback(async () => {
    setIsListLoading(true);
    try {
      const result = await listClawHubSkills({
        q: query.trim() || undefined,
        sort: clawHubSort,
        dir: clawHubDir,
        highlighted: clawHubHighlightedOnly || undefined,
        nonSuspicious: clawHubNonSuspiciousOnly || undefined,
        offset: 0,
        limit: 50,
      });
      const next = result.items || [];
      setSkills(next);
      setTotal(result.total || 0);
      setSelectedSlug((current) => (current && !next.some((item) => item.slug === current) ? "" : current));
    } catch (error) {
      toast({
        status: "error",
        title: error instanceof Error ? error.message : "ClawHub 技能列表加载失败",
        duration: 2000,
      });
    } finally {
      setIsListLoading(false);
    }
  }, [clawHubDir, clawHubHighlightedOnly, clawHubNonSuspiciousOnly, clawHubSort, query, toast]);

  useEffect(() => {
    if (!isOpen) return;
    setSelectedSlug("");
    setDetail(null);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const timer = window.setTimeout(() => {
      void loadList();
    }, 180);
    return () => window.clearTimeout(timer);
  }, [isOpen, loadList]);

  useEffect(() => {
    if (!isOpen || !selectedSlug) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setIsDetailLoading(true);
    getClawHubSkillDetail(selectedSlug)
      .then((payload) => {
        if (cancelled) return;
        setDetail(payload);
      })
      .catch((error) => {
        if (cancelled) return;
        setDetail(null);
        toast({
          status: "error",
          title: error instanceof Error ? error.message : "ClawHub 技能详情加载失败",
          duration: 2000,
        });
      })
      .finally(() => {
        if (!cancelled) setIsDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, selectedSlug, toast]);

  const selectedListItem = useMemo(
    () => skills.find((item) => item.slug === selectedSlug) || null,
    [selectedSlug, skills]
  );
  const detailPreview = useMemo(() => {
    if (!detail) {
      return {
        files: {} as Record<string, string | { code?: unknown }>,
        activeFile: "",
        topDescription: "",
        metaDescription: "",
      };
    }
    const normalizeFilePath = (rawPath: string) => {
      const trimmed = rawPath.trim().replace(/^\/+/, "");
      if (!trimmed) return "";
      return `/skills/${detail.slug}/${trimmed}`;
    };
    const listedPaths =
      Array.isArray(detail.latestVersion.files) && detail.latestVersion.files.length > 0
        ? detail.latestVersion.files.map(normalizeFilePath).filter(Boolean)
        : [];
    const fallbackPath = `/skills/${detail.slug}/SKILL.md`;
    const skillMdPath = listedPaths.find((path) => /(^|\/)SKILL\.md$/i.test(path)) || fallbackPath;
    const allPaths = listedPaths.length > 0 ? listedPaths : [fallbackPath];
    const summaryWithFileCount = `${detail.summary || ""}（共 ${detail.latestVersion.fileCount} 个文件）`;
    const frontmatter = [
      "---",
      `name: ${detail.slug}`,
      `description: ${detail.summary || ""}`,
      "---",
      "",
    ].join("\n");
    const body = detail.latestVersion.readmeText || "暂无 readme 内容";
    const filesMap = Object.fromEntries(allPaths.map((path) => [path, { code: "" }])) as Record<
      string,
      string | { code?: unknown }
    >;
    for (const path of allPaths) {
      const rawPath = path.replace(`/skills/${detail.slug}/`, "");
      const content = detail.latestVersion.fileContents?.[rawPath] || "";
      filesMap[path] = { code: content };
    }
    filesMap[skillMdPath] = { code: `${frontmatter}${body}` };
    return {
      files: filesMap,
      activeFile: skillMdPath,
      topDescription: summaryWithFileCount,
      metaDescription: detail.summary || "",
    };
  }, [detail]);
  const isDetailOpen = Boolean(selectedSlug);
  const iconButtonBaseProps = {
    size: "sm" as const,
    borderRadius: "9999px",
    boxSize: "34px",
    minW: "34px",
    h: "34px",
    p: 0,
    border: "1px solid",
  };
  const drawerMaxW = isDetailOpen
    ? ({ base: "100vw", lg: "clamp(960px, 60vw, 1320px)" } as const)
    : ({ base: "100vw", lg: "clamp(420px, 30vw, 640px)" } as const);

  const normalizeSkillName = useCallback((slug: string) => {
    const normalized = slug
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "");
    return normalized || "imported-skill";
  }, []);

  const stripFrontmatter = useCallback((content: string) => {
    const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    if (!normalized.startsWith("---")) return normalized;
    const match = normalized.match(/^---\s*\n[\s\S]*?\n---\s*\n?/);
    if (!match) return normalized;
    return normalized.slice(match[0].length);
  }, []);

  const buildSkillMd = useCallback(
    (skillName: string, description: string, rawCode: string) => {
      const body = stripFrontmatter(rawCode || "").trim();
      const nextBody = body || "# Skill";
      const safeDescription = description.trim() || "Imported from ClawHub";
      return [
        "---",
        `name: ${skillName}`,
        `description: ${JSON.stringify(safeDescription)}`,
        "---",
        "",
        nextBody,
        "",
      ].join("\n");
    },
    [stripFrontmatter]
  );

  const sanitizeRelativePath = useCallback((rawPath: string) => {
    const normalized = rawPath.replace(/\\/g, "/").replace(/^\/+/, "").trim();
    if (!normalized) return "";
    if (normalized.includes("..")) return "";
    return normalized;
  }, []);

  const handleApplyToProject = useCallback(async () => {
    if (!detail) return;
    const trimmedToken = projectToken.trim();
    if (!trimmedToken) {
      toast({
        status: "warning",
        title: "当前不是项目会话，无法应用",
        duration: 2200,
      });
      return;
    }

    setIsApplying(true);
    try {
      const skillName = normalizeSkillName(detail.slug || detail.displayName || "imported-skill");
      const nextFiles: Record<string, { code: string }> = {};

      for (const relPathRaw of detail.latestVersion.files || []) {
        const relPath = sanitizeRelativePath(relPathRaw);
        if (!relPath) continue;
        const targetPath = `/skills/${skillName}/${relPath}`;
        const content = detail.latestVersion.fileContents?.[relPath] || "";
        nextFiles[targetPath] = { code: content };
      }

      const skillMdPath = `/skills/${skillName}/SKILL.md`;
      const existingSkillMd =
        nextFiles[skillMdPath]?.code ||
        detail.latestVersion.fileContents?.["SKILL.md"] ||
        detail.latestVersion.readmeText ||
        "";
      nextFiles[skillMdPath] = {
        code: buildSkillMd(skillName, detail.summary || detail.displayName || "", existingSkillMd),
      };

      const response = await fetch(`/api/code?token=${encodeURIComponent(trimmedToken)}&action=merge-files`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...withAuthHeaders(),
        },
        body: JSON.stringify({ files: nextFiles }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "应用 skill 失败");
      }

      toast({
        status: "success",
        title: `已应用到 /skills/${skillName}`,
        duration: 1800,
      });
      onUseSkill?.(skillName);

      const syncResponse = await fetch(`/api/code?token=${encodeURIComponent(trimmedToken)}`, {
        headers: {
          ...withAuthHeaders(),
        },
      }).catch(() => null);
      if (syncResponse?.ok) {
        const syncPayload = (await syncResponse.json().catch(() => ({}))) as { files?: unknown };
        if (syncPayload.files && typeof syncPayload.files === "object") {
          onFilesApplied?.(syncPayload.files as Record<string, { code: string }>);
        }
      }
    } catch (error) {
      toast({
        status: "error",
        title: error instanceof Error ? error.message : "应用 skill 失败",
        duration: 2200,
      });
    } finally {
      setIsApplying(false);
    }
  }, [
    buildSkillMd,
    detail,
    normalizeSkillName,
    onFilesApplied,
    onUseSkill,
    projectToken,
    sanitizeRelativePath,
    toast,
  ]);

  return (
    <Drawer isOpen={isOpen} onClose={onClose} placement="right">
      <DrawerOverlay bg="blackAlpha.400" />
      <DrawerContent
        borderTopLeftRadius="16px"
        borderBottomLeftRadius="16px"
        maxW={drawerMaxW}
        transition="max-width 0.24s ease"
        overflow="hidden"
      >
        <DrawerHeader borderBottom="1px solid" borderColor="myGray.200" fontSize="md" pr={14}>
          <Flex align="center" justify="space-between" gap={2}>
            <Text fontSize="md" fontWeight={700}>
              Skills 管理 · ClawHub
            </Text>
          </Flex>
        </DrawerHeader>
        <DrawerCloseButton />
        <DrawerBody p={0}>
          <Flex h="100%" minH="560px">
            <Box
              borderRight={isDetailOpen ? "1px solid" : "none"}
              borderColor="myGray.200"
              p={3}
              w={isDetailOpen ? "420px" : "100%"}
              flexShrink={0}
            >
              <Flex align="center" gap={2} mb={3}>
                <InputGroup>
                  <Input
                    placeholder="按名称、slug、简介筛选..."
                    size="sm"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    bg="white"
                    borderColor="myGray.250"
                    borderRadius="10px"
                    _hover={{ borderColor: "myGray.300" }}
                    _focus={{ borderColor: "primary.400", boxShadow: "0 0 0 3px rgba(100,218,122,0.15)" }}
                  />
                  {query.trim() ? (
                    <InputRightElement h="100%">
                      <MyTooltip label="重置搜索">
                        <IconButton
                          aria-label="重置搜索"
                          icon={<Box as={CloseIcon} boxSize="10px" />}
                          onClick={() => setQuery("")}
                          size="xs"
                          variant="ghost"
                          borderRadius="9999px"
                          minW="22px"
                          h="22px"
                        />
                      </MyTooltip>
                    </InputRightElement>
                  ) : null}
                </InputGroup>
                <MyTooltip label="刷新列表">
                  <IconButton
                    aria-label="刷新列表"
                    icon={<Box as={RefreshIcon} boxSize="15px" />}
                    onClick={() => void loadList()}
                    {...iconButtonBaseProps}
                    bg="myGray.50"
                    color="myGray.700"
                    borderColor="myGray.250"
                    _hover={{ bg: "myGray.100", borderColor: "myGray.300", color: "myGray.800" }}
                  />
                </MyTooltip>
              </Flex>
              <Flex align="center" gap={2} mb={3}>
                <Select
                  size="sm"
                  value={clawHubSort}
                  onChange={(event) => setClawHubSort(event.target.value as ClawHubSort)}
                  maxW="156px"
                  bg="white"
                  borderColor="myGray.250"
                  borderRadius="10px"
                  _hover={{ borderColor: "myGray.300" }}
                  _focus={{ borderColor: "primary.400", boxShadow: "0 0 0 3px rgba(100,218,122,0.12)" }}
                >
                  {CLAWHUB_SORT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
                <MyTooltip label={clawHubDir === "asc" ? "当前升序，点击切换降序" : "当前降序，点击切换升序"}>
                  <IconButton
                    aria-label="切换排序方向"
                    icon={<Box as={ArrowDownUp} boxSize="15px" />}
                    {...iconButtonBaseProps}
                    onClick={() => setClawHubDir((prev) => (prev === "asc" ? "desc" : "asc"))}
                    bg="white"
                    color="myGray.700"
                    borderColor="myGray.250"
                    _hover={{ bg: "myGray.100", borderColor: "myGray.300", color: "myGray.800" }}
                  />
                </MyTooltip>
                <MyTooltip label="仅看精选">
                  <IconButton
                    aria-label="仅看精选"
                    icon={<Box as={Sparkles} boxSize="15px" />}
                    {...iconButtonBaseProps}
                    onClick={() => setClawHubHighlightedOnly((prev) => !prev)}
                    bg={clawHubHighlightedOnly ? "purple.100" : "white"}
                    color={clawHubHighlightedOnly ? "purple.700" : "myGray.700"}
                    borderColor={clawHubHighlightedOnly ? "purple.300" : "myGray.250"}
                    _hover={{
                      bg: clawHubHighlightedOnly ? "purple.200" : "myGray.100",
                      borderColor: clawHubHighlightedOnly ? "purple.400" : "myGray.300",
                    }}
                  />
                </MyTooltip>
                <MyTooltip label="过滤可疑">
                  <IconButton
                    aria-label="过滤可疑"
                    icon={<Box as={ShieldCheck} boxSize="15px" />}
                    {...iconButtonBaseProps}
                    onClick={() => setClawHubNonSuspiciousOnly((prev) => !prev)}
                    bg={clawHubNonSuspiciousOnly ? "blue.100" : "white"}
                    color={clawHubNonSuspiciousOnly ? "blue.700" : "myGray.700"}
                    borderColor={clawHubNonSuspiciousOnly ? "blue.300" : "myGray.250"}
                    _hover={{
                      bg: clawHubNonSuspiciousOnly ? "blue.200" : "myGray.100",
                      borderColor: clawHubNonSuspiciousOnly ? "blue.400" : "myGray.300",
                    }}
                  />
                </MyTooltip>
              </Flex>
              <Divider mb={2} />
              <Box h="calc(100% - 90px)" minH="320px" overflowY="auto">
                {isListLoading ? (
                  <Flex align="center" color="myGray.500" gap={2} justify="center" pt={8}>
                    <Spinner size="sm" />
                    <Text fontSize="sm">加载 ClawHub skills...</Text>
                  </Flex>
                ) : skills.length === 0 ? (
                  <Text color="myGray.500" fontSize="sm" pt={4}>
                    ClawHub 暂无匹配 skill。
                  </Text>
                ) : (
                  <Flex direction="column" gap={2}>
                    {skills.map((item) => {
                      const isActive = item.slug === selectedSlug;
                      return (
                        <Box
                          key={item.slug}
                          bg={isActive ? "primary.50" : "white"}
                          border="1px solid"
                          borderColor={isActive ? "primary.200" : "myGray.200"}
                          borderRadius="12px"
                          cursor="pointer"
                          onClick={() => setSelectedSlug(item.slug)}
                          p={2.5}
                          transition="all 0.16s ease"
                          _hover={{
                            borderColor: isActive ? "primary.300" : "myGray.300",
                            boxShadow: "0 8px 18px -14px rgba(15,23,42,0.5)",
                          }}
                        >
                          <Flex align="center" justify="space-between" mb={1.5}>
                            <Text fontSize="sm" fontWeight={700} noOfLines={1}>
                              {item.displayName}
                            </Text>
                            <Flex align="center" gap={1.5}>
                              {item.highlighted ? (
                                <Tag colorScheme="purple" size="sm" variant="subtle">
                                  精选
                                </Tag>
                              ) : null}
                              {item.suspicious ? (
                                <Tag colorScheme="orange" size="sm" variant="subtle">
                                  可疑
                                </Tag>
                              ) : null}
                            </Flex>
                          </Flex>
                          <Text color="myGray.600" fontSize="xs" noOfLines={2}>
                            {item.summary || "无描述"}
                          </Text>
                              <Flex align="center" gap={2} mt={2}>
                                <Text color="myGray.500" fontSize="11px" noOfLines={1}>
                                  /{item.slug}
                                </Text>
                                <Flex align="center" gap={1}>
                                  <Box as={Package} boxSize="12px" color="blue.500" />
                                  <Text color="blue.600" fontSize="10px" fontWeight={700}>
                                    {item.downloads}
                                  </Text>
                                </Flex>
                                <Flex align="center" gap={1}>
                                  <Box as={Star} boxSize="12px" color="orange.500" />
                                  <Text color="orange.600" fontSize="10px" fontWeight={700}>
                                    {item.stars}
                                  </Text>
                                </Flex>
                              </Flex>
                            </Box>
                          );
                    })}
                    <Text color="myGray.500" fontSize="11px" pt={1} textAlign="right">
                      共 {total} 条
                    </Text>
                  </Flex>
                )}
              </Box>
            </Box>

            {isDetailOpen ? (
              <Flex direction="column" flex="1" minW={0} minH={0}>
                <Flex
                  align="center"
                  justify="space-between"
                  gap={3}
                  px={4}
                  py={3}
                  borderBottom="1px solid"
                  borderColor="myGray.200"
                >
                  <Box minW={0}>
                    <Text fontSize="sm" fontWeight={800} noOfLines={1}>
                      {detail?.displayName || selectedListItem?.displayName || selectedSlug}
                    </Text>
                    <Text color="myGray.500" fontSize="11px" mt={0.5} noOfLines={1}>
                      /{detail?.slug || selectedSlug}
                    </Text>
                  </Box>
                  <Flex align="center" gap={2}>
                    <MyTooltip label="应用到当前项目 skills">
                      <IconButton
                        aria-label="应用到当前项目 skills"
                        icon={<Box as={RunIcon} boxSize="15px" />}
                        onClick={() => void handleApplyToProject()}
                        isLoading={isApplying}
                        {...iconButtonBaseProps}
                        bg="primary.600"
                        color="white"
                        borderColor="primary.600"
                        _hover={{ bg: "primary.700", borderColor: "primary.700" }}
                      />
                    </MyTooltip>
                    <MyTooltip label="收起详情">
                      <IconButton
                        aria-label="收起详情"
                        icon={<Box as={CollapseDetailIcon} boxSize="15px" />}
                        onClick={() => setSelectedSlug("")}
                        {...iconButtonBaseProps}
                        bg="red.50"
                        color="red.600"
                        borderColor="red.200"
                        _hover={{ bg: "red.100", borderColor: "red.300", color: "red.700" }}
                      />
                    </MyTooltip>
                  </Flex>
                </Flex>
                <Box flex="1" minH={0} overflow="hidden" px={4} pt={3} pb={4}>
                  {isDetailLoading ? (
                    <Flex align="center" color="myGray.500" gap={2} h="full" justify="center">
                      <Spinner size="sm" />
                      <Text fontSize="sm">加载详情...</Text>
                    </Flex>
                  ) : !detail ? (
                    <Flex align="center" color="myGray.500" h="full" justify="center">
                      <Text fontSize="sm">暂无详情。</Text>
                    </Flex>
                  ) : (
                    <Box h="full" borderRadius="12px" bg="myGray.25" px={3} py={2}>
                      <SkillDetailPreview
                        files={detailPreview.files}
                        activeFile={detailPreview.activeFile}
                        topDescription={detailPreview.topDescription}
                        metaDescription={detailPreview.metaDescription}
                        flat
                      />
                    </Box>
                  )}
                </Box>
              </Flex>
            ) : null}
          </Flex>
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
};

export default SkillsManagerModal;

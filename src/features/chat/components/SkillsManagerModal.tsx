import {
  Badge,
  Button,
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
  Spinner,
  Tag,
  Text,
  useToast,
} from "@chakra-ui/react";
import {
  CheckIcon,
  CollapseDetailIcon,
  EditCustomIcon,
  RefreshIcon,
  RunIcon,
} from "@/components/common/Icon";
import SkillDetailPreview from "@/components/workspace/SkillDetailPreview";
import MyTooltip from "@/components/ui/MyTooltip";
import yaml from "js-yaml";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getSkillDetail,
  installSkillCreator,
  listSkills,
  reloadSkills,
  validateSkills,
  type SkillDetailResponse,
  type SkillListItem,
} from "../services/skills";

type SkillsManagerModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onUseSkill?: (name: string) => void;
  onCreateViaChat?: () => void;
};

const SkillsManagerModal = ({ isOpen, onClose, onUseSkill, onCreateViaChat }: SkillsManagerModalProps) => {
  const toast = useToast();
  const [isInstallingCreator, setIsInstallingCreator] = useState(false);
  const [query, setQuery] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [isReloading, setIsReloading] = useState(false);
  const [skills, setSkills] = useState<SkillListItem[]>([]);
  const [selectedName, setSelectedName] = useState<string>("");
  const [detail, setDetail] = useState<SkillDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const loadSkills = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await listSkills();
      const nextSkills = result.skills || [];
      setSkills(nextSkills);
      setSelectedName((current) =>
        current && !nextSkills.some((item) => item.name === current) ? "" : current
      );
    } catch (error) {
      toast({
        status: "error",
        title: error instanceof Error ? error.message : "技能列表加载失败",
        duration: 2500,
      });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (!isOpen) return;
    setSelectedName("");
    setDetail(null);
    void loadSkills();
  }, [isOpen, loadSkills]);

  useEffect(() => {
    if (!isOpen || !selectedName) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    getSkillDetail(selectedName)
      .then((data) => {
        if (cancelled) return;
        setDetail(data);
      })
      .catch((error) => {
        if (cancelled) return;
        setDetail(null);
        toast({
          status: "warning",
          title: error instanceof Error ? error.message : "技能详情加载失败",
          duration: 2000,
        });
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, selectedName, toast]);

  const filteredSkills = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return skills;
    return skills.filter((item) => {
      const name = (item.name || "").toLowerCase();
      const description = (item.description || "").toLowerCase();
      return name.includes(keyword) || description.includes(keyword);
    });
  }, [query, skills]);
  const selectedSkillMeta = useMemo(
    () => skills.find((item) => item.name === selectedName),
    [selectedName, skills]
  );
  const detailPreview = useMemo(() => {
    if (!detail) {
      return {
        files: {} as Record<string, string | { code?: unknown }>,
        activeFile: "",
      };
    }

    const rawPath = detail.relativeLocation?.trim() || `/skills/${detail.name}/SKILL.md`;
    const normalizedPath = rawPath.startsWith("/") ? rawPath : `/${rawPath}`;
    const frontmatter = yaml
      .dump(
        {
          name: detail.name,
          description: detail.description || "",
          ...(detail.license ? { license: detail.license } : {}),
          ...(detail.compatibility ? { compatibility: detail.compatibility } : {}),
        },
        { lineWidth: 1000, noRefs: true }
      )
      .trimEnd();
    const skillCode = `---\n${frontmatter}\n---\n\n${detail.body || ""}`;

    return {
      files: {
        [normalizedPath]: { code: skillCode },
      } as Record<string, string | { code?: unknown }>,
      activeFile: normalizedPath,
    };
  }, [detail]);
  const isDetailOpen = Boolean(selectedName);
  const drawerMaxW = isDetailOpen
    ? ({ base: "100vw", lg: "clamp(960px, 60vw, 1320px)" } as const)
    : ({ base: "100vw", lg: "clamp(420px, 30vw, 640px)" } as const);
  const headerActionButtonProps = {
    size: "sm" as const,
    borderRadius: "9999px",
    boxSize: "34px",
    minW: "34px",
    h: "34px",
    p: 0,
  };
  const neutralActionButtonProps = {
    variant: "solid" as const,
    bg: "myGray.50",
    color: "myGray.700",
    border: "1px solid",
    borderColor: "myGray.250",
    _hover: { bg: "myGray.100", borderColor: "myGray.300", color: "myGray.800" },
    _active: { bg: "myGray.150", borderColor: "myGray.300", color: "myGray.800" },
  };
  const accentActionButtonProps = {
    bg: "primary.600",
    color: "white",
    border: "1px solid",
    borderColor: "primary.600",
    _hover: { bg: "primary.700", borderColor: "primary.700" },
    _active: { bg: "primary.800", borderColor: "primary.800" },
    _disabled: {
      bg: "gray.100",
      borderColor: "gray.200",
      color: "gray.400",
      cursor: "not-allowed",
    },
  };

  const handleReload = async () => {
    setIsReloading(true);
    try {
      await reloadSkills();
      await loadSkills();
      toast({ status: "success", title: "技能目录已重新扫描", duration: 1500 });
    } catch (error) {
      toast({
        status: "error",
        title: error instanceof Error ? error.message : "重扫失败",
        duration: 2000,
      });
    } finally {
      setIsReloading(false);
    }
  };

  const handleValidate = async () => {
    setIsValidating(true);
    try {
      const result = await validateSkills();
      toast({
        status: result.ok ? "success" : "warning",
        title: result.ok ? "skills 校验通过" : `发现 ${result.issues.length} 个问题`,
        duration: 2000,
      });
      await loadSkills();
    } catch (error) {
      toast({
        status: "error",
        title: error instanceof Error ? error.message : "校验失败",
        duration: 2000,
      });
    } finally {
      setIsValidating(false);
    }
  };

  const handleCreateInChat = async () => {
    setIsInstallingCreator(true);
    try {
      await installSkillCreator();
      await loadSkills();
      setSelectedName("skill-creator");
      toast({
        status: "success",
        title: "已准备 skill-creator，切换到对话创建",
        duration: 1800,
      });
      onClose();
      onCreateViaChat?.();
    } catch (error) {
      toast({
        status: "error",
        title: error instanceof Error ? error.message : "准备 skill-creator 失败",
        duration: 2200,
      });
    } finally {
      setIsInstallingCreator(false);
    }
  };

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
              Skills 管理
            </Text>
            {isDetailOpen ? (
              <Button size="xs" variant="ghost" onClick={() => setSelectedName("")}>
                返回列表
              </Button>
            ) : null}
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
                <Input
                  placeholder="搜索技能名称或描述"
                  size="sm"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
                <MyTooltip label="校验 skills">
                  <IconButton
                    aria-label="校验 skills"
                    icon={<Box as={CheckIcon} boxSize="15px" />}
                    onClick={handleValidate}
                    isLoading={isValidating}
                    {...headerActionButtonProps}
                    {...neutralActionButtonProps}
                  />
                </MyTooltip>
                <MyTooltip label="重扫 skills 目录">
                  <IconButton
                    aria-label="重扫 skills 目录"
                    icon={<Box as={RefreshIcon} boxSize="15px" />}
                    onClick={handleReload}
                    isLoading={isReloading}
                    {...headerActionButtonProps}
                    {...neutralActionButtonProps}
                  />
                </MyTooltip>
                <MyTooltip label="通过对话创建 skill">
                  <IconButton
                    aria-label="通过对话创建 skill"
                    icon={<Box as={EditCustomIcon} boxSize="15px" />}
                    onClick={handleCreateInChat}
                    isLoading={isInstallingCreator}
                    {...headerActionButtonProps}
                    {...accentActionButtonProps}
                  />
                </MyTooltip>
              </Flex>
              <Divider mb={2} />
              <Box h="calc(100% - 52px)" minH="320px" overflowY="auto">
                {isLoading ? (
                  <Flex align="center" color="myGray.500" gap={2} justify="center" pt={8}>
                    <Spinner size="sm" />
                    <Text fontSize="sm">加载 skills...</Text>
                  </Flex>
                ) : filteredSkills.length === 0 ? (
                  <Text color="myGray.500" fontSize="sm" pt={4}>
                    暂无可用 skill。
                  </Text>
                ) : (
                  <Flex direction="column" gap={2}>
                    {filteredSkills.map((item) => {
                      const isActive = Boolean(item.name && item.name === selectedName);
                      return (
                        <Box
                          key={`${item.relativeLocation}-${item.name || "unknown"}`}
                          bg={isActive ? "primary.50" : "white"}
                          border="1px solid"
                          borderColor={isActive ? "primary.200" : "myGray.200"}
                          borderRadius="10px"
                          cursor={item.name ? "pointer" : "default"}
                          onClick={() => {
                            if (!item.name) return;
                            setSelectedName(item.name);
                          }}
                          p={2.5}
                        >
                          <Flex align="center" justify="space-between" mb={1.5}>
                            <Text fontSize="sm" fontWeight={700}>
                              {item.name || "未命名 skill"}
                            </Text>
                            <Tag
                              colorScheme={item.isLoadable ? "green" : "orange"}
                              size="sm"
                              variant="subtle"
                            >
                              {item.isLoadable ? "可用" : "有问题"}
                            </Tag>
                          </Flex>
                          <Text color="myGray.600" fontSize="xs" noOfLines={2}>
                            {item.description || "无描述"}
                          </Text>
                          <Flex align="center" gap={2} mt={2}>
                            <Text color="myGray.500" fontSize="11px" noOfLines={1}>
                              {item.relativeLocation}
                            </Text>
                            {item.issues.length > 0 ? (
                              <Badge colorScheme="orange" fontSize="10px">
                                {item.issues.length} issues
                              </Badge>
                            ) : null}
                          </Flex>
                        </Box>
                      );
                    })}
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
                      {detail?.name || selectedName}
                    </Text>
                    <Text color="myGray.500" fontSize="11px" mt={0.5} noOfLines={1}>
                      {detail?.relativeLocation || ""}
                    </Text>
                  </Box>
                  <Flex align="center" gap={2}>
                    <MyTooltip label="收起详情">
                      <IconButton
                        aria-label="收起详情"
                        icon={<Box as={CollapseDetailIcon} boxSize="15px" />}
                        onClick={() => setSelectedName("")}
                        bg="red.50"
                        color="red.600"
                        border="1px solid"
                        borderColor="red.200"
                        _hover={{ bg: "red.100", borderColor: "red.300", color: "red.700" }}
                        _active={{ bg: "red.100", borderColor: "red.300", color: "red.700" }}
                        {...headerActionButtonProps}
                      />
                    </MyTooltip>
                    <MyTooltip label="用于当前对话">
                      <IconButton
                        aria-label="用于当前对话"
                        icon={<Box as={RunIcon} boxSize="15px" />}
                        isDisabled={!selectedSkillMeta?.isLoadable || !detail}
                        onClick={() => {
                          if (!selectedSkillMeta?.isLoadable || !detail) {
                            toast({
                              status: "warning",
                              title: "该 skill 当前不可用，请先修复问题后再应用",
                              duration: 1800,
                            });
                            return;
                          }
                          onUseSkill?.(detail.name);
                          onClose();
                        }}
                        {...headerActionButtonProps}
                        {...accentActionButtonProps}
                      />
                    </MyTooltip>
                  </Flex>
                </Flex>
                <Box flex="1" minH={0} overflow="hidden" px={4} pt={3} pb={4}>
                  {detailLoading ? (
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

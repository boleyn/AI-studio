import {
  Badge,
  Box,
  Divider,
  Flex,
  IconButton,
  Input,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalHeader,
  ModalOverlay,
  Spinner,
  Tag,
  Text,
  useToast,
} from "@chakra-ui/react";
import {
  CheckIcon,
  EditIcon,
  RefreshIcon,
  RunIcon,
} from "@/components/common/Icon";
import MyTooltip from "@/components/ui/MyTooltip";
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
      setSkills(result.skills || []);
      const firstLoadable = (result.skills || []).find((item) => item.name && item.isLoadable);
      if (!selectedName && firstLoadable?.name) {
        setSelectedName(firstLoadable.name);
      }
    } catch (error) {
      toast({
        status: "error",
        title: error instanceof Error ? error.message : "技能列表加载失败",
        duration: 2500,
      });
    } finally {
      setIsLoading(false);
    }
  }, [selectedName, toast]);

  useEffect(() => {
    if (!isOpen) return;
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
    <Modal isOpen={isOpen} onClose={onClose} size="6xl" isCentered>
      <ModalOverlay bg="blackAlpha.400" />
      <ModalContent borderRadius="16px" maxH="80vh" overflow="hidden">
        <ModalHeader borderBottom="1px solid" borderColor="myGray.200" fontSize="md">
          Skills 管理
        </ModalHeader>
        <ModalCloseButton />
        <ModalBody p={0}>
          <Flex h="72vh" minH="520px">
            <Box borderRight="1px solid" borderColor="myGray.200" p={3} w="42%">
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
                    size="sm"
                    variant="outline"
                    icon={<CheckIcon />}
                    onClick={handleValidate}
                    isLoading={isValidating}
                  />
                </MyTooltip>
                <MyTooltip label="重扫 skills 目录">
                  <IconButton
                    aria-label="重扫 skills 目录"
                    size="sm"
                    variant="outline"
                    icon={<RefreshIcon />}
                    onClick={handleReload}
                    isLoading={isReloading}
                  />
                </MyTooltip>
                <MyTooltip label="通过对话创建 skill">
                  <IconButton
                    aria-label="通过对话创建 skill"
                    bg="blue.500"
                    border="1px solid"
                    borderColor="blue.500"
                    color="white"
                    size="sm"
                    icon={<EditIcon />}
                    _hover={{ bg: "blue.600", borderColor: "blue.600" }}
                    _active={{ bg: "blue.700", borderColor: "blue.700" }}
                    onClick={handleCreateInChat}
                    isLoading={isInstallingCreator}
                  />
                </MyTooltip>
              </Flex>
              <Divider mb={2} />
              <Box h="calc(72vh - 86px)" minH="320px" overflowY="auto">
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
                          bg={isActive ? "blue.50" : "white"}
                          border="1px solid"
                          borderColor={isActive ? "blue.200" : "myGray.200"}
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

            <Box p={4} w="58%">
              {!selectedName ? (
                <Text color="myGray.500" fontSize="sm">
                  请选择一个 skill 查看详情。
                </Text>
              ) : detailLoading ? (
                <Flex align="center" color="myGray.500" gap={2} h="full" justify="center">
                  <Spinner size="sm" />
                  <Text fontSize="sm">加载详情...</Text>
                </Flex>
              ) : !detail ? (
                <Text color="myGray.500" fontSize="sm">
                  暂无详情。
                </Text>
              ) : (
                <Flex direction="column" gap={3} h="full">
                  <Flex align="flex-start" justify="space-between">
                    <Box minW={0}>
                      <Text fontSize="md" fontWeight={800} noOfLines={1}>
                        {detail.name}
                      </Text>
                      <Text color="myGray.600" fontSize="sm" mt={1}>
                        {detail.description}
                      </Text>
                      <Text color="myGray.500" fontSize="11px" mt={1}>
                        {detail.relativeLocation}
                      </Text>
                    </Box>
                    <MyTooltip label="用于当前对话">
                      <IconButton
                        aria-label="用于当前对话"
                        bg="blue.500"
                        border="1px solid"
                        borderColor="blue.500"
                        color="white"
                        size="sm"
                        icon={<RunIcon />}
                        _hover={{ bg: "blue.600", borderColor: "blue.600" }}
                        _active={{ bg: "blue.700", borderColor: "blue.700" }}
                        _disabled={{
                          bg: "gray.100",
                          borderColor: "gray.200",
                          color: "gray.400",
                          cursor: "not-allowed",
                        }}
                        isDisabled={!selectedSkillMeta?.isLoadable}
                        onClick={() => {
                          if (!selectedSkillMeta?.isLoadable) {
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
                      />
                    </MyTooltip>
                  </Flex>

                  <Divider />

                  <Box flex="1" minH={0}>
                    <Text color="myGray.700" fontSize="xs" fontWeight={700} mb={1}>
                      SKILL.md 正文预览
                    </Text>
                    <Box
                      bg="gray.50"
                      border="1px solid"
                      borderColor="myGray.200"
                      borderRadius="10px"
                      h="full"
                      minH="300px"
                      overflowY="auto"
                      p={3}
                    >
                      <Text fontFamily="mono" fontSize="12px" whiteSpace="pre-wrap">
                        {detail.body || "(empty)"}
                      </Text>
                    </Box>
                  </Box>
                </Flex>
              )}
            </Box>
          </Flex>
        </ModalBody>
      </ModalContent>
    </Modal>
  );
};

export default SkillsManagerModal;

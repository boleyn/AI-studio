import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
} from "react";
import {
  Badge,
  Box,
  Button,
  Checkbox,
  Divider,
  Drawer,
  DrawerBody,
  DrawerCloseButton,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerOverlay,
  Flex,
  FormControl,
  FormLabel,
  Grid,
  Input,
  Select,
  Text,
  useDisclosure,
  useToast,
} from "@chakra-ui/react";
import { withAuthHeaders } from "@features/auth/client/authClient";
import { EmptyIcon, SearchIcon } from "@components/common/Icon";

type EditableModelConfig = {
  id: string;
  label?: string;
  icon?: string;
  protocol?: string;
  baseUrl?: string;
  key?: string;
  maxContext?: number;
  reasoning?: boolean;
  vision?: boolean;
  scope?: "user" | "system";
};

type ModelConfigResponse = {
  models: EditableModelConfig[];
  iconOptions: string[];
};

const createEmptyModel = (): EditableModelConfig => ({
  id: "",
  label: "",
  icon: "auto.svg",
  protocol: "openai",
  baseUrl: "",
  key: "",
  maxContext: undefined,
  reasoning: false,
  vision: false,
});

const resolveIconSrc = (icon?: string) => {
  const value = (icon || "").trim();
  if (!value) return "/icons/llms/auto.svg";
  if (value.startsWith("/") || value.startsWith("http://") || value.startsWith("https://")) {
    return value;
  }
  return `/icons/llms/${value.replace(/^\/+/, "")}`;
};

const parsePositiveNumber = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return undefined;
};

const formatContextWindow = (value?: number) => {
  if (!value || !Number.isFinite(value)) return "-";
  if (value < 1000) return String(Math.floor(value));
  const asK = value / 1000;
  return `${Number.isInteger(asK) ? asK.toFixed(0) : asK.toFixed(1)}k`;
};

type AccountModelConfigPanelProps = {
  title?: string;
  description?: string;
  tableMaxHeight?: string;
  hideHeader?: boolean;
  hideToolbar?: boolean;
  fillParent?: boolean;
  searchValue?: string;
  onSearchValueChange?: (value: string) => void;
};

export type AccountModelConfigPanelRef = {
  openCreateDrawer: () => void;
};

export const AccountModelConfigPanel = forwardRef<AccountModelConfigPanelRef, AccountModelConfigPanelProps>(function AccountModelConfigPanel({
  title = "模型配置",
  description,
  tableMaxHeight = "38vh",
  hideHeader = false,
  hideToolbar = false,
  fillParent = false,
  searchValue,
  onSearchValueChange,
}: AccountModelConfigPanelProps, ref) {
  const toast = useToast();
  const drawer = useDisclosure();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [iconOptions, setIconOptions] = useState<string[]>([]);
  const [models, setModels] = useState<EditableModelConfig[]>([]);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [draft, setDraft] = useState<EditableModelConfig>(createEmptyModel());
  const [innerSearchValue, setInnerSearchValue] = useState("");
  const [page, setPage] = useState(1);

  const pageSize = 6;
  const tableTemplateColumns = "48px 260px 100px 120px 72px 72px 88px";
  const tableMinWidth = "760px";

  const effectiveSearchValue = typeof searchValue === "string" ? searchValue : innerSearchValue;
  const keyword = effectiveSearchValue.trim().toLowerCase();

  const filteredModels = useMemo(() => {
    const list = models.map((item, index) => ({ item, index }));
    if (!keyword) return list;
    return list.filter(({ item }) => {
      const label = (item.label || "").toLowerCase();
      const id = (item.id || "").toLowerCase();
      const protocol = (item.protocol || "").toLowerCase();
      return label.includes(keyword) || id.includes(keyword) || protocol.includes(keyword);
    });
  }, [keyword, models]);

  const totalPages = Math.max(1, Math.ceil(filteredModels.length / pageSize));
  const pagedModels = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredModels.slice(start, start + pageSize);
  }, [filteredModels, page]);

  const openCreateDrawer = () => {
    setEditingIndex(null);
    setDraft(createEmptyModel());
    drawer.onOpen();
  };

  useImperativeHandle(ref, () => ({
    openCreateDrawer,
  }));

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/chat/model-config", {
        headers: withAuthHeaders(),
      });
      if (!response.ok) {
        throw new Error(`读取模型配置失败: ${response.status}`);
      }
      const data = (await response.json()) as ModelConfigResponse;
      const systemResponse = await fetch("/api/chat/models", {
        headers: withAuthHeaders(),
      });
      const systemPayload = await systemResponse.json().catch(() => ({}));
      const systemModels = Array.isArray(systemPayload?.models) ? systemPayload.models : [];

      const userModels = (data.models || []).map((item) => ({
        id: item.id || "",
        label: item.label || item.id || "",
        icon: item.icon || "auto.svg",
        protocol: item.protocol || "openai",
        baseUrl: item.baseUrl || "",
        key: item.key || "",
        maxContext: parsePositiveNumber(item.maxContext),
        reasoning: Boolean(item.reasoning),
        vision: Boolean(item.vision),
        scope: "user" as const,
      }));

      const mergedById = new Map<string, EditableModelConfig>();
      userModels.forEach((item) => {
        if (!item.id) return;
        mergedById.set(item.id, item);
      });
      systemModels.forEach((item: any) => {
        const id = typeof item?.id === "string" ? item.id.trim() : "";
        if (!id || mergedById.has(id)) return;
        mergedById.set(id, {
          id,
          label: (typeof item?.label === "string" && item.label.trim()) ? item.label.trim() : id,
          icon: typeof item?.icon === "string" ? item.icon : "auto.svg",
          protocol: typeof item?.protocol === "string" && item.protocol.trim() ? item.protocol.trim() : "openai",
          baseUrl: "",
          key: "",
          maxContext: parsePositiveNumber(item?.maxContext),
          reasoning: Boolean(item?.reasoning),
          vision: Boolean(item?.vision),
          scope: "system",
        });
      });

      setIconOptions(data.iconOptions || []);
      setModels(Array.from(mergedById.values()));
      setEditingIndex(null);
      setDraft(createEmptyModel());
    } catch (error) {
      toast({
        title: error instanceof Error ? error.message : "读取模型配置失败",
        status: "error",
        duration: 2500,
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    setPage(1);
  }, [keyword]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const openEditDrawer = (index: number) => {
    setEditingIndex(index);
    setDraft(models[index]);
    drawer.onOpen();
  };

  const persistModels = async (
    nextModels: EditableModelConfig[],
    successTitle: string,
    closeDrawer?: boolean
  ) => {
    setSaving(true);
    try {
      const response = await fetch("/api/chat/model-config", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...withAuthHeaders(),
        },
        body: JSON.stringify({
          models: nextModels
            .filter((item) => item.scope !== "system")
            .map((item) => ({
            id: item.id.trim(),
            label: (item.label || "").trim() || item.id.trim(),
            icon: (item.icon || "").trim() || "auto.svg",
            protocol: (item.protocol || "").trim() || "openai",
            baseUrl: (item.baseUrl || "").trim(),
            key: (item.key || "").trim(),
            maxContext:
              Number.isFinite(Number(item.maxContext)) && Number(item.maxContext) > 0
                ? Math.floor(Number(item.maxContext))
                : undefined,
            reasoning: Boolean(item.reasoning),
            vision: Boolean(item.vision),
          })),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || `保存失败: ${response.status}`);
      }
      setModels(nextModels);
      toast({ title: successTitle, status: "success", duration: 1600 });
      if (closeDrawer) {
        drawer.onClose();
      }
    } catch (error) {
      toast({
        title: error instanceof Error ? error.message : "保存失败",
        status: "error",
        duration: 2600,
      });
    } finally {
      setSaving(false);
    }
  };

  const commitDraft = () => {
    const id = draft.id.trim();
    const label = (draft.label || "").trim();
    const baseUrl = (draft.baseUrl || "").trim();
    const key = (draft.key || "").trim();
    const maxContext =
      Number.isFinite(Number(draft.maxContext)) && Number(draft.maxContext) > 0
        ? Math.floor(Number(draft.maxContext))
        : undefined;

    if (!id) {
      toast({ title: "请填写模型 ID", status: "warning", duration: 2000 });
      return;
    }
    if (!baseUrl) {
      toast({ title: "请填写 Base URL", status: "warning", duration: 2000 });
      return;
    }
    if (!key) {
      toast({ title: "请填写 API Key", status: "warning", duration: 2000 });
      return;
    }

    const nextItem: EditableModelConfig = {
      id,
      label: label || id,
      icon: (draft.icon || "").trim() || "auto.svg",
      protocol: (draft.protocol || "").trim() || "openai",
      baseUrl,
      key,
      maxContext,
      reasoning: Boolean(draft.reasoning),
      vision: Boolean(draft.vision),
    };

    const nextModels =
      editingIndex === null
        ? [...models, nextItem]
        : models.map((item, idx) => (idx === editingIndex ? nextItem : item));

    if (nextModels.some((item) => !item.id.trim())) {
      toast({ title: "存在空的模型 ID", status: "warning", duration: 2200 });
      return;
    }

    const countById = new Map<string, number>();
    nextModels.forEach((item) => {
      const modelId = item.id.trim();
      if (!modelId) return;
      countById.set(modelId, (countById.get(modelId) || 0) + 1);
    });
    const duplicate = Array.from(countById.entries()).find(([, count]) => count > 1)?.[0] || "";
    if (duplicate) {
      toast({ title: `模型 ID 重复: ${duplicate}`, status: "warning", duration: 2200 });
      return;
    }

    void persistModels(nextModels, editingIndex === null ? "模型已新增" : "模型已更新", true);
  };

  const handleDelete = (index: number) => {
    const nextModels = models.filter((_, idx) => idx !== index);
    void persistModels(nextModels, "模型已删除");
  };

  return (
    <Flex
      direction="column"
      flex={fillParent ? 1 : undefined}
      minH={fillParent ? 0 : undefined}
      h={fillParent ? "100%" : "auto"}
    >
      <Box
        overflow="hidden"
        bg="transparent"
        display="flex"
        flexDirection="column"
        flex={fillParent ? 1 : undefined}
        minH={fillParent ? 0 : undefined}
      >
        {!hideHeader ? (
          <Flex mb={4} justify="space-between" align="center" pr={14}>
            <Box>
              <Text fontSize="2xl" lineHeight="1.2" fontWeight="700" color="myGray.800">
                {title}
              </Text>
              {description ? (
                <Text mt={2} fontSize="sm" color="myGray.500">
                  {description}
                </Text>
              ) : null}
            </Box>
            <Button variant="whitePrimary" onClick={openCreateDrawer}>
              新增
            </Button>
          </Flex>
        ) : !hideToolbar ? (
          <Flex mb={4} justify="space-between" align="center" gap={3} wrap="wrap">
            <Box position="relative" w={{ base: "100%", md: "320px" }}>
              <Box
                as={SearchIcon}
                w={4}
                h={4}
                position="absolute"
                left={3}
                top="50%"
                transform="translateY(-50%)"
                color="myGray.500"
              />
              <Input
                pl={9}
                value={effectiveSearchValue}
                onChange={(event) => {
                  const value = event.target.value;
                  if (onSearchValueChange) {
                    onSearchValueChange(value);
                  } else {
                    setInnerSearchValue(value);
                  }
                }}
                placeholder="搜索模型名称或 ID"
                bg="myWhite.100"
                borderColor="myGray.200"
                _hover={{ borderColor: "myGray.300" }}
                _focusVisible={{ borderColor: "primary.400", boxShadow: "0 0 0 1px var(--chakra-colors-primary-400)" }}
                name="model_search_keyword"
                autoComplete="off"
              />
            </Box>
            <Button variant="whitePrimary" onClick={openCreateDrawer}>
              新增
            </Button>
          </Flex>
        ) : null}

        <Box
          border="1px solid var(--ws-border)"
          borderRadius="2xl"
          bg="var(--ws-surface-strong)"
          boxShadow="var(--ws-glow-soft)"
          backdropFilter="blur(14px)"
          overflow="hidden"
          display="flex"
          flexDirection="column"
          h={fillParent ? "100%" : "auto"}
          minH={fillParent ? 0 : undefined}
        >
          <Box px={4} py={2} overflowX={{ base: "auto", lg: "visible" }} bg="rgba(255,255,255,0.35)">
            <Grid minW={tableMinWidth} templateColumns={tableTemplateColumns} gap={3} py={2} borderBottom="1px solid var(--ws-border)">
              <Text fontSize="11px" letterSpacing="0.06em" textTransform="uppercase" fontWeight="700" color="var(--ws-text-subtle)">图标</Text>
              <Text fontSize="11px" letterSpacing="0.06em" textTransform="uppercase" fontWeight="700" color="var(--ws-text-subtle)">名称</Text>
              <Text fontSize="11px" letterSpacing="0.06em" textTransform="uppercase" fontWeight="700" color="var(--ws-text-subtle)" textAlign="center">协议</Text>
              <Text fontSize="11px" letterSpacing="0.06em" textTransform="uppercase" fontWeight="700" color="var(--ws-text-subtle)" textAlign="center">最大上下文</Text>
              <Text fontSize="11px" letterSpacing="0.06em" textTransform="uppercase" fontWeight="700" color="var(--ws-text-subtle)" textAlign="center">思考</Text>
              <Text fontSize="11px" letterSpacing="0.06em" textTransform="uppercase" fontWeight="700" color="var(--ws-text-subtle)" textAlign="center">视觉</Text>
              <Text fontSize="11px" letterSpacing="0.06em" textTransform="uppercase" fontWeight="700" color="var(--ws-text-subtle)" textAlign="right">操作</Text>
            </Grid>
          </Box>

          <Box
            px={4}
            flex={fillParent ? 1 : undefined}
            minH={fillParent ? 0 : undefined}
            maxH={fillParent ? "none" : tableMaxHeight}
            overflowY={loading || filteredModels.length === 0 ? "visible" : "auto"}
            overflowX={{ base: "auto", lg: "visible" }}
          >
            {loading ? (
              <Flex align="center" justify="center" py={8}>
                <Text fontSize="sm" color="myGray.500">加载中...</Text>
              </Flex>
            ) : filteredModels.length === 0 ? (
              <Flex direction="column" align="center" justify="center" py={8}>
                <Box mb={5}>
                  <Box as={EmptyIcon} w="140px" h="116px" />
                </Box>
                <Text fontSize="md" color="myGray.700" fontWeight="600" mb={2}>
                  {effectiveSearchValue ? "没有匹配的模型" : "暂无模型"}
                </Text>
                <Text fontSize="sm" color="myGray.500">
                  {effectiveSearchValue ? "请尝试更换关键词。" : "点击右上角“新增”开始配置。"}
                </Text>
              </Flex>
            ) : (
              <Box minW={tableMinWidth}>
                {pagedModels.map(({ item, index }, rowIndex) => (
                  <Grid
                    key={`${item.id}-${index}`}
                    templateColumns={tableTemplateColumns}
                    gap={3}
                    py={2}
                    px={1}
                    alignItems="center"
                    borderBottom={rowIndex === pagedModels.length - 1 ? "none" : "1px solid"}
                    borderColor="var(--ws-border)"
                    transition="background-color 0.18s ease, transform 0.18s ease"
                    _hover={{
                      bg: "rgba(255,255,255,0.52)",
                      transform: "translateY(-1px)",
                    }}
                  >
                    <Box
                      w="36px"
                      h="36px"
                      borderRadius="10px"
                      bg="var(--ws-accent-soft)"
                      border="1px solid var(--ws-accent-border)"
                      display="flex"
                      alignItems="center"
                      justifyContent="center"
                    >
                      <Box as="img" src={resolveIconSrc(item.icon)} w="18px" h="18px" />
                    </Box>
                    <Box minW={0}>
                      <Text fontSize="md" lineHeight="1.2" fontWeight="700" color="var(--ws-text-main)" noOfLines={1}>
                        {item.label || item.id}
                      </Text>
                      <Text mt={1} fontSize="xs" color="var(--ws-text-subtle)" noOfLines={1}>
                        ID: {item.id}
                      </Text>
                    </Box>
                    <Badge
                      w="fit-content"
                      px={2.5}
                      py={1}
                      borderRadius="999px"
                      bg="rgba(255,255,255,0.72)"
                      color="var(--ws-text-main)"
                      border="1px solid var(--ws-border)"
                      justifySelf="center"
                      fontSize="10px"
                      letterSpacing="0.04em"
                    >
                      {(item.protocol || "openai").toUpperCase()}
                    </Badge>
                    <Text fontSize="sm" color="var(--ws-text-main)" textAlign="center" fontWeight="600">
                      {formatContextWindow(item.maxContext)}
                    </Text>
                    <Badge
                      w="fit-content"
                      justifySelf="center"
                      bg={item.reasoning ? "var(--ws-accent-soft)" : "rgba(148, 163, 184, 0.16)"}
                      color={item.reasoning ? "var(--ws-accent)" : "var(--ws-text-subtle)"}
                      border={item.reasoning ? "1px solid var(--ws-accent-border)" : "1px solid var(--ws-border)"}
                      px={2.5}
                      py={1}
                    >
                      {item.reasoning ? "是" : "否"}
                    </Badge>
                    <Badge
                      w="fit-content"
                      justifySelf="center"
                      bg={item.vision ? "var(--ws-accent-soft)" : "rgba(148, 163, 184, 0.16)"}
                      color={item.vision ? "var(--ws-accent)" : "var(--ws-text-subtle)"}
                      border={item.vision ? "1px solid var(--ws-accent-border)" : "1px solid var(--ws-border)"}
                      px={2.5}
                      py={1}
                    >
                      {item.vision ? "是" : "否"}
                    </Badge>
                    <Flex justify="flex-end" gap={1}>
                      {item.scope === "system" ? (
                        <Badge bg="rgba(148, 163, 184, 0.16)" color="var(--ws-text-subtle)" border="1px solid var(--ws-border)" px={2.5} py={1}>
                          只读
                        </Badge>
                      ) : (
                        <>
                          <Button
                            size="xs"
                            variant="ghost"
                            onClick={() => openEditDrawer(index)}
                            isDisabled={saving}
                            color="var(--ws-text-main)"
                            _hover={{ bg: "var(--ws-surface-muted)", color: "var(--ws-accent)" }}
                          >
                            编辑
                          </Button>
                          <Button
                            size="xs"
                            variant="ghost"
                            color="red.600"
                            onClick={() => handleDelete(index)}
                            isDisabled={saving}
                            _hover={{ bg: "red.50", color: "red.700" }}
                          >
                            删除
                          </Button>
                        </>
                      )}
                    </Flex>
                  </Grid>
                ))}
              </Box>
            )}
          </Box>

          {!loading && filteredModels.length > 0 ? (
            <Flex px={4} py={3} borderTop="1px solid var(--ws-border)" justify="space-between" align="center">
              <Text fontSize="sm" color="var(--ws-text-subtle)">
                第 {page} / {totalPages} 页，共 {filteredModels.length} 条
              </Text>
              <Flex gap={2}>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                  isDisabled={page <= 1}
                  border="1px solid var(--ws-border)"
                  bg="rgba(255,255,255,0.52)"
                  _hover={{ bg: "var(--ws-surface-muted)", borderColor: "var(--ws-border-strong)" }}
                >
                  上一页
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
                  isDisabled={page >= totalPages}
                  border="1px solid var(--ws-border)"
                  bg="rgba(255,255,255,0.52)"
                  _hover={{ bg: "var(--ws-surface-muted)", borderColor: "var(--ws-border-strong)" }}
                >
                  下一页
                </Button>
              </Flex>
            </Flex>
          ) : null}
        </Box>
      </Box>

      <Drawer isOpen={drawer.isOpen} placement="right" onClose={drawer.onClose} size="md">
        <DrawerOverlay bg="blackAlpha.300" />
        <DrawerContent borderLeft="1px solid" borderColor="myGray.200">
          <DrawerCloseButton />
          <DrawerHeader borderBottomWidth="1px" borderBottomColor="myGray.200">
            <Text fontSize="2xl" fontWeight="700">
              {editingIndex === null ? "新增模型" : "编辑模型"}
            </Text>
            <Text mt={2} fontSize="sm" color="myGray.500" fontWeight="500">
              配置一个新的模型推理端点。
            </Text>
          </DrawerHeader>

          <DrawerBody py={6}>
            <Text fontSize="sm" fontWeight="600" color="myGray.600" mb={3}>
              基础信息
            </Text>
            <Grid gap={3} mb={6}>
              <FormControl isRequired>
                <FormLabel fontSize="xs">模型 ID</FormLabel>
                <Input value={draft.id} onChange={(e) => setDraft((prev) => ({ ...prev, id: e.target.value }))} placeholder="例如：claude-3-opus-20240229" />
              </FormControl>
              <FormControl>
                <FormLabel fontSize="xs">显示名称</FormLabel>
                <Input value={draft.label || ""} onChange={(e) => setDraft((prev) => ({ ...prev, label: e.target.value }))} placeholder="例如：Claude 3 Opus" />
              </FormControl>
            </Grid>

            <Text fontSize="sm" fontWeight="600" color="myGray.600" mb={3}>
              连接配置
            </Text>
            <Grid gap={3} mb={6}>
              <FormControl>
                <FormLabel fontSize="xs">协议</FormLabel>
                <Select value={draft.protocol || "openai"} onChange={(e) => setDraft((prev) => ({ ...prev, protocol: e.target.value }))}>
                  <option value="openai">OpenAI API</option>
                  <option value="anthropic">Anthropic API</option>
                </Select>
              </FormControl>
              <FormControl isRequired>
                <FormLabel fontSize="xs">Base URL</FormLabel>
                <Input value={draft.baseUrl || ""} onChange={(e) => setDraft((prev) => ({ ...prev, baseUrl: e.target.value }))} placeholder="https://api.openai.com/v1" autoComplete="off" inputMode="url" />
              </FormControl>
              <FormControl isRequired>
                <FormLabel fontSize="xs">API Key</FormLabel>
                <Input type="password" value={draft.key || ""} onChange={(e) => setDraft((prev) => ({ ...prev, key: e.target.value }))} autoComplete="new-password" spellCheck={false} />
              </FormControl>
              <FormControl>
                <FormLabel fontSize="xs">最大上下文</FormLabel>
                <Input
                  type="number"
                  min={1}
                  step={1000}
                  value={draft.maxContext ?? ""}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      maxContext: e.target.value ? Number(e.target.value) : undefined,
                    }))
                  }
                  placeholder="例如：128000"
                />
              </FormControl>
            </Grid>

            <Text fontSize="sm" fontWeight="600" color="myGray.600" mb={3}>
              图标与能力
            </Text>
            <Grid gap={3}>
              <FormControl>
                <FormLabel fontSize="xs">图标</FormLabel>
                <Box border="1px solid" borderColor="myGray.200" borderRadius="md" p={2}>
                  <Flex wrap="wrap" gap={2}>
                    {Array.from(new Set(["auto.svg", ...iconOptions])).map((icon) => {
                      const active = (draft.icon || "auto.svg") === icon;
                      return (
                        <Button
                          key={icon}
                          size="xs"
                          variant="ghost"
                          minW="36px"
                          h="36px"
                          p={0}
                          borderRadius="md"
                          border="1px solid"
                          borderColor={active ? "green.400" : "myGray.200"}
                          bg={active ? "green.50" : "white"}
                          onClick={() => setDraft((prev) => ({ ...prev, icon }))}
                        >
                          <Box as="img" src={resolveIconSrc(icon)} w="16px" h="16px" />
                        </Button>
                      );
                    })}
                  </Flex>
                </Box>
              </FormControl>
              <Flex gap={6}>
                <Checkbox isChecked={Boolean(draft.reasoning)} onChange={(e) => setDraft((prev) => ({ ...prev, reasoning: e.target.checked }))}>
                  思考模型
                </Checkbox>
                <Checkbox isChecked={Boolean(draft.vision)} onChange={(e) => setDraft((prev) => ({ ...prev, vision: e.target.checked }))}>
                  支持视觉
                </Checkbox>
              </Flex>
            </Grid>
          </DrawerBody>

          <Divider />
          <DrawerFooter gap={3}>
            <Button variant="outline" onClick={drawer.onClose}>
              取消
            </Button>
            <Button bg="green.500" color="white" _hover={{ bg: "green.600" }} _active={{ bg: "green.700" }} isLoading={saving} onClick={commitDraft}>
              {editingIndex === null ? "保存模型" : "更新模型"}
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </Flex>
  );
});

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AlertDialog,
  AlertDialogBody,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogOverlay,
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
  IconButton,
  Input,
  Select,
  Text,
  Tooltip,
  useDisclosure,
  useToast,
} from "@chakra-ui/react";
import { withAuthHeaders } from "@features/auth/client/authClient";
import {
  EmptyIcon,
  CloseIcon,
  EditCustomIcon,
  ModelContextIcon,
  ModelProtocolIcon,
  ModelReasoningIcon,
  ModelVisionIcon,
  SearchIcon,
} from "@components/common/Icon";

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
  scopeFilter?: "all" | "user" | "system";
  onModelClick?: (model: {
    modelId: string;
    label: string;
    icon?: string;
    scope: "user" | "system";
  }) => void;
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
  scopeFilter,
  onModelClick,
}: AccountModelConfigPanelProps, ref) {
  const toast = useToast();
  const drawer = useDisclosure();
  const deleteDialog = useDisclosure();
  const cancelDeleteRef = useRef<HTMLButtonElement>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [iconOptions, setIconOptions] = useState<string[]>([]);
  const [models, setModels] = useState<EditableModelConfig[]>([]);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [deleteIndex, setDeleteIndex] = useState<number | null>(null);
  const [draft, setDraft] = useState<EditableModelConfig>(createEmptyModel());
  const [innerSearchValue, setInnerSearchValue] = useState("");

  const effectiveSearchValue = typeof searchValue === "string" ? searchValue : innerSearchValue;
  const keyword = effectiveSearchValue.trim().toLowerCase();

  const filteredModels = useMemo(() => {
    const list = models.map((item, index) => ({ item, index }));
    const byScope = typeof scopeFilter === "string" && scopeFilter !== "all"
      ? list.filter(({ item }) => (item.scope || "user") === scopeFilter)
      : list;
    if (!keyword) return byScope;
    return byScope.filter(({ item }) => {
      const label = (item.label || "").toLowerCase();
      const id = (item.id || "").toLowerCase();
      const protocol = (item.protocol || "").toLowerCase();
      return label.includes(keyword) || id.includes(keyword) || protocol.includes(keyword);
    });
  }, [keyword, models, scopeFilter]);

  const actionBtnSx = {
    variant: "ghost" as const,
    boxSize: "32px",
    minW: "32px",
    borderRadius: "10px",
    border: "1px solid",
    borderColor: "myGray.250",
    bg: "rgba(255,255,255,0.92)",
    color: "myGray.500",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.92)",
    transition: "all 0.22s cubic-bezier(0.2, 0.65, 0.2, 1)",
    _hover: {
      transform: "translateY(-1px)",
      borderColor: "primary.300",
      bg: "rgba(242,251,244,0.92)",
      color: "primary.700",
      boxShadow: "0 8px 16px -12px rgba(50,165,73,0.45)",
    },
    _active: {
      transform: "translateY(0)",
      boxShadow: "inset 0 1px 2px rgba(17,24,36,0.12)",
    },
  };

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
    if (!maxContext) {
      toast({ title: "请填写最大上下文", status: "warning", duration: 2000 });
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
    setDeleteIndex(index);
    deleteDialog.onOpen();
  };

  const confirmDelete = () => {
    if (deleteIndex === null) return;
    const nextModels = models.filter((_, idx) => idx !== deleteIndex);
    void persistModels(nextModels, "模型已删除");
    setDeleteIndex(null);
    deleteDialog.onClose();
  };

  const closeDeleteDialog = () => {
    setDeleteIndex(null);
    deleteDialog.onClose();
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
          px={1}
          py={1}
          flex={fillParent ? 1 : undefined}
          minH={fillParent ? 0 : undefined}
          maxH={fillParent ? "none" : tableMaxHeight}
          overflowY={loading || filteredModels.length === 0 ? "visible" : "auto"}
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
            <Grid
              templateColumns={{
                base: "1fr",
                md: "repeat(2, minmax(0, 1fr))",
                xl: "repeat(3, minmax(0, 1fr))",
                "2xl": "repeat(4, minmax(0, 1fr))",
              }}
              gap={4}
            >
              {filteredModels.map(({ item, index }) => (
                <Box
                  key={`${item.id}-${index}`}
                  position="relative"
                  border="1px solid var(--ws-border)"
                  borderRadius="24px"
                  bg="linear-gradient(140deg, rgba(255,255,255,0.78) 0%, rgba(245,250,248,0.88) 100%)"
                  px={4}
                  py={3.5}
                  transition="all 0.18s ease"
                  cursor={onModelClick ? "pointer" : "default"}
                  _hover={{
                    boxShadow: "var(--ws-glow-soft)",
                    transform: "translateY(-1px)",
                  }}
                  onClick={() => {
                    if (!onModelClick) return;
                    onModelClick({
                      modelId: item.id,
                      label: item.label || item.id,
                      icon: item.icon,
                      scope: (item.scope || "user") as "user" | "system",
                    });
                  }}
                >
                  {item.scope !== "system" ? (
                    <Flex position="absolute" top={3} right={3} gap={1.5} zIndex={2}>
                      <Tooltip label="编辑">
                        <IconButton
                          aria-label="编辑"
                          {...actionBtnSx}
                          icon={<Box as={EditCustomIcon} w={3.5} h={3.5} />}
                          onClick={(event) => {
                            event.stopPropagation();
                            openEditDrawer(index);
                          }}
                          isDisabled={saving}
                        />
                      </Tooltip>
                      <Tooltip label="删除">
                        <IconButton
                          aria-label="删除"
                          {...actionBtnSx}
                          _hover={{
                            ...actionBtnSx._hover,
                            borderColor: "red.300",
                            bg: "rgba(254,243,242,0.92)",
                            color: "red.600",
                            boxShadow: "0 8px 16px -12px rgba(217,45,32,0.45)",
                          }}
                          icon={<Box as={CloseIcon} w={3.5} h={3.5} />}
                          onClick={(event) => {
                            event.stopPropagation();
                            handleDelete(index);
                          }}
                          isDisabled={saving}
                        />
                      </Tooltip>
                    </Flex>
                  ) : null}

                  <Flex align="center" gap={3}>
                    <Box
                      w="44px"
                      h="44px"
                      borderRadius="14px"
                      bg="rgba(134, 239, 172, 0.16)"
                      border="1px solid rgba(74, 222, 128, 0.45)"
                      display="flex"
                      alignItems="center"
                      justifyContent="center"
                      flexShrink={0}
                    >
                      <Box as="img" src={resolveIconSrc(item.icon)} w="20px" h="20px" />
                    </Box>
                    <Box minW={0}>
                      <Text fontSize="lg" lineHeight="1.2" fontWeight="800" color="var(--ws-text-main)" noOfLines={1}>
                        {item.label || item.id}
                      </Text>
                      <Text mt={1} fontSize="xs" color="var(--ws-text-subtle)" noOfLines={1}>
                        {item.id}
                      </Text>
                    </Box>
                  </Flex>

                  <Divider my={4} borderColor="var(--ws-border)" />

                  <Flex wrap="wrap" gap={2.5}>
                    <Badge
                      px={2.5}
                      py={1}
                      borderRadius="999px"
                      bg="rgba(226, 232, 240, 0.7)"
                      color="var(--ws-text-main)"
                      border="1px solid var(--ws-border)"
                      display="inline-flex"
                      alignItems="center"
                      gap={1}
                      fontSize="11px"
                    >
                      <Box as={ModelProtocolIcon} w={3} h={3} />
                      {(item.protocol || "openai").toUpperCase()}
                    </Badge>
                    <Badge
                      px={2.5}
                      py={1}
                      borderRadius="999px"
                      bg="rgba(226, 232, 240, 0.7)"
                      color="var(--ws-text-main)"
                      border="1px solid var(--ws-border)"
                      display="inline-flex"
                      alignItems="center"
                      gap={1}
                      fontSize="11px"
                    >
                      <Box as={ModelContextIcon} w={3} h={3} />
                      {formatContextWindow(item.maxContext)}
                    </Badge>
                    <Badge
                      px={2.5}
                      py={1}
                      borderRadius="999px"
                      bg={item.reasoning ? "var(--ws-accent-soft)" : "rgba(148, 163, 184, 0.16)"}
                      color={item.reasoning ? "var(--ws-accent)" : "var(--ws-text-subtle)"}
                      border={item.reasoning ? "1px solid var(--ws-accent-border)" : "1px solid var(--ws-border)"}
                      display="inline-flex"
                      alignItems="center"
                      gap={1}
                      fontSize="11px"
                    >
                      <Box as={ModelReasoningIcon} w={3} h={3} />
                      {item.reasoning ? "思考" : "无思考"}
                    </Badge>
                    <Badge
                      px={2.5}
                      py={1}
                      borderRadius="999px"
                      bg={item.vision ? "var(--ws-accent-soft)" : "rgba(148, 163, 184, 0.16)"}
                      color={item.vision ? "var(--ws-accent)" : "var(--ws-text-subtle)"}
                      border={item.vision ? "1px solid var(--ws-accent-border)" : "1px solid var(--ws-border)"}
                      display="inline-flex"
                      alignItems="center"
                      gap={1}
                      fontSize="11px"
                    >
                      <Box as={ModelVisionIcon} w={3} h={3} />
                      {item.vision ? "视觉" : "无视觉"}
                    </Badge>
                  </Flex>
                </Box>
              ))}
            </Grid>
          )}
        </Box>
      </Box>

      <AlertDialog
        isOpen={deleteDialog.isOpen}
        onClose={closeDeleteDialog}
        leastDestructiveRef={cancelDeleteRef}
        isCentered
      >
        <AlertDialogOverlay bg="blackAlpha.400">
          <AlertDialogContent
            borderRadius="xl"
            border="1px solid rgba(255,255,255,0.65)"
            bg="rgba(255,255,255,0.95)"
            backdropFilter="blur(18px)"
          >
            <AlertDialogHeader color="myGray.800">删除模型</AlertDialogHeader>
            <AlertDialogBody color="myGray.700">
              {`确定删除模型「${deleteIndex !== null ? models[deleteIndex]?.label || models[deleteIndex]?.id || "" : ""}」吗？此操作无法撤销。`}
            </AlertDialogBody>
            <AlertDialogFooter gap={2}>
              <Button ref={cancelDeleteRef} variant="ghost" onClick={closeDeleteDialog}>
                取消
              </Button>
              <Button
                colorScheme="red"
                onClick={confirmDelete}
                isLoading={saving}
              >
                删除
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialogOverlay>
      </AlertDialog>

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
                  <option value="google">Google API</option>
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
              <FormControl isRequired>
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

import { useCallback, useEffect, useState } from "react";
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
import { EmptyIcon } from "@components/common/Icon";

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

export function AccountModelConfigPanel() {
  const toast = useToast();
  const drawer = useDisclosure();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [iconOptions, setIconOptions] = useState<string[]>([]);
  const [models, setModels] = useState<EditableModelConfig[]>([]);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [draft, setDraft] = useState<EditableModelConfig>(createEmptyModel());

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
      setIconOptions(data.iconOptions || []);
      setModels(
        (data.models || []).map((item) => ({
          id: item.id || "",
          label: item.label || item.id || "",
          icon: item.icon || "auto.svg",
          protocol: item.protocol || "openai",
          baseUrl: item.baseUrl || "",
          key: item.key || "",
          maxContext: typeof item.maxContext === "number" ? item.maxContext : undefined,
          reasoning: Boolean(item.reasoning),
          vision: Boolean(item.vision),
        }))
      );
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

  const openCreateDrawer = () => {
    setEditingIndex(null);
    setDraft(createEmptyModel());
    drawer.onOpen();
  };

  const openEditDrawer = (index: number) => {
    setEditingIndex(index);
    setDraft(models[index]);
    drawer.onOpen();
  };

  const commitDraft = () => {
    const id = draft.id.trim();
    const label = (draft.label || "").trim();
    const baseUrl = (draft.baseUrl || "").trim();
    const key = (draft.key || "").trim();
    const maxContext = Number.isFinite(Number(draft.maxContext)) && Number(draft.maxContext) > 0
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

    const nextModels = editingIndex === null
      ? [...models, nextItem]
      : models.map((item, idx) => (idx === editingIndex ? nextItem : item));

    if (nextModels.some((item) => !item.id.trim())) {
      toast({ title: "存在空的模型 ID", status: "warning", duration: 2200 });
      return;
    }
    const nextDuplicate = (() => {
      const countById = new Map<string, number>();
      nextModels.forEach((item) => {
        const modelId = item.id.trim();
        if (!modelId) return;
        countById.set(modelId, (countById.get(modelId) || 0) + 1);
      });
      return Array.from(countById.entries()).find(([, count]) => count > 1)?.[0] || "";
    })();
    if (nextDuplicate) {
      toast({ title: `模型 ID 重复: ${nextDuplicate}`, status: "warning", duration: 2200 });
      return;
    }

    void persistModels(nextModels, editingIndex === null ? "模型已新增" : "模型已更新", true);
  };

  const handleDelete = (index: number) => {
    const nextModels = models.filter((_, idx) => idx !== index);
    void persistModels(nextModels, "模型已删除");
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
          models: nextModels.map((item) => ({
            id: item.id.trim(),
            label: (item.label || "").trim() || item.id.trim(),
            icon: (item.icon || "").trim() || "auto.svg",
            protocol: (item.protocol || "").trim() || "openai",
            baseUrl: (item.baseUrl || "").trim(),
            key: (item.key || "").trim(),
            maxContext: Number.isFinite(Number(item.maxContext)) && Number(item.maxContext) > 0
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

  return (
    <Flex h="100%" direction="column">
      <Box overflow="hidden" bg="transparent" h="100%" display="flex" flexDirection="column" minH={0}>
        <Flex mb={4} justify="space-between" align="center" pr={14}>
          <Box>
            <Text fontSize="2xl" lineHeight="1.2" fontWeight="700" color="myGray.800">
              模型配置
            </Text>
          </Box>
          <Button
            size="md"
            borderRadius="xl"
            px={6}
            bg="green.500"
            color="white"
            _hover={{ bg: "green.600" }}
            _active={{ bg: "green.700" }}
            onClick={openCreateDrawer}
          >
            + 新增模型
          </Button>
        </Flex>

        <Box
          border="1px solid"
          borderColor="myGray.200"
          borderRadius="xl"
          bg="white"
          overflow="hidden"
          display="flex"
          flexDirection="column"
          minH={0}
          flex={1}
        >
          <Box px={4} py={2}>
            <Grid
              templateColumns="64px minmax(260px, 2.2fr) minmax(120px, 1fr) minmax(120px, 1fr) minmax(90px, 0.9fr) minmax(90px, 0.9fr) minmax(110px, 1fr)"
              gap={3}
              py={2}
              borderBottom="1px solid"
              borderColor="myGray.200"
            >
              <Text fontSize="sm" fontWeight="600" color="myGray.500">图标</Text>
              <Text fontSize="sm" fontWeight="600" color="myGray.500">名称</Text>
              <Text fontSize="sm" fontWeight="600" color="myGray.500" textAlign="center">协议</Text>
              <Text fontSize="sm" fontWeight="600" color="myGray.500" textAlign="center">最大上下文</Text>
              <Text fontSize="sm" fontWeight="600" color="myGray.500" textAlign="center">思考</Text>
              <Text fontSize="sm" fontWeight="600" color="myGray.500" textAlign="center">视觉</Text>
              <Text fontSize="sm" fontWeight="600" color="myGray.500" textAlign="right">操作</Text>
            </Grid>
          </Box>

          <Box
            px={4}
            flex={1}
            minH="280px"
            maxH="38vh"
            overflowY={loading || models.length === 0 ? "hidden" : "auto"}
            display="flex"
            flexDirection="column"
          >
            {loading ? (
              <Flex flex={1} align="center" justify="center">
                <Text fontSize="sm" color="myGray.500">加载中...</Text>
              </Flex>
            ) : models.length === 0 ? (
              <Flex direction="column" align="center" justify="center" flex={1}>
                <Box mb={5}>
                  <Box as={EmptyIcon} w="140px" h="116px" />
                </Box>
                <Text fontSize="md" color="myGray.700" fontWeight="600" mb={2}>
                  暂无模型
                </Text>
                <Text fontSize="sm" color="myGray.500">
                  点击右上角“新增模型”开始配置。
                </Text>
              </Flex>
            ) : (
              models.map((item, index) => (
                <Grid
                  key={`${item.id}-${index}`}
                  templateColumns="64px minmax(260px, 2.2fr) minmax(120px, 1fr) minmax(120px, 1fr) minmax(90px, 0.9fr) minmax(90px, 0.9fr) minmax(110px, 1fr)"
                  gap={3}
                  py={2}
                  alignItems="center"
                  borderBottom={index === models.length - 1 ? "none" : "1px solid"}
                  borderColor="myGray.200"
                >
                  <Box w="40px" h="40px" borderRadius="10px" bg="green.50" border="1px solid" borderColor="myGray.200" display="flex" alignItems="center" justifyContent="center">
                    <Box as="img" src={resolveIconSrc(item.icon)} w="18px" h="18px" />
                  </Box>
                  <Box minW={0}>
                    <Text fontSize="md" lineHeight="1.2" fontWeight="600" color="myGray.800" noOfLines={1}>
                      {item.label || item.id}
                    </Text>
                    <Text mt={1} fontSize="xs" color="myGray.500" noOfLines={1}>
                      ID: {item.id}
                    </Text>
                  </Box>
                  <Badge w="fit-content" px={2} py={1} borderRadius="md" justifySelf="center">
                    {(item.protocol || "openai").toUpperCase()}
                  </Badge>
                  <Text fontSize="sm" color="myGray.700" textAlign="center">
                    {item.maxContext ? `${Math.round(item.maxContext / 1000)}k` : "-"}
                  </Text>
                  <Badge colorScheme={item.reasoning ? "green" : "gray"} w="fit-content" justifySelf="center">
                    {item.reasoning ? "是" : "否"}
                  </Badge>
                  <Badge colorScheme={item.vision ? "green" : "gray"} w="fit-content" justifySelf="center">
                    {item.vision ? "是" : "否"}
                  </Badge>
                  <Flex justify="flex-end" gap={1}>
                    <Button size="xs" variant="ghost" onClick={() => openEditDrawer(index)} isDisabled={saving}>编辑</Button>
                    <Button size="xs" variant="ghost" colorScheme="red" onClick={() => handleDelete(index)} isDisabled={saving}>删除</Button>
                  </Flex>
                </Grid>
              ))
            )}
          </Box>
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
                <Input
                  value={draft.id}
                  onChange={(e) => setDraft((prev) => ({ ...prev, id: e.target.value }))}
                  placeholder="例如：claude-3-opus-20240229"
                />
              </FormControl>
              <FormControl>
                <FormLabel fontSize="xs">显示名称</FormLabel>
                <Input
                  value={draft.label || ""}
                  onChange={(e) => setDraft((prev) => ({ ...prev, label: e.target.value }))}
                  placeholder="例如：Claude 3 Opus"
                />
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
                <Input
                  value={draft.baseUrl || ""}
                  onChange={(e) => setDraft((prev) => ({ ...prev, baseUrl: e.target.value }))}
                  placeholder="https://api.openai.com/v1"
                  autoComplete="off"
                  inputMode="url"
                />
              </FormControl>
              <FormControl isRequired>
                <FormLabel fontSize="xs">API Key</FormLabel>
                <Input
                  type="password"
                  value={draft.key || ""}
                  onChange={(e) => setDraft((prev) => ({ ...prev, key: e.target.value }))}
                  autoComplete="new-password"
                  spellCheck={false}
                />
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
                <Checkbox
                  isChecked={Boolean(draft.reasoning)}
                  onChange={(e) => setDraft((prev) => ({ ...prev, reasoning: e.target.checked }))}
                >
                  思考模型
                </Checkbox>
                <Checkbox
                  isChecked={Boolean(draft.vision)}
                  onChange={(e) => setDraft((prev) => ({ ...prev, vision: e.target.checked }))}
                >
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
            <Button
              bg="green.500"
              color="white"
              _hover={{ bg: "green.600" }}
              _active={{ bg: "green.700" }}
              isLoading={saving}
              onClick={commitDraft}
            >
              {editingIndex === null ? "保存模型" : "更新模型"}
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </Flex>
  );
}

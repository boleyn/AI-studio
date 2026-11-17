import { useEffect, useId, useState } from "react";
import {
  Badge,
  Box,
  Button,
  Code,
  FormControl,
  FormLabel,
  HStack,
  IconButton,
  Input,
  InputGroup,
  InputRightElement,
  Text,
  Tooltip,
  useToast,
  VStack,
} from "@chakra-ui/react";
import { AppDialog, AppSectionCard } from "../ui";
import {
  CheckCircle2,
  Copy,
  Eye,
  EyeOff,
  HardDrive,
  RefreshCw,
  Server,
  Sparkles,
  Wifi,
  WifiOff,
  Laptop,
  FolderCheck,
  Link2,
  Download,
} from "lucide-react";
import { withAuthHeaders } from "@features/auth/client/authClient";

export type ProjectRuntimeConfig = {
  sandboxKind: "remote-vm" | "connector";
  connectorUrl: string;
  connectorToken: string;
  connectorTested?: boolean;
  connectorLatencyMs?: number;
  deviceId?: string;
  deviceName?: string;
  grantId?: string;
  workdir?: string;
  /** 预留：阶段 1 远程虚拟机按项目分配后的实例元数据 */
  vmStatus?: "ready" | "allocating" | "sleeping";
};

type PairedDeviceItem = {
  deviceId: string;
  name: string;
  platform: string;
  online: boolean;
};

type DeviceGrantItem = {
  grantId: string;
  deviceId: string;
  workdir: string;
  revoked: boolean;
};

export const DEFAULT_RUNTIME_CONFIG: ProjectRuntimeConfig = {
  sandboxKind: "remote-vm",
  connectorUrl: "http://127.0.0.1:8787",
  connectorToken: "",
  vmStatus: "ready",
};

const STORAGE_PREFIX = "aistudio:workspace-runtime:";

export function loadProjectRuntimeConfig(projectToken: string): ProjectRuntimeConfig {
  if (typeof window === "undefined" || !projectToken) return { ...DEFAULT_RUNTIME_CONFIG };
  try {
    const raw = window.localStorage.getItem(`${STORAGE_PREFIX}${projectToken}`);
    if (!raw) return { ...DEFAULT_RUNTIME_CONFIG };
    const parsed = JSON.parse(raw) as Partial<ProjectRuntimeConfig>;
    return {
      sandboxKind: parsed.sandboxKind === "connector" ? "connector" : "remote-vm",
      connectorUrl:
        typeof parsed.connectorUrl === "string" && parsed.connectorUrl.trim()
          ? parsed.connectorUrl.trim()
          : DEFAULT_RUNTIME_CONFIG.connectorUrl,
      connectorToken: typeof parsed.connectorToken === "string" ? parsed.connectorToken : "",
      connectorTested: Boolean(parsed.connectorTested),
      connectorLatencyMs: typeof parsed.connectorLatencyMs === "number" ? parsed.connectorLatencyMs : undefined,
      deviceId: typeof parsed.deviceId === "string" ? parsed.deviceId : undefined,
      deviceName: typeof parsed.deviceName === "string" ? parsed.deviceName : undefined,
      grantId: typeof parsed.grantId === "string" ? parsed.grantId : undefined,
      workdir: typeof parsed.workdir === "string" ? parsed.workdir : undefined,
      vmStatus: parsed.vmStatus || "ready",
    };
  } catch {
    return { ...DEFAULT_RUNTIME_CONFIG };
  }
}

export function saveProjectRuntimeConfig(projectToken: string, config: ProjectRuntimeConfig): void {
  if (typeof window === "undefined" || !projectToken) return;
  try {
    window.localStorage.setItem(`${STORAGE_PREFIX}${projectToken}`, JSON.stringify(config));
  } catch {
    // ignore storage quota errors
  }
}

const generateConnectorToken = () => {
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const bytes = new Uint8Array(18);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  return `conn_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
};

type WorkspaceRuntimeModalProps = {
  isOpen: boolean;
  onClose: () => void;
  projectName: string;
  projectToken: string;
  config: ProjectRuntimeConfig;
  onSave: (next: ProjectRuntimeConfig) => void;
  onTestConnector: (url: string, token: string) => Promise<{ ok: boolean; latencyMs?: number; error?: string }>;
};

export default function WorkspaceRuntimeModal({
  isOpen,
  onClose,
  projectName,
  projectToken,
  config,
  onSave,
  onTestConnector,
}: WorkspaceRuntimeModalProps) {
  const toast = useToast();
  const urlInputId = useId();
  const tokenInputId = useId();

  const [draft, setDraft] = useState<ProjectRuntimeConfig>(config);
  const [showToken, setShowToken] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [devices, setDevices] = useState<PairedDeviceItem[]>([]);
  const [grants, setGrants] = useState<DeviceGrantItem[]>([]);
  const [loadingDevices, setLoadingDevices] = useState(false);
  const [pairingLocal, setPairingLocal] = useState(false);
  const [requestingGrantId, setRequestingGrantId] = useState<string | null>(null);
  const [showLegacyHttp, setShowLegacyHttp] = useState(false);

  const loadDevicesAndGrants = async () => {
    setLoadingDevices(true);
    try {
      const [devRes, grantRes] = await Promise.all([
        fetch("/api/core/localDevice/manage", {
          headers: withAuthHeaders({}),
        }),
        projectToken
          ? fetch("/api/core/localDevice/grant", {
              method: "POST",
              headers: withAuthHeaders({ "content-type": "application/json" }),
              body: JSON.stringify({ action: "list", appId: projectToken }),
            })
          : Promise.resolve(null),
      ]);
      if (devRes.ok) {
        const data = (await devRes.json()) as { devices?: PairedDeviceItem[] };
        setDevices(Array.isArray(data.devices) ? data.devices : []);
      }
      if (grantRes && grantRes.ok) {
        const data = (await grantRes.json()) as { grants?: DeviceGrantItem[] };
        setGrants(Array.isArray(data.grants) ? data.grants : []);
      }
    } catch {
      // ignore
    } finally {
      setLoadingDevices(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      setDraft(config);
      setShowToken(false);
      setShowLegacyHttp(Boolean(!config.deviceId && config.connectorTested));
      void loadDevicesAndGrants();
      setTestResult(
        config.connectorTested
          ? {
              ok: true,
              message:
                typeof config.connectorLatencyMs === "number"
                  ? `上次检测连通正常 (${config.connectorLatencyMs} ms)`
                  : "上次检测连通正常",
            }
          : null,
      );
    }
  }, [config, isOpen]);

  const handlePairLocalBridge = async () => {
    setPairingLocal(true);
    try {
      const bridgeRes = await fetch("http://127.0.0.1:13005/pair", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ platformUrl: window.location.origin }),
      });
      if (!bridgeRes.ok) {
        throw new Error("未检测到本机连接器客户端，请先启动桌面端连接器");
      }
      const bridgeData = (await bridgeRes.json()) as {
        pairingId?: string;
        confirmationCode?: string;
        name?: string;
      };
      if (!bridgeData.pairingId || !bridgeData.confirmationCode) {
        throw new Error("本机配对桥返回格式异常");
      }
      const confirmRes = await fetch("/api/core/localDevice/pair", {
        method: "POST",
        headers: withAuthHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({
          action: "confirm",
          pairingId: bridgeData.pairingId,
          confirmationCode: bridgeData.confirmationCode,
          deviceLabel: bridgeData.name,
        }),
      });
      if (!confirmRes.ok) {
        const err = (await confirmRes.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error || "绑定本机电脑失败");
      }
      toast({ title: "已绑定本机电脑", status: "success", duration: 2500 });
      await loadDevicesAndGrants();
    } catch (err) {
      toast({
        title: "连接本机电脑失败",
        description: err instanceof Error ? err.message : String(err),
        status: "error",
        duration: 3500,
      });
    } finally {
      setPairingLocal(false);
    }
  };

  const handleRequestDeviceGrant = async (device: PairedDeviceItem) => {
    setRequestingGrantId(device.deviceId);
    try {
      const res = await fetch("/api/core/localDevice/grant", {
        method: "POST",
        headers: withAuthHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({
          action: "request",
          appId: projectToken,
          deviceId: device.deviceId,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        grant?: { grantId: string; workdir: string };
        error?: string;
      };
      if (!res.ok || !data.grant) {
        throw new Error(data.error || "未获得本机目录授权");
      }
      setDraft((prev) => ({
        ...prev,
        deviceId: device.deviceId,
        deviceName: device.name,
        grantId: data.grant!.grantId,
        workdir: data.grant!.workdir,
      }));
      toast({
        title: `已授权目录：${data.grant.workdir}`,
        status: "success",
        duration: 2500,
      });
      await loadDevicesAndGrants();
    } catch (err) {
      toast({
        title: "目录授权未完成",
        description: err instanceof Error ? err.message : String(err),
        status: "error",
        duration: 3000,
      });
    } finally {
      setRequestingGrantId(null);
    }
  };

  const effectiveToken = draft.connectorToken.trim() || "<YOUR_CONNECTOR_TOKEN>";
  const displayToken = draft.connectorToken.trim()
    ? showToken
      ? draft.connectorToken.trim()
      : `${draft.connectorToken.trim().slice(0, 4)}••••••••`
    : "<YOUR_CONNECTOR_TOKEN>";
  const launchCommand = `AISTUDIO_CONNECTOR_ROOT=~/workspace AISTUDIO_CONNECTOR_TOKEN=${effectiveToken} bun run connector`;
  const displayLaunchCommand = `AISTUDIO_CONNECTOR_ROOT=~/workspace AISTUDIO_CONNECTOR_TOKEN=${displayToken} bun run connector`;

  const handleCopyCommand = async () => {
    try {
      await navigator.clipboard.writeText(launchCommand);
      toast({ title: "已复制本机启动命令", status: "success", duration: 2000 });
    } catch {
      toast({ title: "复制失败，请手动复制", status: "warning", duration: 2000 });
    }
  };

  const handleGenerateToken = () => {
    const nextToken = generateConnectorToken();
    setDraft((prev) => ({ ...prev, connectorToken: nextToken, connectorTested: false }));
    setTestResult(null);
  };

  const handleTest = async () => {
    const url = draft.connectorUrl.trim();
    if (!url) {
      setTestResult({ ok: false, message: "请先填写连接器地址" });
      return;
    }
    setTesting(true);
    try {
      const result = await onTestConnector(url, draft.connectorToken.trim());
      if (result.ok) {
        setDraft((prev) => ({
          ...prev,
          connectorTested: true,
          connectorLatencyMs: result.latencyMs,
        }));
        setTestResult({
          ok: true,
          message:
            typeof result.latencyMs === "number"
              ? `连接成功（${result.latencyMs} ms）`
              : "连接成功，本机工作目录已就绪",
        });
      } else {
        setDraft((prev) => ({ ...prev, connectorTested: false, connectorLatencyMs: undefined }));
        setTestResult({ ok: false, message: result.error || "连接失败，请确认本机连接器已启动" });
      }
    } finally {
      setTesting(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const normalized: ProjectRuntimeConfig = {
      ...draft,
      connectorUrl: draft.connectorUrl.trim() || DEFAULT_RUNTIME_CONFIG.connectorUrl,
      connectorToken: draft.connectorToken.trim(),
    };
    onSave(normalized);
    onClose();
  };

  return (
    <AppDialog
      isOpen={isOpen}
      onClose={onClose}
      size="lg"
      title={
        <HStack spacing={2}>
          <Text>项目执行环境</Text>
          <Badge bg="surface.hover" color="ink.secondary" fontWeight="500" fontSize="11px" px={2} py={0.5}>
            {projectName}
          </Badge>
        </HStack>
      }
      subtitle="每个项目可独立绑定运行环境，切换项目时会自动恢复对应配置。"
      onSubmit={handleSubmit}
      footer={
        <>
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            取消
          </Button>
          <Button type="submit" variant="primary" size="sm">
            保存并应用
          </Button>
        </>
      }
    >
      <VStack align="stretch" spacing={4}>
        {/* 双模式选择卡片 */}
        <HStack spacing={3} align="stretch">
          <Box
            as="button"
            type="button"
            flex="1"
            textAlign="left"
            p={3.5}
            borderRadius="12px"
            border="1.5px solid"
            borderColor={draft.sandboxKind === "remote-vm" ? "ink.primary" : "stroke.subtle"}
            bg={draft.sandboxKind === "remote-vm" ? "surface.sidebar" : "white"}
            transition="all 0.15s"
            _hover={{ borderColor: draft.sandboxKind === "remote-vm" ? "ink.primary" : "rgba(0,0,0,0.22)" }}
            onClick={() => setDraft((prev) => ({ ...prev, sandboxKind: "remote-vm" }))}
          >
            <HStack justify="space-between" mb={1.5}>
              <HStack spacing={2}>
                <Server size={16} color={draft.sandboxKind === "remote-vm" ? "#0d0d0d" : "#5d5d5d"} />
                <Text fontSize="14px" fontWeight="600" color="ink.primary">
                  远程虚拟机
                </Text>
              </HStack>
              {draft.sandboxKind === "remote-vm" && <CheckCircle2 size={15} color="#0d0d0d" />}
            </HStack>
            <Text fontSize="12px" color="ink.secondary" lineHeight="1.45">
              按项目分配云端隔离工作区，文件与成果自动持久化到云端存储。
            </Text>
          </Box>

          <Box
            as="button"
            type="button"
            flex="1"
            textAlign="left"
            p={3.5}
            borderRadius="12px"
            border="1.5px solid"
            borderColor={draft.sandboxKind === "connector" ? "ink.primary" : "stroke.subtle"}
            bg={draft.sandboxKind === "connector" ? "surface.sidebar" : "white"}
            transition="all 0.15s"
            _hover={{ borderColor: draft.sandboxKind === "connector" ? "ink.primary" : "rgba(0,0,0,0.22)" }}
            onClick={() => setDraft((prev) => ({ ...prev, sandboxKind: "connector" }))}
          >
            <HStack justify="space-between" mb={1.5}>
              <HStack spacing={2}>
                <HardDrive size={16} color={draft.sandboxKind === "connector" ? "#0d0d0d" : "#5d5d5d"} />
                <Text fontSize="14px" fontWeight="600" color="ink.primary">
                  本机连接器
                </Text>
              </HStack>
              {draft.sandboxKind === "connector" && <CheckCircle2 size={15} color="#0d0d0d" />}
            </HStack>
            <Text fontSize="12px" color="ink.secondary" lineHeight="1.45">
              挂载你自己的电脑目录，Agent 直接在本机读写代码与运行命令。
            </Text>
          </Box>
        </HStack>

        {draft.sandboxKind === "remote-vm" ? (
          <AppSectionCard>
            <HStack justify="space-between" mb={1.5}>
              <Text fontSize="13px" fontWeight="600" color="ink.primary">
                项目虚拟机实例
              </Text>
              <Badge colorScheme="green" variant="subtle" fontSize="11px" px={2}>
                已就绪 · 项目隔离
              </Badge>
            </HStack>
            <Text fontSize="12px" color="ink.secondary">
              工作区标识：<Code fontSize="11px">{projectToken || "default"}</Code>
            </Text>
            <Text fontSize="12px" color="ink.muted" mt={1}>
              所有终端命令、Python/Node 脚本及生成文件均在专属沙盒环境中运行。
            </Text>
          </AppSectionCard>
        ) : (
          <AppSectionCard>
            <VStack align="stretch" spacing={3}>
              <HStack justify="space-between" flexWrap="wrap" gap={2}>
                <HStack spacing={2}>
                  <Laptop size={15} color="#0d0d0d" />
                  <Text fontSize="13px" fontWeight="600" color="ink.primary">
                    已连接的桌面设备（Mac / Windows）
                  </Text>
                </HStack>
                <HStack spacing={2}>
                  <Button
                    as="a"
                    href="/downloads/AIStudio-Connector-macOS.dmg"
                    download="AIStudio-Connector-macOS.dmg"
                    size="xs"
                    variant="outline"
                    leftIcon={<Download size={12} />}
                  >
                    下载 Mac 版 (.dmg)
                  </Button>
                  <Button
                    type="button"
                    size="xs"
                    variant="primary"
                    leftIcon={<Link2 size={12} />}
                    isLoading={pairingLocal}
                    onClick={() => void handlePairLocalBridge()}
                  >
                    连接此电脑
                  </Button>
                </HStack>
              </HStack>

              {loadingDevices ? (
                <Text fontSize="12px" color="ink.muted">
                  正在查询在线设备…
                </Text>
              ) : devices.length === 0 ? (
                <Box p={3} borderRadius="10px" bg="white" border="1px solid" borderColor="stroke.light">
                  <Text fontSize="12.5px" fontWeight="500" color="ink.primary" mb={1}>
                    尚未绑定电脑，按以下 3 步快速连接：
                  </Text>
                  <Text fontSize="12px" color="ink.secondary" lineHeight="1.6">
                    1. 点击右上角「下载 Mac 版 (.dmg)」安装并启动「AI Studio 连接器」；
                    <br />
                    2. 保持连接器在菜单栏运行，点击「连接此电脑」完成设备配对；
                    <br />
                    3. 配对后点击「选择工作目录」，在本机弹窗确认授权即可使用。
                  </Text>
                </Box>
              ) : (
                <VStack align="stretch" spacing={2}>
                  {devices.map((dev) => {
                    const existingGrant = grants.find((g) => g.deviceId === dev.deviceId && !g.revoked);
                    const isSelected = draft.deviceId === dev.deviceId && Boolean(draft.grantId);
                    return (
                      <Box
                        key={dev.deviceId}
                        p={2.5}
                        borderRadius="10px"
                        bg="white"
                        border="1px solid"
                        borderColor={isSelected ? "ink.primary" : "stroke.subtle"}
                      >
                        <HStack justify="space-between" gap={2}>
                          <HStack spacing={2} minW={0}>
                            <Box
                              w="7px"
                              h="7px"
                              borderRadius="full"
                              bg={dev.online ? "#16a34a" : "#9ca3af"}
                              flexShrink={0}
                            />
                            <Box minW={0}>
                              <Text fontSize="13px" fontWeight="500" color="ink.primary" noOfLines={1}>
                                {dev.name}
                              </Text>
                              <Text fontSize="11px" color="ink.muted" noOfLines={1}>
                                {dev.platform} · {dev.online ? "在线" : "离线"}
                                {existingGrant?.workdir ? ` · ${existingGrant.workdir}` : ""}
                              </Text>
                            </Box>
                          </HStack>

                          <HStack spacing={1.5} flexShrink={0}>
                            {existingGrant && !isSelected && (
                              <Button
                                type="button"
                                size="xs"
                                variant="ghost"
                                onClick={() =>
                                  setDraft((prev) => ({
                                    ...prev,
                                    deviceId: dev.deviceId,
                                    deviceName: dev.name,
                                    grantId: existingGrant.grantId,
                                    workdir: existingGrant.workdir,
                                  }))
                                }
                              >
                                使用此授权
                              </Button>
                            )}
                            <Button
                              type="button"
                              size="xs"
                              variant={isSelected ? "primary" : "outline"}
                              leftIcon={isSelected ? <FolderCheck size={12} /> : undefined}
                              isDisabled={!dev.online}
                              isLoading={requestingGrantId === dev.deviceId}
                              onClick={() => void handleRequestDeviceGrant(dev)}
                            >
                              {isSelected ? "已授权目录" : "选择工作目录"}
                            </Button>
                          </HStack>
                        </HStack>
                      </Box>
                    );
                  })}
                </VStack>
              )}

              <Box pt={1}>
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  color="ink.muted"
                  px={0}
                  onClick={() => setShowLegacyHttp((v) => !v)}
                >
                  {showLegacyHttp ? "收起命令行 HTTP 直连配置" : "高级：使用命令行 HTTP 连接器 (bun run connector)"}
                </Button>
              </Box>

              {showLegacyHttp && (
                <VStack align="stretch" spacing={3} pt={2} borderTop="1px solid" borderColor="stroke.light">
                  <FormControl>
                    <FormLabel htmlFor={urlInputId} fontSize="12px" fontWeight="500" color="ink.primary" mb={1}>
                      连接器地址
                    </FormLabel>
                    <Input
                      id={urlInputId}
                      size="sm"
                      value={draft.connectorUrl}
                      onChange={(e) =>
                        setDraft((prev) => ({
                          ...prev,
                          connectorUrl: e.target.value,
                          connectorTested: false,
                        }))
                      }
                      placeholder="http://127.0.0.1:8787"
                    />
                  </FormControl>

                  <FormControl>
                    <HStack justify="space-between" mb={1}>
                      <FormLabel htmlFor={tokenInputId} fontSize="12px" fontWeight="500" color="ink.primary" mb={0}>
                        访问令牌（AISTUDIO_CONNECTOR_TOKEN）
                      </FormLabel>
                      <Button
                        type="button"
                        size="xs"
                        variant="ghost"
                        leftIcon={<Sparkles size={12} />}
                        onClick={handleGenerateToken}
                      >
                        随机生成
                      </Button>
                    </HStack>
                    <InputGroup size="sm">
                      <Input
                        id={tokenInputId}
                        type={showToken ? "text" : "password"}
                        value={draft.connectorToken}
                        onChange={(e) =>
                          setDraft((prev) => ({
                            ...prev,
                            connectorToken: e.target.value,
                            connectorTested: false,
                          }))
                        }
                        placeholder="输入或点击右侧随机生成令牌"
                      />
                      <InputRightElement>
                        <IconButton
                          aria-label={showToken ? "隐藏令牌" : "显示令牌"}
                          icon={showToken ? <EyeOff size={14} /> : <Eye size={14} />}
                          size="xs"
                          variant="ghost"
                          onClick={() => setShowToken((v) => !v)}
                        />
                      </InputRightElement>
                    </InputGroup>
                  </FormControl>

                  <Box>
                    <HStack justify="space-between" mb={1}>
                      <Text fontSize="12px" fontWeight="500" color="ink.primary">
                        本机启动命令
                      </Text>
                      <Tooltip label="复制启动命令">
                        <Button
                          type="button"
                          size="xs"
                          variant="ghost"
                          leftIcon={<Copy size={12} />}
                          onClick={() => void handleCopyCommand()}
                        >
                          复制命令
                        </Button>
                      </Tooltip>
                    </HStack>
                    <Box
                      p={2.5}
                      borderRadius="8px"
                      bg="#0d0d0d"
                      color="#f3f4f6"
                      fontSize="11px"
                      fontFamily="mono"
                      whiteSpace="pre-wrap"
                      wordBreak="break-all"
                      lineHeight="1.5"
                    >
                      {displayLaunchCommand}
                    </Box>
                  </Box>

                  <HStack justify="space-between" pt={1}>
                    <HStack spacing={1.5} minW={0}>
                      {testResult ? (
                        <>
                          {testResult.ok ? (
                            <Wifi size={14} color="#16a34a" />
                          ) : (
                            <WifiOff size={14} color="#dc2626" />
                          )}
                          <Text
                            fontSize="12px"
                            color={testResult.ok ? "green.600" : "red.600"}
                            noOfLines={1}
                          >
                            {testResult.message}
                          </Text>
                        </>
                      ) : (
                        <Text fontSize="12px" color="ink.muted">
                          请先在本机运行连接器后测试连通性
                        </Text>
                      )}
                    </HStack>
                    <Button
                      type="button"
                      size="xs"
                      variant="outline"
                      leftIcon={<RefreshCw size={12} />}
                      isLoading={testing}
                      onClick={() => void handleTest()}
                    >
                      测试连通性
                    </Button>
                  </HStack>
                </VStack>
              )}
            </VStack>
          </AppSectionCard>
        )}
      </VStack>
    </AppDialog>
  );
}

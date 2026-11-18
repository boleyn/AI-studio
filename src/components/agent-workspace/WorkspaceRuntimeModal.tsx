import { deviceDisplayName } from "@/shared/localDevice/displayName";
import { useEffect, useId, useState } from "react";
import {
  Box,
  Button,
  FormControl,
  FormLabel,
  HStack,
  IconButton,
  Menu, MenuButton, MenuList, MenuItem,
  Input,
  InputGroup,
  InputRightElement,
  Text,
  Tooltip,
  useToast,
  VStack,
} from "@chakra-ui/react";
import { AppDialog } from "../ui";
import {
  Copy,
  Eye,
  EyeOff,
  RefreshCw,
  Cloud,
  Sparkles,
  Wifi,
  WifiOff,
  Laptop,
  Pencil,
  Plus,
  MoreHorizontal,
  Check,
  Folder,
  Link2,
  Download,
} from "lucide-react";
import { withAuthHeaders } from "@features/auth/client/authClient";
import { getCloudHostStatusMeta, type CloudHostStatus } from "@shared/sandbox/cloudHostStatus";

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
  remark?: string;
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
  embedded?: boolean;
  isOpen: boolean;
  onClose: () => void;
  projectName: string;
  projectToken: string;
  config: ProjectRuntimeConfig;
  cloudHostStatus?: CloudHostStatus;
  onSave: (next: ProjectRuntimeConfig) => void;
  onTestConnector: (url: string, token: string) => Promise<{ ok: boolean; latencyMs?: number; error?: string }>;
};

export default function WorkspaceRuntimeModal({
  embedded,
  isOpen,
  onClose,
  projectToken,
  config,
  cloudHostStatus = "ready",
  onSave,
  onTestConnector,
}: WorkspaceRuntimeModalProps) {
  const toast = useToast();
  const urlInputId = useId();
  const tokenInputId = useId();
  const workdirInputId = useId();
  const [requestedWorkdirs, setRequestedWorkdirs] = useState<Record<string, string>>({});

  const [draft, setDraft] = useState<ProjectRuntimeConfig>(config);
  const [showToken, setShowToken] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [devices, setDevices] = useState<PairedDeviceItem[]>([]);
  const [grants, setGrants] = useState<DeviceGrantItem[]>([]);
  const [loadingDevices, setLoadingDevices] = useState(false);
  const [folderEditor, setFolderEditor] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [remark, setRemark] = useState("");
  const [savingRemark, setSavingRemark] = useState(false);
  const saveRemark = async (device: PairedDeviceItem) => {
    setSavingRemark(true);
    try {
      const response = await fetch("/api/core/localDevice/manage", {
        method: "POST", headers: withAuthHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ action: "remark", deviceId: device.deviceId, remark: remark.trim() }),
      });
      if (!response.ok) throw new Error();
      setEditing(null);
      await loadDevicesAndGrants(true);
    } catch { toast({ title: "备注保存失败，请重试", status: "error" }); }
    finally { setSavingRemark(false); }
  };
  const [pairMessage, setPairMessage] = useState("");
  const [inviteLink, setInviteLink] = useState("");
  const [listError, setListError] = useState("");
  const [pairingLocal, setPairingLocal] = useState(false);
  const [requestingGrantId, setRequestingGrantId] = useState<string | null>(null);
  const [showLegacyHttp, setShowLegacyHttp] = useState(false);

  const loadDevicesAndGrants = async (background = false) => {
    if (!background) setLoadingDevices(true);
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
      if (!devRes.ok) throw new Error();
      setListError("");
      {
        const data = (await devRes.json()) as { devices?: PairedDeviceItem[] };
        setDevices(Array.isArray(data.devices) ? data.devices : []);
      }
      if (grantRes && grantRes.ok) {
        const data = (await grantRes.json()) as { grants?: DeviceGrantItem[] };
        setGrants(Array.isArray(data.grants) ? data.grants : []);
      }
    } catch {
      setListError("设备列表加载失败，请刷新重试。");
    } finally {
      setLoadingDevices(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      setDraft(config);
      setFolderEditor(null);
      setEditing(null);
      setPairMessage("");
      setInviteLink("");
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

  useEffect(() => {
    if (!isOpen) return;
    const timer = window.setInterval(() => { void loadDevicesAndGrants(true); }, 5000);
    return () => window.clearInterval(timer);
  }, [isOpen, draft.sandboxKind, projectToken]);

  const createInvite = async () => {
    const response = await fetch("/api/core/localDevice/invite", {
      method: "POST", headers: withAuthHeaders({ "content-type": "application/json" }),
      body: JSON.stringify({ action: "create" }),
    });
    if (!response.ok) throw new Error("无法创建邀请，请重试。");
    return (await response.json()).code as string;
  };

  const inviteOtherDevice = async () => {
    try {
      const code = await createInvite();
      setInviteLink(window.location.origin + "/account/devices#connect=" + code);
      setPairMessage("在另一台电脑打开伯仁连接器，选择「添加授权」并粘贴链接。链接 10 分钟内有效。");
    } catch { setPairMessage("无法创建邀请，请重试。"); }
  };

  const handlePairLocalBridge = async () => {
    setPairingLocal(true);
    try {
      setInviteLink("");
      setPairMessage("正在联系伯仁连接器…");
      const status = await fetch("http://127.0.0.1:13005/status").then(r => r.ok ? r.json() : null).catch(() => null);
      if (status?.inviteDecision) {
        if (devices.some(device => device.deviceId === status.deviceId || status.deviceIds?.includes(device.deviceId))) {
          setPairMessage("此电脑已在设备列表中。");
          return;
        }
        const code = await createInvite();
        setPairMessage("请在本机的伯仁连接器窗口确认账号授权。");
        const result = await fetch("http://127.0.0.1:13005/invite", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ code, waitForDecision: true }),
        });
        if (!result.ok) throw new Error(result.status === 403 ? "本机授权未完成。可以再次连接。" : "连接器未能完成邀请，请重试。");
        setPairMessage("连接器已接受请求，正在刷新设备列表。");
        await loadDevicesAndGrants();
        return;
      }
      const bridgeRes = await fetch("http://127.0.0.1:13005/pair", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nonce: crypto.randomUUID() }),
      });
      if (!bridgeRes.ok) {
        const reason = (await bridgeRes.text()).trim();
        const hints: Record<string, string> = {
          no_pending_pairing: "配对已过期，请在连接器中重新连接后重试",
          origin_not_allowed: "连接器的平台地址与当前网页不同，请检查连接设置",
          invalid_request: "网页与连接器的配对协议不兼容，请更新连接器",
          local_pairing_rejected: "本机配对已取消",
        };
        throw new Error(hints[reason] || `本机连接器配对失败（HTTP ${bridgeRes.status}）`);
      }
      const bridgeData = (await bridgeRes.json()) as {
        deviceId?: string;
        pairingId?: string;
        confirmationCode?: string;
        name?: string;
      };
      if (bridgeData.deviceId) {
        await loadDevicesAndGrants();
        toast({ title: "本机电脑已绑定", status: "success", duration: 2500 });
        return;
      }
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
      setPairMessage(err instanceof TypeError
        ? "无法联系连接器。请确认它已启动，并在连接设置中核对平台地址 " + window.location.origin
        : err instanceof Error ? err.message : "连接失败，请重试。");
    } finally {
      setPairingLocal(false);
    }
  };

  const handleRequestDeviceGrant = async (device: PairedDeviceItem, initialWorkdir: string) => {
    setRequestingGrantId(device.deviceId);
    try {
      const res = await fetch("/api/core/localDevice/grant", {
        method: "POST",
        headers: withAuthHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({
          action: "request",
          appId: projectToken,
          deviceId: device.deviceId,
          initialWorkdir: initialWorkdir.trim(),
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
        sandboxKind: "connector",
        deviceName: deviceDisplayName(device),
        grantId: data.grant!.grantId,
        workdir: data.grant!.workdir,
      }));
      setFolderEditor(null);
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

  const footer = (
        <Box display="flex" w="full" alignItems="center" justifyContent="space-between">
          <Menu placement="top-start">
            <MenuButton as={Button} size="sm" variant="ghost" leftIcon={<Plus size={15} />}>添加电脑</MenuButton>
            <MenuList fontSize="sm">
              <MenuItem icon={<Link2 size={15} />} onClick={() => void handlePairLocalBridge()} isDisabled={pairingLocal}>连接此电脑</MenuItem>
              <MenuItem icon={<Laptop size={15} />} onClick={() => void inviteOtherDevice()}>邀请其他电脑</MenuItem>
              <MenuItem as="a" href="/downloads/AIStudio-Connector-macOS.dmg" download="伯仁连接器-macOS.dmg" icon={<Download size={15} />}>下载 Mac 连接器</MenuItem>
              <MenuItem icon={<RefreshCw size={15} />} onClick={() => void loadDevicesAndGrants()}>刷新设备</MenuItem>
              <MenuItem onClick={() => { setShowLegacyHttp(v => !v); setDraft(prev => ({ ...prev, sandboxKind: "connector" })); }}>高级连接</MenuItem>
            </MenuList>
          </Menu>
          <Box as="form" method="post" onSubmit={handleSubmit}>
            <Button type="submit" variant="primary" size="sm" isDisabled={draft.sandboxKind === "connector" && !(draft.deviceId && draft.grantId && devices.some(device => device.deviceId === draft.deviceId && device.online)) && !(showLegacyHttp && draft.connectorTested)}>完成</Button>
          </Box>
        </Box>
  );
  const body = (
      <VStack align="stretch" spacing={2}>
        <Button variant="ghost" h="auto" justifyContent="start" px={3} py={3} borderRadius="10px"
          bg={draft.sandboxKind === "remote-vm" ? "blue.50" : "transparent"}
          aria-pressed={draft.sandboxKind === "remote-vm"}
          onClick={() => { setDraft(prev => ({ ...prev, sandboxKind: "remote-vm" })); setFolderEditor(null); }}>
          <Box p={2} borderRadius="10px" bg="blue.50" color="blue.600"><Cloud size={20} /></Box>
          <Box textAlign="left" ml={3}><Text fontSize="sm">云电脑</Text><Text fontSize="xs" color="ink.muted" fontWeight="normal">{getCloudHostStatusMeta(cloudHostStatus).label}</Text></Box>
          {draft.sandboxKind === "remote-vm" && <Box ml="auto"><Check size={16} /></Box>}
        </Button>
        <Box borderTop="1px solid" borderColor="stroke.light" pt={2}>
            <VStack align="stretch" spacing={2}>
              {pairMessage && <Text role="status" color="ink.secondary" fontSize="sm">{pairMessage}</Text>}
              {inviteLink && <Button size="sm" variant="outline" onClick={() => void navigator.clipboard.writeText(inviteLink)
                .then(() => toast({ title: "邀请链接已复制", status: "success" }))
                .catch(() => setPairMessage("无法访问剪贴板，请允许此页面复制链接。"))}>复制邀请链接</Button>}
              {inviteLink && ["127.0.0.1", "localhost", "[::1]"].includes(window.location.hostname) && (
                <Text color="ink.secondary" fontSize="sm">当前是回环地址。连接其他电脑时，请从两台电脑都能访问的平台地址打开工作台并创建邀请。</Text>
              )}
              {listError ? <Text role="alert" fontSize="sm">{listError}</Text> : loadingDevices ? (
                <Text fontSize="sm" color="ink.muted">正在刷新设备…</Text>
              ) : devices.length === 0 ? (
                <Text fontSize="sm" color="ink.secondary">还没有连接电脑。</Text>
              ) : (
                <VStack align="stretch" spacing={2}>
                  {devices.map((dev) => {
                    const existingGrant = grants.find((g) => g.deviceId === dev.deviceId && !g.revoked);
                    const isSelected = draft.sandboxKind === "connector" && draft.deviceId === dev.deviceId && Boolean(draft.grantId);
                    const name = deviceDisplayName(dev);
                    return (
                      <Box key={dev.deviceId}>
                        <HStack spacing={1} pr={1} borderRadius="10px" bg={dev.online ? "green.50" : "gray.50"}>
                          <Button flex={1} minW={0} h="auto" px={3} py={3} variant="ghost" justifyContent="start"
                            isDisabled={!dev.online || Boolean(requestingGrantId)} aria-pressed={isSelected} title={dev.name}
                            onClick={() => {
                              if (!existingGrant) { void handleRequestDeviceGrant(dev, ""); return; }
                              setDraft(prev => ({ ...prev, sandboxKind: "connector", deviceId: dev.deviceId,
                                deviceName: name, grantId: existingGrant.grantId, workdir: existingGrant.workdir }));
                              setFolderEditor(null);
                            }}>
                            <Box bg="transparent" color={dev.online ? "green.700" : "gray.500"} borderRadius="10px" p={2}><Laptop size={20} /></Box>
                            <Box ml={3} minW={0} textAlign="left">
                              <Text fontSize="sm" noOfLines={1}>{name}</Text>
                              <HStack spacing={1.5} mt={1} fontSize="xs" color="ink.secondary" fontWeight="normal">
                                <Text>{dev.online ? "在线" : "离线"}</Text>
                                {existingGrant?.workdir && <Text noOfLines={1} title={existingGrant.workdir}>· {existingGrant.workdir.split(/[/\\]/).filter(Boolean).pop() || existingGrant.workdir}</Text>}
                              </HStack>
                            </Box>
                            {isSelected && <Box ml="auto" pl={2} color="green.700"><Check size={16} /></Box>}
                          </Button>
                          <Menu placement="bottom-end">
                            <MenuButton as={IconButton} aria-label={`${name}的操作`} size="sm" variant="ghost" icon={<MoreHorizontal size={16} />} />
                            <MenuList fontSize="sm">
                              <MenuItem icon={<Pencil size={14} />} onClick={() => { setFolderEditor(null); setEditing(dev.deviceId); setRemark(dev.remark || ""); }}>修改备注</MenuItem>
                              <MenuItem icon={<Folder size={14} />} isDisabled={!dev.online} onClick={() => { setEditing(null); setFolderEditor(dev.deviceId); }}>选择工作目录</MenuItem>
                            </MenuList>
                          </Menu>
                        </HStack>
                        {editing === dev.deviceId && <HStack mt={2}>
                          <Input size="sm" aria-label="电脑备注" placeholder="例如：办公 Mac" maxLength={32} autoFocus
                            value={remark} onChange={e => setRemark(e.target.value)}
                            onKeyDown={e => { if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                              e.preventDefault(); void saveRemark(dev);
                            } }} />
                          <Button type="button" size="sm" isLoading={savingRemark} onClick={() => void saveRemark(dev)}>保存备注</Button>
                          <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)}>取消</Button>
                        </HStack>}
                        {folderEditor === dev.deviceId && <Box as="form" method="post" px={3} pb={2} onSubmit={event => {
                          event.preventDefault(); void handleRequestDeviceGrant(dev, requestedWorkdirs[dev.deviceId] ?? existingGrant?.workdir ?? "");
                        }}>
                        <FormControl mt={3} isRequired>
                          <FormLabel htmlFor={`${workdirInputId}-${dev.deviceId}`} fontSize="sm">工作目录</FormLabel>
                          <Input id={`${workdirInputId}-${dev.deviceId}`} name="initialWorkdir" required maxLength={4096}
                            placeholder="输入目录的完整路径"
                            autoCorrect="off" autoCapitalize="none" spellCheck={false}
                            value={requestedWorkdirs[dev.deviceId] ?? existingGrant?.workdir ?? ""}
                            onChange={(event) => setRequestedWorkdirs(prev => ({ ...prev, [dev.deviceId]: event.target.value }))}
                            sx={{ "&:user-invalid": { borderColor: "red.500" } }}
                          />
                        </FormControl>
                        <HStack justify="end" mt={2}>
                          <Button size="xs" variant="ghost" onClick={() => setFolderEditor(null)}>取消</Button>
                          <Button size="xs" type="submit" isDisabled={!dev.online} isLoading={requestingGrantId === dev.deviceId}>请求授权</Button>
                        </HStack>
                        </Box>}
                      </Box>
                    );
                  })}
                </VStack>
              )}

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
          </Box>
      </VStack>
  );
  if (embedded) return (
    <Box>
      <Text fontWeight="600" fontSize="sm" px={2} pb={2}>我的设备</Text>
      {body}
      <Box borderTop="1px solid" borderColor="stroke.light" mt={2} pt={2}>{footer}</Box>
    </Box>
  );
  return <AppDialog isOpen={isOpen} onClose={onClose} size="md" title="选择电脑" footer={footer}>{body}</AppDialog>;
}

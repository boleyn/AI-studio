import { Button, Flex, Image, ModalCloseButton, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, ModalOverlay, Text } from "@chakra-ui/react";
import { Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { withAuthHeaders } from "@features/auth/client/authClient";

import ConnectorFilePicker from "./ConnectorFilePicker";

const providerIcons: Record<string,string> = { "Google Drive":"google-drive.png", Box:"box.svg", Dropbox:"dropbox.svg", SharePoint:"sharepoint.svg" };

const endpoints: Record<string, string> = {
  "Google Drive": "/api/library/connectors/google",
  Box: "/api/library/connectors/box",
  SharePoint: "/api/library/connectors/sharepoint",
  Dropbox: "/api/library/connectors/dropbox",
};
type Status = { configured: boolean; connected: boolean };
export default function LibraryConnectors({ close, callbackStatus, siteId, onAttach }: { onAttach?: (files: File[]) => Promise<void>; siteId?: string; close: () => void; callbackStatus?: string }) {
  const [browseProvider, setBrowseProvider] = useState<"Dropbox" | "Box" | null>(null);
  const [provider, setProvider] = useState<string>();
  const [statuses, setStatuses] = useState<Record<string, Status>>({});
  const callbackProvider = Object.keys(endpoints).find(name => callbackStatus?.startsWith(name.toLowerCase() + "-")) ?? "Google Drive";
  const result = callbackStatus?.replace(/^(dropbox|box|sharepoint)-/, "");
  const [error, setError] = useState(result === "invalid-session" ? "此次授权请求已失效，请重新连接 " + callbackProvider + "。" : result === "error" ? "连接失败，请重试" : "");
  const [attempt, setAttempt] = useState(0);
  const [statusFailed, setStatusFailed] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    for (const [name, endpoint] of Object.entries(endpoints)) {
      if (siteId && name !== "Google Drive") continue;
      fetch(endpoint + "?status=1", { headers: withAuthHeaders(), signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error();
        const result = await response.json();
        if (!controller.signal.aborted) setStatuses(prev => ({...prev, [name]: result}));
      }).catch(() => { if (!controller.signal.aborted) setStatusFailed(prev => ({...prev, [name]: true})); });
    }
    return () => controller.abort();
  }, [attempt, siteId]);
  async function connect(name: string) {
    setBusy(true);
    try {
      const response = await fetch(endpoints[name], { method: "POST", headers: withAuthHeaders({"Content-Type":"application/json"}), body: JSON.stringify({siteId}) });
      if (!response.ok) throw new Error();
      window.location.assign((await response.json()).url);
    } catch { setBusy(false); setError("无法启动连接，请重试"); }
  }
  const services = siteId ? ["Google Drive"] : ["Google Drive","Box","Dropbox","SharePoint"];
  const heading = siteId ? "连接我的 Google Drive" : "连接你的文件";
  if (browseProvider && onAttach) return <ConnectorFilePicker provider={browseProvider} back={() => setBrowseProvider(null)} onAttach={onAttach}/>;
  if (provider) {
    const available = statuses[provider]?.configured;
    const displayName = provider === "SharePoint" ? "Microsoft SharePoint" : provider;
    const developer = { Box: "Box inc.", Dropbox: "Dropbox", SharePoint: "Microsoft", "Google Drive": "Google" }[provider];
    const back = () => { if (!busy) setProvider(undefined); };
    return <Modal isOpen onClose={back} isCentered><ModalOverlay/>
      <ModalContent mx={3} maxW="480px" minH="264px" borderRadius="24px" borderWidth={0} p={6}>
        <Image src={"/icons/"+providerIcons[provider]} boxSize="48px" objectFit="contain" alt={displayName+" 徽标"}/>
        <ModalHeader px={0} pb={0} as="h2">连接 {displayName}</ModalHeader>
        <ModalBody px={0}><Text fontSize="sm">{provider === "SharePoint" ? "服务提供方" : "开发者"}：{developer}</Text>
          {!available && <Text mt={2} fontSize="sm" color="gray.600">{endpoints[provider] ? "当前服务尚未配置 " + provider + " 授权。" : "当前服务暂未提供此连接。"}</Text>}
          {error && <Text role="alert">{error}</Text>}
        </ModalBody>
        <Button h="36px" borderRadius="full" isDisabled={!available} isLoading={busy} onClick={()=>connect(provider)}>继续连接到 {displayName}</Button>
        <ModalCloseButton boxSize="24px" top={4} right={4} aria-label="关闭对话框" isDisabled={busy}/>
      </ModalContent></Modal>;
  }
  return <Modal isOpen onClose={close} isCentered><ModalOverlay/><ModalContent mx={3} borderWidth={siteId ? undefined : 0} maxW={siteId ? undefined : "464px"} h={siteId ? undefined : "min(640px, calc(100dvh - 32px))"} my={4} borderRadius="16px">
    <ModalHeader as="h2" textAlign={siteId ? undefined : "center"} pt={siteId ? undefined : "36px"} pb={siteId ? undefined : 0} fontSize={siteId ? undefined : "24px"} lineHeight={siteId ? undefined : "32px"}>{heading}</ModalHeader><ModalBody overflowY="auto">
      <Text color="gray.600" fontSize={siteId ? "sm" : "md"} maxW={siteId ? undefined : "296px"} mx="auto" textAlign={siteId ? undefined : "center"}>{siteId ? "选择你的 Google 账号，授权读取云端硬盘中的文件。" : "无需离开伯仁，即可搜索你的文件、提问并使用工具"}</Text>
      <Flex as="ul" aria-label={heading} direction="column" listStyleType="none" p={0} mt={siteId ? 4 : 3}>
        {services.map(name=><Flex as="li" key={name} align="center" justify="space-between" minH={siteId ? undefined : "69px"} gap={3} py={2}>
          {!siteId && <Flex aria-hidden="true" boxSize="45px" flexShrink={0} align="center" justify="center" bg="#fcfcfc" borderWidth="1px" borderRadius="full">
            <Image src={"/icons/"+providerIcons[name]} alt="" boxSize="24px" objectFit="contain"/>
          </Flex>}
          <Text flex={1}>{name}</Text>{endpoints[name] && !statuses[name] ? (
            statusFailed[name] ? <Button size="sm" variant="outline" borderRadius="full" onClick={()=>{
              setStatusFailed({});
              setAttempt(value=>value+1);
            }}>重试读取状态</Button> : <Text role="status" fontSize="sm" color="gray.600">正在读取…</Text>
          ) : statuses[name]?.connected ? <Flex align="center" gap={2}>
            {(name === "Box" || name === "Dropbox") && onAttach && <Button size="sm" variant="ghost" onClick={() => setBrowseProvider(name)}>浏览文件</Button>}
            <Text fontSize="sm" color="gray.600">已连接</Text>
            <Button size="sm" variant="outline" borderRadius="full" isDisabled={!statuses[name].configured} isLoading={busy}
              aria-label={"重新连接 " + name} onClick={()=>connect(name)}>重新连接</Button>
          </Flex> :
          !siteId ? <Button aria-label={"连接 " + name} boxSize="32px" minW="32px" p={0} variant="ghost" borderRadius="full"
            onClick={()=>setProvider(name)}><Plus size={16} aria-hidden/></Button> :
          <Button size="sm" aria-label={"连接 " + name} borderRadius="full" isDisabled={name !== "Google Drive" || !statuses[name]?.configured}
            isLoading={name === "Google Drive" && busy} onClick={()=>connect(name)}>{statuses[name]?.configured ? "连接" : "暂不可用"}</Button>}
        </Flex>)}
      </Flex>{result === "cancelled" && !error && <Text role="status" fontSize="sm" color="gray.600">已取消 {callbackProvider} 授权。</Text>}{error && <Text role="alert" color="red.600">{error}</Text>}
    </ModalBody><ModalFooter pb={siteId ? undefined : 6}><Button w={siteId ? undefined : "full"} h={siteId ? undefined : "48px"} borderRadius="full" onClick={close}>完成</Button></ModalFooter>
  </ModalContent></Modal>;
}

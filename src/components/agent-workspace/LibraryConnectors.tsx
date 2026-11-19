import { Button, Flex, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, ModalOverlay, Text } from "@chakra-ui/react";
import { useEffect, useState } from "react";
import { withAuthHeaders } from "@features/auth/client/authClient";

const endpoint = "/api/library/connectors/google";
export default function LibraryConnectors({ close, callbackStatus, siteId }: { siteId?: string; close: () => void; callbackStatus?: string }) {
  const [status, setStatus] = useState<{ configured: boolean; connected: boolean }>();
  const [error, setError] = useState(callbackStatus === "invalid-session" ? "此次授权请求已失效，请重新连接 Google Drive。" : callbackStatus === "error" ? "连接失败，请重试" : "");
  const [attempt, setAttempt] = useState(0);
  const [statusFailed, setStatusFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch(endpoint + "?status=1", { headers: withAuthHeaders(), signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error();
        const result = await response.json();
        if (!controller.signal.aborted) setStatus(result);
      }).catch(() => { if (!controller.signal.aborted) setStatusFailed(true); });
    return () => controller.abort();
  }, [attempt]);
  async function connect() {
    setBusy(true);
    try {
      const response = await fetch(endpoint, { method: "POST", headers: withAuthHeaders({"Content-Type":"application/json"}), body: JSON.stringify({siteId}) });
      if (!response.ok) throw new Error();
      window.location.assign((await response.json()).url);
    } catch { setBusy(false); setError("无法启动连接，请重试"); }
  }
  const services = siteId ? ["Google Drive"] : ["Google Drive","Box","Dropbox","SharePoint"];
  const heading = siteId ? "连接我的 Google Drive" : "连接你的文件";
  return <Modal isOpen onClose={close} isCentered><ModalOverlay/><ModalContent mx={3} maxW={siteId ? undefined : "464px"} h={siteId ? undefined : "min(640px, calc(100dvh - 32px))"} my={4} borderRadius="16px">
    <ModalHeader as="h2" textAlign={siteId ? undefined : "center"} pt={siteId ? undefined : "36px"} pb={siteId ? undefined : 0} fontSize={siteId ? undefined : "24px"} lineHeight={siteId ? undefined : "32px"}>{heading}</ModalHeader><ModalBody overflowY="auto">
      <Text color="gray.600" fontSize={siteId ? "sm" : "md"} maxW={siteId ? undefined : "296px"} mx="auto" textAlign={siteId ? undefined : "center"}>{siteId ? "选择你的 Google 账号，授权读取云端硬盘中的文件。" : "无需离开伯仁，即可搜索你的文件、提问并使用工具"}</Text>
      <Flex as="ul" aria-label={heading} direction="column" listStyleType="none" p={0} mt={siteId ? 4 : 3}>
        {services.map(name=><Flex as="li" key={name} align="center" justify="space-between" minH={siteId ? undefined : "69px"} borderBottomWidth={siteId ? 0 : "1px"} py={2}>
          <Text>{name}</Text>{name === "Google Drive" && !status ? (
            statusFailed ? <Button size="sm" variant="outline" borderRadius="full" onClick={()=>{
              setStatusFailed(false);
              setAttempt(value=>value+1);
            }}>重试读取状态</Button> : <Text role="status" fontSize="sm" color="gray.600">正在读取…</Text>
          ) : name === "Google Drive" && status?.connected ? <Flex align="center" gap={2}>
            <Text fontSize="sm" color="gray.600">已连接</Text>
            <Button size="sm" variant="outline" borderRadius="full" isDisabled={!status.configured} isLoading={busy}
              aria-label="重新连接 Google Drive" onClick={connect}>重新连接</Button>
          </Flex> :
          <Button size="sm" aria-label={"连接 " + name} borderRadius="full" isDisabled={name !== "Google Drive" || !status?.configured}
            isLoading={name === "Google Drive" && busy} onClick={connect}>{name === "Google Drive" && status?.configured ? "连接" : "暂不可用"}</Button>}
        </Flex>)}
      </Flex>{callbackStatus === "cancelled" && !error && <Text role="status" fontSize="sm" color="gray.600">已取消 Google Drive 授权。</Text>}{error && <Text role="alert" color="red.600">{error}</Text>}
    </ModalBody><ModalFooter pb={siteId ? undefined : 6}><Button w={siteId ? undefined : "full"} h={siteId ? undefined : "48px"} borderRadius="full" onClick={close}>完成</Button></ModalFooter>
  </ModalContent></Modal>;
}

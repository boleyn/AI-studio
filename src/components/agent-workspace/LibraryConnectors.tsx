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
  return <Modal isOpen onClose={close} isCentered><ModalOverlay/><ModalContent mx={3} borderRadius="16px">
    <ModalHeader>连接你的文件</ModalHeader><ModalBody>
      <Text color="gray.600" fontSize="sm">连接文件服务，在资料空间中使用你的文件。</Text>
      <Flex as="ul" aria-label="连接你的文件" direction="column" listStyleType="none" mt={4}>
        {["Google Drive","Box","Dropbox","SharePoint"].map(name=><Flex as="li" key={name} align="center" justify="space-between" py={2}>
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
    </ModalBody><ModalFooter><Button borderRadius="full" onClick={close}>完成</Button></ModalFooter>
  </ModalContent></Modal>;
}

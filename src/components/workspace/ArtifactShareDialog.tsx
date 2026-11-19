import { sitePreviewPath } from "@/types/library";
import {
  Button, Flex, FormControl, FormLabel, Input, Modal, ModalBody, ModalCloseButton,
  Menu, MenuButton, MenuList, MenuItemOption, MenuOptionGroup, ModalContent, ModalFooter, ModalHeader, ModalOverlay, Spinner, Text,
} from "@chakra-ui/react";
import { CircleAlert, ChevronDown, Link2, LockKeyhole } from "lucide-react";
import { useEffect, useState } from "react";
import { withAuthHeaders } from "@features/auth/client/authClient";

type Member = { userId?: string; username: string; canEdit?: boolean };
type Share = { slug?:string; restricted?:boolean; id: string; filename: string; owner: string; livePage?: boolean; members: Member[] };

export default function ArtifactShareDialog({ token, path, version, libraryItemId, chatId, siteId, spaceId, displayName, onClose }: {
  token: string;
  path: string;
  version?: string;
  libraryItemId?: string;
  chatId?: string;
  siteId?: string;
  spaceId?: string;
  displayName?: string;
  onClose: () => void;
}) {
  const [share, setShare] = useState<Share>();
  const [username, setUsername] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setShare(undefined);
    setError("");
    setCopied(false);
    void fetch(spaceId ? "/api/library/space-share?id="+spaceId : siteId ? `/api/share/${siteId}/members` : "/api/artifact-share", {
      method: siteId || spaceId ? "GET" : "POST",
      headers: withAuthHeaders({ "Content-Type": "application/json" }),
      body: siteId || spaceId ? undefined : JSON.stringify({ token, path, version,libraryItemId,chatId,chatUpload:Boolean(chatId) }),
      signal: controller.signal,
    }).then(async (response) => {
      const data = await response.json().catch(() => null);
      if (!response.ok || !data) throw new Error(data?.error || "无法准备分享链接");
      if (!controller.signal.aborted) setShare(data);
    }).catch((reason) => {
      if (!controller.signal.aborted) setError(reason instanceof TypeError ? "连接失败，请检查网络后重试。" : reason.message || "无法准备分享链接");
    });
    return () => controller.abort();
  }, [token, path, version,libraryItemId,chatId,siteId,spaceId,attempt]);

  const updateMember = async (name: string, remove = false, canEdit?: boolean, userId?: string) => {
    if (!share || !name.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(spaceId ? "/api/library/space-share?id="+spaceId : siteId ? `/api/share/${siteId}/members` : `/api/artifact-share?id=${share.id}`, {
        method: "PATCH",
        headers: withAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ username: name, remove, canEdit, userId }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data) throw new Error(data?.error || "无法更新访问权限");
      setShare({ ...share, members: data.members });
      if (!remove && canEdit === undefined) {
        setUsername(current => current === name ? "" : current);
      }
    } catch (reason) {
      setError(reason instanceof TypeError ? "连接失败，请检查网络后重试。" : reason instanceof Error ? reason.message : "无法更新访问权限");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen onClose={() => {if (!busy) onClose();}} isCentered size="md">
      <ModalOverlay />
      <ModalContent mx={3} borderRadius="20px">
        <ModalHeader pr={10} overflowWrap="anywhere">共享 {displayName || path.split("/").pop()}</ModalHeader>
        <ModalCloseButton isDisabled={busy} aria-label="关闭分享对话框" />
        <ModalBody>
          {spaceId && <Text fontSize="sm" mb={3}>访问权限适用于此资料空间中的所有页面</Text>}
          {!share && !error && <Spinner size="sm" aria-label="正在准备分享" />}
          {share && <>
            <Flex as="form" gap={2} align="end" onSubmit={(event) => { event.preventDefault(); void updateMember(username); }}>
              <FormControl>
                <FormLabel fontSize="sm">添加成员</FormLabel>
                <Input placeholder={spaceId ? "输入飞书邮箱或本地账号" : "输入账号名称"} title={spaceId ? "邮箱形式的本地用户名可写为「账号:用户名」" : undefined} size="sm" value={username} maxLength={100} onChange={(event) => setUsername(event.target.value)} />
              </FormControl>
              <Button type="submit" size="sm" isDisabled={!username.trim() || busy}>邀请</Button>
            </Flex>
            <Text mt={5} fontSize="sm" fontWeight="semibold">链接访问权限</Text>
            {siteId ? <select aria-label="站点链接访问权限" disabled={busy} value={share.restricted ? "invited" : "link"}
              onChange={async event=>{
                const restricted = event.target.value === "invited";
                setBusy(true);
                setError("");
                try {
                  const response = await fetch("/api/share/"+siteId+"/members",{method:"PATCH",headers:withAuthHeaders({"Content-Type":"application/json"}),body:JSON.stringify({restricted})});
                  if (!response.ok) throw new Error();
                  setShare(await response.json());
                } catch { setError("访问权限保存失败，请重试。"); }
                finally { setBusy(false); }
              }}><option value="invited">仅限受邀者</option><option value="link">拥有链接的人</option></select> : <Menu placement="bottom-start">
              <MenuButton as={Button} variant="ghost" size="sm" mt={1} leftIcon={<LockKeyhole size={15}/>}
                rightIcon={<ChevronDown size={14}/>}>仅限受邀者</MenuButton>
              <MenuList borderRadius="12px" shadow="lg" p={1}>
                <MenuOptionGroup type="radio" value="invited"><MenuItemOption value="invited" borderRadius="8px">
                  <Text fontSize="sm" fontWeight="500">仅限受邀者</Text>
                  <Text fontSize="xs" color="gray.600">已有访问权限的用户可以使用此链接</Text>
                </MenuItemOption></MenuOptionGroup>
              </MenuList>
            </Menu>}
            <Text mt={4} fontSize="sm" fontWeight="semibold">谁有访问权限</Text>
            <Flex py={2} justify="space-between" fontSize="sm"><Text>{share.owner}</Text><Text color="gray.600">所有者</Text></Flex>
            {share.members.map((member) => (
              <Flex key={member.userId || member.username} align="center" justify="space-between" gap={3} fontSize="sm">
                <Text isTruncated>{member.username}</Text>
                {share.livePage && <FormControl w="auto" ml="auto"><select aria-label={member.username + " 的页面权限"} disabled={busy} value={member.canEdit ? "edit" : "view"}
                  onChange={e=>void updateMember(member.username,false,e.target.value==="edit",member.userId)}><option value="view">可查看</option><option value="edit">可编辑</option></select></FormControl>}
                <Button size="xs" variant="ghost" isDisabled={busy} aria-label={`移除 ${member.username}`}
                  onClick={() => void updateMember(member.username, true, undefined, member.userId)}>移除</Button>
              </Flex>
            ))}
          </>}
          {error && <Flex mt={3} p={3} gap={2} align="center" borderRadius="10px" bg="#faf5f2" color="#694332">
            <CircleAlert size={16} aria-hidden style={{flexShrink:0}}/>
            <Text role="alert" flex="1" fontSize="sm" overflowWrap="anywhere">{error}</Text>
            {!share && <Button size="xs" variant="outline" borderRadius="full" onClick={()=>setAttempt(value=>value+1)}>重试</Button>}
          </Flex>}
        </ModalBody>
        <ModalFooter gap={2} justifyContent="space-between">
          {share && <Button size="sm" borderRadius="full" variant="outline" leftIcon={<Link2 size={15} />} onClick={async () => {
            try {
              await navigator.clipboard.writeText(new URL(spaceId ? "/share/space/"+spaceId : siteId ? sitePreviewPath(siteId,share.slug) : `/share/file/${share.id}`, window.location.origin).href);
              setCopied(true);
            } catch {
              setError("无法复制链接");
            }
          }}>{copied ? "已复制" : "复制链接"}</Button>}
          <Button size="sm" borderRadius="full" bg="#171717" color="white" _hover={{bg:"#333"}} isDisabled={busy} onClick={onClose}>完成</Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

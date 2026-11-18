import {
  Button, Flex, FormControl, FormLabel, Input, Modal, ModalBody, ModalCloseButton,
  Menu, MenuButton, MenuList, MenuItemOption, MenuOptionGroup, ModalContent, ModalFooter, ModalHeader, ModalOverlay, Spinner, Text,
} from "@chakra-ui/react";
import { ChevronDown, Link2, LockKeyhole } from "lucide-react";
import { useEffect, useState } from "react";
import { withAuthHeaders } from "@features/auth/client/authClient";

type Member = { username: string };
type Share = { id: string; filename: string; owner: string; members: Member[] };

export default function ArtifactShareDialog({ token, path, version, libraryItemId, chatId, displayName, onClose }: {
  token: string;
  path: string;
  version?: string;
  libraryItemId?: string;
  chatId?: string;
  displayName?: string;
  onClose: () => void;
}) {
  const [share, setShare] = useState<Share>();
  const [username, setUsername] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/artifact-share", {
      method: "POST",
      headers: withAuthHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ token, path, version,libraryItemId,chatId,chatUpload:Boolean(chatId) }),
      signal: controller.signal,
    }).then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "无法准备分享链接");
      if (!controller.signal.aborted) setShare(data);
    }).catch((reason) => {
      if (!controller.signal.aborted) setError(reason.message || "无法准备分享链接");
    });
    return () => controller.abort();
  }, [token, path, version,libraryItemId,chatId]);

  const updateMember = async (name: string, remove = false) => {
    if (!share || !name.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/artifact-share?id=${share.id}`, {
        method: "PATCH",
        headers: withAuthHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ username: name, remove }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "无法更新访问权限");
      setShare({ ...share, members: data.members });
      if (!remove) setUsername("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法更新访问权限");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} isCentered size="md">
      <ModalOverlay />
      <ModalContent mx={3} borderRadius="20px">
        <ModalHeader pr={10} overflowWrap="anywhere">共享 {displayName || path.split("/").pop()}</ModalHeader>
        <ModalCloseButton aria-label="关闭分享对话框" />
        <ModalBody>
          {!share && !error && <Spinner size="sm" aria-label="正在准备分享" />}
          {share && <>
            <Flex as="form" gap={2} align="end" onSubmit={(event) => { event.preventDefault(); void updateMember(username); }}>
              <FormControl>
                <FormLabel fontSize="sm">添加成员</FormLabel>
                <Input placeholder="输入账号名称" size="sm" value={username} maxLength={100} onChange={(event) => setUsername(event.target.value)} />
              </FormControl>
              <Button type="submit" size="sm" isDisabled={!username.trim() || busy}>邀请</Button>
            </Flex>
            <Text mt={5} fontSize="sm" fontWeight="semibold">链接访问权限</Text>
            <Menu placement="bottom-start">
              <MenuButton as={Button} variant="ghost" size="sm" mt={1} leftIcon={<LockKeyhole size={15}/>}
                rightIcon={<ChevronDown size={14}/>}>仅限受邀者</MenuButton>
              <MenuList borderRadius="12px" shadow="lg" p={1}>
                <MenuOptionGroup type="radio" value="invited"><MenuItemOption value="invited" borderRadius="8px">
                  <Text fontSize="sm" fontWeight="500">仅限受邀者</Text>
                  <Text fontSize="xs" color="gray.600">已有访问权限的用户可以使用此链接</Text>
                </MenuItemOption></MenuOptionGroup>
              </MenuList>
            </Menu>
            <Text mt={4} fontSize="sm" fontWeight="semibold">谁有访问权限</Text>
            <Flex py={2} justify="space-between" fontSize="sm"><Text>{share.owner}</Text><Text color="gray.600">所有者</Text></Flex>
            {share.members.map((member) => (
              <Flex key={member.username} align="center" justify="space-between" gap={3} fontSize="sm">
                <Text isTruncated>{member.username}</Text>
                <Button size="xs" variant="ghost" isDisabled={busy} aria-label={`移除 ${member.username}`}
                  onClick={() => void updateMember(member.username, true)}>移除</Button>
              </Flex>
            ))}
          </>}
          {error && <Text mt={3} fontSize="sm" color="red.600" role="alert">{error}</Text>}
        </ModalBody>
        <ModalFooter gap={2} justifyContent="space-between">
          {share && <Button size="sm" borderRadius="full" variant="outline" leftIcon={<Link2 size={15} />} onClick={async () => {
            try {
              await navigator.clipboard.writeText(new URL(`/share/file/${share.id}`, window.location.origin).href);
              setCopied(true);
            } catch {
              setError("无法复制链接");
            }
          }}>{copied ? "已复制" : "复制链接"}</Button>}
          <Button size="sm" borderRadius="full" bg="#171717" color="white" _hover={{bg:"#333"}} onClick={onClose}>完成</Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

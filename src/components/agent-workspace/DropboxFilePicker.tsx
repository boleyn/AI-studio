import { useEffect, useState } from "react";
import { Button, Flex, Modal, ModalBody, ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalOverlay, Text } from "@chakra-ui/react";
import { Folder } from "lucide-react";
import { withAuthHeaders } from "@features/auth/client/authClient";
import { redirectedToLogin, responseFilename } from "@features/chat/services/files";
import { inferAttachmentMimeType } from "@features/chat/utils/attachmentMimeType";

type Entry = { id: string; name: string; folder: boolean };
type Listing = { files: Entry[]; nextCursor?: string };
const endpoint = "/api/library/connectors/dropbox-files";

async function readDropbox(params: URLSearchParams, signal?: AbortSignal) {
  const response = await fetch(endpoint + "?" + params, { headers: withAuthHeaders(), signal });
  if (redirectedToLogin(response) || response.status === 401) throw new Error("请重新登录后打开 Dropbox。");
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.error || "Dropbox 暂时不可用，请重试。");
  }
  return response;
}

export default function DropboxFilePicker({ back, onAttach }: { back: () => void; onAttach: (files: File[]) => Promise<void> }) {
  const [path, setPath] = useState([{ id: "", name: "Dropbox" }]);
  const [pages, setPages] = useState([""]);
  const [listing, setListing] = useState<Listing>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [attaching, setAttaching] = useState("");
  const folder = path[path.length - 1];
  const cursor = pages[pages.length - 1];
  useEffect(() => {
    const controller = new AbortController();
    setListing(undefined);
    setError("");
    const params = new URLSearchParams({ folder: folder.id });
    if (cursor) params.set("cursor", cursor);
    readDropbox(params, controller.signal).then(response => response.json()).then(data => {
      if (!controller.signal.aborted) setListing(data);
    }).catch(reason => {
      if (!controller.signal.aborted) setError(reason.message);
    });
    return () => controller.abort();
  }, [folder.id, cursor, attempt]);

  async function attach(entry: Entry) {
    setAttaching(entry.id);
    setError("");
    try {
      const response = await readDropbox(new URLSearchParams({ file: entry.id }));
      const name = responseFilename(response, entry.name);
      await onAttach([new File([await response.blob()], name, { type: inferAttachmentMimeType(name) })]);
    } catch (reason) {
      setError(reason instanceof TypeError ? "连接失败，请检查网络后重试。" : reason instanceof Error ? reason.message : "添加文件失败。");
    } finally {
      setAttaching("");
    }
  }
  return <Modal isOpen onClose={() => { if (!attaching) back(); }} isCentered scrollBehavior="inside">
    <ModalOverlay/><ModalContent mx={3} borderRadius="16px">
      <ModalHeader pr={12} overflowWrap="anywhere">{folder.name}</ModalHeader><ModalCloseButton aria-label="关闭" isDisabled={Boolean(attaching)}/>
      <ModalBody>
        {path.length > 1 && <Button size="sm" variant="ghost" mb={2} isDisabled={Boolean(attaching)} onClick={() => { setPages([""]); setPath(path.slice(0,-1)); }}>返回上级文件夹</Button>}
        {error && <Text role="alert">{error}</Text>}
        {!listing && (error ? <Button size="sm" onClick={() => setAttempt(n => n + 1)}>重新加载</Button> : <Text role="status">正在加载文件…</Text>)}
        {listing && !listing.files.length && <Text role="status">此文件夹为空</Text>}
        {listing?.files.map(entry => <Flex key={entry.id} gap={3} minH="44px" align="center">
          {entry.folder ? <Button variant="ghost" leftIcon={<Folder size={16}/>} isDisabled={Boolean(attaching)} onClick={() => { setPages([""]); setPath([...path,entry]); }}>{entry.name}</Button> :
            <><Text flex={1} overflowWrap="anywhere">{entry.name}</Text><Button size="sm" flexShrink={0} isLoading={attaching === entry.id} isDisabled={Boolean(attaching)} onClick={() => attach(entry)}>添加到聊天</Button></>}
        </Flex>)}
      </ModalBody><ModalFooter gap={2}>
        {pages.length > 1 && <Button size="sm" isDisabled={Boolean(attaching)} onClick={() => setPages(pages.slice(0,-1))}>上一页</Button>}
        {listing?.nextCursor && <Button size="sm" isDisabled={Boolean(attaching)} onClick={() => setPages([...pages,listing.nextCursor!])}>下一页</Button>}
        <Button size="sm" isDisabled={Boolean(attaching)} onClick={back}>返回连接列表</Button>
      </ModalFooter>
    </ModalContent>
  </Modal>;
}

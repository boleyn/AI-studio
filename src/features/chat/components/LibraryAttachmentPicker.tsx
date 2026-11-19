import { useEffect, useRef, useState } from "react";
import { Box, Button, Flex, IconButton, Input, Modal, ModalBody, ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalOverlay, Text } from "@chakra-ui/react";
import { withAuthHeaders } from "@features/auth/client/authClient";
import type { LibraryFile } from "@/types/library";
import { CircleAlert, Search, X } from "lucide-react";
import { LibrarySelectionIndicator } from "@/components/agent-workspace/LibrarySelectionBox";
import LibraryDrive from "@/components/agent-workspace/LibraryDrive";
import LibraryItemIcon from "@/components/agent-workspace/LibraryItemIcon";
import { addLibraryAttachments } from "../services/libraryAttachment";

function sourceLabel(item:LibraryFile) {
  if (item.shareId) return item.project ? item.project + " 共享" : "与你共享";
  if (item.conversation) return "来自会话「" + item.conversation + "」";
  if (item.fromTemplate) return "在资料空间中创建";
  if (item.directUpload) return "上传到资料空间";
  return item.kind === "生成" ? "会话生成的文件" : item.kind;
}

export default function LibraryAttachmentPicker({onClose,onAdd}:{onClose:()=>void;onAdd:(files:File[])=>Promise<(string | undefined)[]>}) {
  const searchRef = useRef<HTMLInputElement>(null);
  const [driveAvailable,setDriveAvailable] = useState(false);
  const [showDrive,setShowDrive] = useState(false);
  useEffect(()=>{
    const controller = new AbortController();
    fetch("/api/library/connectors/google?status=1",{headers:withAuthHeaders(),signal:controller.signal}).then(async response=>{
      if (!response.ok) return;
      const data = await response.json();
      if (!controller.signal.aborted) setDriveAvailable(data.connected);
    }).catch(()=>{});
    return ()=>controller.abort();
  },[]);
  const [items,setItems] = useState<LibraryFile[]>();
  const [query,setQuery] = useState("");
  const [selected,setSelected] = useState<string[]>([]);
  const [error,setError] = useState("");
  const [fileErrors,setFileErrors] = useState(new Map<string,string>());
  const [busy,setBusy] = useState(false);
  const [attempt,setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    fetch("/api/library",{headers:withAuthHeaders(),signal:controller.signal}).then(async response => {
      if (!response.ok) throw new Error();
      const data:LibraryFile[] = await response.json();
      if (!controller.signal.aborted) setItems(data.filter(item => !item.deleted));
    }).catch(() => {if (!controller.signal.aborted) setError("无法加载资料空间");});
    return () => controller.abort();
  },[attempt]);
  const namesById = new Map(items?.map(item=>[item.id,item.name]));
  const attachable = items?.filter(item=>!item.siteId && item.kind !== "文件夹" && item.kind !== "资料空间");
  const locationLabel = (item:LibraryFile) => [item.folderId && namesById.get(item.folderId),sourceLabel(item)].filter(Boolean).join(" · ");
  const visible = attachable?.filter(item => [item.name,item.project,locationLabel(item)].join(" ").toLowerCase().includes(query.trim().toLowerCase()));
  async function add() {
    if (busy || !items) return;
    setBusy(true);
    setError("");
    try {
      const picked = items.filter(item => selected.includes(item.id));
      const errors = await addLibraryAttachments(picked, onAdd);
      setFileErrors(errors);
      if (errors.size) {
        setSelected([...errors.keys()]);
        setQuery("");
        setError("有 " + errors.size + " 项未添加，请查看文件旁的提示后重试。");
      } else {
        onClose();
      }
    } catch (err) {setError(err instanceof Error ? err.message : "添加失败");}
    finally {setBusy(false);}
  }
  return <Modal isOpen initialFocusRef={searchRef} onClose={() => {if (!busy) onClose();}} isCentered scrollBehavior="inside">
    <ModalOverlay bg="blackAlpha.400"/><ModalContent mx={3} maxW="540px" borderRadius="20px" overflow="hidden">
    <ModalHeader px={5} pt={5} pb={3} fontSize="18px" fontWeight="600">从资料空间添加</ModalHeader>
    <ModalCloseButton aria-label="关闭" isDisabled={busy} borderRadius="full" top={4} right={4}/>
    {driveAvailable && <Flex px={5} pb={3} gap={1} aria-label="附件来源" role="group">
      {(["资料空间","Google Drive"] as const).map(source => {
        const drive = source === "Google Drive";
        const active = showDrive === drive;
        return <Button key={source} size="sm" variant="ghost" borderRadius="full" aria-pressed={active}
          bg={active ? "#ededed" : "transparent"} color={active ? "#171717" : "#666"} isDisabled={busy}
          onClick={()=>setShowDrive(drive)}>{source}</Button>;
      })}
    </Flex>}
    {showDrive ? <ModalBody><LibraryDrive onBusyChange={setBusy} onAttach={async files=>{
      const errors = await onAdd(files);
      if (errors[0]) throw new Error(errors[0]);
      onClose();
    }}/></ModalBody> : <><Flex mx={5} mb={3} px={3} h="38px" flexShrink={0} gap={2} align="center" bg="#f5f5f5" borderRadius="12px" _focusWithin={{boxShadow:"inset 0 0 0 1px #aaa"}}>
      <Search size={16} color="#777"/><Input ref={searchRef} variant="unstyled" fontSize="sm" aria-label="搜索资料空间" placeholder="搜索文件或页面" value={query} onChange={event=>setQuery(event.target.value)}/>
      {query && <IconButton size="xs" variant="ghost" borderRadius="full" aria-label="清空搜索" icon={<X size={14}/>}
        onClick={()=>{setQuery("");searchRef.current?.focus();}}/>}
    </Flex><ModalBody px={3} py={0} maxH="min(48dvh, 360px)">
      {!items && !error && <Text role="status" p={3}>正在加载…</Text>}
      {error && <Flex role="alert" mx={2} my={2} p={3} gap={2} align="center" bg="#faf5f2" color="#694332" borderRadius="10px">
        <CircleAlert size={16} aria-hidden style={{flexShrink:0}}/><Text flex="1" minW={0} overflowWrap="anywhere" fontSize="sm">{error}</Text>
        {!items && <Button size="xs" variant="outline" borderRadius="full" onClick={()=>setAttempt(value=>value+1)}>重试</Button>}
      </Flex>}
      {visible?.length === 0 && <Box role="status" px={4} py={8} textAlign="center">
        <Text fontSize="sm" fontWeight="medium">{attachable?.length ? "没有找到匹配的文件或页面" : "暂无可添加的文件或页面"}</Text>
        <Text mt={1} fontSize="xs" color="gray.600">{attachable?.length ? "试试其他文件名或来源会话名称。" : "上传文件或创建页面后，就可以在这里引用。"}</Text>
      </Box>}
      {visible?.map(item=>{
        const checked=selected.includes(item.id);
        return <Flex as="button" type="button" key={item.id} role="checkbox" aria-label={item.name} aria-describedby={["library-source-"+item.id, fileErrors.has(item.id) && "library-error-"+item.id].filter(Boolean).join(" ")} aria-checked={checked} disabled={busy}
          width="100%" align="center" gap={3} borderRadius="10px" px={2} py={2} textAlign="left" bg={checked?"#f0f0f0":"transparent"}
          _hover={{bg:"#f5f5f5"}} _focusVisible={{outline:"2px solid #555",outlineOffset:"-2px"}}
          onClick={()=>setSelected(previous=>previous.includes(item.id)?previous.filter(id=>id!==item.id):[...previous,item.id])}>
          <LibrarySelectionIndicator checked={checked}/>
          <LibraryItemIcon item={item}/><Box flex="1" minW={0}><Text fontSize="sm" isTruncated title={item.name}>{item.name}</Text>
            <Text id={"library-source-"+item.id} color="#707070" fontSize="xs" isTruncated title={locationLabel(item)}>{locationLabel(item)}</Text>
            {fileErrors.has(item.id) && <Text id={"library-error-"+item.id} color="#944525" fontSize="xs" overflowWrap="anywhere">{fileErrors.get(item.id)}</Text>}
          </Box>

        </Flex>;
      })}
    </ModalBody><ModalFooter px={5} py={3} mt={2} borderTop="1px solid #eee" gap={2}><Button size="sm" variant="ghost" borderRadius="full" isDisabled={busy} onClick={onClose}>取消</Button>
      <Button size="sm" bg="#171717" color="white" _hover={{bg:"#333"}} borderRadius="full" px={4} isLoading={busy} isDisabled={!selected.length} onClick={add}>添加{selected.length ? "（"+selected.length+"）" : ""}</Button>
    </ModalFooter></>}</ModalContent></Modal>;
}

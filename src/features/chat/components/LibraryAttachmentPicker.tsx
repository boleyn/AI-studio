import { useEffect, useRef, useState } from "react";
import { Box, Button, Flex, IconButton, Input, Modal, ModalBody, ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalOverlay, Text } from "@chakra-ui/react";
import useDriveConnected from "@/components/agent-workspace/useDriveConnected";
import { libraryActivityTime, type LibraryFile } from "@/types/library";
import { ChevronRight, CircleAlert, Search, X } from "lucide-react";
import AttachmentFilename from "./AttachmentFilename";
import { LibrarySelectionIndicator } from "@/components/agent-workspace/LibrarySelectionBox";
import LibraryDrive from "@/components/agent-workspace/LibraryDrive";
import { matchesLibraryType } from "@/components/agent-workspace/libraryFileType";
import LibraryItemIcon from "@/components/agent-workspace/LibraryItemIcon";
import { addLibraryAttachments, expandLibrarySelection, includeSharedPages, isContainer, loadSharedSpacePages, loadLibraryFiles, recordLibraryOpen } from "../services/libraryAttachment";

function sourceLabel(item:LibraryFile) {
  if (item.shareId) return item.project ? item.project + " 共享" : "与你共享";
  if (item.conversation) {
    const source = item.fileOrigin ?? item.kind;
    const origin = source === "生成" ? "会话生成" : source === "上传" ? "会话上传" : "来自会话";
    return origin + " · 「" + item.conversation + "」";
  }
  if (item.fromTemplate) return "在资料空间中创建";
  if (item.fileOrigin === "生成") return "会话生成的文件";
  if (item.directUpload) return "上传到资料空间";
  if (item.kind === "上传" && item.chatId) return "会话上传的文件";
  return item.kind === "生成" ? "会话生成的文件" : item.kind;
}

export default function LibraryAttachmentPicker({initialQuery="",onClose,onAdd}:{initialQuery?:string;onClose:()=>void;onAdd:(files:File[])=>Promise<(string | undefined)[]>}) {
  const searchRef = useRef<HTMLInputElement>(null);
  const driveAvailable = useDriveConnected();
  const [driveSelected,setShowDrive] = useState(false);
  const showDrive = driveSelected && driveAvailable;
  const [items,setItems] = useState<LibraryFile[]>();
  const [space,setSpace] = useState<LibraryFile>();
  const [query,setQuery] = useState(initialQuery);
  const rootQuery = useRef(initialQuery);
  const [selected,setSelected] = useState<LibraryFile[]>([]);
  const rootItems = useRef<LibraryFile[]>([]);
  const [error,setError] = useState("");
  const [fileErrors,setFileErrors] = useState(new Map<string,string>());
  const listRef = useRef<HTMLDivElement>(null);
  const rootScroll = useRef(0);
  useEffect(() => {
    if (items) listRef.current?.scrollTo({top:space ? 0 : rootScroll.current});
  }, [items,space]);
  useEffect(() => {
    if (fileErrors.size) listRef.current?.scrollTo({top:0});
  }, [fileErrors]);
  const [busy,setBusy] = useState(false);
  const [attempt,setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    setItems(undefined);
    const request = space?.shareId ? loadSharedSpacePages(space,controller.signal) : loadLibraryFiles(controller.signal);
    request.then(data => {
      if (controller.signal.aborted) return;
      const loaded = data.filter(item => !item.deleted).sort((a,b) => libraryActivityTime(b).localeCompare(libraryActivityTime(a)));
      if (space) recordLibraryOpen(space.id);
      else rootItems.current = loaded;
      setItems(loaded);
    }).catch(reason => {
      if (controller.signal.aborted) return;
      if (reason instanceof TypeError) setError("连接失败，请检查网络后重试。");
      else if (reason instanceof SyntaxError) setError("资料列表未能加载，请重试。");
      else setError(reason instanceof Error ? reason.message : "暂时无法加载资料，请稍后重试。");
    });
    return () => controller.abort();
  },[attempt,space]);
  const itemsById = new Map(items?.map(item => [item.id, item]));
  function folderPath(item: LibraryFile) {
    const names: string[] = [];
    const visited = new Set([item.id]);
    let parent = item.folderId && itemsById.get(item.folderId);
    while (parent && !visited.has(parent.id)) {
      names.push(parent.name);
      visited.add(parent.id);
      parent = parent.folderId && itemsById.get(parent.folderId);
    }
    return names.reverse().join(" / ");
  }
  const failedElsewhere = selected.filter(item => fileErrors.has(item.id) && !itemsById.has(item.id));
  const attachable = items && [...failedElsewhere, ...items.filter(item=>!item.siteId)];
  const locationLabel = (item:LibraryFile) => [
    [item.sharedSpaceName, item.sharedSpaceName && item.path.endsWith(" / " + item.name)
      ? item.path.slice(0,-item.name.length - 3) : folderPath(item)].filter(Boolean).join(" / "),
    sourceLabel(item),
    item.version && item.time && new Date(item.time).toLocaleString("zh-CN"),
  ].filter(Boolean).join(" · ");
  const searchTerm = query.trim().normalize("NFC").toLowerCase();
  const visible = attachable?.filter(item => !searchTerm || matchesLibraryType(item, searchTerm) || [item.name,item.path,item.project,locationLabel(item)].some(value => value?.normalize("NFC").toLowerCase().includes(searchTerm)));
  if (fileErrors.size) {
    visible?.sort((left, right) => Number(fileErrors.has(right.id)) - Number(fileErrors.has(left.id)));
  }
  function browseSpace(next?: LibraryFile) {
    if (next) {
      rootQuery.current = query;
      rootScroll.current = listRef.current?.scrollTop ?? 0;
    }
    searchRef.current?.focus();
    setSpace(next);
    setItems(undefined);
    setQuery(next ? "" : rootQuery.current);
    setError("");
  }
  function toggleItem(item: LibraryFile) {
    setSelected(previous => previous.some(entry => entry.id === item.id)
      ? previous.filter(entry => entry.id !== item.id)
      : [...previous, item]);
    setError("");
    if (fileErrors.has(item.id)) {
      setFileErrors(previous => {
        const next = new Map(previous);
        next.delete(item.id);
        return next;
      });
    }
  }
  const sharedSpaces = new Map<string, LibraryFile>();
  const picked = expandLibrarySelection(selected, rootItems.current, sharedSpaces);
  const canAdd = picked.length > 0 || sharedSpaces.size > 0;
  async function add() {
    if (busy || !items || !canAdd) return;
    setBusy(true);
    setError("");
    try {
      const files = await includeSharedPages(picked, sharedSpaces.values());
      if (!files.length) {
        setError("所选位置中没有可添加的文件或页面。");
        return;
      }
      const errors = await addLibraryAttachments(files, onAdd);
      const folders = selected.filter(isContainer);
      if (folders.length) {
        const parents = new Map(rootItems.current.map(item => [item.id, item.folderId]));
        const used = new Set<string>();
        for (const file of files) {
          if (errors.has(file.id)) continue;
          let parent = parents.get(file.id);
          while (parent && !used.has(parent)) {
            used.add(parent);
            parent = parents.get(parent);
          }
        }
        recordLibraryOpen(folders.filter(folder => used.has(folder.id)).map(folder => folder.id));
      }
      setFileErrors(errors);
      if (errors.size) {
        setSelected(files.filter(item => errors.has(item.id)));
        setQuery("");
        const added = files.length - errors.size;
        setError(added
          ? `已添加 ${added} 项。${errors.size} 项未能添加，已列在最前面。`
          : `${errors.size} 项未能添加，请查看文件旁的提示后重试。`);
      } else {
        onClose();
      }
    } catch (err) {setError(err instanceof TypeError ? "连接失败，请检查网络后重试。" : err instanceof Error ? err.message : "添加失败");}
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
    {space && !showDrive && <Flex mx={5} mb={2} align="center" gap={2} minW={0}>
      <Button size="sm" variant="ghost" flexShrink={0} aria-label="返回资料空间" isDisabled={busy} onClick={()=>browseSpace()}>‹ 资料空间</Button>
      <Text as="span" color="gray.500" aria-hidden>/</Text>
      <Text fontSize="sm" minW={0} isTruncated title={space.name}>{space.name}</Text>
    </Flex>}
    {showDrive ? <ModalBody><LibraryDrive onBusyChange={setBusy} onAttach={async files=>{
      const errors = await onAdd(files);
      if (errors[0]) throw new Error(errors[0]);
      if (selected.length) setShowDrive(false);
      else onClose();
    }}/></ModalBody> : <><Flex mx={5} mb={3} px={3} h="38px" flexShrink={0} gap={2} align="center" bg="#f5f5f5" borderRadius="12px" _focusWithin={{boxShadow:"inset 0 0 0 1px #aaa"}}>
      <Search size={16} color="#777"/><Input ref={searchRef} variant="unstyled" fontSize="sm" aria-label="搜索资料空间" placeholder="搜索文件、页面或文件夹" value={query} onChange={event=>setQuery(event.target.value)}/>
      {query && <IconButton size="xs" variant="ghost" borderRadius="full" aria-label="清空搜索" icon={<X size={14}/>}
        onClick={()=>{setQuery("");searchRef.current?.focus();}}/>}
    </Flex>
      {error && <Flex role="alert" mx={5} mb={2} p={3} flexShrink={0} gap={2} align="center" bg="#faf5f2" color="#694332" borderRadius="10px">
        <CircleAlert size={16} aria-hidden style={{flexShrink:0}}/><Text flex="1" minW={0} overflowWrap="anywhere" fontSize="sm">{error}</Text>
        {!items && <Button size="xs" variant="outline" borderRadius="full" onClick={()=>setAttempt(value=>value+1)}>重试</Button>}
      </Flex>}
    <ModalBody ref={listRef} px={3} py={0} maxH="min(48dvh, 360px)">
      {!items && !error && <Text role="status" p={3}>正在加载…</Text>}
      {visible?.length === 0 && <Box role="status" px={4} py={8} textAlign="center">
        <Text fontSize="sm" fontWeight="medium">{attachable?.length ? "没有找到匹配的文件或页面" : "暂无可添加的文件或页面"}</Text>
        <Text mt={1} fontSize="xs" color="gray.600">{attachable?.length ? "试试其他文件名或来源会话名称。" : "上传文件或创建页面后，就可以在这里引用。"}</Text>
      </Box>}
      {visible?.map(item=>{
        if (item.kind === "资料空间" && item.shareId) return <Button key={item.id} variant="ghost" w="full" h="auto" px={2} py={2} gap={3} borderRadius="10px" fontSize="sm" fontWeight="normal"
          justifyContent="start" isDisabled={busy} onClick={()=>browseSpace(item)}>
          <Box aria-hidden="true" w="16px" flexShrink={0}/><LibraryItemIcon item={item}/><Text flex="1" minW={0} textAlign="left" isTruncated title={item.name}>{item.name}</Text><ChevronRight size={16} strokeWidth={1.75} aria-hidden style={{flexShrink:0}}/>
        </Button>;
        const checked=selected.some(entry => entry.id === item.id);
        const source = locationLabel(item);
        return <Flex as="button" type="button" key={item.id} role="checkbox" aria-label={item.name} aria-describedby={["library-source-"+item.id, fileErrors.has(item.id) && "library-error-"+item.id].filter(Boolean).join(" ")} aria-checked={checked} disabled={busy}
          width="100%" direction="column" align="stretch" gap={1} borderRadius="10px" px={2} py={2} textAlign="left" bg={checked?"#f0f0f0":"transparent"}
          _hover={{bg:"#f5f5f5"}} _focusVisible={{outline:"2px solid #555",outlineOffset:"-2px"}}
          onClick={()=>toggleItem(item)}>
          <Flex as="span" align="center" gap={3}>
          <LibrarySelectionIndicator checked={checked}/>
          <LibraryItemIcon item={item}/><Box as="span" flex="1" minW={0}><AttachmentFilename name={item.name} fontSize="sm"/>
            <Text as="span" display="block" id={"library-source-"+item.id} color="#707070" fontSize="xs" isTruncated title={source}>{source}</Text>
          </Box></Flex>
            {fileErrors.has(item.id) && <Text as="span" id={"library-error-"+item.id} color="#944525" fontSize="xs" overflowWrap="anywhere">{fileErrors.get(item.id)}</Text>}
        </Flex>;
      })}
    </ModalBody>
    {items && selected.length > 0 && !canAdd && <Text role="status" px={5} py={2} fontSize="sm" color="gray.600">所选位置中没有可添加的文件或页面。</Text>}
    <ModalFooter px={5} py={3} mt={2} borderTop="1px solid #eee" gap={2}><Button size="sm" variant="ghost" borderRadius="full" isDisabled={busy} onClick={onClose}>取消</Button>
      <Button size="sm" bg="#171717" color="white" _hover={{bg:"#333"}} borderRadius="full" px={4} isLoading={busy} isDisabled={!items || !canAdd} onClick={add}>{selected.length > 0 && selected.every(item => fileErrors.has(item.id)) ? "重试" : "添加"}{selected.length && !sharedSpaces.size ? "（"+picked.length+"）" : ""}</Button>
    </ModalFooter></>}</ModalContent></Modal>;
}

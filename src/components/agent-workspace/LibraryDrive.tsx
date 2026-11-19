import { Box, Button, Flex, Heading, IconButton, Input, Link, Menu, MenuButton, MenuItem, MenuList, Modal, ModalOverlay, ModalContent, ModalHeader, ModalBody, ModalFooter, Text } from "@chakra-ui/react";
import { useEffect, useState } from "react";
import { CircleAlert, Folder, MoreHorizontal } from "lucide-react";
import { withAuthHeaders } from "@features/auth/client/authClient";

import { formatRelativeTime } from "./relativeTime";

interface DriveFile {id:string; name:string; mimeType:string; webViewLink?:string; modifiedTime?:string; viewedByMeTime?:string; size?:string}
export default function LibraryDrive({connect,onAttach,onBusyChange,onBackToLibrary}:{onBackToLibrary?:()=>void;connect?:()=>void;onBusyChange?:(busy:boolean)=>void;onAttach:(files:File[])=>Promise<void>}) {
  const [scope,setScope] = useState("recent");
  const [sort,setSort] = useState({key:"name",descending:false});
  const [search,setSearch] = useState("");
  const [query,setQuery] = useState("");
  useEffect(()=>{
    const timer = window.setTimeout(()=>{setQuery(search.trim());setPages([""]);},250);
    return ()=>window.clearTimeout(timer);
  },[search]);
  const [path,setPath] = useState([{id:"root",name:"Google Drive"}]);
  const folder = path[path.length-1].id;
  const [pages,setPages] = useState([""]);
  const page = pages[pages.length-1];
  const [result,setResult] = useState<{files:DriveFile[];nextPageToken?:string}>();
  const [error,setError] = useState("");
  const [attaching,setAttaching] = useState("");
  const [attachmentError,setAttachmentError] = useState<{file:DriveFile;message:string}>();
  const [rename,setRename] = useState<DriveFile>();
  const [name,setName] = useState("");
  const [renaming,setRenaming] = useState(false);
  const [authorize,setAuthorize] = useState(false);
  const [renameError,setRenameError] = useState("");
  async function saveName() {
    if (!rename || renaming) return;
    setRenaming(true);
    setRenameError("");
    try {
      const response = await fetch(authorize ? "/api/library/connectors/google" : "/api/library/connectors/drive-files?file="+encodeURIComponent(rename.id), {
        method:authorize ? "POST" : "PATCH",headers:withAuthHeaders({"Content-Type":"application/json"}),
        body:JSON.stringify(authorize ? {allowRename:true} : {name:name.trim()}),
      });
      const data = await response.json();
      if (!response.ok) {
        setAuthorize(Boolean(data.authorize));
        throw new Error(data.error || "重命名失败");
      }
      if (authorize) window.location.assign(data.url);
      else {setRename(undefined);setAttempt(value=>value+1);}
    } catch (reason) {setRenameError(reason instanceof Error ? reason.message : "重命名失败");}
    finally {setRenaming(false);}
  }
  async function attach(file: DriveFile) {
    if (attaching) return;
    setAttaching(file.id);
    onBusyChange?.(true);
    setAttachmentError(undefined);
    try {
      const response = await fetch("/api/library/connectors/drive-files?" + new URLSearchParams({file:file.id}),{headers:withAuthHeaders()});
      if (!response.ok) {
        const detail = await response.json().catch(()=>null);
        throw new Error(detail?.error || "暂时无法读取文件，请重试。");
      }
      const encoded = response.headers.get("Content-Disposition")?.split("filename*=UTF-8''")[1];
      const name = encoded ? decodeURIComponent(encoded) : file.name;
      await onAttach([new File([await response.blob()],name,{type:response.headers.get("X-Attachment-Type") || file.mimeType})]);
    } catch (reason) {setAttachmentError({file,message:reason instanceof TypeError ? "请检查网络连接后重试。" : reason instanceof Error ? reason.message : "添加失败"});}
    finally {setAttaching("");onBusyChange?.(false);}
  }
  const [attempt,setAttempt] = useState(0);
  useEffect(()=>{
    const controller = new AbortController();
    setResult(undefined); setError("");
    fetch("/api/library/connectors/drive-files?" + new URLSearchParams({folder,page,scope,query,sort:sort.key,direction:sort.descending ? "desc" : "asc"}),{headers:withAuthHeaders(),signal:controller.signal})
      .then(async response=>{
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "无法读取文件夹");
        if (!controller.signal.aborted) setResult(data);
      }).catch(reason=>{if (!controller.signal.aborted) setError(reason instanceof TypeError ? "请检查网络连接后重试。" : reason instanceof SyntaxError ? "文件列表未能加载，请重试。" : reason.message || "无法读取文件夹");});
    return ()=>controller.abort();
  },[folder,page,scope,query,sort,attempt]);
  const recent = scope === "recent" && folder === "root";
  function sortHeader(key:string, label:string) {
    return <th scope="col" aria-sort={!recent && sort.key===key ? (sort.descending ? "descending" : "ascending") : undefined}>
      <Button size="sm" variant="ghost" isDisabled={recent} onClick={()=>{
        setSort({key,descending:sort.key===key ? !sort.descending : key!=="name"});
        setPages([""]);
      }}>{label}</Button>
    </th>;
  }
  return <Box flex="1" p={6} overflow="auto">
    {onBackToLibrary && <Button display={{base:"inline-flex",md:"none"}} size="sm" variant="ghost" mb={3} onClick={onBackToLibrary}>‹ 返回资料空间</Button>}
    <Flex justify="space-between" align="center" wrap="wrap" gap={3}><Heading size="md">Google Drive</Heading>
      <Input type="search" aria-label="搜索" placeholder="搜索" size="sm" borderRadius="full" maxW="240px" value={search} onChange={event=>setSearch(event.target.value)}/></Flex>
    <Flex aria-label="Drive 文件范围" gap={1} my={3} wrap="wrap">{[["recent","最近"],["mine","我的云端硬盘"],["shared","与我共享"]].map(([value,label])=>
      <Button key={value} size="sm" borderRadius="full" aria-pressed={scope===value} variant={scope===value ? "solid" : "ghost"} onClick={()=>{
        setScope(value);setPath([{id:"root",name:label}]);setPages([""]);setSearch("");setQuery("");
      }}>{label}</Button>)}</Flex>
    {path.length>1 && <Flex as="nav" aria-label="文件夹路径" my={3} wrap="wrap">{path.map((part,i)=><Button key={part.id} size="sm" variant="ghost" onClick={()=>{setPath(path.slice(0,i+1));setPages([""]);}}>{part.name}</Button>)}</Flex>}
    {error ? <Flex role="alert" align="center" wrap="wrap" gap={2} p={3} borderRadius="10px" bg="#faf5f2" color="#694332">
      <CircleAlert size={16} aria-hidden style={{flexShrink:0}}/>
      <Text flex="1 1 12rem" fontSize="sm" overflowWrap="anywhere">{error}</Text>
      <Button size="xs" variant="outline" borderRadius="full" onClick={()=>setAttempt(n=>n+1)}>重试</Button>
      {connect && <Button size="xs" variant="ghost" borderRadius="full" onClick={connect}>连接插件</Button>}
    </Flex> :
    !result ? <Text role="status">正在加载文件…</Text> : <><Box overflowX="auto"><Box as="table" width="full" fontSize="sm" textAlign="left" aria-label="Google Drive 文件"
      sx={{"& th":{fontWeight:"normal",color:"gray.600"},"& td":{borderTop:"1px solid #eee",height:"50px",paddingInline:"8px"}}}>
      <thead><tr>{sortHeader("name","名称")}{sortHeader("modified",recent ? "最近活动时间" : "修改日期")}
        {!recent && sortHeader("size","大小")}<th scope="col" aria-label="文件操作"/></tr></thead>
      <tbody>{result.files.map(file=><tr key={file.id}>
        <td>{file.mimeType==="application/vnd.google-apps.folder" ? <Button variant="ghost" leftIcon={<Folder size={16}/>} onClick={()=>{setPath([...path,file]);setPages([""]);setSearch("");setQuery("");}}>{file.name}</Button> :
          <Link href={file.webViewLink || "https://drive.google.com/open?id="+encodeURIComponent(file.id)} isExternal>{file.name}</Link>}</td>
        <td>{recent && file.viewedByMeTime && file.viewedByMeTime >= (file.modifiedTime || "") ? formatRelativeTime(file.viewedByMeTime)+"打开" : formatRelativeTime(file.modifiedTime) || "—"}</td>
        {!recent && <td>{file.size ? new Intl.NumberFormat("zh-CN",{style:"unit",unit:"byte"}).format(Number(file.size)) : "—"}</td>}
        <td>{file.mimeType!=="application/vnd.google-apps.folder" && <Button size="xs" variant="ghost" isLoading={attaching===file.id} isDisabled={Boolean(attaching)} onClick={()=>attach(file)}>添加到聊天</Button>}
          {file.mimeType!=="application/vnd.google-apps.folder" && <Menu placement="bottom-end">
            <MenuButton as={IconButton} size="xs" variant="ghost" aria-label={`打开 ${file.name} 的操作菜单`} icon={<MoreHorizontal size={16}/>}/>
            <MenuList><MenuItem onClick={()=>{setRename(file);setName(file.name);setAuthorize(false);setRenameError("");}}>重命名</MenuItem><MenuItem as="a" download href={"/api/library/connectors/drive-files?" + new URLSearchParams({file:file.id,download:"1"})}>下载</MenuItem></MenuList>
          </Menu>}</td>
      </tr>)}</tbody></Box></Box>{!result.files.length && <Text>{query ? "没有符合条件的文件" : folder!=="root" ? "此文件夹为空" : "暂无文件"}</Text>}
      <Flex gap={2} mt={3}>{pages.length>1 && <Button onClick={()=>setPages(pages.slice(0,-1))}>上一页</Button>}
        {result.nextPageToken && <Button onClick={()=>setPages([...pages,result.nextPageToken!])}>下一页</Button>}</Flex></>}
    {rename && <Modal isOpen isCentered onClose={()=>{if (!renaming) setRename(undefined);}}><ModalOverlay/><ModalContent mx={3} borderRadius="16px">
      <ModalHeader>重命名文件</ModalHeader><form onSubmit={event=>{event.preventDefault();if (name.trim() && name.trim()!==rename.name) void saveName();}}>
        <ModalBody><Text as="label" htmlFor="drive-filename">文件名</Text><Input id="drive-filename" autoFocus maxLength={255} value={name} onFocus={event=>event.target.select()} onChange={event=>setName(event.target.value)}/>
        {renameError && <Text role="alert" mt={2}>{renameError}</Text>}</ModalBody>
        <ModalFooter gap={2}><Button onClick={()=>setRename(undefined)} isDisabled={renaming}>取消</Button>
          <Button type="submit" isDisabled={!name.trim() || name.trim()===rename.name} isLoading={renaming}>{authorize ? "前往授权" : "重命名"}</Button></ModalFooter>
      </form></ModalContent></Modal>}
    {attachmentError && <Flex role="alert" align="center" gap={3} mt={3} p={3} bg="#faf5f2" color="#694332" borderRadius="10px">
      <CircleAlert size={16} aria-hidden style={{flexShrink:0}}/>
      <Box minW={0} flex={1}><Text fontSize="sm" fontWeight="medium" overflowWrap="anywhere">未能添加“{attachmentError.file.name}”</Text>
        <Text fontSize="sm" overflowWrap="anywhere">{attachmentError.message}</Text></Box>
      <Button size="xs" variant="outline" borderRadius="full" onClick={()=>attach(attachmentError.file)}>重试</Button>
    </Flex>}
  </Box>;
}

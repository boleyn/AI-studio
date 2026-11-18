import { Box, Button, Flex, Heading, Input, Link, Text } from "@chakra-ui/react";
import { useEffect, useState } from "react";
import { Folder } from "lucide-react";
import { withAuthHeaders } from "@features/auth/client/authClient";

interface DriveFile {id:string; name:string; mimeType:string; webViewLink?:string}
export default function LibraryDrive({connect,onAttach}:{connect?:()=>void;onAttach:(files:File[])=>Promise<void>}) {
  const [scope,setScope] = useState("recent");
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
  const [attachmentError,setAttachmentError] = useState("");
  async function attach(file: DriveFile) {
    setAttaching(file.id);
    setAttachmentError("");
    try {
      const response = await fetch("/api/library/connectors/drive-files?" + new URLSearchParams({file:file.id}),{headers:withAuthHeaders()});
      if (!response.ok) throw new Error((await response.json()).error || "读取失败");
      const encoded = response.headers.get("Content-Disposition")?.split("filename*=UTF-8''")[1];
      const name = encoded ? decodeURIComponent(encoded) : file.name;
      await onAttach([new File([await response.blob()],name,{type:response.headers.get("X-Attachment-Type") || file.mimeType})]);
    } catch (reason) {setAttachmentError(reason instanceof Error ? reason.message : "添加失败");}
    finally {setAttaching("");}
  }
  const [attempt,setAttempt] = useState(0);
  useEffect(()=>{
    const controller = new AbortController();
    setResult(undefined); setError("");
    fetch("/api/library/connectors/drive-files?" + new URLSearchParams({folder,page,scope,query}),{headers:withAuthHeaders(),signal:controller.signal})
      .then(async response=>{
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "无法读取文件夹");
        if (!controller.signal.aborted) setResult(data);
      }).catch(reason=>{if (!controller.signal.aborted) setError(reason.message || "无法读取文件夹");});
    return ()=>controller.abort();
  },[folder,page,scope,query,attempt]);
  return <Box flex="1" p={6} overflow="auto"><Flex justify="space-between" align="center" wrap="wrap" gap={3}><Heading size="md">Google Drive</Heading>
      <Input type="search" aria-label="搜索" placeholder="搜索" size="sm" borderRadius="full" maxW="240px" value={search} onChange={event=>setSearch(event.target.value)}/></Flex>
    <Flex aria-label="Drive 文件范围" gap={1} my={3} wrap="wrap">{[["recent","最近"],["mine","我的云端硬盘"],["shared","与我共享"]].map(([value,label])=>
      <Button key={value} size="sm" borderRadius="full" aria-pressed={scope===value} variant={scope===value ? "solid" : "ghost"} onClick={()=>{
        setScope(value);setPath([{id:"root",name:label}]);setPages([""]);setSearch("");setQuery("");
      }}>{label}</Button>)}</Flex>
    {path.length>1 && <Flex as="nav" aria-label="文件夹路径" my={3} wrap="wrap">{path.map((part,i)=><Button key={part.id} size="sm" variant="ghost" onClick={()=>{setPath(path.slice(0,i+1));setPages([""]);}}>{part.name}</Button>)}</Flex>}
    {error ? <Flex align="center" gap={2}><Text role="alert">{error}</Text><Button onClick={()=>setAttempt(n=>n+1)}>重试</Button>{connect && <Button onClick={connect}>连接插件</Button>}</Flex> :
    !result ? <Text role="status">正在加载文件…</Text> : <><Box as="ul" listStyleType="none">
      {result.files.map(file=><Box as="li" key={file.id} py={2} borderBottom="1px solid #eee">
        {file.mimeType==="application/vnd.google-apps.folder" ? <Button variant="ghost" leftIcon={<Folder size={16}/>} onClick={()=>{setPath([...path,file]);setPages([""]);setSearch("");setQuery("");}}>{file.name}</Button> :
        <Flex align="center" justify="space-between" gap={2}><Link href={file.webViewLink || "https://drive.google.com/open?id="+encodeURIComponent(file.id)} isExternal>{file.name}</Link><Button size="xs" variant="ghost" isLoading={attaching===file.id} isDisabled={Boolean(attaching)} onClick={()=>attach(file)}>添加到聊天</Button></Flex>}
      </Box>)}</Box>{!result.files.length && <Text>{query ? "没有符合条件的文件" : folder!=="root" ? "此文件夹为空" : "暂无文件"}</Text>}
      <Flex gap={2} mt={3}>{pages.length>1 && <Button onClick={()=>setPages(pages.slice(0,-1))}>上一页</Button>}
        {result.nextPageToken && <Button onClick={()=>setPages([...pages,result.nextPageToken!])}>下一页</Button>}</Flex></>}
    {attachmentError && <Text role="alert">{attachmentError}</Text>}
  </Box>;
}

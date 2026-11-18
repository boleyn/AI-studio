import { Box, Button, Flex, Heading, Input, Link, Text } from "@chakra-ui/react";
import { useEffect, useState } from "react";
import { Folder } from "lucide-react";
import { withAuthHeaders } from "@features/auth/client/authClient";

import { formatRelativeTime } from "./relativeTime";

interface DriveFile {id:string; name:string; mimeType:string; webViewLink?:string; modifiedTime?:string; viewedByMeTime?:string; size?:string}
export default function LibraryDrive({connect,onAttach}:{connect?:()=>void;onAttach:(files:File[])=>Promise<void>}) {
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
    fetch("/api/library/connectors/drive-files?" + new URLSearchParams({folder,page,scope,query,sort:sort.key,direction:sort.descending ? "desc" : "asc"}),{headers:withAuthHeaders(),signal:controller.signal})
      .then(async response=>{
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "无法读取文件夹");
        if (!controller.signal.aborted) setResult(data);
      }).catch(reason=>{if (!controller.signal.aborted) setError(reason.message || "无法读取文件夹");});
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
  return <Box flex="1" p={6} overflow="auto"><Flex justify="space-between" align="center" wrap="wrap" gap={3}><Heading size="md">Google Drive</Heading>
      <Input type="search" aria-label="搜索" placeholder="搜索" size="sm" borderRadius="full" maxW="240px" value={search} onChange={event=>setSearch(event.target.value)}/></Flex>
    <Flex aria-label="Drive 文件范围" gap={1} my={3} wrap="wrap">{[["recent","最近"],["mine","我的云端硬盘"],["shared","与我共享"]].map(([value,label])=>
      <Button key={value} size="sm" borderRadius="full" aria-pressed={scope===value} variant={scope===value ? "solid" : "ghost"} onClick={()=>{
        setScope(value);setPath([{id:"root",name:label}]);setPages([""]);setSearch("");setQuery("");
      }}>{label}</Button>)}</Flex>
    {path.length>1 && <Flex as="nav" aria-label="文件夹路径" my={3} wrap="wrap">{path.map((part,i)=><Button key={part.id} size="sm" variant="ghost" onClick={()=>{setPath(path.slice(0,i+1));setPages([""]);}}>{part.name}</Button>)}</Flex>}
    {error ? <Flex align="center" gap={2}><Text role="alert">{error}</Text><Button onClick={()=>setAttempt(n=>n+1)}>重试</Button>{connect && <Button onClick={connect}>连接插件</Button>}</Flex> :
    !result ? <Text role="status">正在加载文件…</Text> : <><Box overflowX="auto"><Box as="table" width="full" fontSize="sm" textAlign="left" aria-label="Google Drive 文件"
      sx={{"& th":{fontWeight:"normal",color:"gray.600"},"& td":{borderTop:"1px solid #eee",height:"50px",paddingInline:"8px"}}}>
      <thead><tr>{sortHeader("name","名称")}{sortHeader("modified",recent ? "最近活动时间" : "修改日期")}
        {!recent && sortHeader("size","大小")}<th scope="col" aria-label="文件操作"/></tr></thead>
      <tbody>{result.files.map(file=><tr key={file.id}>
        <td>{file.mimeType==="application/vnd.google-apps.folder" ? <Button variant="ghost" leftIcon={<Folder size={16}/>} onClick={()=>{setPath([...path,file]);setPages([""]);setSearch("");setQuery("");}}>{file.name}</Button> :
          <Link href={file.webViewLink || "https://drive.google.com/open?id="+encodeURIComponent(file.id)} isExternal>{file.name}</Link>}</td>
        <td>{recent && file.viewedByMeTime && file.viewedByMeTime >= (file.modifiedTime || "") ? formatRelativeTime(file.viewedByMeTime)+"打开" : formatRelativeTime(file.modifiedTime) || "—"}</td>
        {!recent && <td>{file.size ? new Intl.NumberFormat("zh-CN",{style:"unit",unit:"byte"}).format(Number(file.size)) : "—"}</td>}
        <td>{file.mimeType!=="application/vnd.google-apps.folder" && <Button size="xs" variant="ghost" isLoading={attaching===file.id} isDisabled={Boolean(attaching)} onClick={()=>attach(file)}>添加到聊天</Button>}</td>
      </tr>)}</tbody></Box></Box>{!result.files.length && <Text>{query ? "没有符合条件的文件" : folder!=="root" ? "此文件夹为空" : "暂无文件"}</Text>}
      <Flex gap={2} mt={3}>{pages.length>1 && <Button onClick={()=>setPages(pages.slice(0,-1))}>上一页</Button>}
        {result.nextPageToken && <Button onClick={()=>setPages([...pages,result.nextPageToken!])}>下一页</Button>}</Flex></>}
    {attachmentError && <Text role="alert">{attachmentError}</Text>}
  </Box>;
}

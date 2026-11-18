import { Box, Button, Flex, Heading, Link, Text } from "@chakra-ui/react";
import { useEffect, useState } from "react";
import { Folder } from "lucide-react";
import { withAuthHeaders } from "@features/auth/client/authClient";

interface DriveFile {id:string; name:string; mimeType:string; webViewLink?:string}
export default function LibraryDrive({connect}:{connect:()=>void}) {
  const [path,setPath] = useState([{id:"root",name:"Google Drive"}]);
  const folder = path[path.length-1].id;
  const [pages,setPages] = useState([""]);
  const page = pages[pages.length-1];
  const [result,setResult] = useState<{files:DriveFile[];nextPageToken?:string}>();
  const [error,setError] = useState("");
  const [attempt,setAttempt] = useState(0);
  useEffect(()=>{
    const controller = new AbortController();
    setResult(undefined); setError("");
    fetch("/api/library/connectors/drive-files?" + new URLSearchParams({folder,page}),{headers:withAuthHeaders(),signal:controller.signal})
      .then(async response=>{
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "无法读取文件夹");
        if (!controller.signal.aborted) setResult(data);
      }).catch(reason=>{if (!controller.signal.aborted) setError(reason.message || "无法读取文件夹");});
    return ()=>controller.abort();
  },[folder,page,attempt]);
  return <Box flex="1" p={6} overflow="auto"><Heading size="md">Google Drive</Heading>
    <Flex as="nav" aria-label="文件夹路径" my={3} wrap="wrap">{path.map((part,i)=><Button key={part.id} size="sm" variant="ghost" onClick={()=>{setPath(path.slice(0,i+1));setPages([""]);}}>{part.name}</Button>)}</Flex>
    {error ? <Flex align="center" gap={2}><Text role="alert">{error}</Text><Button onClick={()=>setAttempt(n=>n+1)}>重试</Button><Button onClick={connect}>连接插件</Button></Flex> :
    !result ? <Text role="status">正在加载文件…</Text> : <><Box as="ul" listStyleType="none">
      {result.files.map(file=><Box as="li" key={file.id} py={2} borderBottom="1px solid #eee">
        {file.mimeType==="application/vnd.google-apps.folder" ? <Button variant="ghost" leftIcon={<Folder size={16}/>} onClick={()=>{setPath([...path,file]);setPages([""]);}}>{file.name}</Button> :
        <Link href={file.webViewLink || "https://drive.google.com/open?id="+encodeURIComponent(file.id)} isExternal>{file.name}</Link>}
      </Box>)}</Box>{!result.files.length && <Text>此文件夹为空</Text>}
      <Flex gap={2} mt={3}>{pages.length>1 && <Button onClick={()=>setPages(pages.slice(0,-1))}>上一页</Button>}
        {result.nextPageToken && <Button onClick={()=>setPages([...pages,result.nextPageToken!])}>下一页</Button>}</Flex></>}
  </Box>;
}

import { Box, Button, Flex, Input, Text, Textarea } from "@chakra-ui/react";
import { useEffect, useState } from "react";
import { withAuthHeaders } from "@features/auth/client/authClient";
import type { LibraryFile } from "@/types/library";

export default function LibraryPageEditor({page,shareId,backLabel="返回资料空间",onBack,onSaved}:{page:Pick<LibraryFile,"id">;shareId?:string;backLabel?:string;onBack:()=>void;onSaved:(name:string,time:string)=>void}) {
  const [content,setContent] = useState<{name:string;body:string}>();
  const [revision,setRevision] = useState(0);
  const [conflict,setConflict] = useState<{name:string;body:string;revision:number}>();
  const [failed,setFailed] = useState(false);
  const [attempt,setAttempt] = useState(0);
  const [busy,setBusy] = useState(false);
  const [status,setStatus] = useState("");
  const url = "/api/library/pages?id=" + encodeURIComponent(page.id) + (shareId ? "&share=" + encodeURIComponent(shareId) : "");
  useEffect(() => {
    const abort = new AbortController();
    setFailed(false);
    fetch(url,{headers:withAuthHeaders(),signal:abort.signal}).then(async response => {
      if (!response.ok) throw new Error();
      const data = await response.json();
      if (!abort.signal.aborted) {setContent({name:data.name,body:data.body});setRevision(data.revision || 0);setConflict(undefined);}
    }).catch(() => { if(!abort.signal.aborted) setFailed(true); });
    return () => abort.abort();
  },[url,attempt]);
  async function save() {
    if (!content || busy || conflict) return;
    setBusy(true);
    try {
      const response = await fetch(url,{method:"PATCH",headers:withAuthHeaders({"Content-Type":"application/json"}),body:JSON.stringify({...content,expectedRevision:revision})});
      if (response.status === 409) {
        setConflict(await response.json());
        setStatus("页面已有新版本，你的草稿已保留");
        return;
      }
      if (!response.ok) throw new Error();
      const {time,revision:nextRevision} = await response.json();
      setRevision(nextRevision);
      onSaved(content.name.trim(),time);
      setStatus("已保存");
    } catch { setStatus("保存失败，请重试"); }
    finally { setBusy(false); }
  }
  return <Box flex="1" minW={0} p={6} overflowY="auto"><Flex align="center" justify="space-between">
    <Button variant="ghost" size="sm" onClick={onBack}>{backLabel}</Button>
    <Flex align="center" gap={3}><Text role="status" fontSize="sm">{status}</Text><Button size="sm" onClick={save} isLoading={busy} isDisabled={!content?.name.trim() || Boolean(conflict)}>保存</Button></Flex>
    </Flex>{failed ? <Button onClick={() => setAttempt(attempt+1)}>加载失败，重试</Button> :
    content && <Box maxW="760px" mx="auto" mt="8vh">
      {conflict && <Box as="section" aria-label="最新版本" borderWidth="1px" borderRadius="12px" p={4} mb={5}>
        <Text fontWeight="600">最新版本 · {conflict.name}</Text><Text whiteSpace="pre-wrap" maxH="30vh" overflowY="auto" my={2}>{conflict.body}</Text>
        <Button size="sm" onClick={()=>{setRevision(conflict.revision || 0);setConflict(undefined);setStatus("请核对草稿后保存");}}>已对照，继续编辑草稿</Button>
      </Box>}
      <Input isReadOnly={busy} aria-label="页面标题" variant="unstyled" fontSize="32px" fontWeight="600" value={content.name} maxLength={255}
        onChange={event => {setContent({...content,name:event.target.value});setStatus("尚未保存");}}/>
      <Textarea isReadOnly={busy} aria-label="页面正文" variant="unstyled" resize="vertical" minH="58vh" mt={8} value={content.body} maxLength={500000}
        onChange={event => {setContent({...content,body:event.target.value});setStatus("尚未保存");}}/>
    </Box>}</Box>;
}

import { Box, Button, Flex, Input, Text, Textarea } from "@chakra-ui/react";
import { useEffect, useState } from "react";
import { withAuthHeaders } from "@features/auth/client/authClient";
import type { LibraryFile } from "@/types/library";

export default function LibraryPageEditor({page,onBack,onSaved}:{page:LibraryFile;onBack:()=>void;onSaved:(name:string,time:string)=>void}) {
  const [content,setContent] = useState<{name:string;body:string}>();
  const [failed,setFailed] = useState(false);
  const [attempt,setAttempt] = useState(0);
  const [busy,setBusy] = useState(false);
  const [status,setStatus] = useState("");
  const url = "/api/library/pages?id=" + encodeURIComponent(page.id);
  useEffect(() => {
    const abort = new AbortController();
    setFailed(false);
    fetch(url,{headers:withAuthHeaders(),signal:abort.signal}).then(async response => {
      if (!response.ok) throw new Error();
      const data = await response.json();
      if (!abort.signal.aborted) setContent({name:data.name,body:data.body});
    }).catch(() => { if(!abort.signal.aborted) setFailed(true); });
    return () => abort.abort();
  },[url,attempt]);
  async function save() {
    if (!content || busy) return;
    setBusy(true);
    try {
      const response = await fetch(url,{method:"PATCH",headers:withAuthHeaders({"Content-Type":"application/json"}),body:JSON.stringify(content)});
      if (!response.ok) throw new Error();
      const {time} = await response.json();
      onSaved(content.name.trim(),time);
      setStatus("已保存");
    } catch { setStatus("保存失败，请重试"); }
    finally { setBusy(false); }
  }
  return <Box flex="1" minW={0} p={6} overflowY="auto"><Flex align="center" justify="space-between">
    <Button variant="ghost" size="sm" onClick={onBack}>返回资料空间</Button>
    <Flex align="center" gap={3}><Text role="status" fontSize="sm">{status}</Text><Button size="sm" onClick={save} isLoading={busy} isDisabled={!content?.name.trim()}>保存</Button></Flex>
    </Flex>{failed ? <Button onClick={() => setAttempt(attempt+1)}>加载失败，重试</Button> :
    content && <Box maxW="760px" mx="auto" mt="8vh">
      <Input aria-label="页面标题" variant="unstyled" fontSize="32px" fontWeight="600" value={content.name} maxLength={255}
        onChange={event => {setContent({...content,name:event.target.value});setStatus("尚未保存");}}/>
      <Textarea aria-label="页面正文" variant="unstyled" resize="vertical" minH="58vh" mt={8} value={content.body} maxLength={500000}
        onChange={event => {setContent({...content,body:event.target.value});setStatus("尚未保存");}}/>
    </Box>}</Box>;
}

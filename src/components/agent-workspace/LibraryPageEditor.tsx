import { Box, Button, Flex, Input, Text, Textarea } from "@chakra-ui/react";
import { useEffect, useState, type ReactNode } from "react";
import { withAuthHeaders } from "@features/auth/client/authClient";
import { fromLibrary } from "@features/chat/services/libraryFileOrigin";
import type { LibraryFile } from "@/types/library";

export type PageDraft = {name:string;body:string;revision:number};

export default function LibraryPageEditor({page,shareId,backLabel="返回资料空间",onBack,onSaved,onChat,subpages,drafts}:{page:Pick<LibraryFile,"id">;shareId?:string;backLabel?:string;onBack:()=>void;subpages?:ReactNode;drafts?:Map<string,PageDraft>;onChat?:(file:File,quote?:string)=>Promise<void>;onSaved:(name:string,time:string)=>void}) {
  const [content,setContent] = useState<{name:string;body:string}>();
  const [revision,setRevision] = useState(0);
  const [conflict,setConflict] = useState<{name:string;body:string;revision:number}>();
  const [failed,setFailed] = useState(false);
  const [attempt,setAttempt] = useState(0);
  const [busy,setBusy] = useState(false);
  const [selection,setSelection] = useState({start:0,end:0});
  const selectedText = content?.body.slice(selection.start,selection.end).trim();
  const [openingChat,setOpeningChat] = useState(false);
  const [status,setStatus] = useState("");
  const url = "/api/library/pages?id=" + encodeURIComponent(page.id) + (shareId ? "&share=" + encodeURIComponent(shareId) : "");
  useEffect(() => {
    const abort = new AbortController();
    setFailed(false);
    fetch(url,{headers:withAuthHeaders(),signal:abort.signal}).then(async response => {
      if (!response.ok) throw new Error();
      const data = await response.json();
      if (abort.signal.aborted) return;
      const draft = drafts?.get(url);
      const currentRevision = data.revision || 0;
      setContent(draft || {name:data.name,body:data.body});
      setRevision(draft?.revision ?? currentRevision);
      const changed = draft && currentRevision !== draft.revision;
      setConflict(changed ? data : undefined);
      setStatus(changed ? "页面已有新版本，你的草稿已保留" : draft ? "尚未保存" : "");
    }).catch(() => { if(!abort.signal.aborted) setFailed(true); });
    return () => abort.abort();
  },[url,attempt,drafts]);
  function edit(next:{name:string;body:string}) {
    setContent(next);
    drafts?.set(url,{...next,revision});
    setStatus("尚未保存");
  }
  function acknowledgeConflict() {
    if (!content || !conflict) return;
    const latestRevision = conflict.revision || 0;
    drafts?.set(url,{...content,revision:latestRevision});
    setRevision(latestRevision);
    setConflict(undefined);
    setStatus("尚未保存");
  }
  async function save() {
    if (!content || busy || conflict) return;
    setBusy(true);
    try {
      const response = await fetch(url,{method:"PATCH",headers:withAuthHeaders({"Content-Type":"application/json"}),body:JSON.stringify({name:content.name,body:content.body,expectedRevision:revision})});
      if (response.status === 409) {
        setConflict(await response.json());
        setStatus("页面已有新版本，你的草稿已保留");
        return;
      }
      if (!response.ok) throw new Error();
      const {time,revision:nextRevision} = await response.json();
      setRevision(nextRevision);
      onSaved(content.name.trim(),time);
      drafts?.delete(url);
      setStatus("已保存");
    } catch { setStatus("保存失败，请重试"); }
    finally { setBusy(false); }
  }
  async function discussPage() {
    if (!content || !onChat || openingChat) return;
    setOpeningChat(true);
    try {
      const title = content.name.trim() || "无标题页";
      const snapshot = new File(["# " + title + "\n\n" + content.body],title + ".md",{type:"text/markdown"});
      const quote = selectedText ? selectedText.split("\n").map(line=>"> " + line).join("\n") + "\n\n" : undefined;
      await onChat(fromLibrary(snapshot,shareId || page.id),quote);
    } catch { setStatus("无法打开聊天，请重试"); }
    finally { setOpeningChat(false); }
  }
  return <Box flex="1" minW={0} p={6} overflowY="auto"><Flex align="center" justify="space-between">
    <Button variant="ghost" size="sm" onClick={onBack}>{backLabel}</Button>
    <Flex align="center" gap={3}><Text role="status" fontSize="sm">{status}</Text>{onChat && <Button size="sm" variant="ghost" isLoading={openingChat} isDisabled={!content} onClick={discussPage}>{selectedText ? "引用选中文字" : "在聊天中引用"}</Button>}
      <Button size="sm" onClick={save} isLoading={busy} isDisabled={!content?.name.trim() || Boolean(conflict)}>保存</Button></Flex>
    </Flex>{failed ? <Button onClick={() => setAttempt(attempt+1)}>加载失败，重试</Button> :
    content && <Box maxW="760px" mx="auto" mt="8vh">
      {conflict && <Box as="section" aria-label="最新版本" borderWidth="1px" borderRadius="12px" p={4} mb={5}>
        <Text fontWeight="600">最新版本 · {conflict.name}</Text><Text whiteSpace="pre-wrap" maxH="30vh" overflowY="auto" my={2}>{conflict.body}</Text>
        <Button size="sm" onClick={acknowledgeConflict}>已对照，继续编辑草稿</Button>
      </Box>}
      <Input isReadOnly={busy} aria-label="页面标题" variant="unstyled" fontSize="32px" fontWeight="600" value={content.name} maxLength={255}
        onChange={event => {edit({...content,name:event.target.value});}}/>
      <Textarea onSelect={event=>{
        const {selectionStart,selectionEnd} = event.currentTarget;
        setSelection({start:selectionStart,end:selectionEnd});
      }} isReadOnly={busy} aria-label="页面正文" variant="unstyled" resize="vertical" minH="58vh" mt={8} value={content.body} maxLength={500000}
        onChange={event => {edit({...content,body:event.target.value});}}/>
      {subpages}
    </Box>}</Box>;
}

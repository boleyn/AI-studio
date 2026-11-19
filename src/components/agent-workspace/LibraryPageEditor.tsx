import { markdownFilename } from "@/types/library";
import { Box, Button, Flex, Input, Text, Textarea, useMediaQuery } from "@chakra-ui/react";
import { useEffect, useState, type ReactNode } from "react";
import { withAuthHeaders } from "@features/auth/client/authClient";
import { fromLibrary } from "@features/chat/services/libraryFileOrigin";
import type { LibraryFile } from "@/types/library";

import LibraryMarkdown from "./LibraryMarkdown";

export const mobilePageReaderQuery = "(max-width: 767px) and (pointer: coarse)";

export type PageDraft = {name:string;body:string;revision:number};

export default function LibraryPageEditor({page,shareId,backLabel="返回资料空间",onBack,onSaved,onChat,onShare,subpages,drafts}:{page:Pick<LibraryFile,"id">;shareId?:string;backLabel?:string;onBack:()=>void;onShare?:()=>void;subpages?:ReactNode;drafts?:Map<string,PageDraft>;onChat?:(file:File,quote?:string)=>Promise<void>;onSaved:(name:string,time:string)=>void}) {
  const [mobileReader] = useMediaQuery(mobilePageReaderQuery);
  const [content,setContent] = useState<{name:string;body:string}>();
  const [revision,setRevision] = useState(0);
  const [conflict,setConflict] = useState<{name:string;body:string;revision:number}>();
  const [loadError,setLoadError] = useState("");
  const [attempt,setAttempt] = useState(0);
  const [busy,setBusy] = useState(false);
  const [selection,setSelection] = useState({start:0,end:0});
  const selectedText = content?.body.slice(selection.start,selection.end);
  const hasSelection = Boolean(selectedText?.trim());
  const [openingChat,setOpeningChat] = useState(false);
  const [status,setStatus] = useState("");
  const url = "/api/library/pages?id=" + encodeURIComponent(page.id) + (shareId ? "&share=" + encodeURIComponent(shareId) : "");
  useEffect(() => {
    const abort = new AbortController();
    setLoadError("");
    fetch(url,{headers:withAuthHeaders(),signal:abort.signal}).then(async response => {
      if (!response.ok) {
        if (!abort.signal.aborted) setLoadError(response.status === 401 ? "登录已过期，请重新登录。" :
          response.status === 403 ? "当前账号没有访问权限。" : response.status === 404 ? "页面可能已删除，或共享权限已变更。" : "暂时无法加载，请稍后重试。");
        return;
      }
      const data = await response.json();
      if (abort.signal.aborted) return;
      const draft = drafts?.get(url);
      const currentRevision = data.revision || 0;
      setContent(draft || {name:data.name,body:data.body});
      setRevision(draft?.revision ?? currentRevision);
      const changed = draft && currentRevision !== draft.revision;
      setConflict(changed ? data : undefined);
      setStatus(changed ? "页面已有新版本，你的草稿已保留" : draft ? "尚未保存" : "");
    }).catch(() => { if (!abort.signal.aborted) setLoadError("请检查网络连接后重试。"); });
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
    if (mobileReader || !content?.name.trim() || busy || conflict) return;
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
      const snapshot = new File(["# " + title + "\n\n" + content.body],markdownFilename(title),{type:"text/markdown"});
      const quote = selectedText && hasSelection ? selectedText.split("\n").map(line=>"> " + line).join("\n") + "\n\n" : undefined;
      await onChat(fromLibrary(snapshot,shareId || page.id),quote);
    } catch { setStatus("无法打开聊天，请重试"); }
    finally { setOpeningChat(false); }
  }
  return <Box flex="1" minW={0} p={6} overflowY="auto" onKeyDown={event => {
    if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "s") {
      event.preventDefault();
      if (!event.repeat) void save();
    }
  }}><Flex align="center" justify="space-between" wrap="wrap" gap={2}>
    <Button variant="ghost" size="sm" onClick={onBack}>{backLabel}</Button>
    <Flex align="center" gap={3}><Text role="status" fontSize="sm">{status}</Text>{onChat && <Button size="sm" variant="ghost" isLoading={openingChat} isDisabled={!content} onClick={discussPage}>{hasSelection ? "引用选中文字" : "在聊天中引用"}</Button>}
      {onShare && <Button size="sm" variant="outline" borderRadius="full" isDisabled={!content} onClick={onShare}>分享</Button>}
      {!mobileReader && <Button aria-keyshortcuts="Control+s Meta+s" size="sm" onClick={save} isLoading={busy} isDisabled={!content?.name.trim() || Boolean(conflict)}>保存</Button>}</Flex>
    </Flex>{loadError ? <Flex role="alert" align="center" gap={3} maxW="760px" mx="auto" mt={6} px={4} py={3} borderRadius="12px" bg="#faf5f2" color="#694332">
      <Box flex={1}><Text fontWeight="medium">无法打开页面</Text><Text fontSize="sm">{loadError}</Text></Box>
      <Button size="sm" variant="outline" borderRadius="full" onClick={()=>setAttempt(value=>value+1)}>重试</Button>
    </Flex> :
    content && <Box maxW="760px" mx="auto" mt="8vh">
      {conflict && <Box as="section" aria-label="最新版本" borderWidth="1px" borderRadius="12px" p={4} mb={5}>
        <Text fontWeight="600">最新版本 · {conflict.name}</Text><Text whiteSpace="pre-wrap" maxH="30vh" overflowY="auto" my={2}>{conflict.body}</Text>
        <Button size="sm" onClick={acknowledgeConflict}>已对照，继续编辑草稿</Button>
      </Box>}
      {mobileReader ? <><Text as="h1" fontSize="2xl" fontWeight="600" mb={5}>{content.name}</Text><LibraryMarkdown>{content.body}</LibraryMarkdown></> : <><Input isReadOnly={busy} aria-label="页面标题" variant="unstyled" fontSize="32px" fontWeight="600" value={content.name} maxLength={255}
        onChange={event => {edit({...content,name:event.target.value});}}/>
      <Textarea onSelect={event=>{
        const {selectionStart,selectionEnd} = event.currentTarget;
        setSelection({start:selectionStart,end:selectionEnd});
      }} isReadOnly={busy} aria-label="页面正文" variant="unstyled" resize="vertical" minH="58vh" mt={8} value={content.body} maxLength={500000}
        onChange={event => {edit({...content,body:event.target.value});}}/></>}
      {subpages}
    </Box>}</Box>;
}

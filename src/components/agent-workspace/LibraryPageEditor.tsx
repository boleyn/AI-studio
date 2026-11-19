import { markdownFilename } from "@/types/library";
import { X } from "lucide-react";
import { Box, Button, IconButton, Flex, Input, Text, Textarea, useMediaQuery } from "@chakra-ui/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { withAuthHeaders } from "@features/auth/client/authClient";
import { fromLibrary } from "@features/chat/services/libraryFileOrigin";
import type { LibraryFile } from "@/types/library";

import LibraryMarkdown from "./LibraryMarkdown";

export const mobilePageReaderQuery = "(max-width: 767px) and (pointer: coarse)";

const formattingCommands = [
  {command:"/heading", label:"标题", markdown:"## "},
  {command:"/checklist", label:"检查清单", markdown:"- [ ] "},
  {command:"/table", label:"表格", markdown:"| 列一 | 列二 |\n| --- | --- |\n|  |  |"},
];

export type PageDraft = {name:string;body:string;revision:number};

export default function LibraryPageEditor({page,shareId,backLabel="返回资料空间",locationLabel,onLocation,onCloseViewer,onBack,onSaved,onChat,onShare,onCreateSubpage,subpages,drafts}:{page:Pick<LibraryFile,"id">;shareId?:string;backLabel?:string;locationLabel?:string;onLocation?:()=>void;onCloseViewer?:()=>void;onBack:()=>void;onShare?:()=>void;onCreateSubpage?:()=>void;subpages?:ReactNode;drafts?:Map<string,PageDraft>;onChat?:(file:File,quote?:string)=>Promise<void>;onSaved:(name:string,time:string)=>void}) {
  const bodyInput = useRef<HTMLTextAreaElement>(null);
  const [mobileReader] = useMediaQuery(mobilePageReaderQuery);
  const [content,setContent] = useState<{name:string;body:string}>();
  const [revision,setRevision] = useState(0);
  const [conflict,setConflict] = useState<{name:string;body:string;revision:number}>();
  const [loadError,setLoadError] = useState("");
  const [attempt,setAttempt] = useState(0);
  const [busy,setBusy] = useState(false);
  const [selection,setSelection] = useState({start:0,end:0});
  const selectedText = content?.body.slice(selection.start,selection.end);
  const currentBody = content?.body ?? "";
  const lineStart = currentBody.slice(0, selection.start).lastIndexOf("\n") + 1;
  const commandPrefix = currentBody.slice(lineStart, selection.start);
  const showCommands = !busy && !conflict && selection.start === selection.end &&
    (!currentBody[selection.end] || currentBody[selection.end] === "\n") &&
    commandPrefix.startsWith("/");
  const matchingFormats = showCommands ? formattingCommands.filter(item=>item.command.startsWith(commandPrefix)) : [];
  const suggestSubpage = showCommands && onCreateSubpage && "/page".startsWith(commandPrefix);
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
      const data = await response.json().catch(error => {
        if (error instanceof SyntaxError) return null;
        throw error;
      });
      if (abort.signal.aborted) return;
      if (typeof data?.name !== "string" || typeof data.body !== "string") {
        setLoadError("页面内容无法读取，请重新加载。");
        return;
      }
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
  function insertFormatting(start:number, end:number, markdown:string) {
    if (!content) return;
    edit({...content, body:content.body.slice(0,start) + markdown + content.body.slice(end)});
    requestAnimationFrame(()=>{
      bodyInput.current?.focus();
      bodyInput.current?.setSelectionRange(start + markdown.length, start + markdown.length);
    });
  }
  function createSubpageFromLine(start:number, end:number) {
    if (!content || !onCreateSubpage) return;
    edit({...content, body:content.body.slice(0, start) + content.body.slice(end)});
    onCreateSubpage();
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
  async function discussPage(prompt?:string, body = content?.body) {
    if (!content || !onChat || openingChat) return;
    setOpeningChat(true);
    try {
      const title = content.name.trim() || "无标题页";
      const snapshot = new File(["# " + title + "\n\n" + body],markdownFilename(title),{type:"text/markdown"});
      const quote = selectedText && hasSelection ? selectedText.split("\n").map(line=>"> " + line).join("\n") + "\n\n" : undefined;
      await onChat(fromLibrary(snapshot,shareId || page.id),prompt ?? quote);
    } catch { setStatus("无法打开聊天，请重试"); }
    finally { setOpeningChat(false); }
  }
  const locationNav = locationLabel && <Flex as="nav" aria-label="面包屑导航" align="center" color="#5d5d5d" fontSize="14px" gap="4px" mt={2}>
    <Text as="span">In</Text>
    <Button variant="link" size="sm" color="inherit" fontWeight="normal" minW={0} onClick={onLocation ?? onBack}>
      <Text as="span" isTruncated>{locationLabel}</Text>
    </Button>
  </Flex>;
  return <Box flex="1" minW={0} p={6} overflowY="auto" onKeyDown={event => {
    if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "s") {
      event.preventDefault();
      if (!event.repeat) void save();
    }
  }}><Flex align="center" justify="space-between" wrap="wrap" gap={2}>
    <Button variant="ghost" size="sm" onClick={onBack}>{backLabel}</Button>
    <Flex align="center" gap={3}><Text role="status" fontSize="sm">{status}</Text>{onChat && <Button size="sm" variant="ghost" isLoading={openingChat} isDisabled={!content} onClick={()=>void discussPage()}>{hasSelection ? "引用选中文字" : "在聊天中引用"}</Button>}
      {onShare && <Button size="sm" variant="outline" borderRadius="full" isDisabled={!content} onClick={onShare}>分享</Button>}
      {!mobileReader && <Button aria-keyshortcuts="Control+s Meta+s" size="sm" onClick={save} isLoading={busy} isDisabled={!content?.name.trim() || Boolean(conflict)}>保存</Button>}
      {onCloseViewer && <IconButton aria-label="关闭查看器" title="关闭查看器" variant="ghost" size="sm" borderRadius="full"
        icon={<X size={18}/>} onClick={onCloseViewer}/>}</Flex>
    </Flex>{loadError ? <Flex role="alert" align="center" gap={3} maxW="760px" mx="auto" mt={6} px={4} py={3} borderRadius="12px" bg="#faf5f2" color="#694332">
      <Box flex={1}><Text fontWeight="medium">无法打开页面</Text><Text fontSize="sm">{loadError}</Text></Box>
      <Button size="sm" variant="outline" borderRadius="full" onClick={()=>setAttempt(value=>value+1)}>重试</Button>
    </Flex> :
    content && <Box maxW="760px" mx="auto" mt="8vh">
      {conflict && <Box as="section" aria-label="最新版本" borderWidth="1px" borderRadius="12px" p={4} mb={5}>
        <Text fontWeight="600">最新版本 · {conflict.name}</Text><Text whiteSpace="pre-wrap" maxH="30vh" overflowY="auto" my={2}>{conflict.body}</Text>
        <Button size="sm" onClick={acknowledgeConflict}>已对照，继续编辑草稿</Button>
      </Box>}
      {mobileReader ? <><Text as="h1" fontSize="2xl" fontWeight="600" >{content.name}</Text>{locationNav}<Box mt={5}/><LibraryMarkdown>{content.body}</LibraryMarkdown></> : <><Input isReadOnly={busy} aria-label="页面标题" placeholder="无标题页" variant="unstyled" fontSize="30px" lineHeight="1.1875" fontWeight="600" value={content.name} maxLength={255}
        onChange={event => {edit({...content,name:event.target.value});}}/>{locationNav}
      {(suggestSubpage || matchingFormats.length > 0) && <Flex wrap="wrap" gap={2} role="group" aria-label="页面命令">
      {matchingFormats.map(item=><Button key={item.command} size="sm" variant="outline" mt={3}
        onClick={()=>insertFormatting(lineStart, selection.end, item.markdown)}>{item.label} · {item.command}</Button>)}
      {suggestSubpage && <Button size="sm" variant="outline" mt={3} onClick={()=>createSubpageFromLine(lineStart, selection.end)}>
        创建子页面 · /page
      </Button>}</Flex>}
      <Textarea ref={bodyInput} onKeyDown={event => {
        if (busy || openingChat || conflict || event.key !== "Enter" || event.shiftKey || event.ctrlKey ||
          event.metaKey || event.altKey || event.nativeEvent.isComposing || event.repeat) return;
        const {value, selectionStart, selectionEnd} = event.currentTarget;
        if (selectionStart !== selectionEnd) return;
        const lineStart = value.slice(0, selectionStart).lastIndexOf("\n") + 1;
        if (selectionStart < value.length && value[selectionStart] !== "\n") return;
        const line = value.slice(lineStart, selectionStart);
        const format = formattingCommands.find(item=>item.command === line);
        if (format) {
          event.preventDefault();
          insertFormatting(lineStart, selectionStart, format.markdown);
          return;
        }
        const request = /^@ChatGPT\s+(.+)$/i.exec(line)?.[1].trim();
        if (request && onChat) {
          event.preventDefault();
          void discussPage(request, value.slice(0, lineStart) + value.slice(selectionStart));
          return;
        }
        if (line !== "/page" || !onCreateSubpage) return;
        event.preventDefault();
        createSubpageFromLine(lineStart, selectionStart);
      }} onSelect={event=>{
        const {selectionStart,selectionEnd} = event.currentTarget;
        setSelection({start:selectionStart,end:selectionEnd});
      }} isReadOnly={busy} aria-label="页面正文" variant="unstyled" fontSize="15px" lineHeight="1.5" resize="vertical" minH="58vh" mt={8} value={content.body} maxLength={500000}
        onChange={event => {const {value,selectionStart,selectionEnd} = event.currentTarget; setSelection({start:selectionStart,end:selectionEnd}); edit({...content,body:value});}}/></>}
      {subpages}
    </Box>}</Box>;
}

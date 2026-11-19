import { markdownFilename } from "@/types/library";
import { libraryActivityTime, libraryTypeName } from "@/types/library";
import SpaceInviteInput from "./SpaceInviteInput";
import SpaceIconPicker from "./SpaceIconPicker";
import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useRef, useState } from "react";
import { Box, Button, Flex, Heading, Input, InputGroup, InputLeftElement, InputRightElement, Text, IconButton, Menu, MenuButton, MenuDivider, FormLabel, Modal, ModalOverlay, ModalContent, ModalHeader, ModalBody, ModalFooter, ModalCloseButton, MenuItem, MenuList, MenuItemOption, MenuOptionGroup, Portal, useToast } from "@chakra-ui/react";
import { withAuthHeaders } from "@features/auth/client/authClient";
import { referenceTypes, type ImageReference, type LibraryFile } from "@/types/library";
import { CircleAlert, ArrowUp, Plus, Search, Pin, PinOff, Copy, FolderInput, Pencil, Share2, Download, MessageSquare, RotateCcw, Trash2, X, Bookmark, ChevronDown, ChevronRight, Folder, LayoutGrid, List, ListFilter, MoreHorizontal, PanelLeftOpen, FileText, Presentation, Sheet, PanelsTopLeft, Image as ImageIcon, Layers, Upload, Plug } from "lucide-react";
import { isArtifactImage } from "../workspace/ArtifactFileIcon";

import { expandLibrarySelection, isContainer, LibraryReadError, libraryReadMessage, libraryAttachmentUrl, loadSharedSpacePages, loadLibraryFiles, readLibraryAttachment, readLibraryAttachments, recordLibraryOpen } from "@features/chat/services/libraryAttachment";
import ArtifactShareDialog from "../workspace/ArtifactShareDialog";
import LibraryFileViewer from "./LibraryFileViewer";
import { formatRelativeTime } from "./relativeTime";
import LibraryDrive from "./LibraryDrive";
import LibraryConnectors from "./LibraryConnectors";
import LibrarySites from "./LibrarySites";
import LibraryItemIcon from "./LibraryItemIcon";
import LibrarySelectionBox from "./LibrarySelectionBox";
import LibraryPageEditor, { mobilePageReaderQuery, type PageDraft } from "./LibraryPageEditor";
import LibraryTemplates, { TemplateGallery, type SlideTemplateName } from "./LibraryTemplates";
import LibraryGlobalSearch from "./LibraryGlobalSearch";
import type { ProjectWithConversations } from "../AgentWorkspace";
import type { FileChatSizing } from "./FileChatDivider";
import LibrarySidebar from "./LibrarySidebar";

const isNative = (file:LibraryFile) => !file.shareId && (file.kind === "页面" || isContainer(file));
function renameSuffix(file?: LibraryFile) {
  if (!file || file.siteId || file.sharedPage || isNative(file)) return "";
  const dot = file.name.lastIndexOf(".");
  return dot > 0 && dot < file.name.length - 1 ? file.name.slice(dot) : "";
}

function formatFolderSize(bytes: number) {
  const units = ["B","KB","MB","GB","TB"];
  const scale = Math.min(units.length-1,Math.floor(Math.log(bytes)/Math.log(1024)));
  return (bytes / 1024 ** scale).toFixed(2) + " " + units[scale];
}
const fileSources = ["已上传", "生成的文件"];
const fileTypes = ["页面", "图像", "文档", "电子表格", "演示文稿", "PDF 文件"];
function fileType(file: LibraryFile) {
  if (isContainer(file)) return file.kind;
  if (file.kind === "页面" || file.sharedPage) return "页面";
  if (file.siteId) return "站点";
  const path = libraryTypeName(file);
  if (isArtifactImage(path)) return "图像";
  if (/\.(xlsx?|csv|tsv|ods)$/i.test(path)) return "电子表格";
  if (/\.(pptx?|odp)$/i.test(path)) return "演示文稿";
  if (/\.pdf$/i.test(path)) return "PDF 文件";
  if (/\.(docx?|txt|md|markdown|rtf|odt)$/i.test(path)) return "文档";
  return "其他";
}

export default function LibraryView({ fileChatWidth, setFileChatWidth, fileChatOpen, resumeFileChat, projects, onProject, onOpen, onBack, onChat }: FileChatSizing & { fileChatOpen:boolean; resumeFileChat?:()=>void; projects: ProjectWithConversations[]; onProject:(token:string)=>void; onChat:(files:File[],text?:string,itemId?:string,imageMode?:boolean)=>Promise<void>; onBack: () => void; onOpen: (token: string, chatId: string) => void }) {
  const [files, setFiles] = useState<LibraryFile[]>();
  const [selected,setSelected] = useState<string[]>([]);
  const [batchBusy,setBatchBusy] = useState(false);
  const [moveFailures,setMoveFailures] = useState<string[]>([]);
  const [batchMove,setBatchMove] = useState(false);
  const [failed, setFailed] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [connectors, setConnectors] = useState(false);
  const [globalSearch,setGlobalSearch] = useState(false);
  const [query, setQuery] = useState("");

  const [showTemplates,setShowTemplates] = useState(true);
  const [creating,setCreating] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [referenceDraft,setReferenceDraft] = useState<{file?:File; type?:ImageReference["type"]; name:string}>();
  const referenceFile = referenceDraft?.file;
  const [referencePreview,setReferencePreview] = useState("");
  useEffect(() => {
    if (!referenceFile) {setReferencePreview(""); return;}
    const url = URL.createObjectURL(referenceFile);
    setReferencePreview(url);
    return () => URL.revokeObjectURL(url);
  },[referenceFile]);
  const [confirmDiscard,setConfirmDiscard] = useState(false);
  function closeReference() {
    if (creating) return;
    if (referenceDraft?.file || referenceDraft?.type || referenceDraft?.name) setConfirmDiscard(true);
    else setReferenceDraft(undefined);
  }
  const [dropActive,setDropActive] = useState(false);
  const pageDrafts = useRef(new Map<string,PageDraft>());
  const referenceInput = useRef<HTMLInputElement>(null);
  async function uploadFiles(selected:File[], openCreated = false, reference?:ImageReference, parentId=folder?.id, fromTemplate=false) {
    if (!selected.length) return;
    if (router.query.libraryFolder && !parentId) {
      toast({status:"error",title:"无法上传到此位置",description:"请重新打开目标文件夹后上传。"});
      return;
    }
    let refreshAfterUpload = false;
    setCreating(true);
    try {
      for (const file of selected) {
        const params = new URLSearchParams({name:file.name});
        if (fromTemplate) params.set("fromTemplate","1");
        if (reference) { params.set("referenceType",reference.type); params.set("referenceName",reference.name); }
        if (parentId) params.set("folderId",parentId);
        let item: LibraryFile;
        try {
          const response = await fetch("/api/library/files?" + params,{method:"POST",headers:withAuthHeaders({"Content-Type":"application/octet-stream"}),body:file});
          if (!response.ok) {
            const failure = await response.json().catch(()=>null);
            toast({status:"error",title:file.name + " 上传失败",description:failure?.error ||
              (response.status === 413 ? "文件超过上传大小限制。" : response.status === 401 ? "请重新登录后上传。" : "请稍后重试。")});
            continue;
          }
          item = await response.json();
        } catch {
          refreshAfterUpload = true;
          toast({status:"warning",title:file.name + " 上传结果未确认",description:"本批上传结束后会刷新列表，请确认文件是否已出现。"});
          continue;
        }
        setFiles(previous => [item,...previous || []]);
        if (reference) setReferenceDraft(undefined);
        if (openCreated && parentId) {
          recordOpen(item);
          navigateList("全部","推荐",parentId,item.id,true);
        } else if (openCreated) openItem(item);
      }
    } catch { toast({status:"error",title:"上传中断，请重试"}); }
    finally {
      setCreating(false);
      if (refreshAfterUpload) setAttempt(value=>value+1);
    }
  }
  async function createSlides(template?: SlideTemplateName, parentId=folder?.id) {
    if (creating) return;
    setCreating(true);
    try {
      const slug = template?.toLowerCase().replaceAll(" ", "-") ?? "blank";
      const response = await fetch(`/library-templates/${slug}.pptx`);
      if (!response.ok) throw new Error();
      await uploadFiles([new File([await response.blob()], (template ?? "无标题演示文稿") + ".pptx", {
        type:"application/vnd.openxmlformats-officedocument.presentationml.presentation"
      })], true, undefined, parentId,true);
    } catch {
      toast({status:"error", title:"无法创建幻灯片，请重试"});
    } finally {
      setCreating(false);
    }
  }
  const [galleryOpen, setGalleryOpen] = useState(false);
  const galleryTrigger = useRef<HTMLButtonElement | null>(null);

  const [appearance,setAppearance] = useState({icon:"",color:"默认"});
  const [inviteQuery,setInviteQuery] = useState("");
  const [confirmSpaceDiscard,setConfirmSpaceDiscard] = useState(false);
  const continueEditing = useRef<HTMLButtonElement>(null);
  function closeSpaceDialog() {
    if (creating) return;
    if (title || inviteQuery || invitees.length || appearance.icon || appearance.color !== "默认") setConfirmSpaceDiscard(true);
    else setNewKind(undefined);
  }
  const [invitees,setInvitees] = useState<string[]>([]);
  const [inviteOpen,setInviteOpen] = useState(false);
  function openSpaceDialog() {
    setAppearance({icon:"",color:"默认"});
    setInviteQuery("");
    setConfirmSpaceDiscard(false);
    setInvitees([]);
    setInviteOpen(false);
    setTitle("");
    setNewKind("资料空间");
  }
  const [newKind,setNewKind] = useState<"文件夹"|"资料空间">();
  const [move,setMove] = useState<LibraryFile>();
  const [newDestinationName, setNewDestinationName] = useState<string>();
  const [destination,setDestination] = useState("");
  async function createPage(name:string, body:string, kind:"页面"|"文件夹"|"资料空间"="页面",duplicateId?:string,parentId=folder?.id) {
    if (creating) return;
    setCreating(true);
    try {
      const response = await fetch("/api/library/pages",{method:"POST", headers:withAuthHeaders({"Content-Type":"application/json"}), body:JSON.stringify({name,body,kind,duplicateId,...(kind === "资料空间" ? {appearance,invitees} : {}),folderId:kind === "资料空间" ? null : parentId})});
      if (!response.ok) throw new Error((await response.json().catch(()=>({}))).error);
      const page:LibraryFile = await response.json();
      setFiles(previous => [page,...previous || []]);
      setNewKind(undefined);
      if (page.folderId && page.kind === "页面") {
        recordOpen(page);
        navigateList("全部","推荐",containingFolderId(page),page.id,true);
      } else openItem(page);
    } catch (error) { toast({status:"error",title:"无法创建"+kind+"，请重试",description:error instanceof Error ? error.message : undefined}); }
    finally {setCreating(false);}
  }
  function recordOpen(file:LibraryFile) {
    const openedAt = new Date().toISOString();
    setFiles(current => current?.map(item => item.id === file.id ? {...item, openedAt} : item));
    recordLibraryOpen(file.id);
  }
  function openItem(file:LibraryFile) {
    recordOpen(file);
    if (file.kind === "资料空间" && file.shareId) {
      void router.push("/share/space/"+file.shareId);
      return;
    }
    if (file.siteId) {
      void router.push("/share/preview/"+encodeURIComponent(file.siteId));
      return;
    }
    if (isContainer(file)) {
      setSelected([]);
      setQuery("");
      navigateList("全部", "推荐", file.id, undefined, true);
    } else {
      navigateList(section, tab, folder?.id, file.id);
    }
  }
  const router = useRouter();
  const sections = ["全部", "页面", "幻灯片", "站点", "图像", "Google Drive", "回收站"];
  const section = sections.find(value => value === router.query.librarySection) || "全部";
  const imageSection = section === "图像";
  const sitesSection = section === "站点";
  const pagesSection = section === "页面";
  const slidesSection = section === "幻灯片";
  const tabs = slidesSection ? ["全部","已置顶","我的","与你共享"] : pagesSection ? ["全部","你的项目","与你共享"] : sitesSection ? ["你的网站", "与你共享", "全部"] : imageSection ? ["你的作品", "已上传"] : ["推荐", "收藏", "你的条目", "与你共享"];
  const tab = tabs.find(value => value === router.query.libraryTab) || tabs[0];
  const folder = files?.find(file => file.id === router.query.libraryFolder && isContainer(file) && !file.deleted);
  const allHome = section === "全部" && !folder;
  const opened = files?.find(file => file.id === router.query.libraryItem && !isContainer(file) && !file.deleted);
  const editor = opened?.kind === "页面" || opened?.editablePageId ? opened : undefined;
  const parentPage = editor && files?.find(item=>item.id===editor.folderId && item.kind==="页面" && !item.deleted);
  const detail = editor ? undefined : opened;
  function navigateList(nextSection: string, nextTab: string, folderId?:string, itemId?:string, clearTypes = false) {
    if (nextSection === section && nextTab === tab && router.query.libraryFolder === folderId && router.query.libraryItem === itemId && !(clearTypes && (router.query.libraryType || router.query.librarySource))) return;
    void router.push(listUrl(nextSection, nextTab, folderId, itemId, clearTypes), undefined, {shallow:true, scroll:false});
  }
  function listUrl(nextSection: string, nextTab: string, folderId?:string, itemId?:string, clearTypes = false) {
    const query = {...router.query};
    if (clearTypes) {delete query.libraryType;delete query.librarySource;}
    if (folderId) query.libraryFolder = folderId;
    else delete query.libraryFolder;
    if (itemId) query.libraryItem = itemId;
    else delete query.libraryItem;
    if (nextSection === "全部") delete query.librarySection;
    else query.librarySection = nextSection;
    if (nextTab === "推荐") delete query.libraryTab;
    else query.libraryTab = nextTab;
    return { pathname: router.pathname, query };
  }
  function itemLink(file: LibraryFile) {
    if (file.deleted) return <span title={file.name}>{file.name}</span>;
    if (file.kind === "资料空间" && file.shareId) return <Link title={file.name} href={"/share/space/"+file.shareId} onClick={()=>recordOpen(file)}>{file.name}</Link>;
    if (file.siteId) return <Link title={file.name} href={"/share/preview/"+encodeURIComponent(file.siteId)} onClick={()=>recordOpen(file)}>{file.name}</Link>;
    const container = isContainer(file);
    const href = container ? listUrl("全部", "推荐", file.id, undefined, true) : listUrl(section, tab, folder?.id, file.id);
    return <Link title={file.name} href={href} shallow scroll={false} prefetch={false} onClick={event=>{
      recordOpen(file);
      if (container && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
        setSelected([]);
        setQuery("");
      }
    }}>{file.name}</Link>;
  }
  useEffect(() => { setSelected([]); }, [section, tab, router.query.libraryFolder]);
  const [sidebar, setSidebar] = useState(true);
  const sidebarToggle = useRef<HTMLButtonElement>(null);
  function toggleSidebar() {
    setSidebar(open => !open);
    requestAnimationFrame(() => sidebarToggle.current?.focus());
  }
  const search = useRef<HTMLInputElement>(null);
  const [sharing,setSharing] = useState<LibraryFile>();
  const [purge,setPurge] = useState<LibraryFile[]>();
  const [rename, setRename] = useState<LibraryFile>();
  const [title, setTitle] = useState("");
  const suffix = renameSuffix(rename);
  const newName = title.trim() + suffix;
  const canRename = Boolean(title.trim() && rename && newName !== rename.name);
  const moveFocus = useRef<HTMLButtonElement>(null);
  const renameInput = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const changeSection = (next: string) => {
    setSelected([]);
    navigateList(next, "推荐", undefined, undefined, true);
    setQuery("");
  };
  const requestedTypes = [router.query.libraryType].flat();
  const types = slidesSection ? [] : fileTypes.filter(type => requestedTypes.includes(type));
  const sources = slidesSection ? fileSources.filter(source => [router.query.librarySource].flat().includes(source)) : [];
  const filterCount = types.length + sources.length;
  const grid = router.query.libraryLayout === "grid";
  const [listTime, setListTime] = useState(Date.now);
  const showRelativeTimes = !grid && !opened && !imageSection && section !== "回收站";
  useEffect(() => {
    if (!showRelativeTimes) return;
    const refresh = () => {
      if (document.visibilityState === "visible") setListTime(Date.now());
    };
    refresh();
    const timer = window.setInterval(refresh, 60000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [showRelativeTimes]);
  function updateListOptions(nextTypes: string[], nextGrid: boolean, nextSources = sources) {
    const query = {...router.query};
    if (nextTypes.length) query.libraryType = nextTypes;
    else delete query.libraryType;
    if (nextSources.length) query.librarySource = nextSources;
    else delete query.librarySource;
    if (nextGrid) query.libraryLayout = "grid";
    else delete query.libraryLayout;
    void router.push({pathname:router.pathname, query}, undefined, {shallow:true, scroll:false});
  }
  const [requestedSort, setSort] = useState<{column: "name" | "time" | "size"; ascending: boolean}>();
  const sort = requestedSort && (folder || requestedSort.column !== "size") ? requestedSort : {column:"time",ascending:false};
  function sortBy(column: "name" | "time" | "size") {
    setSort({ column, ascending: sort.column === column ? !sort.ascending : column === "name" });
  }
  const toast = useToast();
  useEffect(() => {
    const controller = new AbortController();
    setFailed("");
    loadLibraryFiles(controller.signal)
      .then(data => { if (!controller.signal.aborted) setFiles(data); })
      .catch(reason => { if (!controller.signal.aborted) setFailed(reason instanceof TypeError ? "连接失败，请检查网络后重试。" : reason.message); });
    return () => controller.abort();
  }, [attempt]);
  const destinations = files?.filter(item => isContainer(item) && !item.shareId && !item.deleted) || [];
  function folderPath(id?:string) {
    const path: LibraryFile[] = [];
    let current = destinations.find(item => item.id === id);
    while (current && !path.includes(current)) {
      path.unshift(current);
      const parentId: string | null | undefined = current.folderId;
      current = destinations.find(item => item.id === parentId);
    }
    return path;
  }
  const destinationPath = folderPath(destination);
  const childFolders = destinations.filter(item => (item.folderId || "") === destination);
  function rowTime(file: LibraryFile) {
    if (section === "回收站") return file.deletedAt || "";
    if (folder) return file.time;
    return libraryActivityTime(file);
  }
  function sortValue(file: LibraryFile) {
    if (folder && sort.column === "size") return String(file.size ?? 0);
    return sort.column === "name" ? file.name : rowTime(file);
  }
  function sourceFilter(file: LibraryFile) {
    const origin = file.fileOrigin ?? (file.shareId ? undefined : file.fromTemplate ? "生成" : file.kind);
    if (origin === "上传") return "已上传";
    if (origin === "生成") return "生成的文件";
    return "";
  }
  const searchTerm = query.trim().normalize("NFC").toLowerCase();
  const visible = files?.filter(file => Boolean(file.deleted) === (section === "回收站") &&
    (!folder || file.folderId === folder.id) &&
    (section === "全部" || section === "回收站" || fileType(file) === (section === "幻灯片" ? "演示文稿" : section)) &&
    (!imageSection || (!file.shareId && sourceFilter(file) === (tab === "已上传" ? "已上传" : "生成的文件"))) &&
    (!sources.length || sources.includes(sourceFilter(file))) &&
    (tab !== "已置顶" || file.pinned) && (tab !== "收藏" || file.favorite) && (tab === "与你共享" ? Boolean(file.shareId) : (tab !== "你的条目" && tab !== "你的项目" && tab !== "我的") || !file.shareId) && (!types.length || types.includes(fileType(file))) &&
    [file.name, file.path, file.project, file.conversation].some(value => value.normalize("NFC").toLowerCase().includes(searchTerm))).sort((a, b) => (section === "回收站" ? 0 : Number(Boolean(b.pinned))-Number(Boolean(a.pinned))) || (sort.ascending ? 1 : -1) * sortValue(a).localeCompare(sortValue(b), "zh-CN", { numeric: true }));
  const hasPageActions = visible?.some(file => file.kind === "页面" && !file.deleted);
  const picked = visible?.filter(item => selected.includes(item.id)) || [];
  useEffect(() => {
    if (visible && selected.length !== picked.length) {
      const visibleIds = new Set(visible.map(item => item.id));
      setSelected(current => current.filter(id => visibleIds.has(id)));
    }
  }, [visible, selected.length, picked.length]);
  const checkItem = (id:string) => setSelected(ids => ids.includes(id) ? ids.filter(value => value!==id) : [...ids,id]);
  function clickItemSurface(event: React.MouseEvent, file: LibraryFile) {
    const target = event.target;
    if (!(target instanceof Element) || !event.currentTarget.contains(target) ||
        target.closest("button, a, input, td:first-child, td:last-child")) return;
    if (picked.length) checkItem(file.id);
    else if (!file.deleted) openItem(file);
  }
  const allChecked = Boolean(visible?.length && visible.length === picked.length);
  async function usePicked(action:"chat"|"download", items = picked, question?:string, itemId?:string) {
    setBatchBusy(true);
    try {
      const results = await readLibraryAttachments(items);
      const attachments: File[] = [];
      const unavailable: {file:LibraryFile;message:string}[] = [];
      results.forEach((result,index) => {
        if (result.status === "fulfilled") attachments.push(result.value);
        else unavailable.push({file:items[index],message:libraryReadMessage(result.reason)});
      });
      if (unavailable.length) {
        const partialDownload = action === "download" && attachments.length > 0;
        toast({status:partialDownload ? "warning" : "error",isClosable:true,title:action === "chat" ? "无法添加所选资料" : partialDownload ? "部分文件无法下载" : "无法下载所选资料",
          description:<Box><Text>以下资料读取失败。</Text>
            <Box as="ul" pl={5} maxH="8rem" overflowY="auto">{unavailable.map(({file,message})=>
              <li key={file.id}><strong>{file.name}</strong> · {message}</li>)}</Box></Box>});
        if (!partialDownload) return;
      }
      if (action === "chat") {await onChat(attachments,question,itemId); return;}
      if (!attachments.length) return;
      let blob:Blob = attachments[0];
      let name = attachments[0].name;
      if (attachments.length > 1) {
        const {default:JSZip} = await import("jszip");
        const archive = new JSZip();
        attachments.forEach((file,index) => archive.file((index+1) + "/" + file.name.replace(/[\\/]/g,"_"),file));
        blob = await archive.generateAsync({type:"blob"});
        name = "资料空间.zip";
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href=url; link.download=name; link.click();
      if (items === picked && unavailable.length) setSelected(unavailable.map(({file})=>file.id));
      setTimeout(()=>URL.revokeObjectURL(url),1000);
    } catch(error) {toast({status:"error",title:error instanceof Error ? error.message : "操作失败"});}
    finally {setBatchBusy(false);}
  }
  async function startSelectionChat(selection: LibraryFile[]) {
    const attachments = expandLibrarySelection(selection, files || []);
    const shared = selection.filter(item => isContainer(item) && item.shareId);
    if (shared.length) {
      setBatchBusy(true);
      try {
        for (const space of shared) attachments.push(...await loadSharedSpacePages(space));
      } catch {
        toast({status:"error", title:"无法读取共享空间，请检查访问权限后重试。"});
        return;
      } finally {
        setBatchBusy(false);
      }
    }
    if (!attachments.length) {
      toast({status:"info", title:"所选位置中没有可添加的文件或页面。", isClosable:true});
      return;
    }
    return usePicked("chat", attachments);
  }
  const key = (file: LibraryFile) => file.id;
  const download = (file: LibraryFile) => isArtifactImage(libraryTypeName(file)) ?
    <IconButton size="sm" variant="ghost" borderRadius="full" aria-label="下载文件" title="下载文件"
      icon={<Download size={16}/>} isLoading={batchBusy} onClick={()=>usePicked("download",[file])}/> :
    <Button size="xs" variant="ghost" isLoading={batchBusy} onClick={()=>usePicked("download",[file])}>下载</Button>;
  async function update(file: LibraryFile, changes: Partial<Pick<LibraryFile, "name" | "favorite" | "pinned" | "deleted" | "folderId">>, notifyFailure = true) {
    setSaving(true);
    try {
      const response = await fetch((isNative(file) || file.directUpload) ? "/api/library/pages?id=" + file.id : "/api/library", { method: "PATCH", headers: withAuthHeaders({"Content-Type":"application/json"}),
        body: JSON.stringify((isNative(file) || file.directUpload) ? changes : {id:file.id, changes}) });
      if (!response.ok) throw new Error();
      setFiles(previous => previous?.map(item => item.id === file.id ? {...item,...changes,...(changes.deleted === undefined ? {} : {deletedAt:changes.deleted ? new Date().toISOString() : null})} : item));
      setRename(undefined);
      return true;
    } catch {
      if (notifyFailure) toast({ status:"error", title:"未能保存更改，请重试" });
      return false;
    } finally { setSaving(false); }
  }
  async function changeTrashSelection() {
    if (batchBusy || !picked.length) return;
    const restoring = section === "回收站";
    const failed: LibraryFile[] = [];
    setBatchBusy(true);
    try {
      for (const file of picked) {
        if (!await update(file, {deleted:!restoring}, false)) failed.push(file);
      }
      if (failed.length) {
        const action = restoring ? "恢复" : "移入回收站";
        const succeeded = picked.length - failed.length;
        toast({
          status:succeeded ? "warning" : "error", isClosable:true,
          title:succeeded ? `${succeeded} 项已${action}，${failed.length} 项失败` : `${failed.length} 项未能${action}`,
          description:<Box><Text>以下条目仍已勾选，可重试。</Text>
            <Text maxH="8rem" overflowY="auto" overflowWrap="anywhere">{failed.map(file => file.name).join("、")}</Text></Box>,
        });
      }
    } finally {
      setBatchBusy(false);
    }
  }
  async function moveToDestination() {
    if (!move || batchBusy) return;
    const targets = (batchMove ? picked : [move]).filter(item => (item.folderId || "") !== destination);
    const failed: string[] = [];
    setMoveFailures([]);
    setBatchBusy(true);
    try {
      for (const item of targets) {
        if (!await update(item, {folderId: destination || null}, false)) failed.push(item.id);
      }
      setMoveFailures(targets.filter(item=>failed.includes(item.id)).map(item=>item.name));
      if (batchMove) setSelected(failed);
      if (!failed.length) {
        setMove(undefined);
        setBatchMove(false);
      }
    } finally { setBatchBusy(false); }
  }
  function containingFolderId(file:LibraryFile) {
    const visited = new Set<string>();
    let parentId = file.folderId;
    while (parentId && !visited.has(parentId)) {
      visited.add(parentId);
      const parent = files?.find(item=>item.id === parentId && !item.deleted);
      if (!parent) break;
      if (isContainer(parent)) return parent.id;
      parentId = parent.folderId;
    }
  }
  function pageUrl(file:LibraryFile) {
    const url = new URL("/",window.location.origin);
    url.searchParams.set("view","library");
    url.searchParams.set("libraryItem",file.id);
    const containerId = containingFolderId(file);
    if (containerId) url.searchParams.set("libraryFolder",containerId);
    return url.href;
  }
  async function copyPage(file:LibraryFile, markdown:boolean) {
    try {
      const value = markdown ? await (await readLibraryAttachment(file)).text()
        : pageUrl(file);
      await navigator.clipboard.writeText(value);
      toast({status:"success",title:markdown ? "已复制 Markdown" : "已复制链接"});
    } catch (error) {
      const description = error instanceof LibraryReadError
        ? (error.status === 403 ? "当前账号没有读取此页面的权限。" : error.status === 404 ? "页面已不存在。" : "暂时无法读取页面，请稍后重试。")
        : error instanceof DOMException && error.name === "NotAllowedError" ? "请允许浏览器写入剪贴板后重试。" : "请稍后重试。";
      toast({status:"error",title:markdown ? "未能复制 Markdown" : "未能复制链接",description});
    }
  }
  async function copySpace(space:LibraryFile,field:"链接"|"ID") {
    try {
      const url = new URL("/share/space/"+space.id,window.location.origin);
      await navigator.clipboard.writeText(field === "ID" ? space.id : url.href);
      toast({status:"success",title:"已复制资料空间"+field});
    } catch { toast({status:"error",title:"复制失败，请重试"}); }
  }
  const [copyMenuId,setCopyMenuId] = useState<string>();
  function toggleCopyMenu(spaceId:string, menu:Element | null, open:boolean) {
    setCopyMenuId(open ? spaceId : undefined);
    requestAnimationFrame(()=>menu?.querySelector<HTMLElement>(open ? "[data-copy-link]" : "[data-copy-trigger]")?.focus());
  }
  const actions = (file: LibraryFile) => <Menu placement="bottom-end" onClose={()=>setCopyMenuId(undefined)}>{({onClose:closeActions}) => <>
    <MenuButton as={IconButton} variant="ghost" size="xs" aria-label={file.kind === "页面" ? `页面“${file.name}”的操作` : `打开 ${file.name} 的操作菜单`} icon={<MoreHorizontal size={16}/>}/>
    <Portal><MenuList w="240px" minW="0" p="9px" borderRadius="16px" sx={{"& [role=menuitem]":{height:"36px",borderRadius:"12px",fontSize:"14px",padding:"6px 10px"}}}>{file.deleted ? <><MenuItem icon={<RotateCcw size={16}/>} onClick={() => update(file,{deleted:false})}>恢复</MenuItem><MenuItem icon={<Trash2 size={16}/>} color="red.600" onClick={() => setPurge([file])}>永久删除</MenuItem></> : <>
      {imageSection && <MenuItem icon={<MessageSquare size={16}/>} isDisabled={batchBusy} onClick={() => usePicked("chat",[file])}>Chat about this</MenuItem>}
      {!file.shareId && !isContainer(file) && <MenuItem icon={<Share2 size={16}/>} onClick={()=>setSharing(file)}>分享</MenuItem>}
      {(file.kind === "页面" || fileType(file) === "演示文稿") && <MenuItem icon={file.pinned ? <PinOff size={16}/> : <Pin size={16}/>} isDisabled={saving} onClick={()=>update(file,{pinned:!file.pinned})}>{file.pinned ? "取消置顶" : "置顶"}</MenuItem>}
      <MenuItem icon={<Pencil size={16}/>} onClick={() => { setTitle(file.name.slice(0, file.name.length - renameSuffix(file).length)); setRename(file); }}>重命名</MenuItem>
      {file.kind === "页面" && <MenuItem icon={<Copy size={16}/>} isDisabled={creating} onClick={()=>createPage(file.name,"","页面",file.id)}>创建页面副本</MenuItem>}
      {file.kind === "页面" && <Box position="relative" onBlur={event=>{
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setCopyMenuId(undefined);
      }}>
        <MenuItem data-copy-trigger="" aria-haspopup="menu" aria-expanded={copyMenuId === file.id}
          closeOnSelect={false} icon={<Copy size={16}/>}
          onClick={event=>toggleCopyMenu(file.id,event.currentTarget.parentElement,true)}
          onKeyDown={event=>{if (event.key === "ArrowRight") {
            event.preventDefault();event.stopPropagation();toggleCopyMenu(file.id,event.currentTarget.parentElement,true);
          }}}>
          <Flex align="center" justify="space-between">复制<ChevronRight size={14}/></Flex>
        </MenuItem>
        {copyMenuId === file.id && <Box role="menu" aria-label="复制" position="absolute" right="100%" top={0}
          minW="164px" p="6px" bg="chakra-body-bg" borderWidth="1px" borderRadius="14px" shadow="md" zIndex={1}
          sx={{"@media (max-width: 440px)":{position:"static",minWidth:0,marginInlineStart:"20px",border:0,boxShadow:"none",paddingBlock:0}}}
          onKeyDown={event=>{
            event.stopPropagation();
            if (event.key === "Escape" || event.key === "ArrowLeft") {
              event.preventDefault();toggleCopyMenu(file.id,event.currentTarget.parentElement,false);
            } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              const items=event.currentTarget.querySelectorAll("button");
              items[event.target === items[0] ? 1 : 0]?.focus();
            } else if (event.key === "Tab") closeActions();
          }}>
          {["复制链接","复制为 Markdown"].map((label,index)=><Button key={label} role="menuitem" data-copy-link={index === 0 ? "" : undefined}
            tabIndex={-1} variant="ghost" w="full" justifyContent="start" fontWeight="normal"
            onClick={()=>{void copyPage(file,index === 1);closeActions();}}>{label}</Button>)}
        </Box>}
      </Box>}
      {file.siteId ? <MenuItem onClick={()=>openItem(file)}>打开站点</MenuItem> : isContainer(file) ? <MenuItem icon={<LibraryItemIcon item={file} compact/>} onClick={() => openItem(file)}>打开{file.kind}</MenuItem> :
        <MenuItem icon={<Download size={16}/>} isDisabled={batchBusy} onClick={()=>usePicked("download",[file])}>下载</MenuItem>}
      {!pagesSection && <>
        <MenuDivider my={2}/>
        <MenuItem icon={<Bookmark size={16}/>} onClick={() => update(file,{favorite:!file.favorite})}>{file.favorite ? "从收藏夹中移除" : "添加到收藏夹"}</MenuItem>
        {!isContainer(file) && <MenuItem icon={<FolderInput size={16}/>} onClick={() => {setBatchMove(false);setNewDestinationName(undefined);setMoveFailures([]);setMove(file);setDestination(file.folderId || "");}}>{folder || imageSection ? "移动" : "移至文件夹"}</MenuItem>}
      </>}
      <MenuDivider my={2}/>
      <MenuItem icon={<Trash2 size={16}/>} color="red.600" onClick={() => update(file,{deleted:true})}>删除</MenuItem>
    </>}</MenuList></Portal></>}</Menu>;
  async function startCreativeChat(kind: "站点" | "图像") {
    if (creating) return;
    setCreating(true);
    try { await onChat([], kind === "图像" ? undefined : "使用 Sites 创建新站点 ",undefined,kind === "图像"); }
    catch { toast({status:"error", title:"无法开始" + kind + "对话，请重试"}); }
    finally { setCreating(false); }
  }
  const createMenu = (rail:boolean) => {
    const folderMenu = Boolean(folder && !rail);
    return <Menu><MenuButton as={Button} onClick={(event: React.MouseEvent<HTMLButtonElement>) => { galleryTrigger.current = event.currentTarget; }} size="sm" aria-label={!rail && folder ? "新建" : "创建"} borderRadius={rail ? "md" : "full"} h={!rail && allHome ? "36px" : undefined} minW={!rail && allHome ? "82px" : undefined} fontWeight={!rail && allHome ? 500 : undefined} bg={rail ? "transparent" : "#0d0d0d"} color={rail ? "inherit" : "white"} justifyContent={rail ? "start" : "center"} _hover={{bg:rail ? "#eee" : "#333"}} _active={{bg:rail ? "#eee" : "#333"}} isLoading={creating}
      leftIcon={rail ? <Plus size={16} aria-hidden/> : undefined} rightIcon={rail ? undefined : <ChevronDown size={14} aria-hidden/>}>
      {folderMenu ? "新建" : "创建"}</MenuButton>
            <MenuList w="240px" minW="0" p="10px" borderWidth={0} borderRadius="16px" sx={{"& [role=menuitem]":{height:"36px",minHeight:"36px",padding:"6px 10px",borderRadius:"12px",fontSize:"14px"},"& .chakra-menu__icon-wrapper":{marginInlineEnd:"10px"}}}>{!folderMenu && <MenuItem icon={<LayoutGrid size={20} aria-hidden/>} onClick={() => setGalleryOpen(true)}>从模板开始</MenuItem>}
              {!folderMenu && <MenuDivider my="8px"/>}
              <MenuItem icon={<FileText size={20} aria-hidden/>} onClick={() => createPage("无标题页","")}>页面</MenuItem>
              {!folderMenu && <><MenuItem icon={<Presentation size={20} aria-hidden/>} onClick={() => createSlides()}>幻灯片</MenuItem>
              <MenuItem icon={<Sheet size={20} aria-hidden/>} isDisabled>电子表格<Text as="span" ml="auto" fontSize="xs">即将推出</Text></MenuItem>
              <MenuItem icon={<PanelsTopLeft size={20} aria-hidden/>} onClick={() => startCreativeChat("站点")}>站台</MenuItem>
              <MenuItem icon={<ImageIcon size={20} aria-hidden/>} onClick={() => startCreativeChat("图像")}>图像</MenuItem></>}
              {!folderMenu && <MenuDivider my="8px"/>}
              {(folderMenu ? ["文件夹"] as const : ["文件夹","资料空间"] as const).map(kind => <MenuItem icon={kind === "文件夹" ? <Folder size={20} aria-hidden/> : <Layers size={20} aria-hidden/>} key={kind} onClick={() => {if (kind === "资料空间") openSpaceDialog(); else {setTitle("");setNewKind(kind);}}}>{kind}</MenuItem>)}
              {!folderMenu && <MenuDivider my="8px"/>}
              <MenuItem icon={<Upload size={20} aria-hidden/>} onClick={() => fileInput.current?.click()}>上传文件</MenuItem>{!folderMenu && <MenuItem icon={<Plug size={20} aria-hidden/>} onClick={()=>setConnectors(true)}>连接插件</MenuItem>}</MenuList>
          </Menu>;
  };
  return <Flex flex="1" minW={0} minH={0}>
    <input ref={fileInput} type="file" multiple hidden aria-label="上传文件" onChange={event => {
      const selected = Array.from(event.target.files || []);
      event.target.value = "";
      void uploadFiles(selected);
    }}/>
    {sidebar && <Box display={{base:"none",md:"flex"}}><LibrarySidebar spaceActions={space=><Menu placement="bottom-end" onClose={()=>setCopyMenuId(undefined)}>
        <MenuButton as={IconButton} size="xs" variant="ghost" aria-label={space.name+" 资料空间的操作"} icon={<MoreHorizontal size={16}/>}/>
        <MenuList onKeyDownCapture={event=>{
          if (copyMenuId !== space.id || !["Escape","ArrowLeft"].includes(event.key)) return;
          event.preventDefault();
          event.stopPropagation();
          toggleCopyMenu(space.id,event.currentTarget,false);
        }}>{copyMenuId === space.id ? <>
          <MenuItem data-copy-link="" onClick={()=>copySpace(space,"链接")}>资料空间链接</MenuItem>
          <MenuItem onClick={()=>copySpace(space,"ID")}>资料空间 ID</MenuItem>
        </> : <>
          <MenuItem onClick={()=>setSharing(space)}>分享</MenuItem>
          <MenuItem onClick={()=>update(space,{pinned:!space.pinned})}>{space.pinned ? "取消置顶" : "置顶"}</MenuItem>
          <MenuItem onClick={()=>{setTitle(space.name);setRename(space);}}>重命名</MenuItem>
          <MenuItem data-copy-trigger="" aria-haspopup="menu" closeOnSelect={false}
            onClick={event=>toggleCopyMenu(space.id,event.currentTarget.closest('[role="menu"]'),true)}
            onKeyDown={event=>{if (event.key === "ArrowRight") {
              event.preventDefault();
              toggleCopyMenu(space.id,event.currentTarget.closest('[role="menu"]'),true);
            }}}>复制<ChevronRight size={14}/></MenuItem>
          <MenuItem onClick={()=>createPage("无标题页","","页面",undefined,space.id)}>创建新页面</MenuItem>
          <MenuItem isDisabled={batchBusy} onClick={()=>startSelectionChat([space])}>新聊天</MenuItem>
          <MenuItem isDisabled={creating} onClick={()=>createSlides(undefined,space.id)}>新建幻灯片</MenuItem>
          <MenuItem color="red.600" onClick={()=>update(space,{deleted:true})}>删除</MenuItem></>}
        </MenuList>
      </Menu>} createMenu={createMenu(true)} onNewSpace={openSpaceDialog} section={folder ? undefined : section} activeSpaceId={folder && folderPath(folder.id).find(item=>item.kind === "资料空间")?.id} files={files || []} onSection={changeSection}
      onFile={openItem} onSearch={() => setGlobalSearch(true)} toggleRef={sidebarToggle} onCollapse={toggleSidebar} /></Box>}
    {!sidebar && <IconButton ref={sidebarToggle} display={{base:"none",md:"inline-flex"}} flexShrink={0} alignSelf="flex-start" mt={2} ml={1} aria-label="展开资料空间侧栏" icon={<PanelLeftOpen size={16}/>} size="sm" variant="ghost" onClick={toggleSidebar}/>}
    {detail ? <LibraryFileViewer key={detail.kind === "生成" ? JSON.stringify([detail.token,detail.chatId,detail.path]) : detail.id} item={files?.find(item=>item.id===detail.id) || detail}
      versions={detail.kind === "生成" ? (files || [detail]).filter(file =>
        !file.deleted && file.kind === "生成" && file.token === detail.token &&
        file.chatId === detail.chatId && file.path === detail.path
      ).sort((a,b)=>b.time.localeCompare(a.time)) : [detail]} openVersion={openItem}
      fileChatWidth={fileChatWidth} setFileChatWidth={setFileChatWidth} fileChatOpen={fileChatOpen} resumeFileChat={resumeFileChat} askAboutFile={question=>usePicked("chat",[detail],question,detail.id)} share={detail.shareId ? undefined : ()=>setSharing(detail)} download={download(detail)} openLibrary={()=>navigateList("全部","推荐",undefined,undefined,true)} close={()=>navigateList(section, tab, folder?.id)} openSource={()=>onOpen(detail.token,detail.chatId)}
      toggleFavorite={()=>update(detail,{favorite:!files?.find(item=>item.id===detail.id)?.favorite})}/> : editor ? <LibraryPageEditor drafts={pageDrafts.current} key={editor.id} page={{id:editor.editablePageId || editor.id}} shareId={editor.shareId} onShare={editor.shareId ? undefined : () => setSharing(editor)} backLabel={parentPage ? "返回「"+parentPage.name+"」" : folder ? "返回「"+folder.name+"」" : "返回资料空间"} onChat={(file,quote)=>onChat([file],quote,editor.id)} onBack={() => parentPage ? openItem(parentPage) : navigateList(section, tab, folder?.id)}
      subpages={!editor.shareId && <Flex as="nav" aria-label="子页面" direction="column" align="start" gap={1} mt={4}>
        {files?.filter(item=>item.folderId===editor.id && item.kind==="页面" && !item.deleted).map(item=>
          <Flex key={item.id} align="center" gap={2} maxW="full" px={2} borderRadius="8px" _hover={{bg:"surface.hover"}}
            sx={{"& a":{py:2,minWidth:0,overflowWrap:"anywhere"}}}>
            <LibraryItemIcon item={item} compact/>{itemLink(item)}
          </Flex>)}
        <Button size="sm" variant="ghost" sx={{[`@media ${mobilePageReaderQuery}`]:{display:"none"}}} leftIcon={<Plus size={15}/>} isDisabled={creating} onClick={()=>createPage("无标题页","","页面",undefined,editor.id)}>创建子页面</Button>
      </Flex>}
      onSaved={(name,time) => setFiles(items => items?.map(item => item.id === editor.id ? {...item,name,time,...(item.sharedPage ? {path:markdownFilename(name)} : {})} : item))}/> :
    files && !failed && ((router.query.libraryItem && !opened) || (router.query.libraryFolder && !folder)) ? <Flex flex="1" direction="column" align="center" justify="center" gap={3} px={4} textAlign="center">
      <CircleAlert size={22} color="#777" aria-hidden/>
      <Box role="alert"><Heading as="h2" fontSize="md">无法打开此条目</Heading>
        <Text mt={1} fontSize="sm" color="gray.600">条目可能已删除，或当前账号没有访问权限。</Text></Box>
      <Button size="sm" variant="outline" borderRadius="full" onClick={()=>navigateList("全部","推荐",undefined,undefined,true)}>返回资料空间</Button>
    </Flex> : section === "Google Drive" ? <LibraryDrive onAttach={onChat} connect={()=>setConnectors(true)}/> : <Box flex="1" minW={0} overflowY="auto" pt="16px" pb={8}
      outline={dropActive ? "2px dashed #777" : undefined} outlineOffset="-4px"
      onDragOver={event=>{
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        const allowed = section === "全部" && !creating;
        event.dataTransfer.dropEffect = allowed ? "copy" : "none";
        setDropActive(allowed);
      }}
      onDragLeave={event=>{
        if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDropActive(false);
      }}
      onDrop={event=>{
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        setDropActive(false);
        if (section === "全部" && !creating) void uploadFiles(Array.from(event.dataTransfer.files));
      }}>
    <Box maxW="1440px" px={{base:4,md:8,xl:"48px"}} mx="auto">
      <Box position="sticky" top={0} bg="white" zIndex={2}><Flex align="center" minH="36px" justify="space-between" gap={4} wrap="wrap">
        <Button display={{ base: "inline-flex", md: "none" }} variant="ghost" onClick={onBack}>返回聊天</Button>
        <Flex align="center" gap={2}><Heading as="h1" display="flex" alignItems="center" gap={2} fontSize="24px" lineHeight="36px" fontWeight="500">
          {folder ? <><Button variant="link" fontSize="inherit" onClick={()=>navigateList("全部","你的条目",undefined,undefined,true)}>全部</Button>
            {folderPath(folder.id).map(item=><Flex as="span" key={item.id} gap={2} align="center"><ChevronRight size={16}/>
              {item.id===folder.id ? item.name : <Button variant="link" fontSize="inherit" onClick={()=>navigateList("全部","推荐",item.id,undefined,true)}>{item.name}</Button>}</Flex>)}</> : section}</Heading></Flex>
        {section !== "回收站" && <Flex align="center" gap={allHome ? 2 : 3}><InputGroup size="sm" w={allHome ? {base:"min(46vw, 241px)",md:"241px"} : undefined} maxW={allHome ? "241px" : "240px"} sx={allHome ? {"& input, & .chakra-input__left-element, & .chakra-input__right-element":{height:"36px"}} : undefined}>
            <InputLeftElement pointerEvents="none" color="gray.500"><Search size={16} aria-hidden/></InputLeftElement>
            <Input ref={search} borderRadius="full" type="search" aria-label={sitesSection ? "搜索站点" : "搜索文件、项目或会话"}
              placeholder={sitesSection ? "搜索站点" : "搜索"} pr={8} sx={{"&::-webkit-search-cancel-button":{WebkitAppearance:"none"}}}
              value={query} onChange={event => setQuery(event.target.value)}/>
            {query && <InputRightElement><IconButton aria-label="清空搜索" size="xs" variant="ghost" borderRadius="full"
              icon={<X size={14}/>} onClick={() => {setQuery(""); search.current?.focus();}}/></InputRightElement>}
          </InputGroup>
          {imageSection ? <Button size="sm" borderRadius="full" bg="#111" color="white" isLoading={creating}
            onClick={() => startCreativeChat("图像")}>创建图像</Button> : pagesSection ? <Button size="sm" borderRadius="full" bg="#111" color="white" _hover={{bg:"#333"}} isLoading={creating} onClick={()=>createPage("无标题页","")}>创建页面</Button> : slidesSection ? <Button size="sm" borderRadius="full" bg="#111" color="white" _hover={{bg:"#333"}} isLoading={creating} onClick={()=>createSlides()}>新建幻灯片</Button> : createMenu(false)}</Flex>}
      </Flex>
      <Flex gap={1} mt="4px" pb="20px" mb="17px" minH="56px" align="center" justify="flex-end">
        <Flex flex="1" gap={slidesSection || allHome ? 0 : 1} wrap="wrap" role={section === "回收站" || folder ? undefined : "tablist"} aria-label={section === "回收站" ? undefined : pagesSection ? "页面集合" : slidesSection ? "幻灯片集合" : imageSection ? "图像来源" : "资料库分区"}>
          {section !== "回收站" && !folder && tabs.map((name,index) =>
            <Button key={name} role="tab" aria-selected={tab === name} tabIndex={tab === name ? 0 : -1}
              size="sm" h="36px" minW={allHome && name === "推荐" ? "90px" : undefined} px={slidesSection || allHome ? "16px" : "18px"} borderRadius="full" variant={tab === name ? "solid" : "ghost"}
              sx={slidesSection || allHome ? {border:"1px solid transparent",fontSize:"14px",fontWeight:500,
                color:tab === name ? "#0d0d0d" : "#5d5d5d",bg:tab === name ? "blackAlpha.50" : "transparent",
                "&[aria-selected=true]":{bg:"rgba(0,0,0,.05)"}} : undefined}
              onKeyDown={event => {
                const destinations: Record<string,number> = {Home:0,End:tabs.length-1,
                  ArrowLeft:(index+tabs.length-1)%tabs.length,ArrowRight:(index+1)%tabs.length};
                const destination = destinations[event.key];
                if (destination === undefined) return;
                event.preventDefault();
                const next = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[destination];
                next?.focus();
                next?.click();
              }}
              onClick={() => {setSelected([]);navigateList(section, name);}}>{name}</Button>)}
        </Flex>
        {!imageSection && !sitesSection && !pagesSection && filterCount > 0 && <Flex gap={1} wrap="wrap" justify="end">
          {[...types,...sources].map(filter => <Button key={filter} size="sm" borderRadius="full" variant="outline"
            aria-label={`移除${filter}筛选条件`} rightIcon={<X size={14}/>}
            onClick={()=>updateListOptions(types.filter(type=>type!==filter),grid,sources.filter(source=>source!==filter))}>{filter}</Button>)}
        </Flex>}
        {!imageSection && <>{!sitesSection && !pagesSection && <Menu closeOnSelect={false}>
          <MenuButton as={IconButton} aria-label={filterCount ? "打开筛选器，" + filterCount + " 个筛选器已开启" : "打开筛选器"} icon={<ListFilter size={17}/>} size="sm" borderRadius="full" variant={filterCount ? "solid" : "ghost"} />
          <MenuList aria-label="打开筛选器" w="240px" p="10px" borderRadius="16px" borderWidth={0}
            sx={{"& [role=menuitemcheckbox]":{height:"36px",padding:"6px 10px",borderRadius:"12px",fontSize:"14px"},
              "& [role=group] > p":{height:"28px",m:0,px:"10px",lineHeight:"28px",fontSize:"13px"},
              "& .chakra-menu__icon-wrapper":{order:1,ms:"auto",me:0}}}>{!slidesSection && <MenuOptionGroup title="文件类型" type="checkbox" value={types} onChange={value => updateListOptions(Array.isArray(value) ? value : [value], grid)}>
            {fileTypes.map(type => <MenuItemOption key={type} value={type}>{type}</MenuItemOption>)}
          </MenuOptionGroup>}
          {slidesSection && <MenuOptionGroup title="来源" type="checkbox" value={sources} onChange={value => updateListOptions(types,grid,Array.isArray(value) ? value : [value])}>
            {fileSources.map(source => <MenuItemOption key={source} value={source}><Flex align="center" gap={2}>{source === "已上传" ? <Upload size={20} aria-hidden/> : <Pencil size={20} aria-hidden/>}{source}</Flex></MenuItemOption>)}
          </MenuOptionGroup>}</MenuList>
        </Menu>}
        {!sitesSection && !pagesSection && <Box aria-hidden="true" w="1px" h="16px" mx={1} flexShrink={0} bg="blackAlpha.100"/>}
        <IconButton boxSize={slidesSection ? "36px" : undefined} role="checkbox" aria-label="网格视图" aria-checked={grid} onClick={() => updateListOptions(types, true)} icon={<LayoutGrid size={16}/>} variant={grid ? "solid" : "ghost"} size="sm" borderRadius="full"/>
        <IconButton boxSize={slidesSection ? "36px" : undefined} role="checkbox" aria-label="列表视图" aria-checked={!grid} onClick={() => updateListOptions(types, false)} icon={<List size={16}/>} variant={!grid ? "solid" : "ghost"} size="sm" borderRadius="full"/></>}
      </Flex>
      </Box>
      {imageSection && <Box as="section" aria-label="参考照片" mb={5}>
        <Heading as="h2" fontSize="md" mb={2}>参考照片</Heading>
        <Flex gap={2} overflowX="auto"><Button aria-label="添加引用" size="sm" h="36px" px={4} borderRadius="full" variant="outline" leftIcon={<Plus size={16}/>} onClick={() => setReferenceDraft({name:""})}>添加</Button>
          {files?.filter(item => item.reference && !item.deleted).map(item =>
            <Button key={item.id} variant="ghost" onClick={() => openItem(item)}>
              <Box as="img" src={libraryAttachmentUrl(item)} alt="" boxSize="32px" objectFit="cover" mr={2} borderRadius="md"/>
              {item.reference?.name || item.reference?.type}
            </Button>)}
        </Flex></Box>}
      {section === "回收站" && <Flex align="center" justifyContent="space-between" gap={4} mb={4}>
        <Text fontSize="sm" color="gray.600">恢复最近删除的项目。这些项目将在 30 天后被永久删除。</Text>
        <Button size="sm" variant="outline" borderRadius="full" isDisabled={!files?.some(item => item.deleted)}
          onClick={() => setPurge(files?.filter(item => item.deleted))}>清空回收站</Button>
      </Flex>}
      <Box>{showTemplates && !router.query.libraryFolder && !folder && ((section === "全部" && tab === "推荐") || ((pagesSection || slidesSection) && tab === "全部")) && !query && !filterCount &&
        <LibraryTemplates collection={slidesSection ? "幻灯片" : pagesSection ? "页面" : "全部"} onSlides={createSlides} onPick={createPage} onClose={() => setShowTemplates(false)}/>}</Box>
      {sitesSection ? <LibrarySites tab={tab} query={query} grid={grid}/> : failed ? <Flex direction="column" align="center" textAlign="center" gap={3} py={16}>
          <CircleAlert size={22} color="#777" aria-hidden/>
          <Box role="alert"><Heading as="h2" fontSize="md">无法加载资料列表</Heading>
            <Text mt={1} fontSize="sm" color="gray.600">{failed}</Text></Box>
          <Button size="sm" variant="outline" borderRadius="full" onClick={()=>setAttempt(value=>value+1)}>重新加载</Button>
        </Flex> :
        !visible ? <Text role="status">正在加载文件…</Text> :
        !visible.length ? (query.trim() ?
          <Flex role="status" direction="column" align="center" textAlign="center" py={20} gap={2}>
            <Heading as="h2" fontSize="lg" fontWeight="600">未找到匹配结果</Heading>
            <Text fontSize="sm" color="gray.600" maxW="full" overflowWrap="anywhere">没有与“{query.trim()}”匹配的结果。<br/>请尝试使用其他搜索词。</Text>
          </Flex> : section === "全部" && tab === "与你共享" && !filterCount && !folder ?
          <Flex role="status" direction="column" align="center" textAlign="center" py={20} gap={2}>
            <Heading as="h2" fontSize="lg" fontWeight="600">文件夹为空</Heading>
            <Text fontSize="sm" color="gray.600">与你共享的文件和页面将显示在这里</Text>
          </Flex> : folder && !filterCount ? <Flex role="status" direction="column" align="center" textAlign="center" py={16} gap={2}>
            <Heading as="h2" fontSize="lg" fontWeight="600">{folder.kind === "资料空间" ? "资料空间为空" : "文件夹为空"}</Heading>
            <Text fontSize="sm" color="gray.600">通过「新建」添加页面，或将文件拖到这里。</Text>
          </Flex> : slidesSection || pagesSection ? <Text role="status" textAlign="center" py={16} color="gray.500">未找到任何项目</Text> : <Text>{section === "回收站" ? "回收站为空" : filterCount || files?.length ? "没有符合条件的文件" : "会话中生成或上传的文件会显示在这里"}</Text>) :
        imageSection ? <Box sx={{containerType:"inline-size"}}>
          <Box sx={{
            columnCount:1, columnGap:"16px",
            "@container (min-width:24rem)":{columnCount:2}, "@container (min-width:36rem)":{columnCount:3},
            "@container (min-width:48rem)":{columnCount:4}, "@container (min-width:64rem)":{columnCount:5},
            "@container (min-width:80rem)":{columnCount:6}
          }}>
            {visible.map(file => <Box key={key(file)} position="relative" mb={4} data-selecting={picked.length > 0} sx={{breakInside:"avoid",
              "& [role=checkbox]":{background:"white",insetBlockStart:"auto",insetBlockEnd:"19px",insetInlineEnd:"19px",
                width:"20px",height:"20px",borderRadius:"4px",boxShadow:"0 1px 4px #0003"},
              "& [role=checkbox][aria-checked=true]":{background:"#171717",color:"white",borderColor:"transparent"},
              "@media (hover:hover)":{"&:not(:hover):not(:focus-within) .image-actions:not(:has([aria-expanded=true])), &[data-selecting=false]:not(:hover):not(:focus-within) [role=checkbox]":{opacity:0}}
            }}>
              <Box as="button" display="block" w="full" overflow="hidden" borderRadius="16px" borderWidth="1px"
                onClick={() => picked.length ? checkItem(file.id) : openItem(file)} aria-label={picked.length ? (selected.includes(file.id) ? "取消选择" : "选择") + "图像 " + file.name : file.name}>
                <Box as="img" src={libraryAttachmentUrl(file)} alt="" loading="lazy" w="full" h="auto"/>
              </Box>
              <Box className="image-actions" position="absolute" top="13px" insetInlineEnd="13px"
                sx={{"& > button":{width:"36px",height:"36px",borderRadius:"full",color:"white",background:"rgba(0,0,0,.28)",backdropFilter:"blur(8px)"},
                  "& > button:hover, & > button[aria-expanded=true]":{background:"rgba(0,0,0,.42)"}}}>{actions(file)}</Box>
              <LibrarySelectionBox card label={"选择"+file.name} checked={selected.includes(file.id)} onChange={()=>checkItem(file.id)}/>
            </Box>)}
          </Box>
        </Box> : grid ? <Box display="grid" gridTemplateColumns="repeat(auto-fill,minmax(180px,1fr))" gap={3}>
          {visible.map(file => <Box key={key(file)} position="relative" p={4} borderWidth="1px" borderRadius="14px"
            bg={selected.includes(file.id) ? "#f3f3f3" : undefined} cursor="pointer" onClick={event=>clickItemSurface(event,file)}>
            <LibrarySelectionBox card label={"选择"+file.name} checked={selected.includes(file.id)} onChange={()=>checkItem(file.id)}/>
            <LibraryItemIcon item={file}/><Text my={2} overflowWrap="anywhere">{itemLink(file)}</Text>
            {actions(file)}
          </Box>)}
        </Box> : <Box overflowX="auto"><Box as="table" minW="680px" data-selecting={picked.length > 0} width="100%" textAlign="left" fontSize="sm" aria-label={folder?.name || (pagesSection ? (tab === "全部" ? "你的项目" : tab) : section === "全部" ? tab : section)} sx={{
          tableLayout:"fixed", "& th":{height:"42px",fontSize:"13px",fontWeight:500,color:"#656565",textAlign:"left"},
          "& td":{height:"50px",lineHeight:"20px",verticalAlign:"middle"},
          "& th:first-of-type, & td:first-of-type":{padding:0,textAlign:"center",verticalAlign:"middle"},
          "& th:nth-of-type(2)":{paddingInlineStart:"8px"},
          "& td:nth-of-type(2)":{paddingInlineStart:section === "全部" && !folder ? "24px" : "8px"},
          "& [data-item-name] > a, & [data-item-name] > span, & td:nth-child(3) > button":{maxWidth:"100%",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"},
          "@media (hover:hover)":{"& tbody tr:not(:hover):not(:focus-within) td:last-child > div > button:not([aria-expanded=true])":{opacity:0}}
        }}>
          <colgroup><col style={{width:"32px"}}/><col style={{width:section === "全部" && !folder ? "calc(65% - 32px)" : "calc(62% - 32px)"}}/><col style={{width:"19%"}}/><col/><col style={{width:hasPageActions ? "64px" : "30px"}}/></colgroup>
          <thead><tr><th scope="col"><Flex align="center" justify="center"><LibrarySelectionBox label={allChecked ? "清除选择" : "全选"} checked={allChecked}
                mixed={picked.length>0 && !allChecked} onChange={()=>setSelected(allChecked ? [] : visible.map(item=>item.id))}/></Flex></th>{(folder ? ["name","time","size"] as const : ["name", "source", "time"] as const).map(column =>
            <th key={column} scope="col" aria-sort={sort.column === column ? sort.ascending ? "ascending" : "descending" : undefined}>
              {column === "source" ? (section === "回收站" ? "大小" : "来源") : <Flex as="button" type="button" align="center" gap={1} onClick={() => sortBy(column)}>{column === "name" ? "名称" : column === "size" ? "大小" : folder ? "修改日期" : section === "回收站" ? "删除日期" : "上次活动时间"}{requestedSort?.column === column && <ArrowUp aria-hidden size={12} style={{transform:sort.ascending ? undefined : "rotate(180deg)"}}/>}</Flex>}
            </th>)}<th aria-label="文件操作"/></tr></thead>
          <tbody>{visible.map(file => <Box as="tr" key={key(file)} borderTop="1px solid rgb(0 0 0 / 6%)" aria-selected={selected.includes(file.id)}
            onClick={event => clickItemSurface(event,file)}
            cursor={file.deleted ? undefined : "pointer"}
            sx={{"&[aria-selected=true], &[aria-selected=true]:hover":{bg:"#f3f3f3"}}} _hover={{bg:"surface.hover"}}>
            <td><Flex align="center" justify="center"><LibrarySelectionBox label={"选择"+file.name} checked={selected.includes(file.id)} onChange={()=>checkItem(file.id)}/></Flex></td>
            <td><Flex align="center" py="4px" gap={3}><LibraryItemIcon item={file}/><Flex data-item-name="" align="center" gap={1} minW={0}>{itemLink(file)}{file.pinned && <Pin role="img" aria-label="已置顶" size={12} style={{flexShrink:0}}/>} {file.favorite && <Bookmark role="img" aria-label="已保存到收藏夹" size={12} fill="currentColor" color="#707070" style={{flexShrink:0}}/>}</Flex></Flex></td>
            {folder ? <><td><time dateTime={file.time}>{formatRelativeTime(file.time,listTime) || "—"}</time></td>
              <td>{file.size === undefined ? "—" : file.size < 1024 ? file.size+" B" : formatFolderSize(file.size)}</td></> : <><td>{section === "回收站" ? (file.size === undefined ? "—" : new Intl.NumberFormat("zh-CN", {style:"unit",unit:"byte"}).format(file.size)) : file.chatId && file.conversation ? <Button size="xs" variant="link" title={file.conversation}
              aria-label={"打开来源会话「"+file.conversation+"」"} onClick={() => onOpen(file.token,file.chatId)}>
              <Text as="span" isTruncated>{file.conversation}</Text>
            </Button> : file.shareId ? <Text fontSize="sm" isTruncated title={file.project}>{file.project || "与你共享"}</Text> : "—"}</td>
            <td>{section === "回收站" ? (file.deletedAt ? <time dateTime={file.deletedAt} title={new Date(file.deletedAt).toLocaleString("zh-CN")}>{new Date(file.deletedAt).toLocaleDateString("zh-CN")}</time> : "—") : <time dateTime={rowTime(file) || undefined} title={rowTime(file) ? new Date(rowTime(file)).toLocaleString("zh-CN") : undefined}>{formatRelativeTime(rowTime(file),listTime) || "—"}</time>}</td></>}<td><Flex align="center" justify="end">
              {file.kind === "页面" && !file.deleted && <IconButton size="xs" variant="ghost"
                role="checkbox" aria-label={"置顶 " + file.name} aria-checked={Boolean(file.pinned)}
                icon={file.pinned ? <PinOff size={16}/> : <Pin size={16}/>} isDisabled={saving}
                onClick={()=>update(file,{pinned:!file.pinned})}/>}
              {actions(file)}</Flex></td>
          </Box>)}</tbody>
        </Box></Box>}
      {picked.length>0 && <Flex role="toolbar" aria-label="所选项目的操作" position="sticky" bottom={3} zIndex={3} mx="auto" mt={4}
        w="fit-content" maxW="100%" wrap="wrap" align="center" gap={{base:1,md:3}} px={{base:3,md:6}} py={2} minH="52px" borderRadius="26px" bg="#212121" color="#ededed" shadow="md"
        sx={{"& button":{borderRadius:"9999px"},"& > button, & > .chakra-menu__menu-button":{height:"36px"}}}>
        <Text fontSize="sm" minW={{base:"auto",md:"96px"}} whiteSpace="nowrap">已选择 {picked.length} 个</Text>
        <Button size="sm" bg="white" color="black" _hover={{bg:"#ededed"}} leftIcon={<MessageSquare size={16}/>} isDisabled={batchBusy || picked.some(item=>item.siteId || item.deleted)} onClick={()=>startSelectionChat(picked)}>开始聊天</Button>
        <Button size="sm" bg="#303030" color="inherit" _hover={{bg:"#444"}} leftIcon={<Download size={18}/>} isDisabled={batchBusy || picked.some(item=>isContainer(item)||item.siteId||item.deleted)} onClick={()=>usePicked("download")}>下载</Button>
        <Button size="sm" bg={section==="回收站" ? "#303030" : "#fa423e"} color="white" _hover={{filter:"brightness(.9)"}} leftIcon={section==="回收站" ? <RotateCcw size={16}/> : <Trash2 size={16}/>} isDisabled={saving || batchBusy} onClick={changeTrashSelection}>{section==="回收站" ? "恢复" : "删除"}</Button>
        <Menu><MenuButton as={IconButton} size="sm" variant="ghost" color="inherit" _hover={{bg:"#444"}} aria-label="更多操作" icon={<MoreHorizontal size={16}/>}/><MenuList color="gray.800"><MenuItem isDisabled={picked.some(item=>isContainer(item)||item.deleted)} onClick={()=>{setBatchMove(true);setNewDestinationName(undefined);setMoveFailures([]);setMove(picked[0]);setDestination("");}}>移动</MenuItem></MenuList></Menu>
        <IconButton size="sm" variant="ghost" color="inherit" _hover={{bg:"#444"}} aria-label="清除选择" icon={<X size={20}/>} onClick={()=>setSelected([])}/>
      </Flex>}
    </Box>
  </Box>}
    {referenceDraft && <Modal isOpen isCentered onClose={closeReference}>
      <ModalOverlay/><ModalContent borderRadius="16px"><ModalHeader>上传参考图</ModalHeader><ModalCloseButton aria-label="关闭对话框"/>
        <ModalBody><Text mb={4}>今后生成图像时可以将这张照片用作参考。请仅保存你拥有或有权限使用的照片。</Text>
          <input ref={referenceInput} type="file" hidden accept=".png,.jpg,.jpeg,.webp,.avif,.gif" onChange={event => setReferenceDraft({...referenceDraft,file:event.target.files?.[0]})}/>
          <Flex justify="center"><IconButton aria-label="上传图像" boxSize="120px" p={0} borderRadius="full" overflow="hidden"
            icon={referencePreview ? <Box as="img" src={referencePreview} alt="" boxSize="full" objectFit="cover"/> : <ArrowUp size={20}/>}
            onClick={() => referenceInput.current?.click()}/></Flex>
          <Flex role="group" aria-label="参考类型" mt={4} gap={1} justify="center" wrap="wrap">{referenceTypes.map(type =>
            <Button key={type} size="sm" borderRadius="full" variant={referenceDraft.type === type ? "solid" : "ghost"} aria-pressed={referenceDraft.type === type}
              onClick={() => setReferenceDraft({...referenceDraft,type})}>{type}</Button>)}</Flex>
          {referenceDraft.type && referenceDraft.type !== "我" && <Box mt={3}><FormLabel htmlFor="reference-name">名字</FormLabel><Input autoFocus id="reference-name" maxLength={120} value={referenceDraft.name}
            onChange={event => setReferenceDraft({...referenceDraft,name:event.target.value})}/></Box>}
        </ModalBody><ModalFooter gap={2}><Button isDisabled={creating} onClick={closeReference}>取消</Button>
          <Button isLoading={creating} isDisabled={!referenceDraft.file || !referenceDraft.type} onClick={() => {
            if (referenceDraft.file && referenceDraft.type) void uploadFiles([referenceDraft.file], false, {type:referenceDraft.type,name:referenceDraft.name});
          }}>保存</Button></ModalFooter></ModalContent></Modal>}
    <Modal isOpen={confirmDiscard} isCentered onClose={() => setConfirmDiscard(false)}>
      <ModalOverlay/><ModalContent borderRadius="16px"><ModalHeader>是否放弃更改？</ModalHeader>
        <ModalBody>未保存的更改将丢失</ModalBody>
        <ModalFooter gap={2}><Button onClick={() => setConfirmDiscard(false)}>继续编辑</Button>
          <Button colorScheme="red" onClick={() => {setConfirmDiscard(false); setReferenceDraft(undefined);}}>放弃更改</Button>
        </ModalFooter></ModalContent>
    </Modal>
    {(connectors || router.query.libraryConnectors) && <LibraryConnectors callbackError={router.query.libraryConnectors === "error"} close={()=>{
      setConnectors(false);
      if (router.query.libraryConnectors) {
        const query = {...router.query};
        delete query.libraryConnectors;
        void router.replace({pathname:router.pathname,query},undefined,{shallow:true});
      }
    }}/>}
    {globalSearch && <LibraryGlobalSearch projects={projects} files={files || []} onProject={onProject} onChat={onOpen} onFile={openItem} close={() => setGlobalSearch(false)} />}
    {galleryOpen && <TemplateGallery onSlides={() => { setGalleryOpen(false); void createSlides(); }} onUpload={() => { setGalleryOpen(false); fileInput.current?.click(); }} onWorkbook={file => { setGalleryOpen(false); void uploadFiles([file], true, undefined, folder?.id,true); }} triggerRef={galleryTrigger} onClose={() => { setGalleryOpen(false); requestAnimationFrame(() => galleryTrigger.current?.focus()); }} onPick={(name, body) => { setGalleryOpen(false); void createPage(name, body); }} />}
    {sharing && <ArtifactShareDialog spaceId={sharing.kind==="资料空间" ? sharing.id : undefined} siteId={sharing.siteId} token={sharing.token} path={sharing.siteId ? sharing.name : sharing.path} displayName={sharing.name} version={sharing.version}
      libraryItemId={sharing.directUpload || sharing.kind==="页面" ? sharing.id : undefined}
      chatId={sharing.kind==="上传" && !sharing.directUpload ? sharing.chatId : undefined} onClose={()=>setSharing(undefined)}/>}
    <Modal isOpen={newKind === "资料空间"} onClose={closeSpaceDialog} isCentered>
      <ModalOverlay/><ModalContent mx={3} maxW="512px" minH="238px" borderRadius="24px">
        <ModalHeader as="h2" fontSize="20px">创建资料空间</ModalHeader><ModalCloseButton aria-label="关闭对话框" isDisabled={creating}/>
        <form onSubmit={event=>{event.preventDefault();if (title.trim() && !creating) void createPage(title.trim(),"","资料空间");}}>
          <ModalBody><Flex align="center" gap={4}><SpaceIconPicker value={appearance} onChange={setAppearance}/><Input autoFocus aria-label="资料空间名称" placeholder="为话题或群组命名" value={title} maxLength={255} onChange={event=>setTitle(event.target.value)}/></Flex>
            <Button size="sm" variant="ghost" mt={3} aria-expanded={inviteOpen} onClick={()=>setInviteOpen(!inviteOpen)}>邀请用户</Button>
            {inviteOpen && <Box mt={2}><SpaceInviteInput query={inviteQuery} setQuery={setInviteQuery} accounts={invitees} onChange={setInvitees}/><Text fontSize="sm" mt={2}>访问权限适用于此资料空间中的所有页面</Text></Box>}
          </ModalBody><ModalFooter gap={2}><Button h="36px" borderRadius="full" isDisabled={creating} onClick={closeSpaceDialog}>取消</Button><Button h="36px" borderRadius="full" type="submit" isDisabled={!title.trim()} isLoading={creating}>创建</Button></ModalFooter>
        </form></ModalContent></Modal>
    <Modal isOpen={confirmSpaceDiscard} initialFocusRef={continueEditing} onClose={()=>setConfirmSpaceDiscard(false)} isCentered>
      <ModalOverlay/><ModalContent mx={3} borderRadius="20px">
        <ModalHeader>放弃更改？</ModalHeader><ModalBody>你的更改将丢失</ModalBody>
        <ModalFooter gap={2}><Button ref={continueEditing} borderRadius="full" onClick={()=>setConfirmSpaceDiscard(false)}>继续编辑</Button>
          <Button borderRadius="full" colorScheme="red" onClick={()=>{setConfirmSpaceDiscard(false);setNewKind(undefined);}}>放弃更改</Button></ModalFooter>
      </ModalContent>
    </Modal>
    <Modal isOpen={newKind === "文件夹"} onClose={() => setNewKind(undefined)} isCentered><ModalOverlay/><ModalContent mx={3} maxW="520px" p="20px" borderRadius="24px">
      <ModalHeader as="h2" p={0} fontSize="20px" lineHeight="28px">新建{newKind}</ModalHeader><form onSubmit={event => {event.preventDefault(); if (title.trim() && newKind) void createPage(title.trim(),"",newKind);}}>
        <ModalBody p={0} mt="12px"><FormLabel m={0} mb="8px" lineHeight="24px" htmlFor="library-container-name">{newKind}名称</FormLabel><Input h="36px" fontSize="14px" borderRadius="6px" id="library-container-name" autoFocus value={title} maxLength={255}
          onChange={event => setTitle(event.target.value)}/></ModalBody><ModalFooter p={0} mt="12px" gap="12px"><Button minW="66px" h="32px" borderRadius="full" onClick={() => setNewKind(undefined)}>取消</Button>
          <Button minW="66px" h="32px" borderRadius="full" colorScheme="blackAlpha" type="submit" isLoading={creating} isDisabled={!title.trim()}>创建</Button></ModalFooter>
      </form></ModalContent></Modal>
    <Modal initialFocusRef={moveFocus} isOpen={Boolean(move) && newDestinationName === undefined} onClose={() => {if (!batchBusy) setMove(undefined);}} isCentered><ModalOverlay/><ModalContent mx={3} maxW="600px" p="19px" borderRadius="24px"><ModalHeader as="h2" p={0} fontSize="20px" lineHeight="28px">移动到…</ModalHeader><ModalCloseButton isDisabled={batchBusy} top={4} right={4} boxSize={6} aria-label="关闭对话框"/>
      <ModalBody p={0} mt={3}><Flex as="nav" aria-label="移动目标位置" align="center" gap={1} wrap="wrap">
        {destination ? <Button ref={moveFocus} size="sm" h={6} variant="link" isDisabled={batchBusy} onClick={()=>setDestination("")}>资料库</Button> : <Text lineHeight="24px">资料库</Text>}
        {destinationPath.map(item=><Flex align="center" key={item.id}><ChevronRight size={14}/>{item.id===destination ? <Text aria-current="location">{item.name}</Text> : <Button size="sm" variant="link" isDisabled={batchBusy} onClick={()=>setDestination(item.id)}>{item.name}</Button>}</Flex>)}
      </Flex><Box as="ul" listStyleType="none" mt={2} mb={0} maxH="36vh" overflowY="auto">
        {childFolders.map((item,index)=><Box as="li" key={item.id}><Button ref={!destination && index===0 ? moveFocus : undefined} w="full" h="36px" borderRadius="12px" fontSize="sm" variant="ghost" justifyContent="start" leftIcon={<LibraryItemIcon item={item} compact/>} title={item.name} isDisabled={batchBusy} onClick={()=>setDestination(item.id)}><Text isTruncated>{item.name}</Text></Button></Box>)}
        {!childFolders.length && <Box as="li" py={5} textAlign="center" color="gray.500">此文件夹为空</Box>}
      </Box>{moveFailures.length > 0 && <Box role="alert" mt={3} p={3} bg="#faf5f2" color="#694332" borderRadius="10px">
        <Text fontSize="sm" fontWeight="medium">{moveFailures.length} 项未能移动，可再次点击“移至此处”重试。</Text>
        <Text fontSize="xs" mt={1} overflowWrap="anywhere" maxH="12vh" overflowY="auto">{moveFailures.join("、")}</Text>
      </Box>}</ModalBody>
      <ModalFooter p={0} mt="14px" gap={3} sx={{"& button":{height:"32px",borderRadius:"9999px"}}}><Button ref={!destination && !childFolders.length ? moveFocus : undefined} isDisabled={batchBusy} mr="auto" variant="ghost" onClick={()=>setNewDestinationName("")}>新建文件夹</Button><Button isDisabled={batchBusy} onClick={() => setMove(undefined)}>取消</Button><Button isLoading={saving || batchBusy} isDisabled={!(batchMove ? picked : move ? [move] : []).some(item=>(item.folderId || "")!==destination)} onClick={moveToDestination}>移至此处</Button></ModalFooter>
    </ModalContent></Modal>
    <Modal isOpen={Boolean(move) && newDestinationName !== undefined} onClose={()=>{if (!saving) setNewDestinationName(undefined);}} isCentered>
      <ModalOverlay/><ModalContent mx={3} maxW="520px" p="19px" borderRadius="24px">
        <ModalHeader as="h2" p={0} fontSize="20px" lineHeight="28px">新建文件夹</ModalHeader>
        <form onSubmit={async event=>{
        event.preventDefault();
        if (!newDestinationName?.trim() || saving) return;
        setSaving(true);
        try {
          const response = await fetch("/api/library/pages",{method:"POST",headers:withAuthHeaders({"Content-Type":"application/json"}),body:JSON.stringify({kind:"文件夹",name:newDestinationName.trim(),body:"",folderId:destination || null})});
          if (!response.ok) throw new Error();
          const item: LibraryFile = await response.json();
          setFiles(previous=>[item,...previous || []]); setNewDestinationName(undefined); setDestination(item.id);
        } catch { toast({status:"error",title:"创建文件夹失败，请重试"}); }
        finally { setSaving(false); }
      }}>
          <ModalBody p={0} mt={3}><FormLabel htmlFor="move-folder-name" fontSize="sm">文件夹名称</FormLabel>
            <Input id="move-folder-name" autoFocus maxLength={255} value={newDestinationName ?? ""} onChange={event=>setNewDestinationName(event.target.value)}/>
          </ModalBody>
          <ModalFooter p={0} mt={3} gap={3}><Button size="sm" borderRadius="full" isDisabled={saving} onClick={()=>setNewDestinationName(undefined)}>取消</Button>
            <Button size="sm" borderRadius="full" type="submit" isDisabled={!newDestinationName?.trim()} isLoading={saving}>创建</Button>
          </ModalFooter>
        </form>
      </ModalContent>
    </Modal>
    <Modal isOpen={Boolean(purge)} onClose={() => {if (!saving) setPurge(undefined);}} isCentered>
      <ModalOverlay/><ModalContent borderRadius="16px"><ModalHeader>{purge && purge.length > 1 ? "清空回收站？" : "永久删除项目？"}</ModalHeader>
        <ModalBody>{purge?.length === 1 ? "“" + purge[0].name + "”" : (purge?.length || 0) + " 个项目"}将被永久删除，此操作无法撤销。</ModalBody>
        <ModalFooter gap={2}><Button isDisabled={saving} onClick={() => setPurge(undefined)}>取消</Button>
          <Button colorScheme="red" isLoading={saving} onClick={async () => {
            if (!purge || saving) return;
            setSaving(true);
            try {
              const byId = new Map(purge.map(item => [item.id, item]));
              const depth = (item: LibraryFile) => {
                const parents = new Set<string>();
                let parentId = item.folderId;
                while (parentId && byId.has(parentId) && !parents.has(parentId)) {
                  parents.add(parentId);
                  parentId = byId.get(parentId)?.folderId;
                }
                return parents.size;
              };
              const pending = purge.map(item => ({item, depth:depth(item)}))
                .sort((left,right) => right.depth - left.depth);
              for (const {item} of pending) {
                const response = await fetch("/api/library?id=" + encodeURIComponent(item.id), {method:"DELETE", headers:withAuthHeaders({})});
                if (response.status === 404) {
                  // Another tab may already have restored or removed this item.
                  setAttempt(value => value + 1);
                } else if (!response.ok) {
                  throw new Error(response.status === 409 ? "请先恢复此条目并移出其中的资料，或先永久删除已在回收站中的子项。" : "删除失败，请重试");
                }
                setPurge(items => items?.filter(entry => entry.id !== item.id));
                if (response.ok) setFiles(items => items?.filter(entry => entry.id !== item.id));
                setSelected(ids => ids.filter(id => id !== item.id));
              }
              setPurge(undefined);
            } catch (error) { toast({status:"error", title:error instanceof TypeError ? "网络连接中断，请重试" : error instanceof Error ? error.message : "删除失败，请重试"}); }
            finally { setSaving(false); }
          }}>永久删除</Button></ModalFooter>
      </ModalContent></Modal>
    <Modal isOpen={Boolean(rename)} initialFocusRef={renameInput} onClose={() => setRename(undefined)} isCentered><ModalOverlay/><ModalContent mx={3} maxW="520px" p="19px" borderRadius="24px">
      <ModalHeader as="h2" p={0} fontSize="20px" lineHeight="28px">重命名{rename && isNative(rename) ? rename.kind : "文件"}</ModalHeader>
      <form onSubmit={event => {event.preventDefault(); if(rename && canRename && !saving) void update(rename,{name:newName});}}>
        <ModalBody p={0} mt={3}><Text as="label" htmlFor="library-rename" display="block" fontSize="sm" lineHeight="24px">文件名</Text>
          <Flex align="center" gap={2} mt={2} px="10px" h="36px" border="1px solid" borderColor="gray.300" borderRadius="10px" _focusWithin={{borderColor:"gray.700"}}><Input variant="unstyled" fontSize="sm" minW={0} id="library-rename" ref={renameInput} value={title} maxLength={255-suffix.length}
            onFocus={event => event.target.setSelectionRange(event.target.value.length,event.target.value.length)} onChange={event => setTitle(event.target.value)}/>
            {suffix && <Text color="gray.600">{suffix}</Text>}</Flex></ModalBody>
        <ModalFooter p={0} mt={3} gap={3}><Button h={8} px={4} borderRadius="full" variant="outline" onClick={() => setRename(undefined)}>取消</Button><Button h={8} px={4} borderRadius="full" bg="#171717" color="white" _hover={{bg:"#303030"}} type="submit" isLoading={saving} isDisabled={!canRename}>重命名</Button></ModalFooter>
      </form></ModalContent></Modal>
  </Flex>;
}

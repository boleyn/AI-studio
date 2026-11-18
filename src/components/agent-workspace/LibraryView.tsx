import { useRouter } from "next/router";
import { useEffect, useRef, useState } from "react";
import { Box, Button, Flex, Heading, Input, Text, IconButton, Menu, MenuButton, Select, FormLabel, Modal, ModalOverlay, ModalContent, ModalHeader, ModalBody, ModalFooter, ModalCloseButton, MenuItem, MenuList, MenuItemOption, MenuOptionGroup, useToast } from "@chakra-ui/react";
import { withAuthHeaders } from "@features/auth/client/authClient";
import { buildDownloadUrl, downloadWorkspaceArtifact } from "@features/chat/services/files";
import { referenceTypes, type ImageReference, type LibraryFile } from "@/types/library";
import { LayoutGrid, List, ListFilter, MoreHorizontal, PanelLeftOpen } from "lucide-react";
import { isArtifactImage } from "../workspace/ArtifactFileIcon";

import { libraryAttachmentUrl, readLibraryAttachment } from "@features/chat/services/libraryAttachment";
import ArtifactShareDialog from "../workspace/ArtifactShareDialog";
import LibraryFileViewer from "./LibraryFileViewer";
import LibraryItemIcon from "./LibraryItemIcon";
import LibrarySelectionBox from "./LibrarySelectionBox";
import LibraryPageEditor from "./LibraryPageEditor";
import LibraryTemplates, { TemplateGallery } from "./LibraryTemplates";
import LibraryGlobalSearch from "./LibraryGlobalSearch";
import type { ProjectWithConversations } from "../AgentWorkspace";
import LibrarySidebar from "./LibrarySidebar";

const isContainer = (file:LibraryFile) => file.kind === "文件夹" || file.kind === "资料空间";
const isNative = (file:LibraryFile) => file.kind === "页面" || isContainer(file);
const fileTypes = ["页面", "图像", "文档", "电子表格", "演示文稿", "PDF 文件"];
function fileType(path: string) {
  if (isArtifactImage(path)) return "图像";
  if (/\.(xlsx?|csv|tsv|ods)$/i.test(path)) return "电子表格";
  if (/\.(pptx?|odp)$/i.test(path)) return "演示文稿";
  if (/\.pdf$/i.test(path)) return "PDF 文件";
  if (/\.(docx?|txt|md|rtf|odt)$/i.test(path)) return "文档";
  return "其他";
}

export default function LibraryView({ projects, onProject, onOpen, onBack, onChat }: { projects: ProjectWithConversations[]; onProject:(token:string)=>void; onChat:(files:File[])=>Promise<void>; onBack: () => void; onOpen: (token: string, chatId: string) => void }) {
  const [files, setFiles] = useState<LibraryFile[]>();
  const [selected,setSelected] = useState<string[]>([]);
  const [batchBusy,setBatchBusy] = useState(false);
  const [batchMove,setBatchMove] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [globalSearch,setGlobalSearch] = useState(false);
  const [query, setQuery] = useState("");

  const [showTemplates,setShowTemplates] = useState(true);
  const [creating,setCreating] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [referenceDraft,setReferenceDraft] = useState<{file?:File; type?:ImageReference["type"]; name:string}>();
  const referenceInput = useRef<HTMLInputElement>(null);
  async function uploadFiles(selected:File[], openCreated = false, reference?:ImageReference) {
    if (!selected.length) return;
    setCreating(true);
    try {
      for (const file of selected) {
        const params = new URLSearchParams({name:file.name});
        if (reference) { params.set("referenceType",reference.type); params.set("referenceName",reference.name); }
        if (folder) params.set("folderId",folder.id);
        const response = await fetch("/api/library/files?" + params,{method:"POST",headers:withAuthHeaders({"Content-Type":"application/octet-stream"}),body:file});
        if (!response.ok) {
          toast({status:"error",title:file.name + (response.status === 413 ? " 超过上传大小限制" : " 上传失败")});
          continue;
        }
        const item:LibraryFile = await response.json();
        setFiles(previous => [item,...previous || []]);
        if (reference) setReferenceDraft(undefined);
        if (openCreated) openItem(item);
      }
    } catch { toast({status:"error",title:"上传中断，请重试"}); }
    finally { setCreating(false); }
  }
  async function createSlides(template: "blank" | "product-strategy" = "blank") {
    if (creating) return;
    setCreating(true);
    try {
      const response = await fetch(`/library-templates/${template}.pptx`);
      if (!response.ok) throw new Error();
      await uploadFiles([new File([await response.blob()], template === "blank" ? "无标题演示文稿.pptx" : "Product Strategy.pptx", {
        type:"application/vnd.openxmlformats-officedocument.presentationml.presentation"
      })], true);
    } catch {
      toast({status:"error", title:"无法创建幻灯片，请重试"});
    } finally {
      setCreating(false);
    }
  }
  const [galleryOpen, setGalleryOpen] = useState(false);
  const galleryTrigger = useRef<HTMLButtonElement | null>(null);

  const [newKind,setNewKind] = useState<"文件夹"|"资料空间">();
  const [move,setMove] = useState<LibraryFile>();
  const [destination,setDestination] = useState("");
  async function createPage(name:string, body:string, kind:"页面"|"文件夹"|"资料空间"="页面") {
    if (creating) return;
    setCreating(true);
    try {
      const response = await fetch("/api/library/pages",{method:"POST", headers:withAuthHeaders({"Content-Type":"application/json"}), body:JSON.stringify({name,body,kind,folderId:kind === "资料空间" ? null : folder?.id})});
      if (!response.ok) throw new Error();
      const page:LibraryFile = await response.json();
      setFiles(previous => [page,...previous || []]);
      setNewKind(undefined);
      openItem(page);
    } catch { toast({status:"error",title:"创建页面失败"}); }
    finally {setCreating(false);}
  }
  function openItem(file:LibraryFile) {
    const openedAt = new Date().toISOString();
    setFiles(current => current?.map(item => item.id === file.id ? {...item, openedAt} : item));
    void fetch("/api/library", {method:"POST", headers:withAuthHeaders({"Content-Type":"application/json"}),
      body:JSON.stringify({openedId:file.id})}).catch(() => undefined);
    if (isContainer(file)) {
      setSelected([]);
      setQuery("");
      navigateList("全部", "推荐", file.id, undefined, true);
    } else {
      navigateList(section, tab, folder?.id, file.id);
    }
  }
  const router = useRouter();
  const sections = ["全部", "页面", "幻灯片", "站点", "图像", "回收站"];
  const section = sections.find(value => value === router.query.librarySection) || "全部";
  const imageSection = section === "图像";
  const tabs = imageSection ? ["你的作品", "已上传"] : ["推荐", "收藏", "你的条目", "与你共享"];
  const tab = tabs.find(value => value === router.query.libraryTab) || tabs[0];
  const folder = files?.find(file => file.id === router.query.libraryFolder && isContainer(file) && !file.deleted);
  const opened = files?.find(file => file.id === router.query.libraryItem && !isContainer(file) && !file.deleted);
  const editor = opened?.kind === "页面" ? opened : undefined;
  const detail = opened?.kind !== "页面" ? opened : undefined;
  function navigateList(nextSection: string, nextTab: string, folderId?:string, itemId?:string, clearTypes = false) {
    if (nextSection === section && nextTab === tab && router.query.libraryFolder === folderId && router.query.libraryItem === itemId && !(clearTypes && router.query.libraryType)) return;
    const query = {...router.query};
    if (clearTypes) delete query.libraryType;
    if (folderId) query.libraryFolder = folderId;
    else delete query.libraryFolder;
    if (itemId) query.libraryItem = itemId;
    else delete query.libraryItem;
    if (nextSection === "全部") delete query.librarySection;
    else query.librarySection = nextSection;
    if (nextTab === "推荐") delete query.libraryTab;
    else query.libraryTab = nextTab;
    void router.push({pathname:router.pathname, query}, undefined, {shallow:true, scroll:false});
  }
  useEffect(() => { setSelected([]); }, [section, tab]);
  const [sidebar, setSidebar] = useState(true);
  const search = useRef<HTMLInputElement>(null);
  const [sharing,setSharing] = useState<LibraryFile>();
  const [purge,setPurge] = useState<LibraryFile[]>();
  const [rename, setRename] = useState<LibraryFile>();
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const changeSection = (next: string) => {
    setSelected([]);
    navigateList(next, "推荐", undefined, undefined, true);
    setQuery("");
  };
  const requestedTypes = [router.query.libraryType].flat();
  const types = fileTypes.filter(type => requestedTypes.includes(type));
  const grid = router.query.libraryLayout === "grid";
  function updateListOptions(nextTypes: string[], nextGrid: boolean) {
    const query = {...router.query};
    if (nextTypes.length) query.libraryType = nextTypes;
    else delete query.libraryType;
    if (nextGrid) query.libraryLayout = "grid";
    else delete query.libraryLayout;
    void router.push({pathname:router.pathname, query}, undefined, {shallow:true, scroll:false});
  }
  const [sort, setSort] = useState<{column: "name" | "time"; ascending: boolean}>({ column: "time", ascending: false });
  function sortBy(column: "name" | "time") {
    setSort(previous => ({ column, ascending: previous.column === column ? !previous.ascending : column === "name" }));
  }
  const toast = useToast();
  useEffect(() => {
    const controller = new AbortController();
    setFailed(false);
    fetch("/api/library", { headers: withAuthHeaders(), signal: controller.signal })
      .then(response => {
        if (!response.ok) throw new Error();
        return response.json();
      }).then(data => { if (!controller.signal.aborted) setFiles(data); })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [attempt]);
  const destinations = files?.filter(item => isContainer(item) && !item.deleted) || [];
  const visible = files?.filter(file => Boolean(file.deleted) === (section === "回收站") &&
    (!folder || file.folderId === folder.id) &&
    (section === "全部" || section === "回收站" || (file.kind === "页面" ? "页面" : fileType(file.path)) === (section === "幻灯片" ? "演示文稿" : section)) &&
    (!imageSection || (!file.shareId && file.kind === (tab === "已上传" ? "上传" : "生成"))) &&
    (tab !== "收藏" || file.favorite) && (tab === "与你共享" ? Boolean(file.shareId) : tab !== "你的条目" || !file.shareId) && (!types.length || types.includes(file.kind === "页面" ? "页面" : fileType(file.path))) &&
    [file.name, file.path, file.project, file.conversation].some(value => value.toLowerCase().includes(query.trim().toLowerCase()))).sort((a, b) => (sort.ascending ? 1 : -1) * (section === "回收站" && sort.column === "time" ? a.deletedAt || "" : a[sort.column]).localeCompare(section === "回收站" && sort.column === "time" ? b.deletedAt || "" : b[sort.column], "zh-CN", { numeric: true }));
  const picked = visible?.filter(item => selected.includes(item.id)) || [];
  const checkItem = (id:string) => setSelected(ids => ids.includes(id) ? ids.filter(value => value!==id) : [...ids,id]);
  const allChecked = Boolean(visible?.length && visible.length === picked.length);
  async function usePicked(action:"chat"|"download") {
    setBatchBusy(true);
    try {
      const attachments = await Promise.all(picked.map(item => readLibraryAttachment(item)));
      if (action === "chat") {await onChat(attachments); return;}
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
      setTimeout(()=>URL.revokeObjectURL(url),1000);
    } catch(error) {toast({status:"error",title:error instanceof Error ? error.message : "操作失败"});}
    finally {setBatchBusy(false);}
  }
  const key = (file: LibraryFile) => file.id;
  const downloadUrl = (file:LibraryFile) => file.shareId ? "/api/artifact-share?id="+file.shareId+"&file=1" : file.directUpload ? "/api/library/files?id=" + file.id : buildDownloadUrl({storagePath:file.path,token:file.token,chatId:file.chatId});
  const download = (file: LibraryFile) => file.kind === "上传" ?
    <Button as="a" size="xs" variant="ghost" href={downloadUrl(file)}>下载</Button> :
    <Button size="xs" variant="ghost" onClick={() => downloadWorkspaceArtifact(file.token,file.path,file.version)
      .catch(() => toast({ status:"error", title:"无法下载此文件" }))}>下载</Button>;
  async function update(file: LibraryFile, changes: Partial<Pick<LibraryFile, "name" | "favorite" | "deleted" | "folderId">>) {
    setSaving(true);
    try {
      const response = await fetch((isNative(file) || file.directUpload) ? "/api/library/pages?id=" + file.id : "/api/library", { method: "PATCH", headers: withAuthHeaders({"Content-Type":"application/json"}),
        body: JSON.stringify((isNative(file) || file.directUpload) ? changes : {id:file.id, changes}) });
      if (!response.ok) throw new Error();
      setFiles(previous => previous?.map(item => item.id === file.id ? {...item,...changes,...(changes.deleted === undefined ? {} : {deletedAt:changes.deleted ? new Date().toISOString() : null})} : item));
      setRename(undefined);
      setMove(undefined);
    } catch {
      toast({ status:"error", title:"未能保存更改，请重试" });
    } finally { setSaving(false); }
  }
  const actions = (file: LibraryFile) => <Menu placement="bottom-end">
    <MenuButton as={IconButton} variant="ghost" size="xs" aria-label={`打开 ${file.name} 的操作菜单`} icon={<MoreHorizontal size={16}/>}/>
    <MenuList>{file.deleted ? <><MenuItem onClick={() => update(file,{deleted:false})}>恢复</MenuItem><MenuItem color="red.600" onClick={() => setPurge([file])}>永久删除</MenuItem></> : <>
      {!file.shareId && !isContainer(file) && <MenuItem onClick={()=>setSharing(file)}>分享</MenuItem>}
      <MenuItem onClick={() => { setTitle(file.name); setRename(file); }}>重命名</MenuItem>
      {isNative(file) ? <MenuItem onClick={() => openItem(file)}>打开{file.kind}</MenuItem> : file.kind === "上传" ? <MenuItem as="a" href={downloadUrl(file)}>下载</MenuItem> :
        <MenuItem onClick={() => downloadWorkspaceArtifact(file.token,file.path,file.version).catch(() => toast({status:"error",title:"下载失败"}))}>下载</MenuItem>}
      <MenuItem onClick={() => update(file,{favorite:!file.favorite})}>{file.favorite ? "从收藏夹移除" : "添加到收藏夹"}</MenuItem>
      {!isContainer(file) && <MenuItem onClick={() => {setBatchMove(false);setMove(file);setDestination(file.folderId || "");}}>移至文件夹</MenuItem>}
      <MenuItem color="red.600" onClick={() => update(file,{deleted:true})}>删除</MenuItem>
    </>}</MenuList></Menu>;
  const createMenu = (rail:boolean) => <Menu><MenuButton as={Button} onClick={(event: React.MouseEvent<HTMLButtonElement>) => { galleryTrigger.current = event.currentTarget; }} size="sm" aria-label="创建" borderRadius={rail ? "md" : "full"} bg={rail ? "transparent" : "#111"} color={rail ? "inherit" : "white"} justifyContent={rail ? "start" : "center"} _hover={{bg:rail ? "#eee" : "#333"}} _active={{bg:rail ? "#eee" : "#333"}} isLoading={creating}>{rail ? "＋  创建" : "创建 ﹀"}</MenuButton>
            <MenuList><MenuItem onClick={() => setGalleryOpen(true)}>从模板开始</MenuItem>
              <MenuItem onClick={() => createPage("无标题页","")}>页面</MenuItem>
              <MenuItem onClick={() => createSlides()}>幻灯片</MenuItem>
              {(["文件夹","资料空间"] as const).map(kind => <MenuItem key={kind} onClick={() => {setTitle("");setNewKind(kind);}}>{kind}</MenuItem>)}
              <MenuItem onClick={() => fileInput.current?.click()}>上传文件</MenuItem></MenuList>
          </Menu>;
  return <Flex flex="1" minW={0} minH={0}>
    <input ref={fileInput} type="file" multiple hidden aria-label="上传文件" onChange={event => {
      const selected = Array.from(event.target.files || []);
      event.target.value = "";
      void uploadFiles(selected);
    }}/>
    {sidebar && <Box display={{base:"none",md:"flex"}}><LibrarySidebar createMenu={createMenu(true)} onNewSpace={() => {setTitle("");setNewKind("资料空间");}} section={folder?.name || section} files={files || []} onSection={changeSection}
      onFile={openItem} onSearch={() => setGlobalSearch(true)} onCollapse={() => setSidebar(false)} /></Box>}
    {detail ? <LibraryFileViewer key={detail.id} item={files?.find(item=>item.id===detail.id) || detail}
      share={detail.shareId ? undefined : ()=>setSharing(detail)} download={download(detail)} close={()=>navigateList(section, tab, folder?.id)} openSource={()=>onOpen(detail.token,detail.chatId)}
      toggleFavorite={()=>update(detail,{favorite:!files?.find(item=>item.id===detail.id)?.favorite})}/> : editor ? <LibraryPageEditor key={editor.id} page={editor} onBack={() => navigateList(section, tab, folder?.id)}
      onSaved={(name,time) => setFiles(items => items?.map(item => item.id === editor.id ? {...item,name,time} : item))}/> :
    <Box flex="1" minW={0} overflowY="auto" pt="16px" pb={8}>
    <Box maxW="1440px" px={{base:4,md:8,xl:"48px"}} mx="auto">
      <Box position="sticky" top={0} bg="white" zIndex={2}><Flex align="center" minH="36px" justify="space-between" gap={4} wrap="wrap">
        <Button display={{ base: "inline-flex", md: "none" }} variant="ghost" onClick={onBack}>返回聊天</Button>
        <Flex align="center" gap={2}>{!sidebar && <IconButton aria-label="展开资料空间侧栏" icon={<PanelLeftOpen size={16}/>} size="sm" variant="ghost" onClick={() => setSidebar(true)}/>}{folder && <Button variant="ghost" size="xs" onClick={() => {const parent=files?.find(item => item.id===folder.folderId);navigateList(section,tab,parent?.id);}}>返回</Button>}<Heading fontSize="24px" lineHeight="36px" fontWeight="500">{folder?.name || section}</Heading></Flex>
        {section !== "回收站" && <Flex align="center" gap={3}><Input ref={search} size="sm" borderRadius="full" type="search" aria-label="搜索文件、项目或会话" placeholder="搜索" maxW="240px"
          value={query} onChange={event => setQuery(event.target.value)} />
          {createMenu(false)}</Flex>}
      </Flex>
      <Flex gap={1} mt="4px" pb="20px" mb="17px" minH="56px" align="center" justify="flex-end">
        <Flex flex="1" gap={1} wrap="wrap">{section !== "回收站" && tabs.map(name =>
          <Button key={name} size="sm" h="36px" px="18px" borderRadius="full" aria-pressed={tab === name} variant={tab === name ? "solid" : "ghost"} onClick={() => {setSelected([]);navigateList(section, name, folder?.id);}}>{name}</Button>)}</Flex>
        {!imageSection && <><Menu closeOnSelect={false}>
          <MenuButton as={IconButton} aria-label="打开筛选器" icon={<ListFilter size={17}/>} size="sm" variant={types.length ? "solid" : "ghost"} />
          <MenuList><MenuOptionGroup title="文件类型" type="checkbox" value={types} onChange={value => updateListOptions(Array.isArray(value) ? value : [value], grid)}>
            {fileTypes.map(type => <MenuItemOption key={type} value={type}>{type}</MenuItemOption>)}
          </MenuOptionGroup></MenuList>
        </Menu>
        <IconButton aria-label="网格视图" aria-pressed={grid} onClick={() => updateListOptions(types, true)} icon={<LayoutGrid size={16}/>} variant={grid ? "solid" : "ghost"} size="sm" borderRadius="full"/>
        <IconButton aria-label="列表视图" aria-pressed={!grid} onClick={() => updateListOptions(types, false)} icon={<List size={16}/>} variant={!grid ? "solid" : "ghost"} size="sm" borderRadius="full"/></>}
      </Flex>
      </Box>
      {imageSection && <Box as="section" aria-label="参考照片" mb={5}>
        <Heading as="h2" fontSize="md" mb={2}>参考照片</Heading>
        <Flex gap={2} overflowX="auto"><Button onClick={() => setReferenceDraft({name:""})}>添加引用</Button>
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
      <Box>{showTemplates && !folder && section === "全部" && tab === "推荐" && !query && !types.length &&
        <LibraryTemplates onStrategy={() => createSlides("product-strategy")} onPick={createPage} onClose={() => setShowTemplates(false)}/>}</Box>
      {failed ? <Button onClick={() => setAttempt(attempt + 1)}>加载失败，点击重试</Button> :
        !visible ? <Text role="status">正在加载文件…</Text> :
        !visible.length ? <Text>{section === "回收站" ? "回收站为空" : files?.length ? "没有符合条件的文件" : "会话中生成或上传的文件会显示在这里"}</Text> :
        grid || imageSection ? <Box display="grid" gridTemplateColumns="repeat(auto-fill,minmax(180px,1fr))" gap={3}>
          {visible.map(file => <Box key={key(file)} position="relative" p={4} borderWidth="1px" borderRadius="14px">
            <LibrarySelectionBox card label={"选择"+file.name} checked={selected.includes(file.id)} onChange={()=>checkItem(file.id)}/>{imageSection ? <Box as="button" w="full" onClick={() => openItem(file)} aria-label={"打开 " + file.name}>
              <Box as="img" src={libraryAttachmentUrl(file)} alt={file.name} loading="lazy" w="full" aspectRatio="1" objectFit="cover" borderRadius="8px"/>
            </Box> : <LibraryItemIcon item={file}/>}<Text as="button" display="block" my={2} overflowWrap="anywhere" onClick={() => openItem(file)}>{file.name}</Text>
            {actions(file)}
          </Box>)}
        </Box> : <Box as="table" width="100%" textAlign="left" fontSize="sm" aria-label={section === "回收站" ? "回收站" : "推荐内容"} sx={{
          tableLayout:"fixed", "& th":{height:"42px",fontSize:"13px",fontWeight:500,color:"#656565",textAlign:"left"},
          "& td":{height:"50px",verticalAlign:"middle"},
          "& th:first-of-type, & td:first-of-type":{position:"relative",paddingLeft:"16px"},
          "& td button":{maxWidth:"100%",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"},
          "@media (hover:hover)":{"& tbody tr:not(:hover):not(:focus-within) td:last-child button":{opacity:0}}
        }}>
          <colgroup><col style={{width:"62%"}}/><col style={{width:"19%"}}/><col/><col style={{width:"30px"}}/></colgroup>
          <thead><tr>{(["name", "source", "time"] as const).map(column =>
            <th key={column} scope="col" aria-sort={sort.column === column ? sort.ascending ? "ascending" : "descending" : undefined}>
              {column === "name" && <LibrarySelectionBox label={picked.length ? "清除选择" : "全选"} checked={allChecked}
                mixed={picked.length>0 && !allChecked} onChange={()=>setSelected(picked.length ? [] : visible.map(item=>item.id))}/>}
              {column === "source" ? (section === "回收站" ? "大小" : "来源") : <button type="button" onClick={() => sortBy(column)}>{column === "name" ? "名称" : section === "回收站" ? "删除日期" : "上次活动时间"}</button>}
            </th>)}<th aria-label="文件操作"/></tr></thead>
          <tbody>{visible.map(file => <Box as="tr" key={key(file)} borderTopWidth="1px" _hover={{bg:"surface.hover"}}>
            <td><LibrarySelectionBox label={"选择"+file.name} checked={selected.includes(file.id)} onChange={()=>checkItem(file.id)}/>
              <Flex align="center" py="4px" gap={3}><LibraryItemIcon item={file}/><button type="button" onClick={() => openItem(file)}>{file.name}</button></Flex></td>
            <td>{section === "回收站" ? (file.size === undefined ? "—" : new Intl.NumberFormat("zh-CN", {style:"unit",unit:"byte"}).format(file.size)) : file.chatId ? <Button size="xs" variant="link" onClick={() => onOpen(file.token,file.chatId)}>{file.conversation}</Button> : "—"}</td>
            <td>{section === "回收站" ? (file.deletedAt ? new Date(file.deletedAt).toLocaleDateString("zh-CN") : "—") : file.time ? new Date(file.time).toLocaleDateString("zh-CN") : "—"}</td><td>{actions(file)}</td>
          </Box>)}</tbody>
        </Box>}
      {picked.length>0 && <Flex role="toolbar" aria-label="所选项目的操作" position="sticky" bottom={3} zIndex={3} mx="auto" mt={4}
        w="fit-content" maxW="100%" wrap="wrap" align="center" gap={1} p={2} border="1px solid #ddd" borderRadius="18px" bg="white" shadow="md">
        <Text fontSize="sm" px={2}>已选择 {picked.length} 个</Text>
        <Button size="sm" variant="ghost" isDisabled={batchBusy || picked.some(item=>isContainer(item)||item.deleted)} onClick={()=>usePicked("chat")}>开始聊天</Button>
        <Button size="sm" variant="ghost" isDisabled={batchBusy || picked.some(item=>isContainer(item)||item.deleted)} onClick={()=>usePicked("download")}>下载</Button>
        <Button size="sm" variant="ghost" isDisabled={saving || batchBusy} onClick={async()=>{setBatchBusy(true);try {for(const item of picked) await update(item,{deleted:section!=="回收站"});}finally{setBatchBusy(false);}}}>{section==="回收站" ? "恢复" : "删除"}</Button>
        <Menu><MenuButton as={IconButton} size="sm" variant="ghost" aria-label="更多操作" icon={<MoreHorizontal size={16}/>}/><MenuList><MenuItem isDisabled={picked.some(item=>isContainer(item)||item.deleted)} onClick={()=>{setBatchMove(true);setMove(picked[0]);setDestination("");}}>移动</MenuItem></MenuList></Menu>
        <IconButton size="sm" variant="ghost" aria-label="清除选择" icon={<span>×</span>} onClick={()=>setSelected([])}/>
      </Flex>}
    </Box>
  </Box>}
    {referenceDraft && <Modal isOpen isCentered onClose={() => {if (!creating) setReferenceDraft(undefined);}}>
      <ModalOverlay/><ModalContent borderRadius="16px"><ModalHeader>上传参考图</ModalHeader><ModalCloseButton aria-label="关闭对话框"/>
        <ModalBody><Text mb={4}>今后生成图像时可以将这张照片用作参考。请仅保存你拥有或有权限使用的照片。</Text>
          <input ref={referenceInput} type="file" hidden accept=".png,.jpg,.jpeg,.webp,.avif,.gif" onChange={event => setReferenceDraft({...referenceDraft,file:event.target.files?.[0]})}/>
          <Button w="full" onClick={() => referenceInput.current?.click()}>{referenceDraft.file?.name || "上传图像"}</Button>
          <Flex role="group" aria-label="参考类型" mt={4} gap={1}>{referenceTypes.map(type =>
            <Button key={type} size="sm" variant={referenceDraft.type === type ? "solid" : "ghost"} aria-pressed={referenceDraft.type === type}
              onClick={() => setReferenceDraft({...referenceDraft,type})}>{type}</Button>)}</Flex>
          {referenceDraft.type && referenceDraft.type !== "我" && <Input mt={3} aria-label="名字" placeholder="名字" maxLength={120} value={referenceDraft.name}
            onChange={event => setReferenceDraft({...referenceDraft,name:event.target.value})}/>}
        </ModalBody><ModalFooter gap={2}><Button isDisabled={creating} onClick={() => setReferenceDraft(undefined)}>取消</Button>
          <Button isLoading={creating} isDisabled={!referenceDraft.file || !referenceDraft.type} onClick={() => {
            if (referenceDraft.file && referenceDraft.type) void uploadFiles([referenceDraft.file], false, {type:referenceDraft.type,name:referenceDraft.name});
          }}>保存</Button></ModalFooter></ModalContent></Modal>}
    {globalSearch && <LibraryGlobalSearch projects={projects} files={files || []} onProject={onProject} onChat={onOpen} onFile={openItem} close={() => setGlobalSearch(false)} />}
    {galleryOpen && <TemplateGallery onSlides={() => { setGalleryOpen(false); void createSlides(); }} onUpload={() => { setGalleryOpen(false); fileInput.current?.click(); }} onWorkbook={file => { setGalleryOpen(false); void uploadFiles([file], true); }} triggerRef={galleryTrigger} onClose={() => { setGalleryOpen(false); requestAnimationFrame(() => galleryTrigger.current?.focus()); }} onPick={(name, body) => { setGalleryOpen(false); void createPage(name, body); }} />}
    {sharing && <ArtifactShareDialog token={sharing.token} path={sharing.path} displayName={sharing.name} version={sharing.version}
      libraryItemId={sharing.directUpload || sharing.kind==="页面" ? sharing.id : undefined}
      chatId={sharing.kind==="上传" && !sharing.directUpload ? sharing.chatId : undefined} onClose={()=>setSharing(undefined)}/>}
    <Modal isOpen={Boolean(newKind)} onClose={() => setNewKind(undefined)} isCentered><ModalOverlay/><ModalContent borderRadius="20px">
      <ModalHeader>新建{newKind}</ModalHeader><form onSubmit={event => {event.preventDefault(); if (title.trim() && newKind) void createPage(title.trim(),"",newKind);}}>
        <ModalBody><FormLabel htmlFor="library-container-name">{newKind}名称</FormLabel><Input id="library-container-name" autoFocus value={title} maxLength={255}
          onChange={event => setTitle(event.target.value)}/></ModalBody><ModalFooter gap={2}><Button borderRadius="full" onClick={() => setNewKind(undefined)}>取消</Button>
          <Button borderRadius="full" colorScheme="blackAlpha" type="submit" isLoading={creating} isDisabled={!title.trim()}>创建</Button></ModalFooter>
      </form></ModalContent></Modal>
    <Modal isOpen={Boolean(move)} onClose={() => setMove(undefined)} isCentered><ModalOverlay/><ModalContent><ModalHeader>移至文件夹</ModalHeader><ModalCloseButton/>
      <ModalBody><Select aria-label="目标文件夹" value={destination} onChange={e => setDestination(e.target.value)}><option value="">全部</option>
        {destinations.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></ModalBody>
      <ModalFooter gap={2}><Button onClick={() => setMove(undefined)}>取消</Button><Button isLoading={saving} onClick={async () => {if (!move) return; const targets=batchMove ? picked : [move]; for(const item of targets) await update(item,{folderId:destination || null});setBatchMove(false);}}>移动</Button></ModalFooter>
    </ModalContent></Modal>
    <Modal isOpen={Boolean(purge)} onClose={() => {if (!saving) setPurge(undefined);}} isCentered>
      <ModalOverlay/><ModalContent borderRadius="16px"><ModalHeader>{purge && purge.length > 1 ? "清空回收站？" : "永久删除项目？"}</ModalHeader>
        <ModalBody>{purge?.length === 1 ? "“" + purge[0].name + "”" : (purge?.length || 0) + " 个项目"}将被永久删除，此操作无法撤销。</ModalBody>
        <ModalFooter gap={2}><Button isDisabled={saving} onClick={() => setPurge(undefined)}>取消</Button>
          <Button colorScheme="red" isLoading={saving} onClick={async () => {
            if (!purge || saving) return;
            setSaving(true);
            try {
              const pending = [...purge].sort((a,b) => Number(isContainer(a)) - Number(isContainer(b)));
              for (const item of pending) {
                const response = await fetch("/api/library?id=" + encodeURIComponent(item.id), {method:"DELETE", headers:withAuthHeaders({})});
                if (response.status === 404) {
                  // Another tab may already have restored or removed this item.
                  setAttempt(value => value + 1);
                } else if (!response.ok) {
                  throw new Error(response.status === 409 ? "请先移出或删除文件夹中的条目" : "删除失败，请重试");
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
    <Modal isOpen={Boolean(rename)} onClose={() => setRename(undefined)} isCentered><ModalOverlay/><ModalContent>
      <ModalHeader>重命名</ModalHeader><ModalCloseButton/><form onSubmit={event => {event.preventDefault(); if(rename && title.trim()) void update(rename,{name:title.trim()});}}>
        <ModalBody><Input aria-label="名称" autoFocus value={title} maxLength={255} onChange={event => setTitle(event.target.value)}/></ModalBody>
        <ModalFooter gap={2}><Button variant="ghost" onClick={() => setRename(undefined)}>取消</Button><Button type="submit" isLoading={saving} isDisabled={!title.trim()}>保存</Button></ModalFooter>
      </form></ModalContent></Modal>
  </Flex>;
}

import { sitePreviewPath } from "@/types/library";
import { Modal, ModalOverlay, ModalContent, ModalHeader, ModalBody, ModalCloseButton, ModalFooter, AlertDialog, AlertDialogBody, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogOverlay, Box, Button, Flex, Heading, IconButton, Input, Link, Menu, MenuButton, MenuItem, MenuList, Portal, Text, useToast } from "@chakra-ui/react";
import { BarChart3, Trash2, Copy, ExternalLink, Link2, LockKeyhole, MoreHorizontal, PanelsTopLeft, Pencil, Settings, Share2 } from "lucide-react";
import { useRouter } from "next/router";
import { useEffect, useRef, useState } from "react";
import { withAuthHeaders } from "@features/auth/client/authClient";

import SiteDetailHeader, { SiteDetailNav } from "./SiteDetailHeader";
import SiteDatabase from "./SiteDatabase";
import SitePlugins from "./SitePlugins";
import SiteSchedules from "./SiteSchedules";
import SiteDomains from "./SiteDomains";
import ArtifactShareDialog from "../workspace/ArtifactShareDialog";

interface Site { projectToken?:string; slug?:string; restricted?:boolean; memberCount?:number; id: string; name: string; shared: boolean; publishedAt?: string; ownerName?: string; editUrl?: string; libraryId?: string; visitors?: number }

const audience = (site:Site) => site.restricted ? (site.memberCount ? "仅限受邀者" : "仅自己可见") : "拥有链接的人";

export default function LibrarySites({ tab, query, grid, onSitesChanged, onPluginChat }: { onPluginChat:(token:string,name:string)=>Promise<void>; tab: string; query: string; grid: boolean; onSitesChanged: () => void }) {
  const toast = useToast();
  const [pendingDelete,setPendingDelete] = useState<Site>();
  const cancelDelete = useRef<HTMLButtonElement>(null);
  const router = useRouter();
  const [title,setTitle] = useState("");
  const [slugDraft,setSlugDraft] = useState<string>();
  const [slugError,setSlugError] = useState("");
  const [saving,setSaving] = useState(false);
  const [sharing, setSharing] = useState<Site>();
  const [sites, setSites] = useState<Site[]>();
  const settings = sites?.find(site=>!site.shared && site.id===router.query.librarySiteSettings);
  useEffect(()=>setTitle(settings?.name || ""),[settings?.id,settings?.name]);
  const scheduled = router.query.siteDetail === "scheduled";
  const database = router.query.siteDetail === "database";
  const plugins = router.query.siteDetail === "plugins";
  function navigateSettings(id?:string, detail?: "scheduled" | "plugins" | "database") {
    const query = {...router.query};
    if (detail) query.siteDetail = detail;
    else delete query.siteDetail;
    if (id) query.librarySiteSettings = id;
    else delete query.librarySiteSettings;
    void router.push({pathname:router.pathname,query},undefined,{shallow:true,scroll:false});
  }
  const [loadError, setLoadError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoadError("");
    fetch("/api/library/sites", { headers: withAuthHeaders(), signal: controller.signal })
      .then(async response => {
        if (response.status === 401) throw new Error("登录已过期，请重新登录。");
        if (!response.ok) throw new Error("站点服务暂时不可用，请稍后重试。");
        const rows: Site[] = await response.json();
        if (!Array.isArray(rows) || rows.some(site => !site || typeof site.name !== "string" || typeof site.id !== "string")) throw new Error("站点列表未能加载，请重试。");
        if (!controller.signal.aborted) setSites(rows);
      })
      .catch(error => {
        if (controller.signal.aborted) return;
        setLoadError(error instanceof TypeError ? "连接失败，请检查网络后重试。" :
          error instanceof SyntaxError ? "站点列表未能加载，请重试。" : error.message);
      });
    return () => controller.abort();
  }, [attempt]);
  if (loadError) return <Flex direction="column" align="center" py={12} gap={3}>
    <Box role="alert" textAlign="center"><Heading as="h2" size="sm">无法加载站点</Heading>
      <Text mt={1} fontSize="sm" color="gray.600">{loadError}</Text></Box>
    <Button size="sm" variant="outline" borderRadius="full" onClick={() => setAttempt(value => value + 1)}>重新加载站点</Button>
  </Flex>;
  if (!sites) return <Text role="status">正在加载站点…</Text>;
  const searchTerm = query.trim().normalize("NFC").toLowerCase();
  const visible = sites.filter(site => (tab === "全部" || site.shared === (tab === "与你共享")) && site.name.normalize("NFC").toLowerCase().includes(searchTerm));
  const empty = searchTerm ? "没有符合条件的站点" : tab === "与你共享" ? "没有与你共享的站点" : "没有站点";
  const siteUrl = (site: Site) => sitePreviewPath(site.id,site.slug);
  const siteCover = (site: Site) => <Flex position="relative" overflow="hidden" flexShrink={0}
    w={grid ? "full" : "80px"} aspectRatio={grid ? "3 / 2" : "8 / 5"} borderRadius={grid ? 0 : "6px"}
    align="center" justify="center" bg="gray.50" color="gray.400">
    <PanelsTopLeft size={grid ? 32 : 19} aria-hidden/>
    <Box as="img" alt="" loading="lazy" src={"/api/share/"+encodeURIComponent(site.id)+"/cover"}
      position="absolute" inset={0} w="full" h="full" objectFit="cover" onError={event=>{event.currentTarget.style.display="none";}}/>
  </Flex>;
  const siteLink = (site: Site) => {
    const published = site.publishedAt ? new Date(site.publishedAt) : undefined;
    return <Link href={siteUrl(site)} aria-label={"访问 " + site.name}>
      <Flex align="center" gap={4}>{siteCover(site)}<Box>
        <Text>{site.name}</Text>
        {published && Number.isFinite(published.getTime()) && <Text as="time" dateTime={published.toISOString()} fontSize="14px" lineHeight="20px" color="#5d5d5d">
          {published.toLocaleDateString("zh-CN",{month:"long",day:"numeric"})}
        </Text>}
      </Box></Flex>
    </Link>;
  };
  async function deleteSite(site: Site) {
    if (saving || site.shared) return;
    setSaving(true);
    try {
      const response = await fetch("/api/library/sites?id="+encodeURIComponent(site.id),{method:"DELETE",headers:withAuthHeaders()});
      if (!response.ok && response.status !== 404) throw new Error();
      setPendingDelete(undefined);
      setSites(rows=>rows?.filter(row=>row.id!==site.id));
      onSitesChanged();
      navigateSettings();
      toast({status:"success",title:"站点已删除"});
    } catch { toast({status:"error",title:"站点删除失败，请重试"}); }
    finally {setSaving(false);}
  }
  const siteMenu = (site: Site) => <Menu placement="bottom-end">
    <MenuButton as={IconButton} size="sm" variant="ghost" aria-label={site.name + " 的更多操作"} icon={<MoreHorizontal size={16}/>}/>
    <Portal><MenuList w="240px" minW={0} maxW="calc(100vw - 16px)" p="10px" borderRadius="16px"
      sx={{"& [role=menuitem]":{minHeight:"36px",padding:"6px 10px",fontSize:"14px",borderRadius:"8px"}}}>
      {!site.shared && <MenuItem icon={<Share2 size={16}/>} onClick={()=>setSharing(site)}>共享</MenuItem>}
      <MenuItem icon={<Copy size={16}/>} onClick={async ()=>{
        try {
          await navigator.clipboard.writeText(new URL(siteUrl(site),window.location.origin).href);
          toast({status:"success",title:"已复制链接"});
        } catch { toast({status:"error",title:"无法复制链接，请检查剪贴板权限。"}); }
      }}>复制链接</MenuItem>
      <MenuItem as="a" href={siteUrl(site)} target="_blank" rel="noopener noreferrer" icon={<ExternalLink size={16}/>}>在浏览器中打开</MenuItem>
      {!site.shared && site.editUrl && <MenuItem as="a" href={site.editUrl} icon={<Pencil size={16}/>}>编辑</MenuItem>}
      {!site.shared && <MenuItem as="a" icon={<BarChart3 size={16}/>} href={"/sites/analytics/"+encodeURIComponent(site.id)}>分析</MenuItem>}
      {!site.shared && <MenuItem icon={<Settings size={16}/>} onClick={()=>navigateSettings(site.id)}>设置</MenuItem>}
      {!site.shared && <MenuItem icon={<Trash2 size={16}/>} color="red.600" isDisabled={saving} onClick={()=>setPendingDelete(site)}>删除站点</MenuItem>}
    </MenuList></Portal>
  </Menu>;
  const dialog = <>
    {sharing && <ArtifactShareDialog token="" path={sharing.name} siteId={sharing.id} onClose={() => {setSharing(undefined);setAttempt(value=>value+1);}}/>}
    <AlertDialog isOpen={Boolean(pendingDelete)} isCentered leastDestructiveRef={cancelDelete} onClose={()=>{if (!saving) setPendingDelete(undefined);}}>
      <AlertDialogOverlay><AlertDialogContent mx={4} borderRadius="20px">
        <AlertDialogHeader>删除站点</AlertDialogHeader>
        <AlertDialogBody>删除「{pendingDelete?.name}」后，此站点的所有预览链接都会失效。项目源文件会保留。</AlertDialogBody>
        <AlertDialogFooter gap={2}>
          <Button ref={cancelDelete} borderRadius="full" isDisabled={saving} onClick={()=>setPendingDelete(undefined)}>取消</Button>
          <Button colorScheme="red" borderRadius="full" isLoading={saving} onClick={()=>pendingDelete && deleteSite(pendingDelete)}>删除站点</Button>
        </AlertDialogFooter>
      </AlertDialogContent></AlertDialogOverlay>
    </AlertDialog>
  </>;
  if (settings) return <Box maxW="720px">
    <SiteDetailHeader name={settings.name} previewPath={siteUrl(settings)} editUrl={settings.editUrl} onBack={()=>navigateSettings()} saving={saving}/>
    <SiteDetailNav>
      <Button variant="link" aria-current={scheduled || plugins || database ? undefined : "page"} onClick={()=>navigateSettings(settings.id)}>设置</Button>
      <Link href={"/sites/analytics/"+encodeURIComponent(settings.id)}>分析</Link>
      <Button variant="link" aria-current={database ? "page" : undefined} onClick={()=>navigateSettings(settings.id,"database")}>数据库</Button>
      <Button variant="link" aria-current={plugins ? "page" : undefined} onClick={()=>navigateSettings(settings.id,"plugins")}>插件</Button>
      <Button variant="link" aria-current={scheduled ? "page" : undefined} onClick={()=>navigateSettings(settings.id,"scheduled")}>已安排</Button>
    </SiteDetailNav>
    {database ? <SiteDatabase key={settings.id} siteId={settings.id}/> : plugins ? <SitePlugins key={settings.id} siteId={settings.id} onAdd={settings.projectToken ? ()=>onPluginChat(settings.projectToken!,settings.name) : undefined}/> : scheduled ? <SiteSchedules key={settings.id} siteId={settings.id} siteName={settings.name}/> : <>
    <Heading as="h3" size="sm" mt={6} mb={3}>常规</Heading>
    <Box as="form" onSubmit={async event=>{
      event.preventDefault();
      const name = title.trim();
      if (!name || saving || !settings.libraryId) return;
      setSaving(true);
      try {
        const response = await fetch("/api/library",{method:"PATCH",headers:withAuthHeaders({"Content-Type":"application/json"}),body:JSON.stringify({id:settings.libraryId,changes:{name}})});
        if (!response.ok) throw new Error();
        setSites(rows=>rows?.map(row=>row.id===settings.id ? {...row,name} : row));
        onSitesChanged();
        setTitle(name);
        toast({status:"success",title:"已保存站点名称"});
      } catch { toast({status:"error",title:"站点名称保存失败，请重试"}); }
      finally {setSaving(false);}
    }}>
      <Text as="label" htmlFor="library-site-name">名称</Text>
      <Text id="library-site-name-hint" fontSize="sm" color="gray.600">你的站点名称</Text>
      <Flex gap={2} my={2}><Input aria-describedby="library-site-name-hint" id="library-site-name" aria-label="站点标题" value={title} maxLength={255} isDisabled={saving} onChange={event=>setTitle(event.target.value)}/>
        <Button type="submit" isLoading={saving} isDisabled={!title.trim() || title.trim()===settings.name}>保存</Button></Flex>
    </Box>
    <Text mt={4}>URL</Text><Text fontSize="sm" color="gray.600">网址</Text><Flex align="center" gap={3}><Link href={siteUrl(settings)}>{siteUrl(settings)}</Link>
      <Button size="sm" aria-label="更改托管站点 URL" onClick={()=>{setSlugError("");setSlugDraft(settings.slug || "");}}>更改</Button></Flex>
    <Modal isOpen={slugDraft !== undefined} isCentered onClose={()=>{if (!saving) setSlugDraft(undefined);}}>
      <ModalOverlay/><ModalContent mx={4} borderRadius="16px"><ModalHeader>更改 URL</ModalHeader><ModalCloseButton aria-label="关闭对话框" isDisabled={saving}/>
        <form onSubmit={async event=>{
          event.preventDefault();
          if (!slugDraft || saving) return;
          setSaving(true);setSlugError("");
          try {
            const response = await fetch("/api/library/sites",{method:"PATCH",headers:withAuthHeaders({"Content-Type":"application/json"}),body:JSON.stringify({id:settings.id,slug:slugDraft})});
            if (response.status===409) throw new Error("这个网址已被使用，请换一个。");
            if (response.status===401) throw new Error("登录已过期，请重新登录后更改网址。");
            if (response.status===404) throw new Error("站点不存在或你没有管理权限。");
            if (!response.ok) throw new Error("网址暂时无法保存，请稍后重试。");
            setSites(rows=>rows?.map(site=>site.id===settings.id ? {...site,slug:slugDraft} : site));
            onSitesChanged();
            setSlugDraft(undefined);
          } catch(error) {setSlugError(error instanceof TypeError ? "连接失败，请检查网络后重试。" : error instanceof Error ? error.message : "网址保存失败");}
          finally {setSaving(false);}
        }}><ModalBody><Text mb={2}>为你的站点输入新的网址</Text>
          <Flex align="center" gap={1}><Text>/s/</Text><Input autoFocus aria-label="站点 URL 名称" maxLength={63} pattern="[a-z0-9]+(-[a-z0-9]+)*" isDisabled={saving} aria-describedby="site-slug-help" required value={slugDraft || ""} onChange={e=>{setSlugDraft(e.target.value);setSlugError("");}}/></Flex>
          <Text id="site-slug-help" mt={2} fontSize="sm" color="gray.600">最多 63 个字符。可用小写字母和数字，词之间可用单个连字符。</Text>
          {slugError && <Text role="alert" mt={2} fontSize="sm" color="red.600">{slugError}</Text>}</ModalBody><ModalFooter gap={2}>
          <Button isDisabled={saving} onClick={()=>setSlugDraft(undefined)}>取消</Button><Button type="submit" isLoading={saving} isDisabled={!slugDraft || slugDraft===settings.slug}>更改 URL</Button></ModalFooter></form>
      </ModalContent></Modal>
    <SiteDomains key={settings.id} siteId={settings.id}/>
    <Heading as="h3" size="sm" mt={6}>共享设置</Heading>
    <Flex mt={2} gap={3} align="center" wrap="wrap"><Text>谁可以查看你的站点</Text><Text ml="auto">{audience(sites.find(site=>site.id===settings.id) || settings)}</Text>
      <Button size="sm" aria-label="管理共享" onClick={()=>setSharing(settings)}>管理</Button></Flex>
    <Heading as="h3" size="sm" mt={6}>危险操作区</Heading>
    <Flex mt={3} gap={3} align="center" wrap="wrap">
      <Box flex="1"><Text>删除站点</Text><Text id="site-delete-description" fontSize="sm" color="gray.600">永久删除此站点</Text></Box>
      <Button size="sm" aria-describedby="site-delete-description" colorScheme="red" variant="outline" isDisabled={saving} onClick={()=>setPendingDelete(settings)}>删除站点</Button>
    </Flex></>}
    {dialog}
  </Box>;
  if (router.query.librarySiteSettings) return <Box py={6}>
    <Heading as="h1" size="md">无法打开站点设置</Heading>
    <Text role="status" my={3}>站点可能已删除，或当前账号没有管理权限。</Text>
    <Button size="sm" onClick={()=>navigateSettings()}>返回站点</Button>
  </Box>;
  if (!visible.length) return <Text role="status" textAlign="center" fontSize="18px" lineHeight="24px" color="#0d0d0d">{empty}</Text>;
  if (grid) return <Box display="grid" gridTemplateColumns="repeat(auto-fill,minmax(min(100%,250px),1fr))" gap={6}>
    {visible.map(site => {
      const published = new Date(site.publishedAt || "");
      const AudienceIcon = site.restricted ? LockKeyhole : Link2;
      return <Box as="article" key={site.id} position="relative" minW={0} overflow="hidden" borderRadius="16px" boxShadow="0 2px 12px rgba(0,0,0,.07)">
        {siteCover(site)}
        <Flex px={3} py={2} minH="64px" align="center" gap={2}>
          <Box flex="1" minW={0}>
            <Link display="block" isTruncated fontSize="sm" fontWeight="medium" href={siteUrl(site)}
              aria-label={"访问 "+site.name} _after={{content:'""',position:"absolute",inset:0}}>{site.name}</Link>
            <Flex align="center" gap={1} color="#666" fontSize="xs">
              {site.shared ? <Text>{audience(site)}</Text> : <Button variant="link" position="relative" zIndex={1} color="inherit" fontSize="inherit" fontWeight="normal"
                leftIcon={<AudienceIcon size={13} aria-hidden/>} iconSpacing={1} aria-label={audience(site)+"，打开 "+site.name+" 的共享设置"} onClick={()=>setSharing(site)}>{audience(site)}</Button>}
              {Number.isFinite(published.getTime()) && <><span aria-hidden>·</span><time dateTime={published.toISOString()}>{published.toLocaleDateString("zh-CN",{month:"long",day:"numeric"})}</time></>}
            </Flex>
          </Box><Box position="relative" zIndex={1}>{siteMenu(site)}</Box>
        </Flex>
      </Box>;
    })}
    {dialog}</Box>;
  return <Box overflowX="auto"><Box as="table" width="100%" textAlign="left" fontSize="sm" aria-label="站点"
    sx={{"& th, & td": {padding:"12px 8px",borderBottom:"1px solid #eee"}, "& th": {fontWeight:500,color:"#656565"},
      "& tbody tr": {height:"88px",position:"relative"},
      "& tbody td:first-child a::after": {content:'""',position:"absolute",inset:0},
      "& tbody td:not(:first-child) :is(button,a)": {position:"relative",zIndex:1},
      "& tbody td:last-child": {whiteSpace:"nowrap",textAlign:"end"}}}>
    <thead><tr><th scope="col">站点</th>{tab === "与你共享" && <th scope="col">所有者</th>}<th scope="col">共享对象</th>{tab !== "与你共享" && <th scope="col">访客数（近 30 天）</th>}<th scope="col" aria-label="站点操作"/></tr></thead>
    <tbody>{visible.map(site => <tr key={site.id}><td>{siteLink(site)}</td>{tab === "与你共享" && <td>{site.ownerName || "—"}</td>}<td>{site.shared ? audience(site) : <Button size="sm" variant="ghost" fontWeight="normal"
        aria-label={audience(site)+"，打开 " + site.name + " 的共享设置"} onClick={()=>setSharing(site)}>{audience(site)}</Button>}</td>{tab !== "与你共享" && <td>{site.shared ? "—" : <Link href={"/sites/analytics/"+encodeURIComponent(site.id)} aria-label={"打开 "+site.name+" 的数据分析页面，查看过去 30 天的独立访客数"}>{site.visitors ?? 0} 位访客</Link>}</td>}
      <td><IconButton as="a" href={siteUrl(site)} target="_blank" rel="noopener noreferrer" size="sm" variant="ghost"
        aria-label={"在新标签页中打开 " + site.name} icon={<ExternalLink size={16} aria-hidden/>}/>{siteMenu(site)}</td>
    </tr>)}</tbody>
  </Box>{dialog}</Box>;
}

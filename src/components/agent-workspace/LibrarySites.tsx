import { AlertDialog, AlertDialogBody, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogOverlay, Box, Button, Flex, Heading, IconButton, Input, Link, Menu, MenuButton, MenuItem, MenuList, Portal, Text, useToast } from "@chakra-ui/react";
import { Copy, ExternalLink, MoreHorizontal, PanelsTopLeft, Pencil, Settings, Share2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { withAuthHeaders } from "@features/auth/client/authClient";

import ArtifactShareDialog from "../workspace/ArtifactShareDialog";

interface Site { id: string; name: string; shared: boolean; publishedAt?: string; ownerName?: string; editUrl?: string; libraryId?: string; visitors?: number }

export default function LibrarySites({ tab, query, grid, onSitesChanged }: { tab: string; query: string; grid: boolean; onSitesChanged: () => void }) {
  const toast = useToast();
  const [pendingDelete,setPendingDelete] = useState<Site>();
  const cancelDelete = useRef<HTMLButtonElement>(null);
  const [settings,setSettings] = useState<Site>();
  const [title,setTitle] = useState("");
  const [saving,setSaving] = useState(false);
  const [sharing, setSharing] = useState<Site>();
  const [sites, setSites] = useState<Site[]>();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setFailed(false);
    fetch("/api/library/sites", { headers: withAuthHeaders(), signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error();
        const rows: Site[] = await response.json();
        if (!controller.signal.aborted) setSites(rows);
      })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [attempt]);
  if (failed) return <Button onClick={() => setAttempt(value => value + 1)}>重新加载站点</Button>;
  if (!sites) return <Text role="status">正在加载站点…</Text>;
  const searchTerm = query.trim().normalize("NFC").toLowerCase();
  const visible = sites.filter(site => (tab === "全部" || site.shared === (tab === "与你共享")) && site.name.normalize("NFC").toLowerCase().includes(searchTerm));
  const empty = searchTerm ? "没有符合条件的站点" : tab === "与你共享" ? "没有与你共享的站点" : "没有站点";
  const siteUrl = (site: Site) => "/share/preview/" + encodeURIComponent(site.id);
  const siteLink = (site: Site) => {
    const published = site.publishedAt ? new Date(site.publishedAt) : undefined;
    return <Link href={siteUrl(site)} aria-label={"访问 " + site.name}>
      <Flex align="center" gap={3}><PanelsTopLeft size={19} aria-hidden/><Box>
        <Text>{site.name}</Text>
        {published && Number.isFinite(published.getTime()) && <Text as="time" dateTime={published.toISOString()} fontSize="xs" color="#5d5d5d">
          {published.toLocaleDateString("zh-CN",{month:"long",day:"numeric"})}
        </Text>}
      </Box></Flex>
    </Link>;
  };
  const shareButton = (site: Site) => !site.shared && <Button size="xs" variant="ghost" onClick={() => setSharing(site)}>共享</Button>;
  async function deleteSite(site: Site) {
    if (saving || site.shared) return;
    setSaving(true);
    try {
      const response = await fetch("/api/library/sites?id="+encodeURIComponent(site.id),{method:"DELETE",headers:withAuthHeaders()});
      if (!response.ok && response.status !== 404) throw new Error();
      setPendingDelete(undefined);
      setSites(rows=>rows?.filter(row=>row.id!==site.id));
      onSitesChanged();
      setSettings(undefined);
      toast({status:"success",title:"站点已删除"});
    } catch { toast({status:"error",title:"站点删除失败，请重试"}); }
    finally {setSaving(false);}
  }
  const siteMenu = (site: Site) => <Menu placement="bottom-end">
    <MenuButton as={IconButton} size="sm" variant="ghost" aria-label={site.name + " 的更多操作"} icon={<MoreHorizontal size={16}/>}/>
    <Portal><MenuList minW="180px" p={2} borderRadius="16px">
      {!site.shared && <MenuItem icon={<Share2 size={16}/>} onClick={()=>setSharing(site)}>共享</MenuItem>}
      <MenuItem icon={<Copy size={16}/>} onClick={async ()=>{
        try {
          await navigator.clipboard.writeText(new URL(siteUrl(site),window.location.origin).href);
          toast({status:"success",title:"已复制链接"});
        } catch { toast({status:"error",title:"无法复制链接，请检查剪贴板权限。"}); }
      }}>复制链接</MenuItem>
      <MenuItem as="a" href={siteUrl(site)} target="_blank" rel="noopener noreferrer" icon={<ExternalLink size={16}/>}>在浏览器中打开</MenuItem>
      {!site.shared && site.editUrl && <MenuItem as="a" href={site.editUrl} icon={<Pencil size={16}/>}>编辑</MenuItem>}
      {!site.shared && <MenuItem as="a" href={"/sites/analytics/"+encodeURIComponent(site.id)}>分析</MenuItem>}
      {!site.shared && <MenuItem icon={<Settings size={16}/>} onClick={()=>{setTitle(site.name);setSettings(site);}}>设置</MenuItem>}
      {!site.shared && <MenuItem color="red.600" isDisabled={saving} onClick={()=>setPendingDelete(site)}>删除站点</MenuItem>}
    </MenuList></Portal>
  </Menu>;
  const dialog = <>
    {sharing && <ArtifactShareDialog token="" path={sharing.name} siteId={sharing.id} onClose={() => setSharing(undefined)}/>}
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
    <Button variant="link" isDisabled={saving} onClick={()=>setSettings(undefined)}>返回站点</Button>
    <Heading as="h2" size="md" my={4}>{settings.name}</Heading>
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
        setSettings({...settings,name});
        setTitle(name);
        toast({status:"success",title:"已保存站点名称"});
      } catch { toast({status:"error",title:"站点名称保存失败，请重试"}); }
      finally {setSaving(false);}
    }}>
      <Text as="label" htmlFor="library-site-name">名称</Text>
      <Flex gap={2} my={2}><Input id="library-site-name" aria-label="站点标题" value={title} maxLength={255} isDisabled={saving} onChange={event=>setTitle(event.target.value)}/>
        <Button type="submit" isLoading={saving} isDisabled={!title.trim() || title.trim()===settings.name}>保存</Button></Flex>
    </Box>
    <Text mt={4}>网址</Text><Link href={siteUrl(settings)}>{siteUrl(settings)}</Link>
    <Flex mt={4} gap={3} align="center"><Text>拥有链接的人可以查看</Text>{shareButton(settings)}</Flex>
    <Button mt={6} colorScheme="red" variant="outline" isDisabled={saving} onClick={()=>setPendingDelete(settings)}>删除站点</Button>
    {dialog}
  </Box>;
  if (!visible.length) return <Text role="status" textAlign="center" fontSize="18px" lineHeight="24px" color="#0d0d0d">{empty}</Text>;
  if (grid) return <Box display="grid" gridTemplateColumns="repeat(auto-fill,minmax(180px,1fr))" gap={3}>
    {visible.map(site => <Box key={site.id} p={4} borderWidth="1px" borderRadius="14px">{siteLink(site)}{siteMenu(site)}</Box>)}
    {dialog}</Box>;
  return <Box overflowX="auto"><Box as="table" width="100%" textAlign="left" fontSize="sm" aria-label="站点"
    sx={{"& th, & td": {padding:"12px 8px",borderBottom:"1px solid #eee"}, "& th": {fontWeight:500,color:"#656565"}}}>
    <thead><tr><th scope="col">站点</th>{tab === "与你共享" && <th scope="col">所有者</th>}<th scope="col">共享对象</th>{tab !== "与你共享" && <th scope="col">访客数（近 30 天）</th>}<th scope="col" aria-label="站点操作"/></tr></thead>
    <tbody>{visible.map(site => <tr key={site.id}><td>{siteLink(site)}</td>{tab === "与你共享" && <td>{site.ownerName || "—"}</td>}<td>拥有链接的人 {shareButton(site)}</td>{tab !== "与你共享" && <td>{site.shared ? "—" : <Link href={"/sites/analytics/"+encodeURIComponent(site.id)} aria-label={"查看 "+site.name+" 的访客分析"}>{site.visitors ?? 0}</Link>}</td>}
      <td><IconButton as="a" href={siteUrl(site)} target="_blank" rel="noopener noreferrer" size="sm" variant="ghost"
        aria-label={"在新标签页中打开 " + site.name} icon={<ExternalLink size={16} aria-hidden/>}/>{siteMenu(site)}</td>
    </tr>)}</tbody>
  </Box>{dialog}</Box>;
}

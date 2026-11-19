import { Box, Button, Flex, IconButton, Link, Menu, MenuButton, MenuItem, MenuList, Portal, Text, useToast } from "@chakra-ui/react";
import { Copy, ExternalLink, MoreHorizontal, PanelsTopLeft, Pencil, Share2 } from "lucide-react";
import { useEffect, useState } from "react";
import { withAuthHeaders } from "@features/auth/client/authClient";

import ArtifactShareDialog from "../workspace/ArtifactShareDialog";

interface Site { id: string; name: string; shared: boolean; publishedAt?: string; ownerName?: string; editUrl?: string; visitors?: number }

export default function LibrarySites({ tab, query, grid }: { tab: string; query: string; grid: boolean }) {
  const toast = useToast();
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
    </MenuList></Portal>
  </Menu>;
  const dialog = sharing && <ArtifactShareDialog token="" path={sharing.name} siteId={sharing.id} onClose={() => setSharing(undefined)}/>;
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

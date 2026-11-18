import { Box, Button, Flex, Link, Text } from "@chakra-ui/react";
import { PanelsTopLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { withAuthHeaders } from "@features/auth/client/authClient";

interface Site { id: string; name: string }

export default function LibrarySites({ tab, query, grid }: { tab: string; query: string; grid: boolean }) {
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
  const visible = tab === "与你共享" ? [] : sites.filter(site => site.name.toLowerCase().includes(query.trim().toLowerCase()));
  const empty = query.trim() ? "没有符合条件的站点" : tab === "与你共享" ? "没有与你共享的站点" : "没有站点";
  const siteLink = (site: Site) => <Link href={"/share/preview/" + encodeURIComponent(site.id)}>
    <Flex align="center" gap={3}><PanelsTopLeft size={19} aria-hidden/><Text as="span">{site.name}</Text></Flex>
  </Link>;
  if (grid) return visible.length ? <Box display="grid" gridTemplateColumns="repeat(auto-fill,minmax(180px,1fr))" gap={3}>
    {visible.map(site => <Box key={site.id} p={4} borderWidth="1px" borderRadius="14px">{siteLink(site)}</Box>)}
  </Box> : <Text>{empty}</Text>;
  return <Box overflowX="auto"><Box as="table" width="100%" textAlign="left" fontSize="sm" aria-label="站点"
    sx={{"& th, & td": {padding:"12px 8px",borderBottom:"1px solid #eee"}, "& th": {fontWeight:500,color:"#656565"}}}>
    <thead><tr><th scope="col">站点</th><th scope="col">共享对象</th><th scope="col">访客数（近30天）</th></tr></thead>
    <tbody>{visible.length ? visible.map(site => <tr key={site.id}><td>{siteLink(site)}</td><td>拥有链接的人</td><td>—</td></tr>)
      : <tr><td colSpan={3}>{empty}</td></tr>}</tbody>
  </Box></Box>;
}

import { useEffect, useState } from "react";
import { Box, Button, Flex, Heading, IconButton, Text } from "@chakra-ui/react";
import { RefreshCw } from "lucide-react";
import { withAuthHeaders } from "@features/auth/client/authClient";

export default function SitePlugins({siteId, onAdd}:{siteId:string; onAdd?:()=>Promise<void>}) {
  const [plugins,setPlugins] = useState<{id:string;name:string}[]>();
  const [error,setError] = useState(false);
  const [opening,setOpening] = useState(false);
  const [openError,setOpenError] = useState(false);
  const [attempt,setAttempt] = useState(0);
  const refresh = () => setAttempt(n => n+1);
  useEffect(()=>{
    const controller = new AbortController();
    setPlugins(undefined);
    setError(false);
    async function load() {
      try {
        const response = await fetch("/api/share/"+encodeURIComponent(siteId)+"/plugins",{headers:withAuthHeaders(),signal:controller.signal});
        if (!response.ok) throw new Error();
        const data = await response.json();
        if (!Array.isArray(data.plugins)) throw new Error();
        if (!controller.signal.aborted) setPlugins(data.plugins);
      } catch {
        if (!controller.signal.aborted) setError(true);
      }
    }
    void load();
    return ()=>controller.abort();
  },[siteId,attempt]);
  const loading = !plugins && !error;
  return <Box as="section" mt={6}>
    <Flex gap={2} align="center"><Box flex="1"><Heading size="sm">站点插件</Heading>
      <Text fontSize="sm" color="gray.600">查看并管理此站点所用的插件</Text></Box>
      <IconButton size="sm" variant="ghost" aria-label="刷新插件" icon={<RefreshCw size={16}/>} isDisabled={loading} onClick={refresh}/>
      {onAdd && <Button size="sm" isLoading={opening} isDisabled={loading} onClick={async ()=>{
        setOpening(true); setOpenError(false);
        try { await onAdd(); } catch { setOpenError(true); } finally { setOpening(false); }
      }}>添加</Button>}</Flex>
    {openError && <Text role="alert" mt={2}>无法打开站点对话，请重试。</Text>}
    <Box mt={4}>{error ? <Flex gap={2} align="center"><Text role="alert">无法加载此站点当前的插件</Text><Button size="sm" onClick={refresh}>重试</Button></Flex>
      : loading ? <Text role="status">正在加载插件…</Text>
      : plugins?.length ? <Box as="ul" pl={5}>{plugins.map(plugin=><li key={plugin.id}>{plugin.name}</li>)}</Box>
      : <Text role="status">此站点暂无插件</Text>}</Box>
  </Box>;
}

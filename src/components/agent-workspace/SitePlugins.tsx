import { useEffect, useState } from "react";
import { Box, Button, Flex, Heading, IconButton, Text } from "@chakra-ui/react";
import { RefreshCw } from "lucide-react";
import { withAuthHeaders } from "@features/auth/client/authClient";

export default function SitePlugins({siteId, onAdd}:{siteId:string; onAdd?:(connectedNames:string[])=>Promise<void>}) {
  const [plugins,setPlugins] = useState<{id:string;name:string}[]>();
  const [error,setError] = useState(false);
  const [opening,setOpening] = useState(false);
  const [openError,setOpenError] = useState(false);
  const [attempt,setAttempt] = useState(0);
  const [removing,setRemoving] = useState<string>();
  const [removeError,setRemoveError] = useState("");
  async function removePlugin(plugin: {id:string;name:string}) {
    if (removing) return;
    setRemoving(plugin.id);
    setRemoveError("");
    try {
      const response = await fetch("/api/share/"+encodeURIComponent(siteId)+"/plugins?pluginId="+encodeURIComponent(plugin.id), {
        method:"DELETE", headers:withAuthHeaders(),
      });
      if (!response.ok) throw new Error();
      setPlugins(current => current?.filter(item => item.id !== plugin.id));
    } catch {
      setRemoveError("无法移除「"+plugin.name+"」，请重试。");
    } finally {
      setRemoving(undefined);
    }
  }
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
      <IconButton size="sm" variant="ghost" aria-label="刷新插件" icon={<RefreshCw size={16}/>} isDisabled={loading || Boolean(removing)} onClick={refresh}/>
      {onAdd && <Button size="sm" isLoading={opening} isDisabled={!plugins || Boolean(removing)} onClick={async ()=>{
        setOpening(true); setOpenError(false);
        try { await onAdd((plugins || []).map(plugin => plugin.name)); } catch { setOpenError(true); } finally { setOpening(false); }
      }}>添加</Button>}</Flex>
    {openError && <Text role="alert" mt={2}>无法打开站点对话，请重试。</Text>}
    {removeError && <Text role="alert" mt={2}>{removeError}</Text>}
    <Box mt={4}>{error ? <Flex gap={2} align="center"><Text role="alert">无法加载此站点当前的插件</Text><Button size="sm" onClick={refresh}>重试</Button></Flex>
      : loading ? <Text role="status">正在加载插件…</Text>
      : plugins?.length ? <Box as="ul" listStyleType="none">{plugins.map(plugin=><Flex as="li" key={plugin.id} align="center" justify="space-between" py={2}>
          <Text>{plugin.name}</Text><Button size="sm" variant="ghost" aria-label={"从站点移除"+plugin.name} isLoading={removing===plugin.id}
            isDisabled={Boolean(removing)} onClick={()=>void removePlugin(plugin)}>移除</Button>
        </Flex>)}</Box>
      : <Text role="status">此站点暂无插件</Text>}</Box>
  </Box>;
}

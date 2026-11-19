import { Box, Button, Flex, Heading, Text } from "@chakra-ui/react";
import { useEffect, useState } from "react";
import { withAuthHeaders } from "@features/auth/client/authClient";

export default function SiteDatabase({siteId}:{siteId:string}) {
  const [tables,setTables] = useState<{name:string;count:number}[]>();
  const [failed,setFailed] = useState(false);
  const [attempt,setAttempt] = useState(0);
  useEffect(()=>{
    const controller = new AbortController();
    setTables(undefined);
    setFailed(false);
    async function load() {
      try {
        const response = await fetch("/api/share/"+encodeURIComponent(siteId)+"/database", {headers:withAuthHeaders(), signal:controller.signal});
        if (!response.ok) throw new Error();
        const data = await response.json();
        if (!Array.isArray(data.tables)) throw new Error();
        if (!controller.signal.aborted) setTables(data.tables);
      } catch {
        if (!controller.signal.aborted) setFailed(true);
      }
    }
    void load();
    return ()=>controller.abort();
  },[siteId,attempt]);
  const loading = !tables && !failed;
  return <Box as="section" mt={6}>
    <Flex align="center" gap={3}><Box flex="1"><Heading size="sm">数据库</Heading>
      <Text fontSize="sm" color="gray.600">查看已上线站点使用的数据</Text></Box>
      <Button size="sm" aria-label="刷新数据库" isDisabled={loading} onClick={()=>setAttempt(n=>n+1)}>刷新</Button></Flex>
    <Box mt={4}>{loading ? <Text role="status">正在加载数据库…</Text> : failed ? <Text role="alert">无法加载数据库，请刷新重试。</Text>
      : tables?.length ? <Box as="ul" pl={5}>{tables.map(table=><li key={table.name}>{table.name} · {table.count} 条记录</li>)}</Box>
      : <Box role="status"><Text>未连接数据库</Text><Text fontSize="sm" color="gray.600">此站点暂无数据库</Text></Box>}</Box>
  </Box>;
}

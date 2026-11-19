import { Box, Button, Flex, Heading, Text } from "@chakra-ui/react";
import { useEffect, useState } from "react";
import { withAuthHeaders } from "@features/auth/client/authClient";

export default function SiteDatabase({siteId}:{siteId:string}) {
  const [tables,setTables] = useState<{name:string;count:number}[]>();
  const [table,setTable] = useState("");
  const [cursors,setCursors] = useState([""]);
  const after = cursors[cursors.length-1];
  const [page,setPage] = useState<{rows:{id:string;data:unknown}[];next:string|null}>();
  const [failed,setFailed] = useState(false);
  const [attempt,setAttempt] = useState(0);
  useEffect(()=>{
    const controller = new AbortController();
    setTables(undefined);
    setPage(undefined);
    setFailed(false);
    async function load() {
      try {
        const query = new URLSearchParams();
        if (table) query.set("table",table);
        if (after) query.set("after",after);
        const response = await fetch("/api/share/"+encodeURIComponent(siteId)+"/database?"+query, {headers:withAuthHeaders(), signal:controller.signal});
        if (!response.ok) throw new Error();
        const data = await response.json();
        if (!Array.isArray(table ? data.rows : data.tables)) throw new Error();
        if (controller.signal.aborted) return;
        if (table) setPage(data);
        else setTables(data.tables);
      } catch {
        if (!controller.signal.aborted) setFailed(true);
      }
    }
    void load();
    return ()=>controller.abort();
  },[siteId,attempt,table,after]);
  const loading = !tables && !page && !failed;
  return <Box as="section" mt={6}>
    <Flex align="center" gap={3}><Box flex="1"><Heading size="sm">数据库</Heading>
      <Text fontSize="sm" color="gray.600">查看已上线站点使用的数据</Text></Box>
      <Button size="sm" aria-label="刷新数据库" isDisabled={loading} onClick={()=>setAttempt(n=>n+1)}>刷新</Button></Flex>
    {table && <Button mt={3} size="sm" variant="ghost" onClick={()=>{setTable("");setCursors([""]);}}>‹ 数据表 / {table}</Button>}
    <Box mt={4}>{loading ? <Text role="status">正在加载数据库…</Text> : failed ? <Text role="alert">无法加载数据库，请刷新重试。</Text>
      : page ? <Box>{page.rows.length ? page.rows.map(row=><Box key={row.id} as="pre" whiteSpace="pre-wrap" overflowWrap="anywhere" py={2} borderBottomWidth="1px">{JSON.stringify(row.data,null,2)}</Box>) : <Text>暂无记录</Text>}
        <Flex gap={2} mt={3}><Button size="sm" isDisabled={cursors.length===1} onClick={()=>setCursors(values=>values.slice(0,-1))}>上一页</Button>
          <Button size="sm" isDisabled={!page.next} onClick={()=>{if (page.next) setCursors([...cursors,page.next]);}}>下一页</Button></Flex></Box>
      : tables?.length ? <Box as="ul" pl={5}>{tables.map(table=><li key={table.name}><Button size="sm" variant="ghost" onClick={()=>{setTable(table.name);setCursors([""]);}}>{table.name} · {table.count} 条记录</Button></li>)}</Box>
      : <Box role="status"><Text>未连接数据库</Text><Text fontSize="sm" color="gray.600">此站点暂无数据库</Text></Box>}</Box>
  </Box>;
}

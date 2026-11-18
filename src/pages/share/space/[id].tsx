import { Box, Button, Heading, Link, Stack, Text } from "@chakra-ui/react";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { withAuthHeaders } from "@features/auth/client/authClient";

type Contents = {name:string;body?:string;pages?:{id:string;name:string}[]};
export default function SharedSpace() {
  const router = useRouter();
  const {id,page} = router.query;
  const [data,setData] = useState<Contents>();
  const [error,setError] = useState("");
  useEffect(()=>{
    if (typeof id !== "string") return;
    const controller = new AbortController();
    setData(undefined);
    setError("");
    const params = new URLSearchParams({id,contents:"1"});
    if (typeof page === "string") params.set("page",page);
    fetch("/api/library/space-share?"+params,{headers:withAuthHeaders(),signal:controller.signal}).then(async response=>{
      if (!response.ok) throw new Error(response.status === 401 ? "请登录受邀账号后查看。" : "无法访问这份共享内容。");
      const value = await response.json();
      if (!controller.signal.aborted) setData(value);
    }).catch(reason=>{if (!controller.signal.aborted) setError(reason.message);});
    return ()=>controller.abort();
  },[id,page]);
  return <Box as="main" maxW="780px" mx="auto" p={6}>
    {page && <Button as="a" href={"/share/space/"+id} variant="ghost" mb={4}>返回资料空间</Button>}
    {error ? <Text role="alert">{error}</Text> : !data ? <Text role="status">正在加载…</Text> : <>
      <Heading size="lg" mb={5}>{data.name}</Heading>
      {data.pages ? <Stack>{data.pages.length ? data.pages.map(item=><Link key={item.id} href={"?page="+item.id}>{item.name}</Link>) : <Text>暂无页面</Text>}</Stack> :
        <Text whiteSpace="pre-wrap">{data.body}</Text>}
    </>}
  </Box>;
}

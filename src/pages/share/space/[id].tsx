import { Box, Button, Heading, Link, Stack, Text, useToast } from "@chakra-ui/react";
import { downloadAuthenticatedFile } from "@features/chat/services/files";
import { markdownFilename } from "@/types/library";
import LibraryMarkdown from "@/components/agent-workspace/LibraryMarkdown";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { withAuthHeaders } from "@features/auth/client/authClient";

type Contents = {name:string;body?:string;pages?:{id:string;name:string;path?:string}[]};
export default function SharedSpace() {
  const router = useRouter();
  const {id,page} = router.query;
  const toast = useToast();
  const [downloading,setDownloading] = useState(false);
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
      if (controller.signal.aborted) return;
      if (value.owner === true) {
        await router.replace({pathname:"/",query:{view:"library",libraryFolder:id,...(typeof page === "string" ? {libraryItem:page} : {})}});
        return;
      }
      setData(value);
    }).catch(reason=>{if (!controller.signal.aborted) setError(reason.message);});
    return ()=>controller.abort();
  },[id,page,router]);
  return <Box as="main" maxW="780px" mx="auto" p={6}>
    {page && <Button as="a" href={"/share/space/"+id} variant="ghost" mb={4}>返回资料空间</Button>}
    {error ? <Text role="alert">{error}</Text> : !data ? <Text role="status">正在加载…</Text> : <>
      <Heading size="lg" mb={5}>{data.name}</Heading>
      {data.pages ? <Stack>{data.pages.length ? data.pages.map(item=><Link key={item.id} href={"?page="+item.id} overflowWrap="anywhere">{item.path || item.name}</Link>) : <Text>暂无页面</Text>}</Stack> :
        <><LibraryMarkdown>{data.body || ""}</LibraryMarkdown>
          {typeof id === "string" && typeof page === "string" && <Button size="sm" variant="outline" mt={6} isLoading={downloading} onClick={async () => {
            setDownloading(true);
            try {
              const params = new URLSearchParams({id,page,contents:"1",download:"1"});
              await downloadAuthenticatedFile("/api/library/space-share?" + params, markdownFilename(data.name));
            } catch {
              toast({status:"error",title:"下载失败，请确认仍有访问权限后重试。"});
            } finally {
              setDownloading(false);
            }
          }}>下载 Markdown</Button>}
        </>}
    </>}
  </Box>;
}

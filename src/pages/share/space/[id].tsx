import { Box, Button, Heading, Link, Stack, Text, useToast } from "@chakra-ui/react";
import { recordLibraryOpen } from "@features/chat/services/libraryAttachment";
import { downloadAuthenticatedFile, redirectedToLogin } from "@features/chat/services/files";
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
  const [attempt,setAttempt] = useState(0);
  const [error,setError] = useState<{message:string;login?:boolean}>();
  useEffect(()=>{
    if (typeof id !== "string") return;
    const controller = new AbortController();
    setData(undefined);
    setError(undefined);
    const params = new URLSearchParams({id,contents:"1"});
    if (typeof page === "string") params.set("page",page);
    fetch("/api/library/space-share?"+params,{headers:withAuthHeaders(),signal:controller.signal}).then(async response=>{
      if (response.status === 401 || redirectedToLogin(response)) {
        if (!controller.signal.aborted) setError({message:"请登录受邀账号后查看。",login:true});
        return;
      }
      if (!response.ok) throw new Error(response.status >= 500 ? "共享服务暂时不可用，请稍后重试。" : "无法访问这份共享内容。");
      const value = await response.json();
      if (controller.signal.aborted) return;
      if (value.owner === true) {
        await router.replace({pathname:"/",query:{view:"library",libraryFolder:id,...(typeof page === "string" ? {libraryItem:page} : {})}});
        return;
      }
      setData(value);
      if (typeof page === "string") recordLibraryOpen(`space-${id}-${page}`);
    }).catch(reason=>{if (!controller.signal.aborted) setError({message:reason instanceof TypeError ? "连接失败，请检查网络后重试。" : reason.message});});
    return ()=>controller.abort();
  },[id,page,router,attempt]);
  return <Box as="main" maxW="780px" mx="auto" p={6}>
    {typeof id === "string" && <Button as="a" variant="ghost" mb={4}
      href={page ? "/share/space/"+id : "/?"+new URLSearchParams({view:"library",libraryTab:"与你共享"})}>
      {page ? "返回共享空间" : "返回「与你共享」"}
    </Button>}
    {error ? <Stack role="alert" align="start" spacing={3}><Text>{error.message}</Text>
      {error.login ? <Button as="a" href={"/login?" + new URLSearchParams({lastRoute:router.asPath})} size="sm" borderRadius="full">登录</Button> :
        <Button size="sm" variant="outline" borderRadius="full" onClick={()=>setAttempt(previous=>previous+1)}>重新加载</Button>}</Stack> : !data ? <Text role="status">正在加载…</Text> : <>
      <Heading size="lg" mb={5}>{data.name}</Heading>
      {data.pages ? <Stack>{data.pages.length ? data.pages.map(item=><Link key={item.id} href={"?page="+item.id} overflowWrap="anywhere">{item.path || item.name}</Link>) : <Text>暂无页面</Text>}</Stack> :
        <><LibraryMarkdown interactivePages>{data.body || ""}</LibraryMarkdown>
          {typeof id === "string" && typeof page === "string" && <Button size="sm" variant="outline" mt={6} isLoading={downloading} onClick={async () => {
            setDownloading(true);
            try {
              const params = new URLSearchParams({id,page,contents:"1",download:"1"});
              await downloadAuthenticatedFile("/api/library/space-share?" + params, markdownFilename(data.name), true);
            } catch (error) {
              toast({status:"error",title:"下载失败",description:error instanceof TypeError ? "连接失败，请检查网络后重试。" : error instanceof Error ? error.message : "请稍后重试。"});
            } finally {
              setDownloading(false);
            }
          }}>下载 Markdown</Button>}
        </>}
    </>}
  </Box>;
}

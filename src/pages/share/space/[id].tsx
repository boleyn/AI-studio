import { Box, Button, Heading, Link, Stack, Text, useToast } from "@chakra-ui/react";
import { LibraryReadError, libraryReadMessage, recordLibraryOpen } from "@features/chat/services/libraryAttachment";
import { downloadAuthenticatedFile, redirectedToLogin } from "@features/chat/services/files";
import { markdownFilename } from "@/types/library";
import LibraryMarkdown from "@/components/agent-workspace/LibraryMarkdown";
import NextLink from "next/link";
import { CircleAlert } from "lucide-react";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { withAuthHeaders } from "@features/auth/client/authClient";

type Contents = {name:string;body?:string;pages?:{id:string;name:string;path?:string}[]};
export default function SharedSpace() {
  const router = useRouter();
  const {id,page} = router.query;
  return <SharedSpaceContents key={JSON.stringify([id,page])} />;
}

function SharedSpaceContents() {
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
      if (!response.ok) throw new LibraryReadError(response.status,"共享内容");
      const value = await response.json();
      if (controller.signal.aborted) return;
      if (value?.owner === true) {
        await router.replace({pathname:"/",query:{view:"library",libraryFolder:id,...(typeof page === "string" ? {libraryItem:page} : {})}});
        return;
      }
      if (typeof value?.name !== "string" || (page ? typeof value.body !== "string" :
        !Array.isArray(value.pages) || !value.pages.every((entry: NonNullable<Contents["pages"]>[number]) => entry && typeof entry.id === "string" && typeof entry.name === "string"))) {
        throw new Error("共享内容未能加载，请重试。");
      }
      setData(value);
      const opened = typeof page === "string" ? [`space-${id}-${page}`] : [];
      if (value.viewerSpaceId) opened.push(value.viewerSpaceId);
      recordLibraryOpen(opened);
    }).catch(reason=>{if (!controller.signal.aborted) setError({message:reason instanceof SyntaxError ? "共享内容未能加载，请重试。" : reason instanceof LibraryReadError || reason instanceof TypeError ? libraryReadMessage(reason) : "共享内容未能加载，请重试。"});});
    return ()=>controller.abort();
  },[id,page,router,attempt]);
  const spacePath = typeof id === "string" ? "/share/space/"+encodeURIComponent(id) : undefined;
  return <Box as="main" maxW="780px" mx="auto" p={6}>
    {spacePath && <Button as={NextLink} variant="ghost" mb={4}
      href={page ? spacePath : "/?"+new URLSearchParams({view:"library",libraryTab:"与你共享"})}>
      {page ? "返回共享空间" : "返回「与你共享」"}
    </Button>}
    {error ? <Stack align="center" spacing={3} maxW="26rem" mx="auto" py="12vh" textAlign="center">
      <CircleAlert size={24} color="#777" aria-hidden/>
      <Box role="alert"><Heading as="h1" size="sm">{page ? "无法打开共享页面" : "无法打开共享空间"}</Heading>
        <Text mt={1} fontSize="sm" color="gray.600" overflowWrap="anywhere">{error.message}</Text></Box>
      {error.login ? <Button as="a" href={"/login?" + new URLSearchParams({lastRoute:router.asPath})} size="sm" borderRadius="full">登录</Button> :
        <Button size="sm" variant="outline" borderRadius="full" onClick={()=>setAttempt(previous=>previous+1)}>重新加载</Button>}</Stack> : !data ? <Text role="status">正在加载…</Text> : <>
      <Heading size="lg" mb={5}>{data.name}</Heading>
      {data.pages && spacePath ? <Stack>{data.pages.length ? data.pages.map(item=><Link as={NextLink} key={item.id} href={spacePath+"?"+new URLSearchParams({page:item.id})} overflowWrap="anywhere">{item.path || item.name}</Link>) : <Text>暂无页面</Text>}</Stack> :
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

import { Box, Button, Flex, Input, Modal, ModalBody, ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalOverlay, Text } from "@chakra-ui/react";
import { useEffect, useState } from "react";
import { withAuthHeaders } from "@features/auth/client/authClient";

type Domain = {host:string; challenge:string; verified:boolean};
export default function SiteDomains({siteId}:{siteId:string}) {
  const [rows,setRows] = useState<Domain[]>([]);
  const [draft,setDraft] = useState<string>();
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  const [loadError,setLoadError] = useState("");
  const [revision,refresh] = useState(0);
  const url = "/api/share/"+encodeURIComponent(siteId)+"/domains";
  useEffect(()=>{
    const controller = new AbortController();
    setLoadError("");
    fetch(url,{headers:withAuthHeaders(),signal:controller.signal}).then(async response=>{
      if (response.status === 401) throw new Error("登录已过期，请重新登录后查看域名。");
      if (response.status === 404) throw new Error("站点不存在或你没有管理权限。");
      if (!response.ok) throw new Error("域名列表暂时无法加载。");
      const data = await response.json();
      if (!Array.isArray(data)) throw new Error("域名列表暂时无法加载。");
      if (!controller.signal.aborted) setRows(data);
    }).catch(reason=>{
      if (!controller.signal.aborted) setLoadError(reason instanceof TypeError ? "连接失败，请检查网络后重试。" : reason instanceof SyntaxError ? "域名列表暂时无法加载。" : reason.message);
    });
    return ()=>controller.abort();
  },[url,revision]);
  async function change(method:string,host:string) {
    if (busy) return;
    setBusy(true);setError("");
    try {
      const response = await fetch(url,{method,headers:withAuthHeaders({"Content-Type":"application/json"}),body:JSON.stringify({host})});
      if (!response.ok) throw new Error((await response.json().catch(()=>null))?.error || "域名更新失败，请重试。");
      setDraft(undefined);refresh(value=>value+1);
    } catch (reason) {setError(reason instanceof TypeError ? "连接失败，请检查网络。" : (reason as Error).message);}
    finally {setBusy(false);}
  }
  return <Box as="section" aria-label="自定义域名" mt={4}>
    <Flex justify="space-between" align="center"><Text>自定义域名</Text><Button size="sm" onClick={()=>{setDraft("");setError("");}}>添加自定义域名</Button></Flex>
    {loadError && <Flex align="center" gap={3} mt={2}>
      <Text role="alert" fontSize="sm">{loadError}</Text>
      <Button size="xs" variant="outline" onClick={()=>refresh(value=>value+1)}>重新加载</Button>
    </Flex>}
    {rows.map(row=><Box key={row.host} my={3}>
      <Text fontWeight="medium">{row.host}</Text>
      {row.verified ? <Text fontSize="sm">DNS 所有权已验证</Text> : <Box fontSize="sm" overflowWrap="anywhere">请添加 TXT 记录 <code>_bore-site.{row.host}</code>，记录值为 <code>{row.challenge}</code>。</Box>}
      {!row.verified && <Button size="xs" isDisabled={busy} onClick={()=>change("PATCH",row.host)}>验证 DNS</Button>}
      <Button size="xs" variant="ghost" isDisabled={busy} onClick={()=>change("DELETE",row.host)}>移除</Button>
    </Box>)}
    {error && draft===undefined && <Text role="alert">{error}</Text>}
    <Modal isOpen={draft!==undefined} onClose={()=>{if (!busy) setDraft(undefined);}} isCentered><ModalOverlay/><ModalContent mx={4} borderRadius="16px">
      <ModalHeader>添加自定义域名</ModalHeader><ModalCloseButton isDisabled={busy} aria-label="关闭对话框"/>
      <form onSubmit={e=>{e.preventDefault();if(draft) void change("POST",draft);}}><ModalBody>
        <Text mb={3}>要使用此功能，你需要拥有一个域名，并能够管理其 DNS 记录。</Text>
        <Text as="label" htmlFor="site-domain">自定义域名</Text><Input autoFocus id="site-domain" placeholder="www.example.com" value={draft || ""} maxLength={253} isDisabled={busy} onChange={e=>{setDraft(e.target.value);setError("");}}/>
        {error && <Text role="alert">{error}</Text>}</ModalBody><ModalFooter gap={2}><Button isDisabled={busy} onClick={()=>setDraft(undefined)}>取消</Button><Button type="submit" isLoading={busy} isDisabled={!draft?.trim()}>添加域名</Button></ModalFooter></form>
    </ModalContent></Modal>
  </Box>;
}

import { Box, Button, Flex, Input, Text } from "@chakra-ui/react";
import { useEffect, useId, useState } from "react";
import { withAuthHeaders } from "@features/auth/client/authClient";

export default function SpaceInviteInput({accounts,onChange,query,setQuery}:{accounts:string[];onChange:(accounts:string[])=>void;query:string;setQuery:(query:string)=>void}) {
  const account = query.trim();
  const [result,setResult] = useState<{account:string;name?:string;error?:boolean}>();
  const list = useId();
  useEffect(()=>{
    if (!account) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async()=>{
      try {
        const response = await fetch("/api/library/recipient?"+new URLSearchParams({account}),{headers:withAuthHeaders(),signal:controller.signal});
        if (!response.ok) throw new Error();
        const data = await response.json();
        if (!controller.signal.aborted) setResult({account,name:data.recipient?.name});
      } catch { if (!controller.signal.aborted) setResult({account,error:true}); }
    },200);
    return ()=>{clearTimeout(timer);controller.abort();};
  },[account]);
  const current = result?.account===account ? result : undefined;
  function select() {
    if (!current?.name) return;
    if (!accounts.includes(account)) onChange([...accounts,account]);
    setQuery("");
    setResult(undefined);
  }
  return <Box>
    <Flex wrap="wrap" gap={1}>{accounts.map(item=><Button key={item} type="button" size="xs" aria-label={"移除 "+item} onClick={()=>onChange(accounts.filter(value=>value!==item))}>{item} ×</Button>)}</Flex>
    <Input role="combobox" aria-label="添加邮箱地址" aria-controls={list} aria-expanded={Boolean(account)} autoComplete="off" placeholder="输入飞书邮箱或本地账号" value={query} maxLength={103}
      onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key==="Enter" && !e.nativeEvent.isComposing){e.preventDefault();select();}}}/>
    {account && <Box id={list} role="listbox" aria-label="添加邮箱地址" p={2} borderWidth="1px" borderRadius="8px">
      {current?.name ? <Button role="option" aria-selected={accounts.includes(account)} type="button" w="100%" justifyContent="start" variant="ghost" size="sm" onClick={select}>{current.name}</Button> :
        <Text role="status" fontSize="sm">{!current ? "正在搜索用户" : current.error ? "无法搜索用户，请重新输入" : "未找到匹配的收件人"}</Text>}
    </Box>}
  </Box>;
}

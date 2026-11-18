import { Box, Button, Flex, Heading, IconButton, Menu, MenuButton, MenuItem, MenuList, Spinner, Text } from "@chakra-ui/react";
import { ChevronDown, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { LibraryFile } from "@/types/library";
import { libraryAttachmentUrl, readLibraryAttachment } from "@features/chat/services/libraryAttachment";
import ExtendedFilePreview from "../workspace/ExtendedFilePreview";
import { isArtifactImage } from "../workspace/ArtifactFileIcon";
import LibraryItemIcon from "./LibraryItemIcon";

interface Props {
  item: LibraryFile;
  download: ReactNode;
  share?:()=>void;
  close: () => void;
  openSource: () => void;
  toggleFavorite: () => void;
}
export default function LibraryFileViewer({item,download,share,close,openSource,toggleFavorite}:Props) {
  const [attempt,setAttempt] = useState(0);
  const [body,setBody] = useState<string>();
  const [error,setError] = useState(false);
  const closeButton = useRef<HTMLButtonElement>(null);
  const name = item.path || item.name;
  const markdown = /\.(md|markdown)$/i.test(name);
  const plain = /\.(txt|log|json|ya?ml)$/i.test(name);
  const document = isArtifactImage(name) || /\.(pdf|docx|xlsx|pptx|csv|tsv)$/i.test(name);
  useEffect(() => {closeButton.current?.focus();},[]);
  useEffect(() => {
    if (!markdown && !plain) return;
    const controller = new AbortController();
    setBody(undefined);
    setError(false);
    readLibraryAttachment(item,controller.signal).then(file=>file.text()).then(text=>{
      if (!controller.signal.aborted) setBody(text);
    }).catch(()=>{if (!controller.signal.aborted) setError(true);});
    return () => controller.abort();
  },[item,markdown,plain,attempt]);
  return <Flex as="section" aria-label="文件查看器" direction="column" minW={0} flex="1" onKeyDown={event=>{
    if (event.key !== "Escape" || event.defaultPrevented) return;
    // The PPTX viewer handles its own Escape on document after React bubbling.
    const inSlideshow = event.nativeEvent.composedPath().some(node =>
      node instanceof Element && node.classList.contains("flyfish-pptx-presentation")
    );
    if (!inSlideshow) close();
  }}>
    <Flex as="header" align="center" px={4} h="52px" flexShrink={0} gap={2}>
      <Menu><MenuButton as={Button} size="sm" variant="ghost" maxW="65%" rightIcon={<ChevronDown size={14}/>} aria-label={item.name+" 的文件操作"}>
        <Text isTruncated>{item.name}</Text></MenuButton>
        <MenuList><MenuItem onClick={toggleFavorite}>{item.favorite?"从收藏夹移除":"添加到收藏夹"}</MenuItem>
          {item.chatId && <MenuItem onClick={openSource}>打开来源会话</MenuItem>}</MenuList>
      </Menu><Box flex="1"/>{download}{share && <Button size="xs" variant="ghost" onClick={share}>分享</Button>}<IconButton ref={closeButton} variant="ghost" size="sm" aria-label="关闭查看器" icon={<X size={18}/>} onClick={close}/>
    </Flex>
    <Box flex="1" minH={0} overflow="auto">
      {markdown || plain ? <Box mx="auto" maxW="820px" px={{base:5,md:10}} py={8}
        sx={{"& h1, & h2, & h3":{fontWeight:600,marginBlock:"1em .5em"},"& h1":{fontSize:"1.7em"},"& h2":{fontSize:"1.3em"},"& p":{marginBottom:3,whiteSpace:"pre-wrap"},"& ul, & ol":{paddingInlineStart:6},"& pre":{overflowX:"auto"}}}>
        {error ? <Button size="sm" onClick={()=>setAttempt(n=>n+1)}>读取失败，重试</Button> : body===undefined ? <Spinner size="sm" aria-label="读取文件"/> :
          markdown ? <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={{img:({alt})=><span>{alt}</span>}}>{body}</ReactMarkdown> :
          <Text as="pre" whiteSpace="pre-wrap">{body}</Text>}
      </Box> : document ? <ExtendedFilePreview key={attempt} url={libraryAttachmentUrl(item)} name={name} onRetry={()=>setAttempt(n=>n+1)}/> :
        <Flex h="100%" align="center" justify="center" direction="column" gap={2} textAlign="center" px={4}>
          <LibraryItemIcon item={item}/><Text fontSize="xs" color="gray.500">无法预览</Text><Heading size="md">{item.name}</Heading>
          <Text fontSize="sm" color="gray.600">此文件类型可下载或添加到聊天</Text>{download}
        </Flex>}
    </Box>
  </Flex>;
}

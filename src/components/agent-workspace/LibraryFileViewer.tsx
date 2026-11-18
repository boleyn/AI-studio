import { Box, Button, Flex, Heading, Input, IconButton, Menu, MenuButton, MenuItem, MenuList, Spinner, Text } from "@chakra-ui/react";
import { CircleAlert, ChevronDown, MessageSquare, X } from "lucide-react";
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
  askAboutFile:(question:string)=>Promise<void>;
  close: () => void;
  openSource: () => void;
  toggleFavorite: () => void;
}
export default function LibraryFileViewer({item,download,share,askAboutFile,close,openSource,toggleFavorite}:Props) {
  const [question,setQuestion] = useState("");
  const [openingChat,setOpeningChat] = useState(false);
  const [attempt,setAttempt] = useState(0);
  const [body,setBody] = useState<string>();
  const [error,setError] = useState(false);
  const closeButton = useRef<HTMLButtonElement>(null);
  const name = item.path || item.name;
  const markdown = /\.(md|markdown)$/i.test(name);
  const plain = /\.(txt|log|json|ya?ml)$/i.test(name);
  const document = isArtifactImage(name) || /\.(pdf|docx|xlsx|pptx|csv|tsv)$/i.test(name);
  const image = isArtifactImage(name);
  const viewport = useRef<HTMLDivElement>(null);
  const [dimensions,setDimensions] = useState({width:0,height:0});
  const [fit,setFit] = useState(1);
  const [scale,setScale] = useState<number>();
  useEffect(() => {
    const element = viewport.current;
    if (!element || !dimensions.width || !dimensions.height) return;
    const resize = () => setFit(Math.min(1, element.clientWidth / dimensions.width, element.clientHeight / dimensions.height));
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => observer.disconnect();
  },[dimensions]);
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
  const previewFailure = <Flex direction="column" align="center" textAlign="center" px={4} py={8} gap={3}>
    <CircleAlert size={22} color="#777" aria-hidden/>
    <Box role="alert"><Text fontWeight="600">无法加载预览</Text>
      <Text mt={1} fontSize="sm" color="gray.600" overflowWrap="anywhere">未能读取“{item.name}”。</Text>
    </Box>
    <Button size="sm" variant="outline" borderRadius="full" onClick={()=>{setError(false);setAttempt(n=>n+1);}}>重新加载</Button>
  </Flex>;
  return <Flex as="section" aria-label="文件查看器" direction="column" minW={0} flex="1" onKeyDown={event=>{
    if (event.key !== "Escape" || event.defaultPrevented) return;
    // The PPTX viewer handles its own Escape on document after React bubbling.
    const inSlideshow = event.nativeEvent.composedPath().some(node =>
      node instanceof Element && node.classList.contains("flyfish-pptx-presentation")
    );
    if (!inSlideshow) close();
  }}>
    <Flex as="header" align="center" px={4} h="52px" flexShrink={0} gap={2}>
      <Menu><MenuButton as={Button} size="sm" variant="ghost" maxW="65%" rightIcon={<ChevronDown size={14}/>} aria-label={(image ? item.name.replace(/\.[^.]+$/, "") : item.name)+" 的文件操作"}>
        <Text isTruncated>{image ? "图像" : item.name}</Text></MenuButton>
        <MenuList><MenuItem onClick={toggleFavorite}>{item.favorite?"从收藏夹中移除":"添加到收藏夹"}</MenuItem>
          {item.chatId && item.conversation && <MenuItem onClick={openSource}>打开来源会话</MenuItem>}</MenuList>
      </Menu><Box flex="1"/>{image && <Menu>
        <MenuButton as={Button} size="sm" variant="ghost" rightIcon={<ChevronDown size={14}/>} aria-label="图像缩放">
          {Math.round((scale ?? fit)*100)}%
        </MenuButton>
        <MenuList minW="120px">
          <MenuItem onClick={()=>setScale(undefined)}>适应窗口</MenuItem>
          {[50,75,100,125,150,200].map(percent=><MenuItem key={percent} onClick={()=>setScale(percent/100)}>{percent}%</MenuItem>)}
        </MenuList>
      </Menu>}{download}{share && <Button size="xs" variant="ghost" onClick={share}>分享</Button>}<IconButton ref={closeButton} variant="ghost" size="sm" aria-label="关闭查看器" icon={<X size={18}/>} onClick={close}/>
    </Flex>
    <Box ref={viewport} flex="1" minH={0} overflow="auto">
      {markdown || plain ? <Box mx="auto" maxW="820px" px={{base:5,md:10}} py={8}
        sx={{"& h1, & h2, & h3":{fontWeight:600,marginBlock:"1em .5em"},"& h1":{fontSize:"1.7em"},"& h2":{fontSize:"1.3em"},"& p":{marginBottom:3,whiteSpace:"pre-wrap"},"& ul, & ol":{paddingInlineStart:6},"& pre":{overflowX:"auto"}}}>
        {error ? previewFailure : body===undefined ? <Spinner size="sm" aria-label="读取文件"/> :
          markdown ? <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={{img:({alt})=><span>{alt}</span>}}>{body}</ReactMarkdown> :
          <Text as="pre" whiteSpace="pre-wrap">{body}</Text>}
      </Box> : image ? <Flex minH="full" minW="full" w="max-content" align="center" justify="center">
        {error ? previewFailure :
          <Box as="img" key={attempt} src={libraryAttachmentUrl(item)} alt={item.name} maxW="none"
            width={dimensions.width ? dimensions.width*(scale ?? fit)+"px" : undefined}
            onLoad={(event:React.SyntheticEvent<HTMLImageElement>)=>setDimensions({width:event.currentTarget.naturalWidth,height:event.currentTarget.naturalHeight})}
            onError={()=>setError(true)}/>}
      </Flex> : document ? <ExtendedFilePreview key={attempt} url={libraryAttachmentUrl(item)} name={name} onRetry={()=>setAttempt(n=>n+1)}/> :
        <Flex h="100%" align="center" justify="center" direction="column" gap={2} textAlign="center" px={4}>
          <LibraryItemIcon item={item}/><Text fontSize="xs" color="gray.500">无法预览</Text><Heading size="md">{item.name}</Heading>
          <Text fontSize="sm" color="gray.600">此文件类型可下载或添加到聊天</Text>{download}
        </Flex>}
    </Box>
    {isArtifactImage(name) && <Flex as="form" aria-label="询问此文件" align="center" gap={2} w="min(100%, 640px)" mx="auto" p={3}
      onSubmit={async event=>{
        event.preventDefault();
        if (openingChat) return;
        setOpeningChat(true);
        try {await askAboutFile(question.trim());} finally {setOpeningChat(false);}
      }}>
      <Input aria-label="询问此文件" placeholder="询问此文件" value={question} onChange={event=>setQuestion(event.target.value)} borderRadius="full"/>
      <IconButton type="submit" aria-label="带入聊天" title="带入聊天" isLoading={openingChat} icon={<MessageSquare size={18}/>} borderRadius="full"/>
    </Flex>}
  </Flex>;
}

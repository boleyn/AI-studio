import InteractiveHtmlPreview from "../workspace/InteractiveHtmlPreview";
import { libraryTypeName, markdownFilename } from "@/types/library";
import { Box, Button, Flex, Heading, Input, IconButton, Menu, MenuButton, MenuDivider, MenuItem, MenuList, Spinner, Text } from "@chakra-ui/react";
import { CircleAlert, ChevronDown, Download, Share2, Library, Minus, MessageSquare, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import LibraryMarkdown from "./LibraryMarkdown";
import type { LibraryFile } from "@/types/library";
import { libraryAttachmentUrl, libraryReadMessage, readLibraryAttachment } from "@features/chat/services/libraryAttachment";
import ExtendedFilePreview from "../workspace/ExtendedFilePreview";
import { isArtifactImage } from "../workspace/ArtifactFileIcon";
import LibraryItemIcon from "./LibraryItemIcon";

import FileChatDivider, { type FileChatSizing } from "./FileChatDivider";

interface Props extends FileChatSizing {
  item: LibraryFile;
  versions: LibraryFile[];
  openVersion: (file: LibraryFile) => void;
  restoreVersion: (file: LibraryFile, head: LibraryFile) => Promise<void>;
  download: () => void;
  downloading: boolean;
  share?:()=>void;
  fileChatOpen:boolean;
  resumeFileChat?:()=>void;
  askAboutFile:(question:string)=>Promise<void>;
  close: () => void;
  openLibrary: () => void;
  openSource: () => void;
  toggleFavorite: () => void;
}
function displayFileSize(bytes: number) {
  const units = ["B", "kB", "MB", "GB", "TB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log10(Math.max(1,bytes)) / 3));
  const value = (bytes / 1000 ** index).toLocaleString("zh-CN",{maximumFractionDigits:1});
  return value + " " + units[index];
}

type ViewerPanel = "info" | "history";

export default function LibraryFileViewer(props: Props) {
  const [panel,setPanel] = useState<ViewerPanel>();
  return <FilePreview key={props.item.id} {...props} panel={panel} setPanel={setPanel}/>;
}

function FilePreview({item,versions,openVersion,restoreVersion,download,downloading,share,fileChatWidth,setFileChatWidth,fileChatOpen,resumeFileChat,askAboutFile,close,openLibrary,openSource,toggleFavorite,panel,setPanel}:Props & {
  panel?: ViewerPanel;
  setPanel: (panel?: ViewerPanel) => void;
}) {
  const [question,setQuestion] = useState("");
  const [draftMinimized,setDraftMinimized] = useState(false);
  const [restoring,setRestoring] = useState(false);
  const [openingChat,setOpeningChat] = useState(false);
  const [attempt,setAttempt] = useState(0);
  const [imageUrl,setImageUrl] = useState<string>();
  const [body,setBody] = useState<string>();
  const [previewSize,setPreviewSize] = useState<number>();
  const size = item.size ?? previewSize;
  const [error,setError] = useState("");
  const closeButton = useRef<HTMLButtonElement>(null);
  const historySelection = useRef<HTMLButtonElement>(null);
  const name = item.sharedPage ? markdownFilename(item.name) : libraryTypeName(item);
  const markdown = /\.(md|markdown)$/i.test(name);
  const html = /\.html?$/i.test(name);
  const plain = /\.(txt|log|json|ya?ml)$/i.test(name);
  const document = isArtifactImage(name) || /\.(pdf|doc[xm]|xls[xm]?|ppt[xm]|csv|tsv|ods)$/i.test(name);
  const image = isArtifactImage(name);
  const menuTitle = /\.zip$/i.test(item.name)
    ? item.name.slice(0, -4).replace(/-+/g, " ").trim() || item.name
    : item.name;
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
  useEffect(() => {
    const target = historySelection.current || closeButton.current;
    target?.focus();
  },[]);
  useEffect(() => {
    if (!markdown && !plain && !image && !html) return;
    let objectUrl: string | undefined;
    setImageUrl(undefined);
    const controller = new AbortController();
    setBody(undefined);
    setPreviewSize(undefined);
    setError("");
    readLibraryAttachment(item,controller.signal).then(async file=>{
      if (controller.signal.aborted) return;
      if (image) {
        objectUrl = URL.createObjectURL(file);
        setImageUrl(objectUrl);
        setPreviewSize(file.size);
        return;
      }
      const text = await file.text();
      if (!controller.signal.aborted) {
        setBody(text);
        setPreviewSize(file.size);
      }
    }).catch(reason=>{if (!controller.signal.aborted) setError(libraryReadMessage(reason));});
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  },[item,markdown,plain,image,html,attempt]);
  const previewFailure = <Flex direction="column" align="center" textAlign="center" px={4} py={8} gap={3}>
    <CircleAlert size={22} color="#777" aria-hidden/>
    <Box role="alert"><Text fontWeight="600">无法加载预览</Text>
      <Text mt={1} fontSize="sm" color="gray.600" overflowWrap="anywhere">{error}</Text>
    </Box>
    <Button size="sm" variant="outline" borderRadius="full" onClick={()=>{setImageUrl(undefined);setBody(undefined);setError("");setAttempt(n=>n+1);}}>重新加载</Button>
  </Flex>;
  return <Flex as="section" minH={0} aria-label="文件查看器" direction="column" minW={0} flex="1" onKeyDown={event=>{
    if (event.key !== "Escape" || event.defaultPrevented) return;
    // The PPTX viewer handles its own Escape on document after React bubbling.
    const inSlideshow = event.nativeEvent.composedPath().some(node =>
      node instanceof Element && node.classList.contains("flyfish-pptx-presentation")
    );
    if (inSlideshow) return;
    if (panel) setPanel(undefined);
    else close();
  }}>
    <Flex as="header" align="center" ps={4} pe={2} h="52px" flexShrink={0} gap={2}>
      <Menu><MenuButton as={Button} size="sm" variant="ghost" minW={0} maxW="65%" rightIcon={<ChevronDown size={14}/>} aria-label={(image ? item.name.replace(/\.[^.]+$/, "") : menuTitle)+" 的文件操作"}>
        <Text isTruncated>{image ? "图像" : menuTitle}</Text></MenuButton>
        <MenuList>
          <MenuItem icon={<Library size={16}/>} onClick={openLibrary}>资料空间</MenuItem>
          <MenuDivider/>
          <MenuItem onClick={()=>setPanel("info")}>文件信息</MenuItem><MenuItem onClick={toggleFavorite}>{item.favorite?"从收藏夹中移除":"添加到收藏夹"}</MenuItem>
          <MenuItem onClick={()=>setPanel("history")}>版本历史记录</MenuItem>
          {item.chatId && item.conversation && <MenuItem onClick={openSource}>打开来源会话</MenuItem>}</MenuList>
      </Menu><Box flex="1"/>{image && <Menu>
        <MenuButton as={Button} size="sm" variant="ghost" rightIcon={<ChevronDown size={14}/>} aria-label="图像缩放">
          {Math.round((scale ?? fit)*100)}%
        </MenuButton>
        <MenuList minW="120px">
          <MenuItem onClick={()=>setScale(undefined)}>适应窗口</MenuItem>
          {[50,75,100,125,150,200].map(percent=><MenuItem key={percent} onClick={()=>setScale(percent/100)}>{percent}%</MenuItem>)}
        </MenuList>
      </Menu>}
      {panel === "history" && <Button size="sm" borderRadius="full" isLoading={restoring}
        isDisabled={!item.version || !versions[0]?.version || versions[0].id === item.id}
        onClick={async()=>{setRestoring(true);try {await restoreVersion(item,versions[0]);} finally {setRestoring(false);}}}>恢复此版本</Button>}
      <Flex role="group" aria-label="文件操作" align="center" gap="2px" flexShrink={0}>
        <IconButton aria-label="下载" title="下载" size="sm" borderRadius="full" variant="ghost" icon={<Download size={16}/>} isLoading={downloading} onClick={download}/>
        {share && <Button size="sm" minW="80px" borderRadius="full" leftIcon={<Share2 size={16}/>} onClick={share}>分享</Button>}
      </Flex>
      <Flex role="group" aria-label="查看器控件" align="center" flexShrink={0}>
        <IconButton ref={closeButton} variant="ghost" size="sm" boxSize="36px" borderRadius="full" aria-label="关闭查看器" icon={<X size={18}/>} onClick={close}/>
      </Flex>
    </Flex>
    <Flex flex="1" minH={0} position="relative" direction={{base:"column",lg:"row"}}>
    <Flex direction="column" flex="1" minW={0} minH={0}>
    <Flex flex="1" minH={0} position="relative">
    <Box ref={viewport} flex="1" minW={0} minH={0} overflow="auto">
      {html ? error ? previewFailure : body === undefined ? <Spinner size="sm" aria-label="读取文件"/> :
        <InteractiveHtmlPreview name={item.name} body={body}/>
        : markdown || plain ? <Box mx="auto" maxW="820px" px={{base:5,md:10}} py={8}>
        {error ? previewFailure : body===undefined ? <Spinner size="sm" aria-label="读取文件"/> :
          markdown ? <LibraryMarkdown>{body}</LibraryMarkdown> :
          <Text as="pre" whiteSpace="pre-wrap">{body}</Text>}
      </Box> : image ? <Flex minH="full" minW="full" w="max-content" align="center" justify="center">
        {error ? previewFailure : !imageUrl ? <Spinner size="sm" aria-label="读取图片"/> :
          <Box as="img" key={attempt} src={imageUrl} alt={item.name} maxW="none"
            width={dimensions.width ? dimensions.width*(scale ?? fit)+"px" : undefined}
            onLoad={(event:React.SyntheticEvent<HTMLImageElement>)=>setDimensions({width:event.currentTarget.naturalWidth,height:event.currentTarget.naturalHeight})}
            onError={()=>setError("图片暂时无法显示，请重新加载。")}/>}
      </Flex> : document ? <ExtendedFilePreview key={attempt} url={libraryAttachmentUrl(item)} name={name} onRetry={()=>setAttempt(n=>n+1)}/> :
        <Flex h="100%" align="center" justify="center" direction="column" gap={2} textAlign="center" px={4}>
          <LibraryItemIcon item={item}/><Text fontSize="xs" color="gray.500">无法预览</Text><Heading size="md">{item.name}</Heading>
          <Text fontSize="sm" color="gray.600">此文件类型可下载或添加到聊天</Text><Button size="sm" borderRadius="full" isLoading={downloading} onClick={download}>下载文件</Button>
        </Flex>}
    </Box>

    </Flex>
    {(resumeFileChat || (draftMinimized && !fileChatOpen)) && <Button alignSelf="flex-end" m={3} size="sm" borderRadius="full" leftIcon={<MessageSquare size={16}/>}
      onClick={resumeFileChat || (()=>setDraftMinimized(false))} aria-label="展开聊天窗口">聊天</Button>}
    </Flex>
    {!fileChatOpen && !resumeFileChat && !draftMinimized && <Flex as="aside" aria-label="新聊天" direction="column"
      position="relative" w={{base:"100%",lg:fileChatWidth+"%"}} flexShrink={0} minW={0} bg="white" borderInlineStartWidth={{base:0,lg:"1px"}} borderTopWidth={{base:"1px",lg:0}}>
      <FileChatDivider fileChatWidth={fileChatWidth} setFileChatWidth={setFileChatWidth} breakpoint="lg"/>
      <Flex align="center" justify="space-between" px={4} minH="44px">
        <Heading as="h2" fontSize="sm">新聊天</Heading>
        <IconButton size="sm" variant="ghost" aria-label="最小化聊天窗口" icon={<Minus size={16}/>} onClick={()=>setDraftMinimized(true)}/>
      </Flex>
      <Flex as="form" aria-label="询问此文件" align="center" gap={2} w="min(100%, 640px)" mx="auto" mt="auto" p={3}
      onSubmit={async event=>{
        event.preventDefault();
        if (openingChat) return;
        setOpeningChat(true);
        try {await askAboutFile(question.trim());} finally {setOpeningChat(false);}
      }}>
      <Input aria-label="询问此文件" placeholder="询问此文件" value={question} onChange={event=>setQuestion(event.target.value)} borderRadius="full"/>
      <IconButton type="submit" aria-label="带入聊天" title="带入聊天" isLoading={openingChat} icon={<MessageSquare size={18}/>} borderRadius="full"/>
      </Flex>
    </Flex>}
    {panel && <Box as="aside" aria-label={panel === "info" ? "文件详情" : "版本历史记录"} position={{base:"absolute",lg:"relative"}}
      insetY={0} right={0} zIndex={1} mr={{base:0,lg:"8px"}} mb={{base:0,lg:"8px"}} w="min(100%, 296px)" flexShrink={0} overflowY="auto" bg="white" borderLeftWidth="1px" px={4} pt="5px" pb={4}>
      <Flex align="center" justify="space-between" mr="-8px"><Heading size="sm" fontWeight="400" lineHeight="24px">{panel === "info" ? "文件详情" : "版本历史记录"}</Heading>
        <IconButton size="sm" boxSize="36px" borderRadius="full" variant="ghost" aria-label={panel === "info" ? "关闭文件信息面板" : "关闭版本历史记录"} icon={<X size={16}/>} onClick={()=>setPanel(undefined)}/>
      </Flex>
      {panel === "history" ? <Flex direction="column" mt={4} gap={1}>
        {versions.map((version,index) => <Button key={version.id} ref={version.id === item.id ? historySelection : undefined} variant={version.id === item.id ? "solid" : "ghost"}
          justifyContent="space-between" size="sm" aria-current={version.id === item.id ? "true" : undefined}
          onClick={()=>{if (version.id !== item.id) openVersion(version);}}>
          {version.kind === "生成" && !version.version ? "当前文件内容" : version.shareId ? "共享版本" : version.time ? new Date(version.time).toLocaleString("zh-CN") : version.name}
          {index === 0 ? <Text as="span" fontSize="xs">当前版本</Text> : version.id === item.id && <Text as="span" fontSize="xs">正在查看</Text>}
        </Button>)}
      </Flex> : <><Text mt={4} fontWeight="600" overflowWrap="anywhere">{item.name}</Text>
      <Text fontSize="xs" color="gray.600" mt={1}>资料空间</Text>
      <Box as="dl" mt={4} fontSize="sm" sx={{"& dt":{color:"gray.600",mt:3}}}>
        <dt>文件类型</dt><dd>{name.match(/\.([^.\/]+)$/)?.[1].toUpperCase() || item.kind}</dd>
        {item.time && <><dt>{item.shareId ? "共享时间" : "最近更新"}</dt><dd><time dateTime={item.time}>{new Date(item.time).toLocaleString("zh-CN")}</time></dd></>}
        {item.chatId && item.conversation && <><dt>来源会话</dt><dd>
          <Button size="sm" variant="link" whiteSpace="normal" textAlign="left" overflowWrap="anywhere" onClick={openSource}>{item.conversation}</Button>
        </dd></>}
        {item.firstSeenAt && <><dt>首次出现在会话中</dt><dd><time dateTime={item.firstSeenAt}>{new Date(item.firstSeenAt).toLocaleString("zh-CN")}</time></dd></>}
        {item.createdAt && <><dt>创建时间</dt><dd><time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString("zh-CN")}</time>
          {item.createdBy && <Text fontSize="xs" color="gray.600">由 {item.createdBy}</Text>}</dd></>}
        {size !== undefined && <><dt>文件大小</dt><dd>{displayFileSize(size)}</dd></>}
      </Box>
      {item.permission && <Box mt={5} pt={4} borderTopWidth="1px">
        <Heading as="h3" fontSize="sm">您的权限</Heading><Text mt={2} fontSize="sm">{item.permission}</Text>
      </Box>}</>}
    </Box>}
    </Flex>
  </Flex>;
}

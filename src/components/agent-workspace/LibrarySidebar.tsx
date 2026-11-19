import Link, { type LinkProps } from "next/link";
import { Box, Button, Flex, Heading, IconButton, Popover, PopoverContent, PopoverTrigger, Portal, Text, useBreakpointValue } from "@chakra-ui/react";
import { Bell, Plus, Files, Users, FileText, GalleryHorizontalEnd, Image, Library, PanelLeft, LayoutDashboard, Search, Trash2 } from "lucide-react";
import { libraryActivityTime, type LibraryFile } from "@/types/library";
import { formatRelativeTime } from "./relativeTime";
import LibraryItemIcon from "./LibraryItemIcon";
import AttachmentFilename from "@features/chat/components/AttachmentFilename";
import { type ReactNode, useRef, useState } from "react";

const categories = [
  { name: "全部", icon: Library }, { name: "你的条目", icon: Files }, { name: "与你共享", icon: Users }, { name: "页面", icon: FileText },
  { name: "幻灯片", icon: GalleryHorizontalEnd }, { name: "站点", icon: LayoutDashboard },
  { name: "图像", icon: Image },
];
type Props = {
  driveConnected: boolean;
  width?: number;
  setWidth: (width: number) => void;
  createMenu: ReactNode;
  spaceActions:(space:LibraryFile)=>ReactNode;
  onNewSpace: () => void;
  section?: string;
  activeSpaceId?: string;
  files: LibraryFile[];
  sectionHref: (section: string) => LinkProps["href"];
  onSectionNavigate: () => void;
  onSection: (section: string) => void;
  onFile: (file: LibraryFile) => void;
  onSearch: () => void;
  onCollapse: () => void;
};
export default function LibrarySidebar({ driveConnected, width, setWidth, createMenu, spaceActions, onNewSpace, section, activeSpaceId, files, sectionHref, onSectionNavigate, onSection, onFile, onSearch, onCollapse }: Props) {
  const defaultWidth = useBreakpointValue({base:248,xl:288}) ?? 248;
  const resize = (value: number) => setWidth(Math.max(220, Math.min(420, value)));
  const [expanded, setExpanded] = useState(false);
  const focusNewRecent = useRef(false);
  const [recent, setRecent] = useState(true);
  const [spaces,setSpaces] = useState(true);
  const items = files.filter(file => !file.deleted);
  const recentItems = [...items].sort((a,b)=>libraryActivityTime(b).localeCompare(libraryActivityTime(a)));
  const invitations = items.filter(file => file.shareId).sort((a,b)=>(b.invitedAt || b.time).localeCompare(a.invitedAt || a.time));
  const [activityOpen,setActivityOpen] = useState(false);
  return <Flex as="nav" aria-label="资料空间导航" position="relative" w={width === undefined ? {md:"248px",xl:"288px"} : width + "px"} flexShrink={0} direction="column" bg="#fafafa" boxShadow="inset -1px 0 #eee" p="12px" pr="8px" minH={0}>
    <Flex align="center" pl="10px" pr="4px" gap="clamp(2px, calc((100% - 188px) / 3), 8px)" mb={2}><Heading as="h1" fontSize="17px" fontWeight="600" lineHeight="24px" flex="1" display="flex" alignItems="center"><Button variant="unstyled" height="auto" minW={0} fontSize="inherit" fontWeight="inherit" lineHeight="inherit" onClick={() => onSection("全部")}>资料空间</Button></Heading>
      <Popover isOpen={activityOpen} onOpen={()=>setActivityOpen(true)} onClose={()=>setActivityOpen(false)} placement="bottom-start" gutter={5} isLazy>
        <PopoverTrigger><IconButton size="sm" w="36px" h="36px" variant="ghost" color="#8f8f8f" borderRadius="8px" aria-label="动态" icon={<Bell size={20} strokeWidth={1.6}/>} /></PopoverTrigger>
        <Portal><PopoverContent aria-label="动态" width="min(384px, calc(100vw - 24px))" height="320px" borderRadius="12px" boxShadow="lg">
          <Text px={4} py={3} fontWeight="600">动态</Text>
          {invitations.length ? <Box as="ul" overflowY="auto" listStyleType="none" px={2} pb={2}>
            {invitations.map(file=><Box as="li" key={file.id}><Button variant="ghost" w="full" h="auto" py={2} justifyContent="start" gap={2} onClick={()=>{
              setActivityOpen(false); onFile(file);
            }}><LibraryItemIcon item={file}/><Box minW={0} textAlign="left">
              <Text fontSize="sm" isTruncated>{file.name}</Text><Text fontSize="xs" fontWeight="normal" color="gray.600">{file.project} 与你共享{(file.invitedAt || file.time) ? " · "+formatRelativeTime(file.invitedAt || file.time) : ""}</Text>
            </Box></Button></Box>)}
          </Box> : <Flex flex="1" direction="column" align="center" justify="center" px={8} pb={8} textAlign="center" gap={2}>
            <Bell size={22} aria-hidden="true" />
            <Heading as="h2" size="sm">暂无通知</Heading>
            <Text fontSize="sm" color="gray.600">有人提及你、在你的页面上发表评论，或回复你参与的对话时，你会收到通知。</Text>
          </Flex>}
        </PopoverContent></Portal>
      </Popover>
      <IconButton size="sm" w="36px" h="36px" variant="ghost" color="#8f8f8f" borderRadius="8px" aria-label="搜索" aria-haspopup="dialog" icon={<Search size={20} strokeWidth={1.6}/>} onClick={onSearch}/>
      <IconButton size="sm" w="36px" h="36px" variant="ghost" color="#8f8f8f" borderRadius="8px" aria-expanded={true} aria-label="显示/隐藏侧边栏" icon={<PanelLeft size={20} strokeWidth={1.6}/>} onClick={onCollapse}/>
    </Flex>
    {createMenu}
    <Flex direction="column" mt="17px" gap="1px" sx={{"& > :is(button,a)":{height:"35px",paddingInline:"8px",borderRadius:"8px"},"& .chakra-button__icon":{marginInlineEnd:"6px"}}}>
    {categories.map(({name, icon: Icon}) => <Link key={name} href={sectionHref(name)} shallow scroll={false} prefetch={false} legacyBehavior passHref onNavigate={onSectionNavigate}><Button as="a" variant="ghost" justifyContent="start" size="sm" fontWeight="normal"
      aria-current={section === name ? "page" : undefined} bg={section === name ? "#eee" : undefined} leftIcon={<Icon size={20} strokeWidth={1.6}/>}>{name}</Button></Link>)}
    {driveConnected && <Button variant="ghost" size="sm" justifyContent="start" aria-current={section === "Google Drive" ? "page" : undefined} bg={section === "Google Drive" ? "#eee" : undefined} leftIcon={<Flex boxSize="20px" align="center" justify="center"><Box as="img" src="/icons/google-drive.png" alt="" boxSize="16px"/></Flex>} onClick={()=>onSection("Google Drive")}>Google Drive</Button>}
    </Flex>
    <Box overflowY="auto" mt="17px" flex="1">
      <Flex align="center" justify="space-between"><Button size="sm" variant="ghost" ml="4px" flex="1" h="36px" px="4px" justifyContent="start" color="#8f8f8f" aria-expanded={spaces} onClick={() => setSpaces(!spaces)}>资料空间</Button>
        <IconButton size="xs" variant="ghost" aria-label="创建资料空间" icon={<Plus size={14}/>} onClick={onNewSpace}/></Flex>
      {spaces && items.filter(item => item.kind === "资料空间").sort((a,b)=>Number(Boolean(b.pinned))-Number(Boolean(a.pinned))).map(item => <Flex key={item.id} align="center" borderRadius="md" bg={activeSpaceId === item.id ? "#eee" : undefined}><Button minW={0} size="sm" variant="ghost" flex="1" h="36px" px="10px" iconSpacing="8px" fontWeight="normal" justifyContent="start"
        aria-current={activeSpaceId === item.id ? "page" : undefined} title={item.name} leftIcon={<LibraryItemIcon item={item} compact/>} onClick={() => onFile(item)}><Text isTruncated>{item.name}</Text></Button>{spaceActions(item)}</Flex>)}
      <Button mt="17px" variant="ghost" size="sm" ml="4px" w="calc(100% - 10px)" h="36px" px="4px" justifyContent="start" color="#8f8f8f" aria-expanded={recent} onClick={() => setRecent(!recent)}>最近</Button>
      {recent && recentItems.length > 0 && <Flex direction="column" gap="1px" mt="4px">
      {recentItems.slice(0,expanded ? undefined : 5).map((file,index) => <Button key={file.id} ref={index === 5 ? node => {
        if (node && focusNewRecent.current) {
          focusNewRecent.current = false;
          node.focus();
        }
      } : undefined} variant="ghost" size="sm" w="full"
        justifyContent="start" px="10px" iconSpacing="8px" h="36px" borderRadius="8px" fontWeight="normal" title={file.name} onClick={() => onFile(file)} leftIcon={<LibraryItemIcon item={file} compact/>}>
          {(file.kind === "上传" || file.kind === "生成") && !file.sharedPage
            ? <AttachmentFilename name={file.name} fontSize="inherit"/>
            : <Text isTruncated>{file.name}</Text>}
        </Button>)}
      {recentItems.length > 5 && <Button alignSelf="start" h="36px" borderRadius="8px" variant="ghost" size="sm" color="#8f8f8f" fontWeight="normal" aria-expanded={expanded} onClick={event => { focusNewRecent.current = !expanded && event.detail === 0; setExpanded(!expanded); }}>{expanded ? "收起" : "展开显示"}</Button>}
      </Flex>}
    </Box>
    <Button variant="ghost" justifyContent="start" size="sm" flexShrink={0} h="35px" mb="9px" px="8px" iconSpacing="6px" fontWeight="normal" borderRadius="8px" aria-current={section === "回收站" ? "page" : undefined} bg={section === "回收站" ? "#eee" : undefined} leftIcon={<Trash2 size={20} strokeWidth={1.6}/>} onClick={() => onSection("回收站")}>回收站</Button>
    <Box role="separator" aria-label="调整资料空间侧栏宽度" aria-orientation="vertical" tabIndex={0}
      aria-valuemin={220} aria-valuemax={420} aria-valuenow={width ?? defaultWidth} aria-valuetext={(width ?? defaultWidth) + " 像素"} position="absolute" right="-4px" insetY={0}
      w="8px" zIndex={1} cursor="col-resize" style={{touchAction:"none"}} userSelect="none"
      _hover={{bg:"blackAlpha.100"}} _focusVisible={{outline:"2px solid currentColor"}}
      onPointerDown={event => { if (event.button === 0) event.currentTarget.setPointerCapture(event.pointerId); }}
      onPointerMove={event => {
        const handle = event.currentTarget;
        if (handle.hasPointerCapture(event.pointerId) && handle.parentElement)
          resize(event.clientX - handle.parentElement.getBoundingClientRect().left);
      }}
      onKeyDown={event => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        const current = event.currentTarget.parentElement?.getBoundingClientRect().width;
        if (current) resize(current + (event.key === "ArrowLeft" ? -8 : 8));
      }} />
  </Flex>;
}

import { Box, Button, Flex, Heading, IconButton, Popover, PopoverContent, PopoverTrigger, Portal, Text } from "@chakra-ui/react";
import { HardDrive, Bell, Plus, FileText, GalleryHorizontalEnd, Image, Library, PanelLeftClose, PanelsTopLeft, Search, Trash2 } from "lucide-react";
import type { LibraryFile } from "@/types/library";
import { formatRelativeTime } from "./relativeTime";
import LibraryItemIcon from "./LibraryItemIcon";
import { withAuthHeaders } from "@features/auth/client/authClient";
import { type ReactNode, useState, useEffect } from "react";

const categories = [
  { name: "全部", icon: Library }, { name: "页面", icon: FileText },
  { name: "幻灯片", icon: GalleryHorizontalEnd }, { name: "站点", icon: PanelsTopLeft },
  { name: "图像", icon: Image },
];
type Props = {
  createMenu: ReactNode;
  spaceActions:(space:LibraryFile)=>ReactNode;
  onNewSpace: () => void;
  section: string;
  files: LibraryFile[];
  onSection: (section: string) => void;
  onFile: (file: LibraryFile) => void;
  onSearch: () => void;
  onCollapse: () => void;
};
export default function LibrarySidebar({ createMenu, spaceActions, onNewSpace, section, files, onSection, onFile, onSearch, onCollapse }: Props) {
  const [driveConnected,setDriveConnected] = useState(false);
  useEffect(()=>{
    const controller = new AbortController();
    fetch("/api/library/connectors/google?status=1",{headers:withAuthHeaders(),signal:controller.signal}).then(async response=>{
      if (!response.ok) return;
      const status = await response.json();
      if (!controller.signal.aborted) setDriveConnected(status.connected);
    }).catch(()=>{});
    return ()=>controller.abort();
  },[]);
  const [expanded, setExpanded] = useState(false);
  const [recent, setRecent] = useState(true);
  const [spaces,setSpaces] = useState(true);
  const items = files.filter(file => !file.deleted);
  const invitations = items.filter(file => file.shareId).sort((a,b)=>b.time.localeCompare(a.time));
  const [activityOpen,setActivityOpen] = useState(false);
  return <Flex as="aside" w={{md:"248px",xl:"288px"}} flexShrink={0} direction="column" bg="#fafafa" borderRight="1px solid #eee" p="8px" minH={0}>
    <Flex align="center" px="8px" gap="4px" mb={3}><Heading fontSize="17px" fontWeight="600" lineHeight="24px" flex="1"><Button variant="unstyled" height="auto" minW={0} fontSize="inherit" fontWeight="inherit" lineHeight="inherit" onClick={() => onSection("全部")}>资料空间</Button></Heading>
      <Popover isOpen={activityOpen} onOpen={()=>setActivityOpen(true)} onClose={()=>setActivityOpen(false)} placement="bottom-start" gutter={5} isLazy>
        <PopoverTrigger><IconButton size="sm" w="36px" h="36px" variant="ghost" aria-label="动态" icon={<Bell size={15}/>} /></PopoverTrigger>
        <Portal><PopoverContent aria-label="动态" width="min(384px, calc(100vw - 24px))" height="320px" borderRadius="12px" boxShadow="lg">
          <Text px={4} py={3} fontWeight="600">动态</Text>
          {invitations.length ? <Box as="ul" overflowY="auto" listStyleType="none" px={2} pb={2}>
            {invitations.map(file=><Box as="li" key={file.id}><Button variant="ghost" w="full" h="auto" py={2} justifyContent="start" gap={2} onClick={()=>{
              setActivityOpen(false); onFile(file);
            }}><LibraryItemIcon item={file}/><Box minW={0} textAlign="left">
              <Text fontSize="sm" isTruncated>{file.name}</Text><Text fontSize="xs" fontWeight="normal" color="gray.600">{file.project} 与你共享{file.time ? " · "+formatRelativeTime(file.time) : ""}</Text>
            </Box></Button></Box>)}
          </Box> : <Flex flex="1" direction="column" align="center" justify="center" px={8} pb={8} textAlign="center" gap={2}>
            <Bell size={22} aria-hidden="true" />
            <Heading as="h2" size="sm">暂无通知</Heading>
            <Text fontSize="sm" color="gray.600">有人提及你、在你的页面上发表评论，或回复你参与的对话时，你会收到通知。</Text>
          </Flex>}
        </PopoverContent></Portal>
      </Popover>
      <IconButton size="sm" w="36px" h="36px" variant="ghost" aria-label="搜索" icon={<Search size={15}/>} onClick={onSearch}/>
      <IconButton size="sm" w="36px" h="36px" variant="ghost" aria-label="显示/隐藏侧边栏" icon={<PanelLeftClose size={15}/>} onClick={onCollapse}/>
    </Flex>
    {createMenu}
    {categories.map(({name, icon: Icon}) => <Button key={name} variant="ghost" justifyContent="start" size="sm" fontWeight="normal"
      bg={section === name ? "#eee" : undefined} leftIcon={<Icon size={16}/>} onClick={() => onSection(name)}>{name}</Button>)}
    {driveConnected && <Button variant="ghost" size="sm" justifyContent="start" leftIcon={<HardDrive size={16}/>} onClick={()=>onSection("Google Drive")}>Google Drive</Button>}
    <Box overflowY="auto" mt={5} flex="1">
      <Button variant="ghost" size="sm" color="gray.500" aria-expanded={recent} onClick={() => setRecent(!recent)}>最近</Button>
      {recent && items.slice(0,expanded ? undefined : 5).map(file => <Button key={file.id} variant="ghost" size="sm" w="full"
        justifyContent="start" fontWeight="normal" onClick={() => onFile(file)} leftIcon={<LibraryItemIcon item={file} compact/>}><Text isTruncated>{file.name}</Text></Button>)}
      {recent && items.length > 5 && <Button variant="ghost" size="sm" onClick={() => setExpanded(!expanded)}>{expanded ? "收起" : "展开显示"}</Button>}
      <Flex mt={5} align="center" justify="space-between"><Button size="sm" variant="ghost" color="gray.500" aria-expanded={spaces} onClick={() => setSpaces(!spaces)}>资料空间</Button>
        <IconButton size="xs" variant="ghost" aria-label="创建资料空间" icon={<Plus size={14}/>} onClick={onNewSpace}/></Flex>
      {spaces && items.filter(item => item.kind === "资料空间").sort((a,b)=>Number(Boolean(b.pinned))-Number(Boolean(a.pinned))).map(item => <Flex key={item.id} align="center" borderRadius="md" bg={section === item.name ? "#eee" : undefined}><Button minW={0} size="sm" variant="ghost" w="full" justifyContent="start"
        leftIcon={<LibraryItemIcon item={item} compact/>} onClick={() => onFile(item)}><Text isTruncated>{item.name}</Text></Button>{!item.shareId && spaceActions(item)}</Flex>)}
    </Box>
    <Button variant="ghost" justifyContent="start" size="sm" leftIcon={<Trash2 size={16}/>} onClick={() => onSection("回收站")}>回收站</Button>
  </Flex>;
}

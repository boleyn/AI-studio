import { Box, Button, Flex, Heading, IconButton, Popover, PopoverContent, PopoverTrigger, Portal, Text } from "@chakra-ui/react";
import { Bell, Plus, Layers, FileText, GalleryHorizontalEnd, Image, Library, PanelLeftClose, PanelsTopLeft, Search, Trash2 } from "lucide-react";
import type { LibraryFile } from "@/types/library";
import LibraryItemIcon from "./LibraryItemIcon";
import { type ReactNode, useState } from "react";

const categories = [
  { name: "全部", icon: Library }, { name: "页面", icon: FileText },
  { name: "幻灯片", icon: GalleryHorizontalEnd }, { name: "站点", icon: PanelsTopLeft },
  { name: "图像", icon: Image },
];
type Props = {
  createMenu: ReactNode;
  onNewSpace: () => void;
  section: string;
  files: LibraryFile[];
  onSection: (section: string) => void;
  onFile: (file: LibraryFile) => void;
  onSearch: () => void;
  onCollapse: () => void;
};
export default function LibrarySidebar({ createMenu, onNewSpace, section, files, onSection, onFile, onSearch, onCollapse }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [recent, setRecent] = useState(true);
  const [spaces,setSpaces] = useState(true);
  const items = files.filter(file => !file.deleted);
  return <Flex as="aside" w={{md:"248px",xl:"288px"}} flexShrink={0} direction="column" bg="#fafafa" borderRight="1px solid #eee" p="8px" minH={0}>
    <Flex align="center" px="8px" mb={3}><Heading fontSize="17px" fontWeight="600" lineHeight="24px" flex="1">资料空间</Heading>
      <Popover placement="bottom-start" isLazy>
        <PopoverTrigger><IconButton size="xs" variant="ghost" aria-label="动态" icon={<Bell size={15}/>} /></PopoverTrigger>
        <Portal><PopoverContent aria-label="动态" width="min(384px, calc(100vw - 24px))" height="320px" borderRadius="12px" boxShadow="lg">
          <Text px={4} py={3} fontWeight="600">动态</Text>
          <Flex flex="1" direction="column" align="center" justify="center" px={8} pb={8} textAlign="center" gap={2}>
            <Bell size={22} aria-hidden="true" />
            <Heading as="h2" size="sm">暂无通知</Heading>
            <Text fontSize="sm" color="gray.600">有人提及你、在你的页面上发表评论，或回复你参与的对话时，你会收到通知。</Text>
          </Flex>
        </PopoverContent></Portal>
      </Popover>
      <IconButton size="xs" variant="ghost" aria-label="搜索" icon={<Search size={15}/>} onClick={onSearch}/>
      <IconButton size="xs" variant="ghost" aria-label="显示/隐藏侧边栏" icon={<PanelLeftClose size={15}/>} onClick={onCollapse}/>
    </Flex>
    {createMenu}
    {categories.map(({name, icon: Icon}) => <Button key={name} variant="ghost" justifyContent="start" size="sm" fontWeight="normal"
      bg={section === name ? "#eee" : undefined} leftIcon={<Icon size={16}/>} onClick={() => onSection(name)}>{name}</Button>)}
    <Box overflowY="auto" mt={5} flex="1">
      <Button variant="ghost" size="sm" color="gray.500" aria-expanded={recent} onClick={() => setRecent(!recent)}>最近</Button>
      {recent && items.slice(0,expanded ? undefined : 5).map(file => <Button key={file.id} variant="ghost" size="sm" w="full"
        justifyContent="start" fontWeight="normal" onClick={() => onFile(file)} leftIcon={<LibraryItemIcon item={file} compact/>}><Text isTruncated>{file.name}</Text></Button>)}
      {recent && items.length > 5 && <Button variant="ghost" size="sm" onClick={() => setExpanded(!expanded)}>{expanded ? "收起" : "展开显示"}</Button>}
      <Flex mt={5} align="center" justify="space-between"><Button size="sm" variant="ghost" color="gray.500" aria-expanded={spaces} onClick={() => setSpaces(!spaces)}>资料空间</Button>
        <IconButton size="xs" variant="ghost" aria-label="创建资料空间" icon={<Plus size={14}/>} onClick={onNewSpace}/></Flex>
      {spaces && items.filter(item => item.kind === "资料空间").map(item => <Button key={item.id} size="sm" variant="ghost" w="full" justifyContent="start"
        leftIcon={<Layers size={15}/>} onClick={() => onFile(item)}>{item.name}</Button>)}
    </Box>
    <Button variant="ghost" justifyContent="start" size="sm" leftIcon={<Trash2 size={16}/>} onClick={() => onSection("回收站")}>回收站</Button>
  </Flex>;
}

import { useId, useRef, useState } from "react";
import { Box, Button, Flex, Input, Modal, ModalBody, ModalCloseButton, ModalContent, ModalOverlay, Text } from "@chakra-ui/react";
import LibraryItemIcon from "./LibraryItemIcon";
import { Folder, MessageSquare, Search } from "lucide-react";
import { matchesExportedPageName, type LibraryFile } from "@/types/library";
import type { ProjectWithConversations } from "../AgentWorkspace";

type Props = {
  projects: ProjectWithConversations[];
  files: LibraryFile[];
  onProject: (token: string) => void;
  onChat: (token: string, id: string) => void;
  onFile: (item: LibraryFile) => void;
  close: () => void;
};

export default function LibraryGlobalSearch({projects, files, onProject, onChat, onFile, close}: Props) {
  const [query, setQuery] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [activeId,setActiveId] = useState("");
  const needle = query.trim().normalize("NFC").toLowerCase();
  const matches = (name: string) => name.normalize("NFC").toLowerCase().includes(needle);
  const chats = projects.flatMap(project => project.conversations.map(chat => ({
    id: JSON.stringify([project.token,chat.id]), time:chat.updatedAt, label: chat.title, icon:<MessageSquare size={16} aria-hidden/>, open: () => onChat(project.token, chat.id)
  }))).filter(chat => matches(chat.label));
  const items = files.filter(file => !file.deleted && (matchesExportedPageName(file, needle) ||
    [file.name,file.path,file.conversation,file.project].some(matches))).map(file => ({
    id: file.id, time:file.openedAt, label: file.name, icon:<LibraryItemIcon item={file} compact/>, source: file.conversation || file.project, open: () => onFile(file)
  }));
  const groups = [
    {title: needle ? "资料空间" : "最近打开", rows: needle ? items : items.filter(item => item.time).sort((a,b) => (b.time || "").localeCompare(a.time || "")).slice(0, 5)},
    {title: needle ? "聊天" : "最近聊天", rows: needle ? chats : chats.sort((a,b) => (b.time || "").localeCompare(a.time || "")).slice(0, 5)},
    {title: "项目", rows: needle ? projects.filter(project => matches(project.name)).map(project => ({
      id: project.token, label: project.name, icon:<Folder size={16} aria-hidden/>, open: () => onProject(project.token)
    })) : []}
  ];
  const options = groups.flatMap(group => group.rows.map(row => ({...row, optionId: listId + group.title + row.id})));
  const activeIndex = options.findIndex(option => option.optionId === activeId);
  return <Modal isOpen onClose={close} initialFocusRef={input} size="xl" scrollBehavior="inside">
    <ModalOverlay/><ModalContent aria-label="全局搜索" borderRadius="20px" maxH="75vh">
      <Flex align="center" px={4} py={3} pr={12} gap={3} borderBottom="1px solid #eee">
        <Search size={18}/><Input ref={input} aria-label="搜索" placeholder="搜索你的聊天、项目、图像、文档和资料空间" variant="unstyled"
          role="combobox" aria-expanded aria-autocomplete="list" aria-controls={listId}
          aria-activedescendant={activeIndex >= 0 ? activeId : undefined}
          value={query} onChange={event => {setQuery(event.target.value); setActiveId("");}}
          onKeyDown={event => {
            if (event.nativeEvent.isComposing || !options.length) return;
            if (event.key === "Enter" && activeIndex >= 0) {
              event.preventDefault();
              close();
              options[activeIndex].open();
            }
            if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
            event.preventDefault();
            const next = event.key === "ArrowDown" ? (activeIndex + 1) % options.length :
              (activeIndex <= 0 ? options.length - 1 : activeIndex - 1);
            setActiveId(options[next].optionId);
            document.getElementById(options[next].optionId)?.scrollIntoView({block:"nearest"});
          }}/>
      </Flex>
      <ModalCloseButton aria-label="关闭全局搜索"/>
      <ModalBody py={3} id={listId} role="listbox" aria-label="搜索结果">
        {groups.map(group => group.rows.length > 0 && <Box key={group.title} role="group" aria-label={group.title} mb={3}>
          <Text fontSize="xs" fontWeight="600" color="gray.600" mb={1}>{group.title}</Text>
          {group.rows.map(row => <Button key={row.id} id={listId + group.title + row.id} role="option" tabIndex={-1} aria-selected={activeId === listId + group.title + row.id}
            bg={activeId === listId + group.title + row.id ? "gray.100" : undefined} size="sm" variant="ghost" w="full" justifyContent="start"
            leftIcon={row.icon} onClick={() => { close(); row.open(); }}><Text isTruncated title={row.label}>{row.label}</Text>
              {"source" in row && typeof row.source === "string" && row.source && <Text ml={2} minW={0} isTruncated fontSize="xs" color="gray.600" fontWeight="normal">{row.source}</Text>}
            </Button>)}
        </Box>)}
        {groups.every(group => !group.rows.length) && <Text py={5} textAlign="center">没有找到结果</Text>}
      </ModalBody>
    </ModalContent>
  </Modal>;
}

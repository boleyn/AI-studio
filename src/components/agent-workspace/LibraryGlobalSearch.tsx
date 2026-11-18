import { useRef, useState } from "react";
import { Box, Button, Flex, Input, Modal, ModalBody, ModalCloseButton, ModalContent, ModalOverlay, Text } from "@chakra-ui/react";
import { Search } from "lucide-react";
import type { LibraryFile } from "@/types/library";
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
  const needle = query.trim().toLocaleLowerCase();
  const matches = (name: string) => name.toLocaleLowerCase().includes(needle);
  const chats = projects.flatMap(project => project.conversations.map(chat => ({
    id: chat.id, time:chat.updatedAt, label: chat.title, open: () => onChat(project.token, chat.id)
  }))).filter(chat => matches(chat.label));
  const items = files.filter(file => !file.deleted && matches(file.name)).map(file => ({
    id: file.id, time:file.openedAt, label: file.name, open: () => onFile(file)
  }));
  const groups = [
    {title: needle ? "资料空间" : "最近打开", rows: needle ? items : items.filter(item => item.time).sort((a,b) => (b.time || "").localeCompare(a.time || "")).slice(0, 5)},
    {title: needle ? "聊天" : "最近聊天", rows: needle ? chats : chats.sort((a,b) => (b.time || "").localeCompare(a.time || "")).slice(0, 5)},
    {title: "项目", rows: needle ? projects.filter(project => matches(project.name)).map(project => ({
      id: project.token, label: project.name, open: () => onProject(project.token)
    })) : []}
  ];
  return <Modal isOpen onClose={close} initialFocusRef={input} size="xl" scrollBehavior="inside">
    <ModalOverlay/><ModalContent aria-label="全局搜索" borderRadius="20px" maxH="75vh">
      <Flex align="center" px={4} py={3} pr={12} gap={3} borderBottom="1px solid #eee">
        <Search size={18}/><Input ref={input} aria-label="搜索" placeholder="搜索你的聊天、项目、图像、文档和资料空间" variant="unstyled"
          value={query} onChange={event => setQuery(event.target.value)}/>
      </Flex>
      <ModalCloseButton aria-label="关闭全局搜索"/>
      <ModalBody py={3}>
        {groups.map(group => group.rows.length > 0 && <Box key={group.title} mb={3}>
          <Text fontSize="xs" fontWeight="600" color="gray.600" mb={1}>{group.title}</Text>
          {group.rows.map(row => <Button key={row.id} size="sm" variant="ghost" w="full" justifyContent="start"
            onClick={() => { close(); row.open(); }}><Text isTruncated>{row.label}</Text></Button>)}
        </Box>)}
        {groups.every(group => !group.rows.length) && <Text py={5} textAlign="center">没有找到结果</Text>}
      </ModalBody>
    </ModalContent>
  </Modal>;
}

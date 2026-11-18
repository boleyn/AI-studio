import { useState } from "react";
import { Modal, ModalBody, ModalCloseButton, ModalContent, ModalHeader, ModalOverlay, Input, SimpleGrid, Box, Button, Flex, Heading, IconButton, Text } from "@chakra-ui/react";
import { BookOpen, Calendar, ClipboardList, Plane, Search, Target, Wallet, X } from "lucide-react";

export const templates = [
  { name:"页面使用指南", body:"欢迎使用页面\n\n在这里写作、整理资料，并与团队协作。\n\n开始使用\n添加标题、清单和笔记。", icon:BookOpen, color:"#008cff" },
  { name:"待办事项清单", body:"今天\n\n首要任务\n☐ 确定今天的工作重点\n☐ 整理待办事项\n\n本周\n☐ 回顾进展", icon:ClipboardList, color:"#14b95d" },
  { name:"项目跟踪表", body:"🔴 需要立即处理\n\n• 确认项目负责人\n• 跟进当前风险\n\n⛰️ 里程碑\n\n下一阶段", icon:Target, color:"#168cff" },
  { name:"Trip planner", body:"Travelers: Maya and Sam\nPace: One main activity a day\n\n🧭 The plan\n\nPlan two nights near a mountain observatory.", icon:Plane, color:"#168cff" },
  { name:"Weekly planner", body:"🎯 Priorities\n\n☐ Confirm plans\n☐ Review progress\n\n📅 Schedule", icon:Calendar, color:"#d26e69" },
  { name:"Budget tracker", body:"Monthly budget\n\nIncome\n\nExpenses\n\nSavings goals", icon:Wallet, color:"#1a995e" },
];
export default function LibraryTemplates({ onPick, onClose }: {onPick:(name:string, body:string)=>void; onClose:()=>void}) {
  return <Box as="section" mb="40px" role="group">
    <Flex align="center" justify="space-between"><Heading fontWeight="400" fontSize="16px" lineHeight="24px">在资料空间中共同创建</Heading>
      <IconButton opacity={{base:1,md:0}} _groupHover={{opacity:1}} _focusVisible={{opacity:1}} aria-label="关闭“在资料空间中共同创建”" size="xs" variant="ghost" icon={<X size={14}/>} onClick={onClose}/></Flex>
    <Text color="gray.500" fontSize="sm" mt="2px" lineHeight="20px" mb="12px">选择一个模板，与 ChatGPT 和你的团队开始协作</Text>
    <Box display="grid" gridAutoFlow="column" gridAutoColumns="max(144px, calc(23.0769% - 18.4615px))" gap="16px" overflowX="auto" sx={{scrollbarWidth:"none"}}>{templates.map(({name,body,icon:Icon,color},i) =>
      <Button key={name} aria-label={name} variant="unstyled" display="block" height="auto" minW={0} w="full" pb="8px" whiteSpace="normal" onClick={() => onPick(name,body)}>
        <Box bg="#f5f5f5" border="1px solid #e9e9e9" borderRadius="12px" aspectRatio="16 / 9" px={6} pt={5} overflow="hidden">
          <Box bg="white" p={4} textAlign="left" minH="135px"><Icon size={15} color={color}/>
            <Text mt={3} fontSize="7px" lineHeight="1.35" whiteSpace="pre-line">{body}</Text></Box>
        </Box><Text mt="10px" lineHeight="20px" fontWeight="500" fontSize="sm">{name}</Text><Text lineHeight="18px" fontSize="xs" fontWeight="400" color="gray.500">{i === 0 ? "从这里开始" : "Page"}</Text>
      </Button>)}</Box>
  </Box>;
}

export function TemplateGallery({ onClose, onPick, triggerRef }: {
  triggerRef: React.RefObject<HTMLButtonElement>;
  onClose: () => void;
  onPick: (name: string, body: string) => void;
}) {
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("为你推荐");
  const pages = templates.slice(1).filter(template =>
    template.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
  );

  return <Modal finalFocusRef={triggerRef} isOpen isCentered onClose={onClose} size="full" scrollBehavior="inside">
    <ModalOverlay />
    <ModalContent maxW="min(960px, calc(100vw - 32px))" h="min(740px, calc(100dvh - 32px))" minH={0} borderRadius="20px">
      <ModalHeader>Templates</ModalHeader>
      <ModalCloseButton aria-label="关闭对话框" />
      <Flex px={6} pb={4} gap={2} align="center">
        {["为你推荐", "页面"].map(label =>
          <Button key={label} size="sm" borderRadius="full" aria-pressed={category === label}
            variant={category === label ? "solid" : "ghost"} onClick={() => setCategory(label)}>{label}</Button>
        )}
        <Box flex={1} />
        {searching && <Input autoFocus aria-label="搜索模板" size="sm" w="min(200px, 30vw)" placeholder="搜索模板"
          value={query} onChange={event => setQuery(event.target.value)} />}
        <IconButton size="sm" variant="ghost" aria-label="搜索" aria-expanded={searching} icon={<Search size={18} />}
          onClick={() => { setSearching(!searching); setQuery(""); }} />
      </Flex>
      <ModalBody>
        <SimpleGrid columns={{base:2, md:4}} gap={4}>
          {pages.map(({name, body, icon: Icon, color}) =>
            <Button key={name} aria-label={name} variant="unstyled" display="block" h="auto" minW={0} whiteSpace="normal"
              textAlign="left" onClick={() => onPick(name, body)}>
              <Box bg="#f5f5f5" p={3} pb={0} borderRadius="12px" aspectRatio="16/10" overflow="hidden">
                <Box bg="white" p={3} h="full"><Icon size={16} color={color} />
                  <Text whiteSpace="pre-line" mt={2} fontSize="8px">{body}</Text></Box>
              </Box>
              <Text mt={2} fontSize="sm">{name}</Text><Text fontSize="xs" color="gray.500">Page</Text>
            </Button>
          )}
        </SimpleGrid>
        {!pages.length && <Text textAlign="center" color="gray.500" py={8}>没有找到模板</Text>}
      </ModalBody>
    </ModalContent>
  </Modal>;
}

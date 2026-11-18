import { Fragment, useState } from "react";
import { Menu, MenuButton, MenuItem, MenuList, Modal, ModalBody, ModalCloseButton, ModalContent, ModalHeader, ModalOverlay, Input, SimpleGrid, Box, Button, Flex, Heading, IconButton, Text } from "@chakra-ui/react";
import { BookOpen, Calendar, ClipboardList, Plane, MoreHorizontal, Search, Target, Wallet, X } from "lucide-react";

export const templates = [
  { name:"页面使用指南", body:"欢迎使用页面\n\n在这里写作、整理资料，并与团队协作。\n\n开始使用\n添加标题、清单和笔记。", icon:BookOpen, color:"#008cff" },
  { name:"待办事项清单", body:"今天\n\n首要任务\n☐ 确定今天的工作重点\n☐ 整理待办事项\n\n本周\n☐ 回顾进展", icon:ClipboardList, color:"#14b95d" },
  { name:"项目跟踪表", body:"🔴 需要立即处理\n\n• 确认项目负责人\n• 跟进当前风险\n\n⛰️ 里程碑\n\n下一阶段", icon:Target, color:"#168cff" },
  { name:"Trip planner", body:"Travelers: Maya and Sam\nPace: One main activity a day\n\n🧭 The plan\n\nPlan two nights near a mountain observatory.", icon:Plane, color:"#168cff" },
  { name:"Weekly planner", body:"🎯 Priorities\n\n☐ Confirm plans\n☐ Review progress\n\n📅 Schedule", icon:Calendar, color:"#d26e69" },
  { name:"Budget tracker", body:"Monthly budget\n\nIncome\n\nExpenses\n\nSavings goals", icon:Wallet, color:"#1a995e" },
  { name:"Apartment hunter", body:"Apartment shortlist\n\nAddress and neighborhood\nMonthly rent and utilities\nViewing date\n\nQuestions for the landlord", icon:ClipboardList, color:"#168cff" },
  { name:"Personal goals", body:"My goals\n\nGoal\nWhy it matters\nNext step\n\nWeekly reflection", icon:Target, color:"#14b95d" },
  { name:"周报", body:"本周进展\n\n已完成的工作\n\n风险与阻碍\n\n下周计划", icon:Calendar, color:"#168cff" },
  { name:"反馈跟踪表", body:"待处理反馈\n\n反馈内容\n来源\n负责人\n处理状态\n\n后续跟进", icon:ClipboardList, color:"#14b95d" },
  { name:"更新日志", body:"版本与日期\n\n新增功能\n\n改进\n\n问题修复", icon:BookOpen, color:"#168cff" },
  { name:"Feature backlog", body:"Feature requests\n\nUser need\nPriority\nOwner\n\nNext steps", icon:ClipboardList, color:"#168cff" },
  { name:"Learning plan", body:"Learning objective\n\nTopics to explore\nResources\nPractice activities\n\nProgress review", icon:BookOpen, color:"#14b95d" },
  { name:"Event Plan", body:"Event overview\n\nDate and venue\nGuests\nAgenda\n\nPreparation checklist", icon:Calendar, color:"#d26e69" },
];
export default function LibraryTemplates({ collection, onPick, onClose, onStrategy }: {collection:"页面"|"幻灯片"|"全部"; onStrategy:()=>void; onPick:(name:string, body:string)=>void; onClose:()=>void}) {
  const strategyCard = <Button aria-label="Product Strategy" variant="unstyled" h="auto" minW={0} pb="8px" onClick={onStrategy}>
    <Box as="img" src="/library-templates/product-strategy-cover.png" alt="" draggable={false} w="full"
      aspectRatio="16/9" objectFit="cover" borderRadius="12px" border="1px solid #e9e9e9"/>
    <Text mt="10px" lineHeight="20px" fontSize="sm" fontWeight="400">Product Strategy</Text>
    <Text fontSize="xs" fontWeight="400" color="gray.500">幻灯片</Text>
  </Button>;
  return <Box as="section" mb="40px" role="group">
    <Flex align="center" justify="space-between"><Heading fontWeight="400" fontSize="16px" lineHeight="24px">在资料空间中共同创建</Heading>
      <IconButton opacity={{base:1,md:0}} _groupHover={{opacity:1}} _focusVisible={{opacity:1}} aria-label="关闭“在资料空间中共同创建”" size="xs" variant="ghost" icon={<X size={14}/>} onClick={onClose}/></Flex>
    <Text color="gray.500" fontSize="sm" mt="2px" lineHeight="20px" mb="12px">选择一个模板，与 ChatGPT 和你的团队开始协作</Text>
    <Box display="grid" gridAutoFlow="column" gridAutoColumns="max(144px, calc(23.0769% - 18.4615px))" gap="16px" overflowX="auto" sx={{scrollbarWidth:"none",overscrollBehaviorX:"contain"}}>{collection === "幻灯片" ? strategyCard : templates.map(({name,body,icon:Icon,color},i) =>
      <Fragment key={name}>
      {i === 3 && collection === "全部" && strategyCard}
      <Button aria-label={name} variant="unstyled" display="block" height="auto" minW={0} w="full" pb="8px" whiteSpace="normal" onClick={() => onPick(name,body)}>
        <Box bg="#f5f5f5" border="1px solid #e9e9e9" borderRadius="12px" aspectRatio="16 / 9" px={6} pt={5} overflow="hidden">
          <Box bg="white" p={4} textAlign="left" minH="135px"><Icon size={15} color={color}/>
            <Text mt={3} fontSize="7px" lineHeight="1.35" whiteSpace="pre-line">{body}</Text></Box>
        </Box><Text mt="10px" lineHeight="20px" fontWeight="500" fontSize="sm">{name}</Text><Text lineHeight="18px" fontSize="xs" fontWeight="400" color="gray.500">{i === 0 ? "从这里开始" : "Page"}</Text>
      </Button></Fragment>)}</Box>
  </Box>;
}

const workbookTemplates = [
  {name: "Analytics Dashboard", columns: ["Metric", "Period", "Actual", "Target", "Variance"], formula: "C2-D2"},
  {name: "Financial Budget", columns: ["Category", "Month", "Budget", "Actual", "Remaining"], formula: "C2-D2"},
  {name: "Operating Calendar", columns: ["Date", "Activity", "Owner", "Status"]},
  {name: "Project Tracker", columns: ["Task", "Owner", "Due date", "Status"]},
  {name: "Sales Pipeline", columns: ["Opportunity", "Stage", "Value", "Probability", "Weighted value"], formula: "C2*D2"},
  {name: "Three-Statement Forecast", columns: ["Period", "Revenue", "Expenses", "Net income"], formula: "B2-C2"},
];

function TemplateActions({label, onUse}: {label:string; onUse:()=>void}) {
  return <Menu>
  <MenuButton as={IconButton} aria-label={label} icon={<MoreHorizontal size={16} />}
    size="xs" position="absolute" top={2} right={2} borderRadius="full" bg="white"
    opacity={{base:1, md:0}} _groupHover={{opacity:1}} _focusVisible={{opacity:1}} _expanded={{opacity:1}} />
  <MenuList><MenuItem onClick={onUse}>Use template</MenuItem></MenuList>
</Menu>;
}

export function TemplateGallery({ onClose, onPick, triggerRef, onWorkbook, onUpload, onSlides }: {
  onSlides: () => void;
  onUpload: () => void;
  onWorkbook: (file: File) => void;
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

  const workbooks = workbookTemplates.filter(template =>
    template.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
  );
  async function createWorkbook(template: typeof workbookTemplates[number]) {
    const XLSX = await import("xlsx");
    const sheet = XLSX.utils.aoa_to_sheet([template.columns]);
    if (template.formula) {
      XLSX.utils.sheet_add_aoa(sheet, [[{t:"n", f:template.formula}]], {
        origin: {r:1, c:template.columns.length - 1}
      });
    }
    sheet["!cols"] = template.columns.map(() => ({wch:20}));
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, template.name);
    onWorkbook(new File([XLSX.write(book, {type:"array",bookType:"xlsx"})], template.name + ".xlsx",
      {type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}));
  }

  return <Modal finalFocusRef={triggerRef} isOpen isCentered onClose={onClose} size="full" scrollBehavior="inside">
    <ModalOverlay />
    <ModalContent maxW="min(960px, calc(100vw - 32px))" h="min(740px, calc(100dvh - 32px))" minH={0} borderRadius="20px">
      <ModalHeader>Templates</ModalHeader>
      <ModalCloseButton aria-label="关闭对话框" />
      <Flex px={6} pb={4} gap={2} align="center">
        {["为你推荐", "页面", "电子表格"].map(label =>
          <Button key={label} size="sm" borderRadius="full" aria-pressed={category === label}
            variant={category === label ? "solid" : "ghost"} onClick={() => setCategory(label)}>{label}</Button>
        )}
        <Box flex={1} />
        {searching && <Input autoFocus aria-label="搜索模板" size="sm" w="min(200px, 30vw)" placeholder="搜索模板"
          value={query} onChange={event => setQuery(event.target.value)} />}
        <IconButton size="sm" variant="ghost" aria-label="搜索" aria-expanded={searching} icon={<Search size={18} />}
          onClick={() => { setSearching(!searching); setQuery(""); }} />
        <Menu>
          <MenuButton as={Button} size="sm" borderRadius="full">Template</MenuButton>
          <MenuList>
            <MenuItem onClick={() => onPick("无标题页", "")}>Page</MenuItem>
            <MenuItem onClick={onSlides}>Slides</MenuItem>
            <MenuItem onClick={onUpload}>上传文件</MenuItem>
          </MenuList>
        </Menu>
      </Flex>
      <ModalBody>
        <SimpleGrid columns={{base:2, md:4}} gap={4}>
          {category !== "电子表格" && pages.map(({name, body, icon: Icon, color}) =>
            <Box key={name} position="relative" role="group">
            <Button w="full" aria-label={name} variant="unstyled" display="block" h="auto" minW={0} whiteSpace="normal"
              textAlign="left" onClick={() => onPick(name, body)}>
              <Box bg="#f5f5f5" p={3} pb={0} borderRadius="12px" aspectRatio="16/10" overflow="hidden">
                <Box bg="white" p={3} h="full"><Icon size={16} color={color} />
                  <Text whiteSpace="pre-line" mt={2} fontSize="8px">{body}</Text></Box>
              </Box>
              <Text mt={2} fontSize="sm">{name}</Text><Text fontSize="xs" color="gray.500">Page</Text>
            </Button>
            <TemplateActions label={`Actions for ${name}`} onUse={() => onPick(name, body)} />
            </Box>
          )}
          {category !== "页面" && workbooks.map(template =>
            <Box key={template.name} position="relative" role="group">
            <Button w="full" aria-label={`Use ${template.name}`} variant="unstyled" height="auto"
              textAlign="left" whiteSpace="normal" onClick={() => createWorkbook(template)}>
              <Box p={3} bg="#f1f6f2" borderRadius="12px" aspectRatio="16/10" overflow="hidden">
                <Text bg="#21684c" color="white" p={2} fontSize="xs">{template.name}</Text>
                <Flex bg="white">{template.columns.map(column =>
                  <Text key={column} flex={1} p={1} fontSize="8px" border="1px solid #ddd">{column}</Text>)}</Flex>
              </Box>
              <Text mt={2} fontSize="sm">{template.name}</Text><Text color="gray.500" fontSize="xs">Sheets</Text>
            </Button>
            <TemplateActions label={`More actions for ${template.name}`} onUse={() => createWorkbook(template)} />
            </Box>)}
        </SimpleGrid>
        {(category === "电子表格" || !pages.length) && (category === "页面" || !workbooks.length) && <Text textAlign="center" color="gray.500" py={8}>没有找到模板</Text>}
      </ModalBody>
    </ModalContent>
  </Modal>;
}

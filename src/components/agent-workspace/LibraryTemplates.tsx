import { Fragment, useEffect, useRef, useState } from "react";
import { Menu, MenuButton, MenuItem, MenuList, Modal, ModalBody, ModalCloseButton, ModalContent, ModalHeader, ModalOverlay, Input, SimpleGrid, Box, Button, Flex, Heading, IconButton, Text } from "@chakra-ui/react";
import { BookOpen, ChartNoAxesColumn, GraduationCap, Calendar, ClipboardList, Plane, MoreHorizontal, Search, Target, Wallet, X } from "lucide-react";

function TemplatePreview({body}: {body: string}) {
  return <>{body.split("\n\n").map((paragraph,index) => <Text key={index} mb="4px" whiteSpace="pre-line"
                fontWeight={/^#{1,6} /.test(paragraph) ? "600" : "400"}>
                {paragraph.replace(/^#{1,6} /gm, "").replace(/^- \[ \] /gm, "☐ ").replace(/^- /gm, "• ")}
              </Text>)}</>;
}

export const templates = [
  { name:"页面使用指南", pageTitle:"页面入门指南", body:"在页面中，你可以写作、创作，并与团队协作。把这个页面当作你的练习场，学习基础操作。\n\n## 开始使用\n\n- [ ] 添加标题、图片、检查清单或表格。\n- [ ] 选中一段文字，在聊天中引用。", icon:GraduationCap, color:"#008cff" },
  { name:"待办事项清单", body:"## 今天\n\n### 首要任务\n\n- [ ] 进行推进系统测试\n- [ ] 验证航线计算结果\n- [ ] 检查燃料剂量\n\n## 本周\n\n- [ ] 回顾进展", icon:ClipboardList, color:"#14b95d" },
  { name:"项目跟踪表", body:"## 🔴 需要立即处理\n\n- 发布前通信系统测试\n\n## ⛰️ 里程碑\n\n下一阶段", icon:ChartNoAxesColumn, color:"#168cff" },
  { name:"Trip planner", body:"Travelers: Maya and Sam\nPace: One main activity a day\n\n🧭 The plan\n\nPlan two nights near a mountain observatory.", icon:Plane, color:"#168cff" },
  { name:"Weekly planner", body:"🎯 Priorities\n\n- [ ] Confirm plans\n- [ ] Review progress\n\n📅 Schedule", icon:Calendar, color:"#d26e69" },
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
const slideTemplates = [
  "Photography Portfolio",
  "Creative Campaign Brief",
  "Product Strategy",
  "Weekly Business Review",
  "Next Generation OS",
  "Brand Guidelines",
  "State of Art",
  "Growth Strategy",
  "Calder Architecture",
  "Annual Impact Report",
  "Product Pitch",
  "Business Review",
  "Market Trends Report",
  "Project Kickoff",
] as const;
const galleryCategories = ["为你推荐", "页面", "幻灯片", "电子表格", "图像"];
const imageTemplates = [
  {name: "海报", cover: "poster"},
  {name: "室内设计", cover: "interior-design"},
  {name: "徽标", cover: "logo"},
  {name: "插画", cover: "illustration"},
  {name: "职业形象照", cover: "headshot"},
  {name: "图标", cover: "icon"},
  {name: "产品照", cover: "product-photo"},
  {name: "周边商品", cover: "merch"},
  {name: "信息图", cover: "infographic"},
  {name: "宣传单", cover: "flyer"},
  {name: "书籍封面", cover: "book-cover"},
  {name: "应用效果图", cover: "app-mockup"},
  {name: "包装", cover: "packaging"},
  {name: "广告", cover: "advertisement"},
  {name: "缩略图", cover: "thumbnail"},
  {name: "网站效果图", cover: "website-mockup"},
];
export type SlideTemplateName = typeof slideTemplates[number];

export default function LibraryTemplates({ collection, onPick, onClose, onSlides }: {collection:"页面"|"幻灯片"|"全部"; onSlides:(name:SlideTemplateName)=>void; onPick:(name:string, body:string)=>void; onClose:()=>void}) {
  const strip = useRef<HTMLDivElement>(null);
  const [moreTemplates,setMoreTemplates] = useState(false);
  useEffect(()=>{
    const element = strip.current;
    const lastCard = element?.lastElementChild;
    if (!element || !lastCard) return;
    const observer = new IntersectionObserver(([entry])=>setMoreTemplates(entry.intersectionRatio < 0.99),
      {root:element,threshold:0.99});
    observer.observe(lastCard);
    return ()=>observer.disconnect();
  },[collection]);
  const pageTemplates = collection === "页面" ? templates.slice(1) : templates.slice(0, 8);
  const slideCard = (name:SlideTemplateName) => <Button key={name} aria-label={name} variant="unstyled" display="block" w="full" h="auto" minW={0} pb="8px" whiteSpace="normal" onClick={() => onSlides(name)}>
    <Box as="img" src={`/library-templates/${name.toLowerCase().replaceAll(" ", "-")}-cover.png`} alt="" draggable={false} w="full"
      aspectRatio="16/9" objectFit="cover" borderRadius="12px" border="1px solid #e9e9e9"/>
    <Text mt="10px" lineHeight="20px" fontSize="sm" fontWeight="400">{name}</Text>
    <Text lineHeight="18px" fontSize="12px" fontWeight="400" color="#8f8f8f">幻灯片</Text>
  </Button>;
  return <Box as="section" mb="40px" role="group">
    <Flex align="center" gap="6px"><Heading fontWeight="400" fontSize="16px" lineHeight="24px">在资料空间中共同创建</Heading>
      <IconButton opacity={{base:1,md:0}} _groupHover={{opacity:1}} _focusVisible={{opacity:1}} aria-label="关闭“在资料空间中共同创建”" size="xs" boxSize="20px" minW="20px" borderRadius={0} color="#8f8f8f" variant="ghost" icon={<X size={14}/>} onClick={onClose}/></Flex>
    <Text color="#8f8f8f" fontSize="sm" mt="2px" lineHeight="20px" mb="12px">选择一个模板，与 ChatGPT 和你的团队开始协作</Text>
    <Box ref={strip} display="grid" gridAutoFlow="column" gridAutoColumns="max(144px, calc(23.0769% - 18.4615px))" gap="16px" overflowX="auto" sx={{scrollbarWidth:"none",overscrollBehaviorX:"contain",maskImage:moreTemplates ? "linear-gradient(to right, black calc(100% - 24px), transparent)" : undefined}}>{collection === "幻灯片" ? slideTemplates.map(slideCard) : pageTemplates.map(({name,pageTitle,body,icon:Icon,color},i) =>
      <Fragment key={name}>
      {i === 3 && collection === "全部" && slideCard("Photography Portfolio")}
      <Button aria-label={name} variant="unstyled" display="block" height="auto" minW={0} w="full" pb="8px" whiteSpace="normal" onClick={() => onPick(pageTitle ?? name,body)}>
        <Box bg="#f5f5f5" border="1px solid #e9e9e9" borderRadius="12px" aspectRatio="16 / 9" px={6} pt={5} overflow="hidden">
          <Box bg="white" borderRadius="4px" p={4} textAlign="left" minH="135px"><Icon size={23} color={color}/>
            <Box mt="15px" fontSize="7px" lineHeight="1.35" aria-hidden="true">
              <TemplatePreview body={body} />
            </Box></Box>
        </Box><Text mt="10px" lineHeight="20px" fontWeight="500" fontSize="sm">{name}</Text><Text lineHeight="18px" fontSize="12px" fontWeight="400" color="#8f8f8f">{pageTitle ? "从这里开始" : "Page"}</Text>
      </Button>
      {collection === "全部" && i === pageTemplates.length - 1 && slideCard("Creative Campaign Brief")}
      </Fragment>)}</Box>
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

export function TemplateGallery({ onClose, onPick, triggerRef, onWorkbook, onUpload, onSlides, onImage }: {
  onSlides: (name?: SlideTemplateName) => void;
  onImage: (name: string) => void;
  onUpload: () => void;
  onWorkbook: (file: File) => void;
  triggerRef: React.RefObject<HTMLButtonElement>;
  onClose: () => void;
  onPick: (name: string, body: string) => void;
}) {
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [building,setBuilding] = useState<string>();
  const [buildError,setBuildError] = useState("");
  const firstCategory = useRef<HTMLButtonElement>(null);
  const [category, setCategory] = useState(galleryCategories[0]);
  const pages = templates.slice(1).filter(template =>
    template.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
  );

  const workbooks = workbookTemplates.filter(template =>
    template.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
  );
  const matches = (name: string) => name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  const slides = slideTemplates.filter(matches);
  const images = imageTemplates.filter(({name}) => matches(name));
  const shows = (kind: string) => category === "为你推荐" || category === kind;
  async function createWorkbook(template: typeof workbookTemplates[number]) {
    if (building) return;
    setBuilding(template.name);
    setBuildError("");
    try {
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
    } catch {
      setBuildError(`无法创建“${template.name}”，请重试。`);
    } finally {
      setBuilding(undefined);
    }
  }

  return <Modal initialFocusRef={firstCategory} finalFocusRef={triggerRef} isOpen isCentered onClose={onClose} size="full" scrollBehavior="inside">
    <ModalOverlay />
    <ModalContent maxW="min(960px, calc(100vw - 32px))" h="min(740px, calc(100dvh - 32px))" minH={0} borderRadius="16px">
      <ModalHeader>Templates</ModalHeader>
      <ModalCloseButton aria-label="关闭对话框" />
      <Flex px={6} pb={4} gap={2} align="center" wrap="wrap">
        <Flex role="tablist" aria-label="模板分类" gap={2} maxW="full" overflowX="auto">
          {galleryCategories.map((label, index) =>
            <Button key={label} ref={index === 0 ? firstCategory : undefined} id={`gallery-tab-${index}`}
              role="tab" aria-selected={category === label} aria-controls="gallery-results"
              tabIndex={category === label ? 0 : -1} size="sm" h="38px" px="16px" py="9px" borderRadius="full" flexShrink={0}
              variant={category === label ? "solid" : "ghost"} onClick={() => setCategory(label)}
              onKeyDown={event => {
                const count = galleryCategories.length;
                const targets: Record<string, number> = {
                  ArrowRight: (index + 1) % count, ArrowLeft: (index + count - 1) % count,
                  Home: 0, End: count - 1
                };
                const next = targets[event.key];
                if (next === undefined) return;
                event.preventDefault();
                setCategory(galleryCategories[next]);
                document.getElementById(`gallery-tab-${next}`)?.focus();
              }}>{label}</Button>
          )}
        </Flex>
        <Box flex={1} />
        {searching && <Input autoFocus aria-label="搜索模板" size="sm" w="min(200px, 30vw)" placeholder="搜索模板"
          value={query} onChange={event => setQuery(event.target.value)} />}
        <IconButton size="sm" variant="ghost" aria-label="搜索" aria-expanded={searching} icon={<Search size={18} />}
          onClick={() => { setSearching(!searching); setQuery(""); }} />
        <Menu>
          <MenuButton as={Button} size="sm" borderRadius="full">Template</MenuButton>
          <MenuList>
            <MenuItem onClick={() => onPick("无标题页", "")}>Page</MenuItem>
            <MenuItem onClick={() => onSlides()}>Slides</MenuItem>
            <MenuItem onClick={onUpload}>上传文件</MenuItem>
          </MenuList>
        </Menu>
      </Flex>
      <ModalBody px={{base:4, md:8}} id="gallery-results" role="tabpanel" aria-labelledby={`gallery-tab-${galleryCategories.indexOf(category)}`} tabIndex={0}>
        {buildError && <Text role="alert" fontSize="sm" mb={3} color="red.700">{buildError}</Text>}
        <SimpleGrid columns={{base:2, md:3}} columnGap={{base:3, md:6}} rowGap={{base:6, md:10}}>
          {shows("页面") && pages.map(({name, pageTitle, body, icon: Icon, color}) =>
            <Box key={name} position="relative" role="group">
            <Button w="full" aria-label={name} variant="unstyled" display="block" h="auto" minW={0} whiteSpace="normal"
              textAlign="left" onClick={() => onPick(pageTitle ?? name, body)}>
              <Box bg="#f5f5f5" p={3} pb={0} borderRadius="12px" aspectRatio="16/10" overflow="hidden">
                <Box bg="white" p={3} h="full"><Icon size={16} color={color} />
                  <Box mt={2} fontSize="8px" aria-hidden="true"><TemplatePreview body={body} /></Box></Box>
              </Box>
              <Text mt={2} fontSize="sm">{name}</Text><Text fontSize="xs" color="gray.500">Page</Text>
            </Button>
            <TemplateActions label={`Actions for ${name}`} onUse={() => onPick(pageTitle ?? name, body)} />
            </Box>
          )}
          {shows("电子表格") && workbooks.map(template =>
            <Box key={template.name} position="relative" role="group">
            <Button w="full" aria-label={`Use ${template.name}`} isLoading={building === template.name} isDisabled={Boolean(building)} variant="unstyled" height="auto"
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
          {shows("幻灯片") && slides.map(name =>
            <Button key={name} aria-label={name} variant="unstyled" h="auto" whiteSpace="normal" textAlign="left" onClick={() => onSlides(name)}>
              <Box as="img" src={`/library-templates/${name.toLowerCase().replaceAll(" ", "-")}-cover.png`} alt="" w="full" aspectRatio="16/10" objectFit="cover" borderRadius="12px" />
              <Text mt={2} fontSize="sm">{name}</Text><Text fontSize="xs" color="gray.500">Slides</Text>
            </Button>)}
          {shows("图像") && images.map(({name, cover}) =>
            <Button key={name} aria-label={name} variant="unstyled" h="auto" textAlign="left" onClick={() => onImage(name)}>
              <Flex aspectRatio="7/5" align="center" justify="center" bg="gray.50" borderRadius="24px">
                <Box as="img" src={`/library-templates/image-${cover}.webp`} alt="" loading="lazy" w="72%" h="72%" objectFit="contain" />
              </Flex>
              <Text mt={2} fontSize="sm">{name}</Text><Text fontSize="xs" color="gray.500">Image</Text>
            </Button>)}
        </SimpleGrid>
        {!(shows("页面") && pages.length || shows("幻灯片") && slides.length || shows("电子表格") && workbooks.length || shows("图像") && images.length) && <Text textAlign="center" color="gray.500" py={8}>没有找到模板</Text>}
      </ModalBody>
    </ModalContent>
  </Modal>;
}

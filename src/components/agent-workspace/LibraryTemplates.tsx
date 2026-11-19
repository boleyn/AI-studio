import { withAuthHeaders } from "@features/auth/client/authClient";
import { workbookTemplates } from "@/types/libraryWorkbookTemplates";
import { Fragment, useEffect, useRef, useState } from "react";
import { Menu, MenuButton, MenuItem, MenuList, Modal, ModalBody, ModalCloseButton, ModalContent, ModalHeader, ModalOverlay, Input, SimpleGrid, Box, Button, Flex, Heading, IconButton, Text } from "@chakra-ui/react";
import { FileText, Presentation, Upload, BookOpen, ChartNoAxesColumn, GraduationCap, Calendar, ClipboardList, Plane, Plus, MoreHorizontal, Search, Target, Wallet, X } from "lucide-react";

import LibraryMarkdown from "./LibraryMarkdown";

function TemplatePreview({body}: {body: string}) {
  return <>{body.split("\n\n").map((paragraph,index) => paragraph.startsWith("|")
    ? <LibraryMarkdown key={index}>{paragraph}</LibraryMarkdown>
    : <Text key={index} mb="4px" whiteSpace="pre-line"
                fontWeight={/^#{1,6} /.test(paragraph) ? "600" : "400"}>
                {paragraph.replace(/^#{1,6} /gm, "").replace(/^- \[ \] /gm, "☐ ").replace(/^- /gm, "• ")}
              </Text>)}</>;
}

export const templates = [
  { name:"页面使用指南", pageTitle:"页面入门指南", body:"试着把这页变成一份旅行计划，边写边熟悉资料空间。\n\n## 开始使用\n\n- [ ] 把页面标题改成目的地，在正文里写下出发日期。\n- [ ] 在桌面端点击「保存」，另起一行输入 /page 并按回车，创建一个记录住宿备选的子页面。\n- [ ] 用右上角的「分享」邀请同行的人查看行程。\n\n## 在聊天中使用页面\n\n另起一行输入 @ChatGPT 和你的问题，按回车即可带着页面内容打开聊天。也可以点击「在聊天中引用」。如果只想讨论某一天的安排，先选中那段文字，再点击「引用选中文字」。\n\n## 试着问问 ChatGPT\n\n- 根据这份行程，列出出发前需要确认的三件事。\n- 把每天的计划整理成表格，标出仍然缺少的信息。", icon:GraduationCap, color:"#008cff" },
  { name:"待办事项清单", body:"## 今天\n\n### 首要任务\n\n- [ ] 进行推进系统测试\n- [ ] 验证航线计算结果\n- [ ] 检查燃料箱\n\n### 如果时间允许\n\n- [ ] 检查辐射防护罩\n- [ ] 测试通信系统\n- [ ] 撰写状态报告", icon:ClipboardList, color:"#14b95d" },
  { name:"项目跟踪表", body:"## 🔴 需要立即处理\n\n- 发布前通信系统测试\n\n## ⛰️ 里程碑\n\n| 里程碑 | 状态 |\n| --- | --- |\n| ☐ 项目简介 | 已完成 |\n| ☐ 原型评审 | 处理中 |\n| ☐ 发布准备 | 即将开始 |", icon:ChartNoAxesColumn, color:"#168cff" },
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
  return <Box as="section" mb="40px" role="group" sx={{containerType:"inline-size"}}>
    <Flex align="center" gap="6px"><Heading fontWeight="400" fontSize="16px" lineHeight="24px">在资料空间中共同创建</Heading>
      <IconButton opacity={{base:1,md:0}} sx={{"@media (any-pointer:coarse), (hover:none)":{opacity:1}}} _groupHover={{opacity:1}} _focusVisible={{opacity:1}} aria-label="关闭“在资料空间中共同创建”" size="xs" boxSize="20px" minW="20px" borderRadius={0} color="#8f8f8f" variant="ghost" icon={<X size={14}/>} onClick={onClose}/></Flex>
    <Text color="#8f8f8f" fontSize="sm" mt="2px" lineHeight="20px" mb="12px">选择一个模板，与 ChatGPT 和你的团队开始协作</Text>
    <Box ref={strip} display="grid" gridAutoFlow="column" gridAutoColumns="max(9rem, calc((100% - 1rem) * 3 / 4))" marginInlineStart="-16px" paddingInline="16px" gap="16px" overflowX="auto" sx={{
      "@container (min-width: 32rem)": {gridAutoColumns:"max(9rem, calc((100% - 2rem) * 3 / 7))"},
      "@container (min-width: 48rem)": {gridAutoColumns:"max(9rem, calc((100% - 3rem) * 3 / 10))"},
      "@container (min-width: 64rem)": {gridAutoColumns:"max(9rem, calc((100% - 4rem) * 3 / 13))"},
      "@container (min-width: 80rem)": {gridAutoColumns:"max(9rem, calc((100% - 5rem) * 3 / 16))"},
      scrollbarWidth:"none",overscrollBehaviorX:"contain",maskImage:moreTemplates ? "linear-gradient(to right, black calc(100% - 24px), transparent)" : undefined}}>{collection === "幻灯片" ? slideTemplates.map(slideCard) : pageTemplates.map(({name,pageTitle,body,icon:Icon,color},i) =>
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

function TemplateActions({label, onUse, onEdit, onUninstall}: {label:string; onUse:()=>void; onEdit?:()=>void; onUninstall?:()=>void}) {
  return <Menu>
  <MenuButton as={IconButton} aria-label={label} icon={<MoreHorizontal size={16} />}
    size="xs" position="absolute" top={2} right={2} borderRadius="full" bg="white"
    opacity={{base:1,md:0}} sx={{"@media (any-pointer:coarse), (hover:none)":{opacity:1}}} _groupHover={{opacity:1}} _focusVisible={{opacity:1}} _expanded={{opacity:1}} />
  <MenuList><MenuItem onClick={onUse}>Use template</MenuItem>{onEdit && <MenuItem onClick={onEdit}>Edit</MenuItem>}{onUninstall && <MenuItem onClick={onUninstall}>Uninstall</MenuItem>}</MenuList>
</Menu>;
}

export function TemplateGallery({ onClose, onPick, triggerRef, onWorkbook, onEditWorkbook, onUpload, onSlides, onImage }: {
  onSlides: (name?: SlideTemplateName) => void;
  onImage: (name: string) => void;
  onUpload: () => void;
  onWorkbook: (file: File) => void;
  onEditWorkbook: (file: File, name: string) => Promise<void>;
  triggerRef: React.RefObject<HTMLButtonElement>;
  onClose: () => void;
  onPick: (name: string, body: string) => void;
}) {
  const searchTrigger = useRef<HTMLButtonElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [building,setBuilding] = useState<string>();
  const [buildError,setBuildError] = useState("");
  const firstCategory = useRef<HTMLButtonElement>(null);
  const [category, setCategory] = useState(galleryCategories[0]);
  function selectCategory(label: string) {
    setCategory(label);
    setQuery("");
    setSearching(false);
  }
  const pages = templates.slice(1).filter(template =>
    template.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
  );

  const [loadAttempt, setLoadAttempt] = useState(0);
  const [loadFailed, setLoadFailed] = useState(false);
  const [removed, setRemoved] = useState<string[] | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/library/templates", {signal:controller.signal, headers:withAuthHeaders()})
      .then(async response => {
        if (!response.ok) throw new Error();
        const names: string[] = await response.json();
        if (!controller.signal.aborted) setRemoved(current => [...new Set([...(current ?? []), ...names])]);
      }).catch(() => { if (!controller.signal.aborted) setLoadFailed(true); });
    return () => controller.abort();
  }, [loadAttempt]);
  async function uninstall(name: string) {
    try {
      const response = await fetch("/api/library/templates", {method:"DELETE", headers:withAuthHeaders({"Content-Type":"application/json"}), body:JSON.stringify({name})});
      if (!response.ok) throw new Error();
      setRemoved(current => [...new Set([...(current ?? []), name])]);
      setBuildError("");
    } catch { setBuildError(`无法卸载“${name}”，请重试。`); }
  }
  const workbooks = workbookTemplates.filter(template => removed !== null && !removed.includes(template.name) &&
    template.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
  );
  const matches = (name: string) => name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  const slides = slideTemplates.filter(matches);
  const images = imageTemplates.filter(({name}) => matches(name));
  const shows = (kind: string) => category === "为你推荐" || category === kind;
  async function createWorkbook(template: typeof workbookTemplates[number], edit = false) {
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
      const file = new File([XLSX.write(book, {type:"array",bookType:"xlsx"})], template.name + ".xlsx",
        {type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});
      if (edit) await onEditWorkbook(file, template.name);
      else onWorkbook(file);
    } catch {
      setBuildError(`无法创建“${template.name}”，请重试。`);
    } finally {
      setBuilding(undefined);
    }
  }

  const pageCards = shows("页面") ? pages.map(({name, pageTitle, body, icon: Icon, color}) =>
            <Box key={name} position="relative" role="group">
            <Button w="full" aria-label={name} variant="unstyled" display="block" h="auto" minW={0} whiteSpace="normal"
              textAlign="left" onClick={() => onPick(pageTitle ?? name, body)}>
              <Box bg="#f5f5f5" p={3} pb={0} borderRadius="24px" aspectRatio="7/5" overflow="hidden">
                <Box bg="white" p={3} h="full"><Icon size={16} color={color} />
                  <Box mt={2} fontSize="8px" aria-hidden="true">
                    <Text fontSize="12px" fontWeight="600" mb="4px">{pageTitle ?? name}</Text>
                    <TemplatePreview body={body} />
                  </Box></Box>
              </Box>
              <Text mt="12px" pb="8px" px="8px" fontSize="14px" lineHeight="20px" textAlign="center">{name}</Text>
            </Button>
            <TemplateActions label={`Actions for ${name}`} onUse={() => onPick(pageTitle ?? name, body)} />
            </Box>
          ) : [];
  const workbookCards = shows("电子表格") ? workbooks.map(template =>
            <Box key={template.name} position="relative" role="group">
            <Button w="full" aria-label={`Use ${template.name}`} isLoading={building === template.name} isDisabled={Boolean(building)} variant="unstyled" height="auto"
              textAlign="left" whiteSpace="normal" onClick={() => createWorkbook(template)}>
              <Box p={3} bg="#f1f6f2" borderRadius="24px" aspectRatio="7/5" overflow="hidden">
                <Text bg="#21684c" color="white" p={2} fontSize="xs">{template.name}</Text>
                <Flex bg="white">{template.columns.map(column =>
                  <Text key={column} flex={1} p={1} fontSize="8px" border="1px solid #ddd">{column}</Text>)}</Flex>
              </Box>
              <Text mt="12px" pb="8px" px="8px" fontSize="14px" lineHeight="20px" textAlign="center">{template.name}</Text>
            </Button>
            <TemplateActions label={`More actions for ${template.name}`} onUse={() => createWorkbook(template)} onEdit={() => createWorkbook(template, true)} onUninstall={() => uninstall(template.name)} />
            </Box>) : [];
  const slideCards = shows("幻灯片") ? slides.map(name =>
            <Box key={name} position="relative" role="group">
            <Button w="full" aria-label={name} variant="unstyled" h="auto" whiteSpace="normal" textAlign="left" onClick={() => onSlides(name)}>
              <Box as="img" src={`/library-templates/${name.toLowerCase().replaceAll(" ", "-")}-cover.png`} alt="" w="full" aspectRatio="7/5" objectFit="cover" borderRadius="24px" />
              <Text mt="12px" pb="8px" px="8px" fontSize="14px" lineHeight="20px" textAlign="center">{name}</Text>
            </Button>
            <TemplateActions label={`Actions for ${name}`} onUse={() => onSlides(name)} />
            </Box>) : [];
  const imageCards = shows("图像") ? images.map(({name, cover}) =>
            <Button key={name} aria-label={name} variant="unstyled" h="auto" textAlign="left" onClick={() => onImage(name)}>
              <Flex aspectRatio="7/5" px="11.3%" py="9.9%" align="center" justify="center" bg="gray.50" borderRadius="24px">
                <Box as="img" src={`/library-templates/image-${cover}.webp`} alt="" loading="lazy" draggable={false} maxW="100%" maxH="100%" borderRadius="8px" objectFit="contain" />
              </Flex>
              <Text mt="12px" pb="8px" px="8px" fontSize="14px" lineHeight="20px" textAlign="center">{name}</Text>
            </Button>) : [];
  const groups = [pageCards, slideCards, workbookCards, imageCards];
  const cards = Array.from({length: Math.max(...groups.map(group => group.length))},
    (_, index) => groups.flatMap(group => group[index] ? [group[index]] : [])).flat();

  return <Modal initialFocusRef={firstCategory} finalFocusRef={triggerRef} isOpen isCentered onClose={onClose} size="full" scrollBehavior="inside">
    <ModalOverlay />
    <ModalContent maxW="min(960px, calc(100vw - 32px))" h="min(740px, calc(100dvh - 32px))" minH={0} borderRadius="16px">
      <ModalHeader as="h2" fontSize="20px" lineHeight="28px" fontWeight="600" px={{base:4, md:"30px"}} pt="26px" pb={{base:4, md:6}}>Templates</ModalHeader>
      <ModalCloseButton aria-label="关闭对话框" />
      <Flex px={{base:4, md:"30px"}} pb={4} gap={2} align="center" wrap="wrap">
        <Flex role="tablist" aria-label="模板分类" gap={2} maxW="full" overflowX="auto">
          {galleryCategories.map((label, index) =>
            <Button key={label} ref={index === 0 ? firstCategory : undefined} id={`gallery-tab-${index}`}
              role="tab" aria-selected={category === label} aria-controls="gallery-results"
              tabIndex={category === label ? 0 : -1} size="sm" h="38px" px="16px" py="9px" borderRadius="full" flexShrink={0}
              variant={category === label ? "solid" : "ghost"} onClick={() => selectCategory(label)}
              onKeyDown={event => {
                const count = galleryCategories.length;
                const targets: Record<string, number> = {
                  ArrowRight: (index + 1) % count, ArrowLeft: (index + count - 1) % count,
                  Home: 0, End: count - 1
                };
                const next = targets[event.key];
                if (next === undefined) return;
                event.preventDefault();
                selectCategory(galleryCategories[next]);
                document.getElementById(`gallery-tab-${next}`)?.focus();
              }}>{label}</Button>
          )}
        </Flex>
        <Box flex={1} />
        {searching ? <Flex align="center">
          <Input ref={searchInput} type="search" autoFocus aria-label="搜索" size="sm" w="min(200px, 30vw)" placeholder="搜索"
            value={query} onChange={event => setQuery(event.target.value)}
            onKeyDown={event => {
              if (event.key !== "Escape") return;
              event.preventDefault();
              event.stopPropagation();
              setQuery("");
              setSearching(false);
              requestAnimationFrame(() => searchTrigger.current?.focus());
            }} />
          {query && <IconButton size="sm" variant="ghost" aria-label="清空搜索" icon={<X size={16} />}
            onClick={() => { setQuery(""); searchInput.current?.focus(); }} />}
        </Flex> : <IconButton ref={searchTrigger} size="sm" variant="ghost" aria-label="搜索" icon={<Search size={18} />}
          onClick={() => setSearching(true)} />}
        <Menu>
          <MenuButton as={Button} size="sm" h="36px" px="16px" bg="#0d0d0d" color="white" _hover={{bg:"#333"}} _active={{bg:"#333"}} iconSpacing="4px" leftIcon={<Plus size={16} aria-hidden/>} borderRadius="full">Template</MenuButton>
          <MenuList aria-label="Template" minW="180px" p="10px" borderWidth={0} borderRadius="16px"
            sx={{"& [role=menuitem]": {height:"36px", padding:"6px 10px", borderRadius:"12px", fontSize:"14px"}}}>
            <MenuItem icon={<FileText size={16} aria-hidden />} onClick={() => onPick("无标题页", "")}>Page</MenuItem>
            <MenuItem icon={<Presentation size={16} aria-hidden />} onClick={() => onSlides()}>Slides</MenuItem>
            <MenuItem icon={<Upload size={16} aria-hidden />} onClick={onUpload}>上传文件</MenuItem>
          </MenuList>
        </Menu>
      </Flex>
      <ModalBody px={{base:4, md:"30px"}} pt={{base:2, md:"36px"}} id="gallery-results" role="tabpanel" aria-labelledby={`gallery-tab-${galleryCategories.indexOf(category)}`} tabIndex={0}>
        {loadFailed && shows("电子表格") && <Flex role="alert" align="center" gap={3} mb={3}>
          <Text fontSize="sm">无法加载电子表格模板。</Text>
          <Button size="sm" variant="outline" onClick={() => {
            setLoadFailed(false);
            setLoadAttempt(attempt => attempt + 1);
          }}>重试</Button>
        </Flex>}
        {buildError && <Text role="alert" fontSize="sm" mb={3} color="red.700">{buildError}</Text>}
        <SimpleGrid columns={{base:2, md:3}} columnGap={{base:3, md:6}} rowGap={{base:6, md:10}}>
          {cards}
        </SimpleGrid>
        {removed === null && shows("电子表格") && !loadFailed && <Text role="status" textAlign="center" color="gray.500" py={4}>正在加载资料库</Text>}
        {!cards.length && (!shows("电子表格") || removed !== null) && <Text textAlign="center" color="gray.500" py={8}>未找到匹配的模板</Text>}
      </ModalBody>
    </ModalContent>
  </Modal>;
}

import { Box, Button, Flex, IconButton, Input, Popover, PopoverBody, PopoverContent, PopoverTrigger, Text } from "@chakra-ui/react";
import { Folder, DollarSign, Book, GraduationCap, Pencil, PenLine, Code, Terminal, Music, Popcorn, Sparkles, Palette, Stethoscope, Activity, Flower, Briefcase, BarChart3, Weight, Dumbbell, Notebook, Scale, Orbit, Plane, Globe, Wrench, PawPrint, FlaskConical, Brain, Heart, Sprout, Layers } from "lucide-react";
import { useRef, useState } from "react";
import type { SpaceAppearance } from "@/types/library";

const icons = {文件夹:Folder,美元:DollarSign,书:Book,毕业帽:GraduationCap,铅笔:Pencil,写作:PenLine,代码括号:Code,终端:Terminal,音乐:Music,爆米花:Popcorn,自定义:Sparkles,调色板:Palette,听诊器:Stethoscope,健康:Activity,莲花:Flower,行李箱:Briefcase,条形图:BarChart3,壶铃:Weight,哑铃:Dumbbell,日志:Notebook,天平:Scale,地球旋转:Orbit,飞机:Plane,地球仪:Globe,扳手:Wrench,爪印:PawPrint,烧瓶:FlaskConical,大脑:Brain,心形:Heart,植物:Sprout};
const colors = {默认:"#0d0d0d",红色:"#fa423e",橙色:"#fb6a22",黄色:"#ffc300",绿色:"#04b84c",蓝色:"#0285ff",紫色:"#924ff7",粉色:"#ff66ad"};

export function SpaceIcon({appearance,size=20}:{appearance?:SpaceAppearance;size?:number}) {
  const Icon = appearance && Object.prototype.hasOwnProperty.call(icons,appearance.icon) ? icons[appearance.icon as keyof typeof icons] : Layers;
  return <Icon size={size} color={colors[appearance?.color as keyof typeof colors]} aria-hidden/>;
}

export default function SpaceIconPicker({value,onChange}:{value:SpaceAppearance;onChange:(value:SpaceAppearance)=>void}) {
  const [query,setQuery] = useState("");
  const [focused,setFocused] = useState("");
  const search = useRef<HTMLInputElement>(null);
  const options = Object.entries(icons).filter(([name])=>name.includes(query.trim()));
  const rows = Array.from({length: Math.ceil(options.length / 8)}, (_, index) => options.slice(index * 8, index * 8 + 8));
  const tabStop = options.some(([name])=>name===focused) ? focused : options[0]?.[0];
  return <Popover placement="bottom-start" initialFocusRef={search} onOpen={()=>{setQuery("");setFocused(value.icon);}}>
    <PopoverTrigger><IconButton aria-label="更换图标" boxSize="26px" minW="26px" ml="12px" flexShrink={0} borderRadius="full" variant="ghost" icon={<SpaceIcon appearance={value} size={26}/>}/></PopoverTrigger>
      <PopoverContent w="min(360px,calc(100vw - 24px))"><PopoverBody px="19px">
        <Input ref={search} type="search" size="sm" h="28px" px="8px" borderRadius="6px" aria-label="搜索图标" placeholder="搜索图标" value={query} onChange={e=>setQuery(e.target.value)}/>
        <Flex role="group" aria-label="图标颜色" gap={1} my={2}>{Object.entries(colors).map(([name,color])=>
          <Button key={name} aria-label={"使用"+name} aria-pressed={value.color===name} variant="ghost" size="xs" onClick={()=>onChange({...value,color:name})}><Box boxSize="14px" bg={color} borderRadius="full" outline={value.color===name?"1px solid":undefined} outlineOffset="2px"/></Button>)}</Flex>
        <Text role="status" fontSize="xs">{options.length} 个图标</Text>
        <Box role="grid" aria-label="图标" mt={1} onKeyDown={event=>{
          const offsets:Record<string,number> = {ArrowLeft:-1,ArrowRight:1,ArrowUp:-8,ArrowDown:8};
          const offset = offsets[event.key];
          if (!offset) return;
          const buttons = Array.from(event.currentTarget.querySelectorAll("button"));
          const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
          if (index < 0) return;
          event.preventDefault();
          buttons[Math.max(0,Math.min(buttons.length-1,index+offset))].focus();
        }}>
          <Box role="rowgroup" aria-label="图标">{rows.map(row =>
            <Box key={row[0][0]} role="row" display="grid" gridTemplateColumns="repeat(8,minmax(0,1fr))">
              {row.map(([name,Icon])=><Box role="gridcell" key={name} textAlign="center"><IconButton w="32px" maxW="full" minW={0} tabIndex={tabStop===name ? 0 : -1} onFocus={()=>setFocused(name)} size="sm" variant="ghost" aria-label={name} aria-pressed={value.icon===name} bg={value.icon===name ? "#efefef" : undefined} title={name} icon={<Icon size={18} color={colors[value.color as keyof typeof colors]}/>} onClick={()=>onChange({...value,icon:name})}/></Box>)}
            </Box>)}</Box>
        </Box>
      </PopoverBody></PopoverContent>
  </Popover>;
}

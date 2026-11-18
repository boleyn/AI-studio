import { Box, Button, Flex, IconButton, Input, Popover, PopoverBody, PopoverContent, PopoverTrigger, Text } from "@chakra-ui/react";
import { Folder, DollarSign, Book, GraduationCap, Pencil, PenLine, Code, Terminal, Music, Popcorn, Sparkles, Palette, Stethoscope, Activity, Flower, Briefcase, BarChart3, Weight, Dumbbell, Notebook, Scale, Orbit, Plane, Globe, Wrench, PawPrint, FlaskConical, Brain, Heart, Sprout, Layers } from "lucide-react";
import { useRef, useState } from "react";
import type { SpaceAppearance } from "@/types/library";

const icons = {文件夹:Folder,美元:DollarSign,书:Book,毕业帽:GraduationCap,铅笔:Pencil,写作:PenLine,代码括号:Code,终端:Terminal,音乐:Music,爆米花:Popcorn,自定义:Sparkles,调色板:Palette,听诊器:Stethoscope,健康:Activity,莲花:Flower,行李箱:Briefcase,条形图:BarChart3,壶铃:Weight,哑铃:Dumbbell,日志:Notebook,天平:Scale,地球旋转:Orbit,飞机:Plane,地球仪:Globe,扳手:Wrench,爪印:PawPrint,烧瓶:FlaskConical,大脑:Brain,心形:Heart,植物:Sprout};
const colors = {默认:"currentColor",红色:"#d94949",橙色:"#d77421",黄色:"#b69012",绿色:"#299650",蓝色:"#3280d7",紫色:"#915cd2",粉色:"#cf5597"};

export function SpaceIcon({appearance,size=20}:{appearance?:SpaceAppearance;size?:number}) {
  const Icon = appearance && Object.prototype.hasOwnProperty.call(icons,appearance.icon) ? icons[appearance.icon as keyof typeof icons] : Layers;
  return <Icon size={size} color={colors[appearance?.color as keyof typeof colors]} aria-hidden/>;
}

export default function SpaceIconPicker({value,onChange}:{value:SpaceAppearance;onChange:(value:SpaceAppearance)=>void}) {
  const [query,setQuery] = useState("");
  const search = useRef<HTMLInputElement>(null);
  const options = Object.entries(icons).filter(([name])=>name.includes(query.trim()));
  return <Popover placement="bottom-start" initialFocusRef={search} onOpen={()=>setQuery("")}>
    {({onClose})=><><PopoverTrigger><IconButton aria-label="更换图标" variant="ghost" icon={<SpaceIcon appearance={value} size={26}/>}/></PopoverTrigger>
      <PopoverContent w="min(320px,85vw)"><PopoverBody>
        <Input ref={search} type="search" size="sm" aria-label="搜索图标" placeholder="搜索图标" value={query} onChange={e=>setQuery(e.target.value)}/>
        <Flex role="group" aria-label="图标颜色" gap={1} my={2}>{Object.entries(colors).map(([name,color])=>
          <Button key={name} aria-label={"使用"+name} aria-pressed={value.color===name} variant="ghost" size="xs" onClick={()=>onChange({...value,color:name})}><Box boxSize="14px" bg={color} borderRadius="full" outline={value.color===name?"1px solid":undefined} outlineOffset="2px"/></Button>)}</Flex>
        <Text role="status" fontSize="xs">{options.length} 个图标</Text>
        <Box display="grid" gridTemplateColumns="repeat(8,1fr)" mt={1}>{options.map(([name,Icon])=><IconButton key={name} size="sm" variant="ghost" aria-label={name} title={name} icon={<Icon size={18} color={colors[value.color as keyof typeof colors]}/>} onClick={()=>{onChange({...value,icon:name});onClose();}}/>)}</Box>
      </PopoverBody></PopoverContent></>}
  </Popover>;
}

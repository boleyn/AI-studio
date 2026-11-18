import { useRef, useState } from "react";
import { Tabs, TabList, Tab, Box, Flex, Grid, Text } from "@chakra-ui/react";

const templates = [
  ["海报","poster","cf2b8f454736ef49959494dc07b81107bc3c4278e82756104b74abaadcbbc89b","设计一张海报，请先和我确认主题、必备文字、展示场景和版式。"],
  ["室内设计","interior-design","34893fbdd54c72c7d27c8d4f9ea41a344ab6ffc58986f3368b3dc465d02cec1a","为我的空间设计室内效果图，请先确认尺寸、用途、材质和采光。"],
  ["徽标","logo","1b1be571ecf621410376aba147a70765ec67c402a23eaadddb504b3e5f09a47d","设计一个徽标，请先确认品牌名称、受众和使用场景。"],
  ["插画","illustration","6bfb502b329095214140579bb65cb298505bf741e2ac0e6de689ce0f7e20ee3c","创作一幅插画，请先确认主题、构图、配色和媒介。"],
  ["职业形象照","headshot","d7457abc48b60332758815bd786d6b2a499e66517a56ff0e0cad0dadb4a5413c","制作职业形象照，请先确认参考照片、背景、光线和服装。"],
  ["图标","icon","1d652dad962da64ee91a8ab44c2cfb720a78306b8751f0e032b126775f39d3ed","设计图标，请先确认用途、尺寸与风格。"],
  ["产品照","product-photo","79c95f6762e2e761e4b0525096bc160f7db861127fd79717a32cb4babd26edb8","制作产品照，请先确认产品外观、背景和拍摄角度。"],
  ["周边商品","merch","2149b9e47134e530c8b5bb90e717d0551e5033ebdf51bca4365fc0c4f5505d1f","设计周边商品效果图，请先确认品类、材质和印刷位置。"],
  ["信息图","infographic","067d90cc658452be4a1d303f2149af89a2f95eb93233adb125ce51fbb3c910a1","设计信息图，请先确认数据、读者和要表达的结论。"],
  ["宣传单","flyer","ea3979eaf7b69c9abf4791ccfaf1ea90056fe949b95e72264880c950f6d7356c","设计宣传单，请先确认尺寸、文案和分发场景。"],
  ["书籍封面","book-cover","885e6bb0d6a80777727a172f67a2640e4c23be343e69a9fc97be508884a30c92","设计书籍封面，请先确认书名、作者、类型和视觉主题。"],
  ["应用效果图","app-mockup","4682a32811097d760bee4df6dde54faa9d675b475abb7e6874fb726cdcf2e075","绘制应用效果图，请先确认平台、目标用户和核心界面。"],
  ["包装","packaging","7df5528c817280d8130cb4a86bd5cfcd11824c758f03184c562f13babdc6275c","设计产品包装，请先确认容器形状、标签内容和材质。"],
  ["广告","advertisement","5b058f642d6501458810a5dab5fa1261b691dfea7bb9323fc6b7e9d06f24fc41","制作广告图，请先确认产品、投放位置和行动提示。"],
  ["缩略图","thumbnail","bec878131b459709d6531854c0845349a7933aec95f17a33d7ddc7757f59922f","制作缩略图，请先确认主题、平台和展示文字。"],
  ["网站效果图","website-mockup","ee1bb9e068c9b5998f97c526e13c416e16e6fd60c50ee798590949a8b439342c","设计网站效果图，请先确认页面目标、内容和品牌风格。"],
];

const popular = [
  ["Anime reaction GIF","promptworks/2026-11-05/anime-reaction-a4d03da6dd758476ce894a37a40e3ccd06a2cab0def66b5c37207b9da150199a"],
  ["航拍视角","promptworks/2026-10-02/drone-view-ada14b68403f230a0210b2dee6ff8353f52a5632e06cfb38f55048a1990853b6"],
  ["收藏版铁盒","promptworks/2026-10-03/collectors-tin-31391d96e4f005b1bebdd4b3c266513aa8964303352764954dc583c60ce15e4e"],
  ["重返 80 年代","promptworks/2026-09-08/80s-flashback-a00031b0a07c584db431969185a66fa7a682675803f4be5cda3ba17c61d405eb"],
  ["夸张漫画","promptworks/2026-10-02/caricature-32705045db0710f0d140c562c82cd424c0d0a4cb4cbcf546a9cd9e8b278bdee3"],
  ["素描","promptworks/2026-10-02/sketch-d7b1709f2b3a7a60e79fa8bfbe7c843c18f27f4c6a221fc5c0ecf6d18d3a1fe2"],
  ["贴纸","promptworks/2026-07-29/stickers-18de392f7686bfb1d3099d5196f05a69f915a95c3078b1f3f8d618dba2a21cae"],
  ["拍照亭","promptworks/2026-09-30/photo-booth-afb1f5541d9765123efa3f17cf069e4f62f635e639bd8463d1a3976a9433baa8"],
  ["Y2K 数码相机风","promptworks/2026-09-30/y2k-c83c217f3d66d6330f707c270ae4e4f2446f8716c94e29788606288649151db5"],
  ["动漫风","anime-sheet"],
  ["70 年代风格人像","promptworks/2026-09-30/70s-bc70a746219f072abdc031abae89d9083624826fe20cf80e77e613710e1ef913"],
  ["印象派绘画","promptworks/2026-09-30/impressionism-8a90c0c21d2cca8fe4d5c3309d39bafb03315cbb05c2750729f9229fc57cd680"],
  ["置顶合集","promptworks/2026-07-10/pin-collection-34b419410824b90fed76556057d79f55a58cfd5c4734417add1c8f28954abbf3"],
  ["水下","underwater-sheet"],["3D 头像","3d-avatar-sheet"],
  ["丙烯画","promptworks/2026-09-30/acrylic-fd94a9623f976f198b81481543db5f65a3258ce5dee1434de0cc782ad9b7f25a"],
  ["羊毛毡微缩模型","promptworks/2026-09-30/felt-2d344687da002475665d73044e8e231076f6e442bc2c3af80ea5f52637acaebb"],
  ["塔罗牌","tarot-sheet"],["雕像","statue-sheet"],
  ["黏土动画世界","promptworks/2026-09-30/claymation-8dc8d845f2b2055bbf733ac6d3198da20ce189bcd5fea80081777bf22d451a68"],
  ["拼装模型套件","promptworks/2026-09-30/sprue-card-5d286404f357929d1af0b7bb053bc80ddd6b3af1a40acc4854f46f2fe8216c31"],
  ["16 位街机风格","promptworks/2026-09-30/8-bit-01eba4a7418ca463afb19b8160d7637be348bc2d6f9e8f55f87193121aa1cf68"],
  ["手写批注风格","white-lines-sheet"],["美妆指南","makeup-analysis-sheet"],["涂鸦","scribble-sheet"],
  ["你的摇头娃娃","promptworks/2026-09-30/bobblehead-7a2b94522f03cfa193d080b5daea01ec5faf1fb9fc103c8b64d063517faadba8"],
  ["迷你分身","mini-me-global-sheet"],["剖面图","cross-section-sheet"],["增强照片","enhance-sheet"],
  ["远方情结","wanderlust-postcard-sheet"],["夜拍闪光","flash-sheet"],["蓝图海报","blueprint-sheet"],
  ["色彩分析","color-analysis-new"],["漫画","comic-sheet"],["动漫风漫画","anime-comic-sheet"],
  ["奇幻报纸","fantasy-newspaper-sheet"],["胶片条","film-strip-sheet"],["超写实壁纸","hyper-real-sheet"],
];

export default function ImageCreationTemplates({onPick,onUpload}:{onPick:(prompt:string)=>void;onUpload:(photos:File[])=>void}) {
  const photoInput = useRef<HTMLInputElement>(null);
  const [tab,setTab] = useState(0);
  const cards = tab === 0 ? templates.map(([label,slug,hash,prompt])=>({
    label,prompt,path:`promptworks/2026-09-${slug==="thumbnail"?"08":"04"}/professional-${slug}-${hash}`
  })) : popular.map(([label,path])=>({label,path,prompt:"以「"+label+"」为主题创作图像。"}));
  return <Box as="section" aria-label="创建图像" mt={3} maxW="768px" mx="auto" maxH="32vh" overflowY="auto">
    <input ref={photoInput} type="file" accept="image/*" multiple hidden aria-label="上传参考照片" onChange={event=>{
      const photos = Array.from(event.currentTarget.files || []);
      event.currentTarget.value = "";
      if (photos.length) onUpload(photos);
    }}/>
    <Flex align="center" justify="space-between" mb={2}><Tabs index={tab} onChange={setTab} size="sm" variant="soft-rounded"><TabList aria-label="图像灵感"><Tab>模板</Tab><Tab>热门</Tab></TabList></Tabs></Flex>
    <Grid templateColumns={{base:"repeat(2,minmax(0,1fr))",md:"repeat(4,minmax(0,1fr))"}} gap="8px">
      <Flex as="button" type="button" align="center" justify="center" direction="column" gap={2} aspectRatio="4 / 5"
        bg="gray.100" borderRadius="24px" onClick={()=>photoInput.current?.click()}><span aria-hidden>＋</span>上传照片</Flex>
      {cards.map(({label,path,prompt})=>
      <Box as="button" type="button" key={path} position="relative" overflow="hidden" borderRadius="16px" aspectRatio="4 / 5" textAlign="left" onClick={()=>onPick(prompt)}>
        <Box as="img" alt="" loading="lazy" w="100%" h="100%" objectFit="cover"
          src={`https://persistent.oaistatic.com/images-app/${path}.webp`}/>
        <Text position="absolute" insetInline={0} bottom={0} px={3} pb={2} pt={5} bgGradient="linear(to-t, blackAlpha.700, transparent)" color="white" fontSize="sm" fontWeight="600">{label}</Text>
      </Box>)}</Grid>
  </Box>;
}

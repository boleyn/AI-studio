import { Box, Button, Flex, Grid, Text } from "@chakra-ui/react";

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

export default function ImageCreationTemplates({onPick,onUpload}:{onPick:(prompt:string)=>void;onUpload:()=>void}) {
  return <Box as="section" aria-label="创建图像" mt={3} maxH="32vh" overflowY="auto">
    <Flex align="center" justify="space-between" mb={2}><Text fontSize="sm" fontWeight="600">模板</Text><Button size="sm" variant="ghost" onClick={onUpload}>上传照片</Button></Flex>
    <Grid templateColumns="repeat(auto-fill,minmax(104px,1fr))" gap={2}>{templates.map(([label,slug,hash,prompt])=>
      <Box as="button" type="button" key={slug} textAlign="left" onClick={()=>onPick(prompt)}>
        <Box as="img" alt="" loading="lazy" borderRadius="10px" w="100%" aspectRatio="1" objectFit="cover"
          src={`https://persistent.oaistatic.com/images-app/promptworks/2026-09-${slug==="thumbnail"?"08":"04"}/professional-${slug}-${hash}.webp`}/>
        <Text mt={1} fontSize="sm">{label}</Text>
      </Box>)}</Grid>
  </Box>;
}

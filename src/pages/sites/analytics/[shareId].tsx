import type { GetServerSideProps } from "next";
import { Box, Flex, Heading, Link, Text } from "@chakra-ui/react";
import { getAuthUserFromRequest } from "@server/auth/ssr";
import { getMongoDb } from "@server/db/mongo";
import { getProject } from "@server/projects/projectStorage";
import { getShareLink } from "@server/shares/shareStorage";

interface Props {
  name: string;
  shareId: string;
  days: number;
  visitors: number;
  views: number;
  daily: {day:string; visitors:number; views:number}[];
}

export const getServerSideProps: GetServerSideProps<Props> = async context => {
  const user = getAuthUserFromRequest(context.req);
  if (!user) return {redirect:{destination:"/login?lastRoute="+encodeURIComponent(context.resolvedUrl),permanent:false}};
  const shareId = String(context.params?.shareId || "");
  const share = await getShareLink(shareId);
  if (!share || share.mode !== "preview" || share.ownerUserId !== user.sub) return {notFound:true};
  const project = await getProject(share.projectToken);
  if (!project || project.userId !== user.sub) return {notFound:true};
  context.res.setHeader("Cache-Control","private, no-store");
  const days = context.query.days === "7" ? 7 : 30;
  const now = Date.now();
  const dates = Array.from({length:days}, (_, i) => new Date(now - (days-1-i)*86400000).toISOString().slice(0,10));
  const db = await getMongoDb();
  const [report] = await db.collection("site_daily_visits").aggregate([
    {$match:{projectToken:share.projectToken,day:{$gte:dates[0],$lte:dates[days-1]}}},
    {$facet:{
      daily:[{$group:{_id:"$day",views:{$sum:"$views"},visitors:{$sum:1}}}],
      distinct:[{$group:{_id:"$viewer"}},{$count:"count"}],
    }},
  ]).toArray();
  const daily = dates.map(day => {
    const row = report?.daily.find((entry:{_id:string}) => entry._id === day);
    return {day,visitors:Number(row?.visitors || 0),views:Number(row?.views || 0)};
  });
  return {props:{shareId,name:project.name,days,daily,visitors:report?.distinct[0]?.count || 0,views:daily.reduce((sum,row)=>sum+row.views,0)}};
};

export default function SiteAnalytics({name,shareId,days,daily,visitors,views}:Props) {
  return <Box as="main" maxW="960px" mx="auto" p={6}>
    <Flex justify="space-between"><Link href="/?view=library&librarySection=站点">返回站点</Link><Link href={"/share/preview/"+shareId}>访问</Link></Flex>
    <Heading as="h1" size="lg" my={6}>{name}</Heading>
    <Flex justify="space-between" align="center" wrap="wrap" gap={4}>
      <Heading as="h2" size="md">分析</Heading>
      <Flex as="nav" aria-label="日期范围" gap={2}>{[7,30].map(n=><Link key={n} href={"?days="+n} aria-current={n===days?"page":undefined} bg={n===days?"gray.100":undefined} borderRadius="full" px={3} py={1}>{n} 天</Link>)}</Flex>
    </Flex>
    <Flex gap={12} my={6}><Box>独立访客数<Text fontSize="2xl">{visitors}</Text></Box><Box>页面浏览量<Text fontSize="2xl">{views}</Text></Box></Flex>
    <Heading as="h2" size="md" mb={3}>流量趋势</Heading>
    <Box as="table" w="full" fontSize="sm" sx={{"& th, & td":{textAlign:"start",py:2,borderBottom:"1px solid #eee"}}}>
      <thead><tr><th>日期（UTC）</th><th>独立访客数</th><th>页面浏览量</th></tr></thead>
      <tbody>{daily.map(row=><tr key={row.day}><td>{row.day}</td><td>{row.visitors}</td><td>{row.views}</td></tr>)}</tbody>
    </Box>
  </Box>;
}

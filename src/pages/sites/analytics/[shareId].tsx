import type { GetServerSideProps } from "next";
import { useState } from "react";
import { Box, Button, Flex, Heading, Link, Text } from "@chakra-ui/react";
import { getAuthUserFromRequest } from "@server/auth/ssr";
import { getMongoDb } from "@server/db/mongo";
import { getSiteSettings } from "@server/library/sites";
import { getProject } from "@server/projects/projectStorage";
import { siteReportDates } from "@server/shares/siteVisits";
import { getShareLink } from "@server/shares/shareStorage";

interface Props {
  name: string;
  shareId: string;
  days: number;
  requests: number;
  visitors: number;
  views: number;
  pages: {id:string; visitors:number; views:number}[];
  daily: {day:string; visitors:number; views:number}[];
}

export const getServerSideProps: GetServerSideProps<Props> = async context => {
  const user = getAuthUserFromRequest(context.req);
  if (!user) return {redirect:{destination:"/login?lastRoute="+encodeURIComponent(context.resolvedUrl),permanent:false}};
  const shareId = String(context.params?.shareId || "");
  const share = await getShareLink(shareId);
  if (!share || share.mode !== "preview" || share.ownerUserId !== user.sub) return {notFound:true};
  const [project, settings] = await Promise.all([
    getProject(share.projectToken),
    getSiteSettings(share.ownerUserId, share.projectToken),
  ]);
  if (!project || project.userId !== user.sub) return {notFound:true};
  context.res.setHeader("Cache-Control","private, no-store");
  const days = context.query.days === "7" ? 7 : 30;
  const dates = siteReportDates(days);
  const db = await getMongoDb();
  const [requestTotal] = await db.collection("site_daily_requests").aggregate<{count:number}>([
    {$match:{projectToken:share.projectToken,day:{$gte:dates[0],$lte:dates[days-1]}}},
    {$group:{_id:null,count:{$sum:"$requests"}}},
  ]).toArray();
  const [report] = await db.collection("site_daily_visits").aggregate([
    {$match:{projectToken:share.projectToken,day:{$gte:dates[0],$lte:dates[days-1]}}},
    {$facet:{
      daily:[{$group:{_id:"$day",views:{$sum:"$views"},visitors:{$sum:1}}}],
      pages:[
        {$project:{viewer:1,entries:{$objectToArray:{$ifNull:["$pages",{}]}}}},
        {$unwind:"$entries"},
        {$group:{_id:{page:"$entries.k",viewer:"$viewer"},views:{$sum:"$entries.v"}}},
        {$group:{_id:"$_id.page",visitors:{$sum:1},views:{$sum:"$views"}}},
        {$sort:{views:-1,_id:1}},
        {$project:{_id:0,id:"$_id",visitors:1,views:1}},
      ],
      distinct:[{$group:{_id:"$viewer"}},{$count:"count"}],
    }},
  ]).toArray();
  const daily = dates.map(day => {
    const row = report?.daily.find((entry:{_id:string}) => entry._id === day);
    return {day,visitors:Number(row?.visitors || 0),views:Number(row?.views || 0)};
  });
  return {props:{shareId,name:settings?.name || project.name,days,daily,pages:report?.pages || [],requests:requestTotal?.count || 0,visitors:report?.distinct[0]?.count || 0,views:daily.reduce((sum,row)=>sum+row.views,0)}};
};

function TrafficTrend({daily}: Pick<Props,"daily">) {
  const [showVisitors, setShowVisitors] = useState(true);
  const [showViews, setShowViews] = useState(true);
  const maximum = Math.max(1,...daily.map(row=>Math.max(showViews ? row.views : 0, showVisitors ? row.visitors : 0)));
  const x = (index:number) => 48 + index * 648 / (daily.length - 1);
  const y = (value:number) => 158 - value * 132 / maximum;
  const points = (metric:"visitors"|"views") => daily.map((row,index)=>x(index)+","+y(row[metric])).join(" ");
  return <Box as="figure" mb={6}>
    <svg viewBox="0 0 720 192" width="100%" role="img" aria-label="每日独立访客数和页面浏览量，详细数值见下表">
      {[0,Math.ceil(maximum/2),maximum].filter((v,i,a)=>a.indexOf(v)===i).map(tick=><g key={tick}>
        <line x1="48" x2="696" y1={y(tick)} y2={y(tick)} stroke="#ddd"/>
        <text x="40" y={y(tick)+4} textAnchor="end" fontSize="12" fill="#555">{tick}</text>
      </g>)}
      {showViews && <polyline points={points("views")} fill="none" stroke="#2563eb" strokeWidth="3"/>}
      {showVisitors && <polyline points={points("visitors")} fill="none" stroke="#08775b" strokeWidth="2" strokeDasharray="5 4"/>}
      {[0,Math.floor(daily.length/2),daily.length-1].map(index=><text key={index} x={x(index)} y="182" textAnchor="middle" fontSize="12" fill="#555">{daily[index].day.slice(5)}</text>)}
    </svg>
    <Flex as="figcaption" gap={4} justify="center" fontSize="sm">
      <Button variant="ghost" size="sm" aria-pressed={showVisitors} onClick={()=>setShowVisitors(value=>!value)}
        color={showVisitors ? "#08775b" : "gray.500"}><Box aria-hidden w={4} borderTop="2px dashed currentColor" mr={2}/>独立访客数</Button>
      <Button variant="ghost" size="sm" aria-pressed={showViews} onClick={()=>setShowViews(value=>!value)}
        color={showViews ? "#2563eb" : "gray.500"}><Box aria-hidden w={4} borderTop="3px solid currentColor" mr={2}/>页面浏览量</Button>
    </Flex>
  </Box>;
}

export default function SiteAnalytics({name,shareId,days,daily,visitors,views,requests,pages}:Props) {
  return <Box as="main" maxW="960px" mx="auto" p={6}>
    <Flex justify="space-between"><Link href="/?view=library&librarySection=站点">返回站点</Link><Link href={"/share/preview/"+shareId}>访问</Link></Flex>
    <Box as="section" aria-label={name} mt={6} mb={4}>
      <Heading as="h1" fontSize="24px" lineHeight="32px" fontWeight={400} overflowWrap="anywhere">{name}</Heading>
      <Link href={"/share/preview/"+shareId} fontSize="sm" color="gray.600" overflowWrap="anywhere">{"/share/preview/"+shareId}</Link>
    </Box>
    <Flex as="nav" aria-label="站点详情" gap={4} align="center" minH="36px" mb={4} borderBottomWidth="1px">
      <Link href={"/?"+new URLSearchParams({view:"library",librarySection:"站点",librarySiteSettings:shareId})}>设置</Link>
      <Text aria-current="page" fontWeight="semibold">分析</Text>
    </Flex>
    <Flex justify="space-between" align="center" wrap="wrap" gap={4}>
      <Heading as="h2" size="md">分析</Heading>
      <Flex as="nav" aria-label="日期范围" gap={2}>{[7,30].map(n=><Link key={n} href={"?days="+n} aria-current={n===days?"page":undefined} bg={n===days?"gray.100":undefined} borderRadius="full" px={3} py={1}>{n} 天</Link>)}</Flex>
    </Flex>
    <Flex gap={12} my={6}><Box>独立访客数<Text fontSize="2xl">{visitors}</Text></Box><Box title="预览页面及预览数据接口的成功请求">请求数<Text fontSize="2xl">{requests}</Text></Box><Box>页面浏览量<Text fontSize="2xl">{views}</Text></Box></Flex>
    <Heading as="h2" size="md" mb={3}>流量趋势</Heading>
    <TrafficTrend daily={daily}/>
    <Heading as="h2" size="md" my={3}>热门页面</Heading>
    {pages.length ? <Box as="table" width="full" mb={6} fontSize="sm" sx={{"& th, & td":{textAlign:"start",py:2,borderBottom:"1px solid #eee"}}}>
      <thead><tr><th>页面</th><th>独立访客数</th><th>页面浏览量</th></tr></thead>
      <tbody>{pages.map(page=><tr key={page.id}><td><Link href={"/share/preview/"+encodeURIComponent(page.id)}>/share/preview/{page.id}</Link></td><td>{page.visitors}</td><td>{page.views}</td></tr>)}</tbody>
    </Box> : <Text mb={6}>暂无页面访问记录</Text>}
    <Heading as="h2" size="md" mb={3}>每日明细</Heading>
    <Box as="table" w="full" fontSize="sm" sx={{"& th, & td":{textAlign:"start",py:2,borderBottom:"1px solid #eee"}}}>
      <thead><tr><th>日期（UTC）</th><th>独立访客数</th><th>页面浏览量</th></tr></thead>
      <tbody>{daily.map(row=><tr key={row.day}><td>{row.day}</td><td>{row.visitors}</td><td>{row.views}</td></tr>)}</tbody>
    </Box>
  </Box>;
}

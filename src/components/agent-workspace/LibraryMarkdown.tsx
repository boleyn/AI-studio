import { Box } from "@chakra-ui/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export default function LibraryMarkdown({children}:{children:string}) {
  return <Box overflowWrap="anywhere" sx={{
    "& h1, & h2, & h3, & h4":{fontWeight:600,lineHeight:1.3,marginBlock:"1em .5em"},
    "& h1":{fontSize:"1.7em"}, "& h2":{fontSize:"1.3em"}, "& p":{marginBottom:3,whiteSpace:"pre-wrap"},
    "& ul, & ol":{paddingInlineStart:6,marginBottom:3}, "& ul":{listStyleType:"disc"}, "& ol":{listStyleType:"decimal"},
    "& .task-list-item":{listStyleType:"none"}, "& input[type=checkbox]":{marginInlineEnd:1},
    "& pre":{overflowX:"auto",p:3,bg:"gray.50",borderRadius:"md"}, "& a":{textDecoration:"underline"},
    "& th, & td":{border:"1px solid",borderColor:"gray.200",px:3,py:2,textAlign:"start"}
  }}>
    <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={{
      img:({alt})=><span>{alt}</span>,
      table:({children})=><Box overflowX="auto" mb={3}><table>{children}</table></Box>
    }}>{children}</ReactMarkdown>
  </Box>;
}

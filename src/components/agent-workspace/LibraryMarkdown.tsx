import InteractiveHtmlPreview from "../workspace/InteractiveHtmlPreview";
import { Component } from "react";
import { Box } from "@chakra-ui/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type MarkdownProps = {children: string; showImages?: boolean; interactivePages?: boolean};

function FormattedMarkdown({children, showImages, interactivePages}: MarkdownProps) {
  return <Box overflowWrap="anywhere" sx={{
    "& h1, & h2, & h3, & h4":{fontWeight:600,lineHeight:1.3,marginBlock:"1em .5em"},
    "& h1":{fontSize:"1.7em"}, "& h2":{fontSize:"1.3em"}, "& p":{marginBottom:3,whiteSpace:"pre-wrap"},
    "& ul, & ol":{paddingInlineStart:6,marginBottom:3}, "& ul":{listStyleType:"disc"}, "& ol":{listStyleType:"decimal"},
    "& .task-list-item":{listStyleType:"none"}, "& input[type=checkbox]":{marginInlineEnd:1},
    "& pre":{overflowX:"auto",p:3,bg:"gray.50",borderRadius:"md"}, "& a":{textDecoration:"underline"},
    "& th, & td":{border:"1px solid",borderColor:"gray.200",px:3,py:2,textAlign:"start"}
  }}>
    <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={{
      ...(!showImages && {img: ({alt}: {alt?: string}) => <span>{alt}</span>}),
      pre:({node,children})=>{
        const code = node?.children[0];
        if (interactivePages && code?.type === "element" && code.tagName === "code" &&
          Array.isArray(code.properties.className) && code.properties.className.includes("language-visualize")) {
          const source = code.children.map(child=>child.type === "text" ? child.value : "").join("");
          return <Box h="min(480px, 60dvh)" my={3}><InteractiveHtmlPreview name="交互式可视化" body={source}/></Box>;
        }
        return <pre>{children}</pre>;
      },
      table:({children})=><Box overflowX="auto" mb={3}><table>{children}</table></Box>
    }}>{children}</ReactMarkdown>
  </Box>;
}

export default class LibraryMarkdown extends Component<MarkdownProps, {failed: boolean}> {
  state = {failed: false};

  static getDerivedStateFromError() {
    return {failed: true};
  }

  componentDidUpdate(previous: {children: string}) {
    if (this.state.failed && previous.children !== this.props.children) {
      this.setState({failed: false});
    }
  }

  render() {
    if (this.state.failed) {
      return <Box>
        <Box role="status" fontSize="sm" color="gray.600" mb={3}>已切换为纯文本预览</Box>
        <Box as="pre" whiteSpace="pre-wrap" overflowWrap="anywhere" fontSize="sm">{this.props.children}</Box>
      </Box>;
    }
    return <FormattedMarkdown {...this.props} />;
  }
}

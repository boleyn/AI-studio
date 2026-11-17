import React, { useMemo, useState } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { Box, Flex, Text } from '@chakra-ui/react';
import { Check, Copy } from 'lucide-react';
import { useCopyData } from '@/hooks/useCopyData';
import { useMarkdownWidth } from '../hooks';

export const codeLight: { [key: string]: React.CSSProperties } = {
  'code[class*=language-]': {
    color: '#1e293b',
    textShadow: 'none',
    direction: 'ltr',
    textAlign: 'left',
    whiteSpace: 'pre',
    wordSpacing: 'normal',
    wordBreak: 'normal',
    lineHeight: '1.6',
    MozTabSize: '4',
    OTabSize: '4',
    tabSize: '4',
    WebkitHyphens: 'none',
    MozHyphens: 'none',
    msHyphens: 'none',
    hyphens: 'none'
  },
  'pre[class*=language-]': {
    color: '#1e293b',
    textShadow: 'none',
    direction: 'ltr',
    textAlign: 'left',
    whiteSpace: 'pre',
    wordSpacing: 'normal',
    wordBreak: 'normal',
    lineHeight: '1.6',
    MozTabSize: '4',
    OTabSize: '4',
    tabSize: '4',
    WebkitHyphens: 'none',
    MozHyphens: 'none',
    msHyphens: 'none',
    hyphens: 'none',
    padding: '1em',
    margin: '.5em 0',
    overflow: 'auto',
    background: '#f9f9fa'
  },
  'code[class*=language-] ::selection': {
    textShadow: 'none',
    background: '#dbeafe'
  },
  'code[class*=language-]::selection': {
    textShadow: 'none',
    background: '#dbeafe'
  },
  'pre[class*=language-] ::selection': {
    textShadow: 'none',
    background: '#dbeafe'
  },
  'pre[class*=language-]::selection': {
    textShadow: 'none',
    background: '#dbeafe'
  },
  ':not(pre)>code[class*=language-]': {
    padding: '.15em .4em',
    borderRadius: '.35em',
    color: '#0f172a',
    background: '#f1f5f9'
  },
  '.namespace': {
    opacity: '0.7'
  },
  'doctype.doctype-tag': {
    color: '#2563eb'
  },
  'doctype.name': {
    color: '#0284c7'
  },
  comment: {
    color: '#6b7280',
    fontStyle: 'italic'
  },
  prolog: {
    color: '#6b7280'
  },
  '.language-html .language-css .token.punctuation': {
    color: '#475569'
  },
  '.language-html .language-javascript .token.punctuation': {
    color: '#475569'
  },
  punctuation: {
    color: '#475569'
  },
  boolean: {
    color: '#2563eb'
  },
  constant: {
    color: '#0369a1'
  },
  inserted: {
    color: '#15803d'
  },
  number: {
    color: '#d97706'
  },
  property: {
    color: '#0369a1'
  },
  symbol: {
    color: '#d97706'
  },
  tag: {
    color: '#16a34a'
  },
  unit: {
    color: '#d97706'
  },
  'attr-name': {
    color: '#0284c7'
  },
  builtin: {
    color: '#b45309'
  },
  char: {
    color: '#059669'
  },
  deleted: {
    color: '#dc2626'
  },
  selector: {
    color: '#7c3aed'
  },
  string: {
    color: '#059669'
  },
  '.language-css .token.string.url': {
    textDecoration: 'underline'
  },
  entity: {
    color: '#2563eb'
  },
  operator: {
    color: '#475569'
  },
  'operator.arrow': {
    color: '#2563eb'
  },
  atrule: {
    color: '#b45309'
  },
  'atrule.rule': {
    color: '#7c3aed'
  },
  'atrule.url': {
    color: '#0284c7'
  },
  'atrule.url.function': {
    color: '#2563eb'
  },
  'atrule.url.punctuation': {
    color: '#475569'
  },
  keyword: {
    color: '#7c3aed'
  },
  'keyword.control-flow': {
    color: '#7c3aed'
  },
  'keyword.module': {
    color: '#7c3aed'
  },
  function: {
    color: '#2563eb'
  },
  'function.maybe-class-name': {
    color: '#2563eb'
  },
  regex: {
    color: '#dc2626'
  },
  important: {
    color: '#2563eb'
  },
  italic: {
    fontStyle: 'italic'
  },
  'class-name': {
    color: '#0d9488'
  },
  'maybe-class-name': {
    color: '#0d9488'
  },
  console: {
    color: '#9cdcfe'
  },
  parameter: {
    color: '#9cdcfe'
  },
  interpolation: {
    color: '#9cdcfe'
  },
  'punctuation.interpolation-punctuation': {
    color: '#569cd6'
  },
  'exports.maybe-class-name': {
    color: '#9cdcfe'
  },
  'imports.maybe-class-name': {
    color: '#9cdcfe'
  },
  variable: {
    color: '#9cdcfe'
  },
  escape: {
    color: '#d7ba7d'
  },
  'tag.punctuation': {
    color: 'grey'
  },
  cdata: {
    color: 'grey'
  },
  'attr-value': {
    color: '#ce9178'
  },
  'attr-value.punctuation': {
    color: '#ce9178'
  },
  'attr-value.punctuation.attr-equals': {
    color: '#d4d4d4'
  },
  namespace: {
    color: '#4ec9b0'
  },
  'code[class*=language-javascript]': {
    color: '#9cdcfe'
  },
  'code[class*=language-jsx]': {
    color: '#9cdcfe'
  },
  'code[class*=language-tsx]': {
    color: '#9cdcfe'
  },
  'code[class*=language-typescript]': {
    color: '#9cdcfe'
  },
  'pre[class*=language-javascript]': {
    color: '#9cdcfe'
  },
  'pre[class*=language-jsx]': {
    color: '#9cdcfe'
  },
  'pre[class*=language-tsx]': {
    color: '#9cdcfe'
  },
  'pre[class*=language-typescript]': {
    color: '#9cdcfe'
  },
  'code[class*=language-css]': {
    color: '#ce9178'
  },
  'pre[class*=language-css]': {
    color: '#ce9178'
  },
  'code[class*=language-html]': {
    color: '#d4d4d4'
  },
  'pre[class*=language-html]': {
    color: '#d4d4d4'
  },
  '.language-regex .token.anchor': {
    color: '#dcdcaa'
  },
  '.language-html .token.punctuation': {
    color: 'grey'
  },
  'pre[class*=language-]>code[class*=language-]': {
    position: 'relative',
    zIndex: '1'
  },
  '.line-highlight.line-highlight': {
    background: '#f7ebc6',
    boxShadow: 'inset 5px 0 0 #f7d87c',
    zIndex: '0'
  }
};

const CodeLight = ({
  children,
  className,
  codeBlock,
  match
}: {
  children: React.ReactNode & React.ReactNode[];
  className?: string;
  codeBlock?: boolean;
  match: RegExpExecArray | null;
}) => {
  const { copyData } = useCopyData();
  const [copied, setCopied] = useState(false);
  // 使用动态宽度计算，设置代码块的最小宽度
  const { width, Ref } = useMarkdownWidth({
    minWidth: { base: 320, md: 500 }
  });

  const codeBoxName = useMemo(() => {
    const input = match?.['input'] || '';
    if (!input) return match?.[1];

    const splitInput = input.split('#');
    return splitInput[1] || match?.[1];
  }, [match]);

  // 处理代码内容
  const processedChildren = useMemo(() => {
    let code = String(children).replace(/&nbsp;/g, ' ');

    // 对于bash、shell、terminal代码块，保持原始格式
    const language = match?.[1]?.toLowerCase();
    if (language === 'bash' || language === 'shell' || language === 'terminal') {
      // 只做基本清理，保持原始格式
      return code.trim();
    }

    return code;
  }, [children, match]);

  if (codeBlock) {

    return (
      <Box
        ref={Ref}
        my={3}
        borderRadius="14px"
        border="1px solid rgba(0, 0, 0, 0.08)"
        bg="#f9f9fa"
        overflow="hidden"
        maxW="100%"
        w="100%"
      >
        <Flex
          className="code-header"
          py={2}
          px={4}
          bg="#f3f4f6"
          borderBottom="1px solid rgba(0, 0, 0, 0.06)"
          color="#52525b"
          fontSize="12px"
          fontWeight="500"
          align="center"
          justify="space-between"
          userSelect="none"
        >
          <Box flex={1} className="textEllipsis">
            {codeBoxName}
          </Box>
          <Flex
            as="button"
            type="button"
            cursor="pointer"
            align="center"
            gap={1}
            px={2}
            py={0.5}
            borderRadius="6px"
            color={copied ? "#16a34a" : "#52525b"}
            _hover={{ bg: "rgba(0, 0, 0, 0.06)", color: "#18181b" }}
            transition="background 0.15s, color 0.15s"
            onClick={() => {
              copyData(String(children));
              setCopied(true);
              setTimeout(() => setCopied(false), 1400);
            }}
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
            <Text fontSize="12px">{copied ? "已复制" : "复制"}</Text>
          </Flex>
        </Flex>
        <Box overflow="auto" maxW="100%" bg="#f9f9fa">
          <SyntaxHighlighter
            style={codeLight as any}
            language={match?.[1]}
            PreTag="pre"
            customStyle={{
              margin: 0,
              padding: '14px 16px',
              background: 'transparent',
              maxWidth: '100%',
              overflow: 'auto',
            }}
            codeTagProps={{
              style: {
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                fontSize: '13.5px',
                lineHeight: '1.6',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              },
            }}
          >
            {processedChildren}
          </SyntaxHighlighter>
        </Box>
      </Box>
    );
  }

  return <code className={className}>{children}</code>;
};

export default React.memo(CodeLight);

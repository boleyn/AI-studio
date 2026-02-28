import React, { useMemo } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { Box, Flex } from '@chakra-ui/react';
import Icon from '@/components/common/MyIcon';
import { useCopyData } from '@/hooks/useCopyData';
import { useMarkdownWidth } from '../hooks';

export const codeLight: { [key: string]: React.CSSProperties } = {
  'code[class*=language-]': {
    color: '#d4d4d4',
    textShadow: 'none',
    direction: 'ltr',
    textAlign: 'left',
    whiteSpace: 'pre',
    wordSpacing: 'normal',
    wordBreak: 'normal',
    lineHeight: '1.5',
    MozTabSize: '4',
    OTabSize: '4',
    tabSize: '4',
    WebkitHyphens: 'none',
    MozHyphens: 'none',
    msHyphens: 'none',
    hyphens: 'none'
  },
  'pre[class*=language-]': {
    color: '#d4d4d4',
    textShadow: 'none',
    direction: 'ltr',
    textAlign: 'left',
    whiteSpace: 'pre',
    wordSpacing: 'normal',
    wordBreak: 'normal',
    lineHeight: '1.5',
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
    background: '#1e1e1e'
  },
  'code[class*=language-] ::selection': {
    textShadow: 'none',
    background: '#264f78'
  },
  'code[class*=language-]::selection': {
    textShadow: 'none',
    background: '#264f78'
  },
  'pre[class*=language-] ::selection': {
    textShadow: 'none',
    background: '#264f78'
  },
  'pre[class*=language-]::selection': {
    textShadow: 'none',
    background: '#264f78'
  },
  ':not(pre)>code[class*=language-]': {
    padding: '.1em .3em',
    borderRadius: '.3em',
    color: '#db4c69',
    background: '#1e1e1e'
  },
  '.namespace': {
    opacity: '0.7'
  },
  'doctype.doctype-tag': {
    color: '#569cd6'
  },
  'doctype.name': {
    color: '#9cdcfe'
  },
  comment: {
    color: '#6a9955'
  },
  prolog: {
    color: '#6a9955'
  },
  '.language-html .language-css .token.punctuation': {
    color: '#d4d4d4'
  },
  '.language-html .language-javascript .token.punctuation': {
    color: '#d4d4d4'
  },
  punctuation: {
    color: '#d4d4d4'
  },
  boolean: {
    color: '#569cd6'
  },
  constant: {
    color: '#9cdcfe'
  },
  inserted: {
    color: '#b5cea8'
  },
  number: {
    color: '#b5cea8'
  },
  property: {
    color: '#9cdcfe'
  },
  symbol: {
    color: '#b5cea8'
  },
  tag: {
    color: '#569cd6'
  },
  unit: {
    color: '#b5cea8'
  },
  'attr-name': {
    color: '#9cdcfe'
  },
  builtin: {
    color: '#ce9178'
  },
  char: {
    color: '#ce9178'
  },
  deleted: {
    color: '#ce9178'
  },
  selector: {
    color: '#d7ba7d'
  },
  string: {
    color: '#ce9178'
  },
  '.language-css .token.string.url': {
    textDecoration: 'underline'
  },
  entity: {
    color: '#569cd6'
  },
  operator: {
    color: '#d4d4d4'
  },
  'operator.arrow': {
    color: '#569cd6'
  },
  atrule: {
    color: '#ce9178'
  },
  'atrule.rule': {
    color: '#c586c0'
  },
  'atrule.url': {
    color: '#9cdcfe'
  },
  'atrule.url.function': {
    color: '#dcdcaa'
  },
  'atrule.url.punctuation': {
    color: '#d4d4d4'
  },
  keyword: {
    color: '#569cd6'
  },
  'keyword.control-flow': {
    color: '#c586c0'
  },
  'keyword.module': {
    color: '#c586c0'
  },
  function: {
    color: '#dcdcaa'
  },
  'function.maybe-class-name': {
    color: '#dcdcaa'
  },
  regex: {
    color: '#d16969'
  },
  important: {
    color: '#569cd6'
  },
  italic: {
    fontStyle: 'italic'
  },
  'class-name': {
    color: '#4ec9b0'
  },
  'maybe-class-name': {
    color: '#4ec9b0'
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
  // 使用动态宽度计算，设置代码块的最小宽度
  const { width, Ref } = useMarkdownWidth({
    minWidth: { base: 320, md: 500 }
  });

  if (codeBlock) {
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

    return (
      <Box
        ref={Ref}
        my={3}
        borderRadius={'md'}
        overflow={'hidden'}
        boxShadow={
          '0px 0px 1px 0px rgba(19, 51, 107, 0.08), 0px 1px 2px 0px rgba(19, 51, 107, 0.05)'
        }
        maxW={'100%'}
        w={width}
      >
        <Flex
          className="code-header"
          py={2}
          px={5}
          bg={'myGray.600'}
          color={'white'}
          fontSize={'sm'}
          userSelect={'none'}
        >
          <Box flex={1} className={'textEllipsis'}>
            {codeBoxName}
          </Box>
          <Flex cursor={'pointer'} onClick={() => copyData(String(children))} alignItems={'center'}>
            <Icon name={'copy'} width={15} height={15}></Icon>
            <Box ml={1}>{'复制'}</Box>
          </Flex>
        </Flex>
        <Box overflow={'auto'} maxW={'100%'}>
          <SyntaxHighlighter
            style={codeLight as any}
            language={match?.[1]}
            PreTag="pre"
            customStyle={{
              margin: 0,
              padding: '1rem',
              background: 'transparent',
              maxWidth: '100%',
              overflow: 'auto'
            }}
            codeTagProps={{
              style: {
                fontFamily: 'Monaco, Menlo, "Ubuntu Mono", monospace',
                fontSize: '14px',
                lineHeight: '1.5',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word'
              }
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

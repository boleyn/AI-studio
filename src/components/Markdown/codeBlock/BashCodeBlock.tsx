import React, { useMemo } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { Box, Flex } from '@chakra-ui/react';
import Icon from '@/components/common/MyIcon';
import { useCopyData } from '@/hooks/useCopyData';
import { codeLight } from './CodeLight';
import { useMarkdownWidth } from '../hooks';

interface BashCodeBlockProps {
  children: React.ReactNode & React.ReactNode[];
  className?: string;
  match: RegExpExecArray | null;
}

const BashCodeBlock: React.FC<BashCodeBlockProps> = ({ children, className, match }) => {
  const { copyData } = useCopyData();
  // 使用动态宽度计算，设置代码块的最小宽度
  const { width, Ref } = useMarkdownWidth({
    minWidth: { base: 320, md: 500 }
  });

  const processedCode = useMemo(() => {
    let code = String(children).replace(/&nbsp;/g, ' ');

    // 移除开头和结尾的多余空白
    code = code.trim();

    // 确保每个命令都在新行开始
    code = code.replace(/([^;\n])\s*\$\s*/g, '$1\n$ ');

    // 确保代码块有适当的换行
    if (!code.startsWith('\n') && code.length > 0) {
      code = '\n' + code;
    }

    if (!code.endsWith('\n') && code.length > 0) {
      code = code + '\n';
    }

    return code;
  }, [children]);

  const language = match?.[1] || 'bash';

  return (
    <Box
      ref={Ref}
      my={3}
      borderRadius={'md'}
      overflow={'overlay'}
      boxShadow={'0px 0px 1px 0px rgba(19, 51, 107, 0.08), 0px 1px 2px 0px rgba(19, 51, 107, 0.05)'}
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
        <Box flex={1}>{language}</Box>
        <Flex cursor={'pointer'} onClick={() => copyData(String(children))} alignItems={'center'}>
          <Icon name={'copy'} width={15} height={15}></Icon>
          <Box ml={1}>{'复制'}</Box>
        </Flex>
      </Flex>
      <SyntaxHighlighter
        style={codeLight as any}
        language={language}
        PreTag="pre"
        customStyle={{
          margin: 0,
          padding: '1rem',
          background: 'transparent',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word'
        }}
        codeTagProps={{
          style: {
            fontFamily: 'Monaco, Menlo, "Ubuntu Mono", monospace',
            fontSize: '14px',
            lineHeight: '1.6'
          }
        }}
      >
        {processedCode}
      </SyntaxHighlighter>
    </Box>
  );
};

export default React.memo(BashCodeBlock);

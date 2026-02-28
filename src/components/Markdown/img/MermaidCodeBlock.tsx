import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Box, useDisclosure } from '@chakra-ui/react';
import mermaid from 'mermaid';
import MyIcon from '@/components/common/MyIcon';
import MyTooltip from '@/components/common/MyTooltip';
import MermaidEditor from './MermaidEditor';
import { ensureMermaidInitialized, exportSvgToJpg } from './utils';
import { useSystem } from '@/hooks/useSystem';
import MyPhotoView from '@/components/common/Image/PhotoView';

const punctuationMap: Record<string, string> = {
  '，': ',',
  '；': ';',
  '。': '.',
  '：': ':',
  '！': '!',
  '？': '?',
  '"': '"', // 中文双引号映射到英文双引号
  "'": "'",
  '【': '[',
  '】': ']',
  '（': '(',
  '）': ')',
  '《': '<',
  '》': '>',
  '、': ','
};

interface MermaidBlockProps {
  code: string;
  onCodeChange?: (newCode: string) => void;
}

const MermaidBlock: React.FC<MermaidBlockProps> = ({ code, onCodeChange }) => {
  const { isPc } = useSystem();
  const ref = useRef<HTMLDivElement>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [svg, setSvg] = useState('');
  const [editingText, setEditingText] = useState('');
  const [editingElement, setEditingElement] = useState<SVGElement | null>(null);
  const [currentCode, setCurrentCode] = useState(code); // 新增：内部状态管理当前代码
  const {
    isOpen: isTextEditOpen,
    onOpen: onTextEditOpen,
    onClose: onTextEditClose
  } = useDisclosure();

  // 使用内部状态的代码而不是props中的code
  useEffect(() => {
    (async () => {
      if (!currentCode) return;
      try {
        ensureMermaidInitialized();
        setIsLoading(true);
        setError('');
        const formatCode = currentCode.replace(
          new RegExp(`[${Object.keys(punctuationMap).join('')}]`, 'g'),
          (match) => punctuationMap[match]
        );
        const { svg } = await mermaid.render(`mermaid-${Date.now()}`, formatCode);
        setSvg(svg);
        setIsLoading(false);
      } catch (e: any) {
        setError(e?.message || '');
        setIsLoading(false);
        // console.log('[Mermaid] ', e?.message);
      }
    })();
  }, [currentCode]); // 依赖于 currentCode 而不是 code

  // 当外部 code 改变时，更新内部状态
  useEffect(() => {
    setCurrentCode(code);
  }, [code]);

  // 添加点击事件监听器，使文本可编辑
  useEffect(() => {
    if (!ref.current || !onCodeChange) return;

    const svgElement = ref.current.querySelector('svg');
    if (!svgElement) return;

    const handleTextClick = (event: Event) => {
      const target = event.target as SVGElement;

      // 查找文本元素
      let textElement: SVGElement | null = null;
      if (target.tagName === 'text') {
        textElement = target;
      } else if (target.tagName === 'tspan') {
        textElement = target.parentElement as unknown as SVGElement;
      } else if (target.parentElement?.tagName === 'text') {
        textElement = target.parentElement as unknown as SVGElement;
      }

      if (textElement && textElement.tagName === 'text') {
        event.stopPropagation();
        const currentText = textElement.textContent || '';
        setEditingText(currentText);
        setEditingElement(textElement);
        onTextEditOpen();
      }
    };

    // 为所有文本元素添加点击事件
    const textElements = svgElement.querySelectorAll('text');
    textElements.forEach((element) => {
      element.style.cursor = 'pointer';
      element.addEventListener('click', handleTextClick);
    });

    return () => {
      textElements.forEach((element) => {
        element.removeEventListener('click', handleTextClick);
      });
    };
  }, [svg, onCodeChange, onTextEditOpen]);

  // 移除旧的导出实现（PNG/SVG），统一使用下方的 JPG 实现

  const handleCodeChange = (newCode: string) => {
    setCurrentCode(newCode);
    if (onCodeChange) {
      onCodeChange(newCode);
    }
  };

  const handleTextSave = () => {
    if (!editingElement) return;

    // 更新 SVG 中的文本
    if (editingElement.textContent !== editingText) {
      editingElement.textContent = editingText;

      // 尝试更新原始代码
      const oldText = editingElement.textContent || '';
      const newCode = currentCode.replace(oldText, editingText);

      // 更新内部状态
      setCurrentCode(newCode);

      // 如果有外部回调，也调用它
      if (onCodeChange && newCode !== currentCode) {
        onCodeChange(newCode);
      }
    }

    onTextEditClose();
    setEditingElement(null);
  };

  const handleTextCancel = () => {
    onTextEditClose();
    setEditingElement(null);
  };

  // 导出 JPG（高分辨率）
  const exportJpg = useCallback(() => {
    if (!svg) return;
    exportSvgToJpg(svg, 'mermaid');
  }, [svg]);

  if (isLoading) {
    return (
      <Box
        minW={'100px'}
        minH={'50px'}
        py={4}
        bg={'gray.50'}
        borderRadius={'md'}
        textAlign={'center'}
      >
        Loading...
      </Box>
    );
  }

  if (error) {
    return (
      <Box minW={'100px'} minH={'50px'} py={4} bg={'red.50'} borderRadius={'md'} p={3}>
        <Box color={'red.600'} fontSize={'sm'}>
          {error}
        </Box>
      </Box>
    );
  }

  return (
    <>
      <MyPhotoView src={svg}>
        <Box
          position={'relative'}
          cursor={'zoom-in'}
          _hover={{
            '& .toolbar': { display: 'flex' }
          }}
        >
          <Box
            overflowY={'auto'}
            overflowX={'hidden'}
            ref={ref}
            minW={'100px'}
            minH={'50px'}
            py={4}
            sx={{
              '& svg': {
                width: '100% !important',
                height: 'auto !important',
                maxWidth: '100% !important',
                display: 'block'
              }
            }}
            dangerouslySetInnerHTML={{ __html: svg }}
          />
          {/* 统一右上角工具栏：编辑 + 导出JPG */}
          <Box
            className="toolbar"
            display={'none'}
            position={'absolute'}
            top={0}
            right={0}
            zIndex={2}
            bg={'rgba(255,255,255,0.9)'}
            backdropFilter={'blur(4px)'}
            border={'1px solid'}
            borderColor={'myGray.200'}
            borderRadius={'md'}
            px={2}
            py={1}
            alignItems={'center'}
            onClick={(e) => e.stopPropagation()}
          >
            <MyTooltip label={'下载'}>
              <MyIcon
                name={'common/download'}
                w={'18px'}
                color={'myGray.600'}
                _hover={{ color: 'primary.600' }}
                mr={2}
                cursor={'pointer'}
                onClick={exportJpg}
                aria-label={'下载'}
              />
            </MyTooltip>
            {/* 编辑按钮放在最后，统一容器内排布，移动端不显示 */}
            {isPc && (
              <Box>
                <MermaidEditor code={currentCode} onCodeChange={handleCodeChange} />
              </Box>
            )}
          </Box>
        </Box>
      </MyPhotoView>
    </>
  );
};

export default MermaidBlock;

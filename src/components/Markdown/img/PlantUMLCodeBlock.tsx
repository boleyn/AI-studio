import React, { useEffect, useRef, useCallback, useState } from 'react';
import { Box, Button, useDisclosure, ModalBody, ModalFooter, Input } from '@chakra-ui/react';
import { deflateRaw } from 'pako';
import MyIcon from '@/components/common/MyIcon';
import MyTooltip from '@/components/common/MyTooltip';
import MyModal from '@/components/common/MyModal';
import PlantUMLEditor from './PlantUMLEditor';
import { exportSvgToJpg, downloadBlob } from './utils';
import { useSystem } from '@/hooks/useSystem';
import MyPhotoView from '@/components/common/Image/PhotoView';

// 全局缓存，页面刷新时会清除
const renderCache = new Map<string, string>();
// 进行中请求缓存，防止同一份代码并发/重复请求
const inflightRenderCache = new Map<string, Promise<string>>();
// 已尝试过的渲染（无论成功或失败），用于确保每个 plantuml 只请求一次
const attemptedRenderCache = new Set<string>();

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

/**
 * 对 PlantUML 源码进行编码，生成字符串用于 PlantUML 服务器。
 * @param text PlantUML 源码
 * @returns 编码后的字符串
 */
function encodePlantUML(text: string): string {
  // UTF-8 编码
  const encoder = new TextEncoder();
  const data = encoder.encode(text);

  // Raw deflate 压缩（无 zlib header）
  const compressed = deflateRaw(data);

  // PlantUML 专用的 64 字符映射表
  const base64Table = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_';

  // 按 3 字节一组编码为 4 个字符
  let result = '';
  for (let i = 0; i < compressed.length; i += 3) {
    const b1 = compressed[i];
    const b2 = i + 1 < compressed.length ? compressed[i + 1] : 0;
    const b3 = i + 2 < compressed.length ? compressed[i + 2] : 0;

    const c1 = b1 >> 2;
    const c2 = ((b1 & 0x3) << 4) | (b2 >> 4);
    const c3 = ((b2 & 0xf) << 2) | (b3 >> 6);
    const c4 = b3 & 0x3f;

    result += base64Table[c1];
    result += base64Table[c2];
    // 如果最后只剩 1 个或 2 个字节，不必填满 4 个字符
    if (i + 1 < compressed.length) result += base64Table[c3];
    if (i + 2 < compressed.length) result += base64Table[c4];
  }

  return result;
}

interface PlantUMLBlockProps {
  code: string;
  onCodeChange?: (newCode: string) => void;
  dataId?: string; // 用于 React.memo 比较，避免不必要的重渲染
}

// 提取完整代码的辅助函数（移到组件外部，供初始化使用）
function extractCompleteCodeHelper(plantumlCode: string): string | null {
  const trimmedCode = plantumlCode.trim();
  const endumlIndex = trimmedCode.indexOf('@enduml');
  if (endumlIndex === -1) {
    return null;
  }
  return trimmedCode.substring(0, endumlIndex + '@enduml'.length);
}

const PlantUMLBlock: React.FC<PlantUMLBlockProps> = ({ code, onCodeChange, dataId }) => {
  const { isPc } = useSystem();
  const ref = useRef<HTMLDivElement>(null);

  // 在初始化时就检查缓存，避免闪烁
  const getInitialSvg = () => {
    const completeCode = extractCompleteCodeHelper(code);
    if (completeCode && renderCache.has(completeCode)) {
      return renderCache.get(completeCode)!;
    }
    return '';
  };

  const initialSvg = getInitialSvg();
  const lastStableSvgRef = useRef<string>(initialSvg); // 持有上一次非空 SVG
  const [svg, setSvg] = useState(initialSvg);
  const [editingText, setEditingText] = useState('');
  const [editingElement, setEditingElement] = useState<SVGElement | null>(null);
  const [currentCode, setCurrentCode] = useState(code); // 新增：内部状态管理当前代码
  const [lastRenderedCode, setLastRenderedCode] = useState(
    initialSvg ? extractCompleteCodeHelper(code) || '' : ''
  ); // 记录上次渲染的代码
  const {
    isOpen: isTextEditOpen,
    onOpen: onTextEditOpen,
    onClose: onTextEditClose
  } = useDisclosure();

  // PlantUML 编码函数 - 使用正确的 deflateRaw + 特殊 base64 编码
  const encodePlantUMLCode = useCallback((text: string): string => {
    try {
      return encodePlantUML(text);
    } catch (e) {
      // 编码失败时回退到简单的 URL 编码
      return encodeURIComponent(text);
    }
  }, []);

  // PlantUML 渲染函数
  const renderPlantUML = useCallback(
    async (plantumlCode: string) => {
      try {
        // 提取完整的代码块
        const completeCode = extractCompleteCodeHelper(plantumlCode);

        if (!completeCode) {
          return;
        }

        // 检查是否已经渲染过相同的代码
        if (completeCode === lastRenderedCode) {
          return;
        }

        // 使用完整代码作为缓存键
        const cacheKey = completeCode;

        // 检查缓存
        if (renderCache.has(cacheKey)) {
          const cachedSvg = renderCache.get(cacheKey)!;
          setSvg(cachedSvg);
          if (cachedSvg) {
            lastStableSvgRef.current = cachedSvg; // 更新稳定 SVG 引用
          }
          setLastRenderedCode(completeCode);
          return;
        }

        // 检查进行中请求，若存在则等待同一请求完成并复用结果
        if (inflightRenderCache.has(cacheKey)) {
          try {
            const svgContent = await inflightRenderCache.get(cacheKey)!;
            setSvg(svgContent);
            if (svgContent) {
              lastStableSvgRef.current = svgContent; // 更新稳定 SVG 引用
            }
            setLastRenderedCode(completeCode);
            return;
          } catch (e) {
            // 进行中请求失败，标记本次代码已尝试，后续不再重试，等待代码变更
            attemptedRenderCache.add(cacheKey);
            setLastRenderedCode(completeCode);
            setSvg('');
            return;
          }
        }

        // 若之前已尝试过（包含失败），则不再请求，等待代码变更
        if (attemptedRenderCache.has(cacheKey)) {
          setLastRenderedCode(completeCode);
          return;
        }

        // 格式化代码，替换中文标点符号
        const formatCode = completeCode.replace(
          new RegExp(`[${Object.keys(punctuationMap).join('')}]`, 'g'),
          (match) => punctuationMap[match]
        );

        // 使用 PlantUML 在线服务渲染
        // 不需要任何前缀（不要加 ~1），直接将编码后的字符串拼接在 /plantuml/svg/ 后面
        const encodedCode = encodePlantUMLCode(formatCode);
        const plantumlUrl = `https://www.plantuml.com/plantuml/svg/${encodedCode}`;

        // 记录已尝试，确保同一代码仅请求一次
        attemptedRenderCache.add(cacheKey);
        // 发起并缓存进行中的请求，确保并发场景只请求一次
        const inflight = (async () => {
          const response = await fetch(plantumlUrl);
          const contentType = response.headers.get('content-type') || '';
          const text = await response.text();
          const isSvg = contentType.includes('image/svg') || text.trim().startsWith('<svg');
          if (!response.ok && !isSvg) {
            throw new Error(response.statusText);
          }
          renderCache.set(cacheKey, text);
          return text;
        })().finally(() => {
          inflightRenderCache.delete(cacheKey);
        });

        inflightRenderCache.set(cacheKey, inflight);

        const svgContent = await inflight;
        setSvg(svgContent);
        if (svgContent) {
          lastStableSvgRef.current = svgContent; // 更新稳定 SVG 引用
        }
        setLastRenderedCode(completeCode); // 记录已渲染的代码
      } catch (e: any) {
        // 失败同样认为该代码已尝试渲染，避免重复请求
        const completeCode = extractCompleteCodeHelper(plantumlCode);
        if (completeCode) {
          attemptedRenderCache.add(completeCode);
          setLastRenderedCode(completeCode);
        }
        setSvg('');
      }
    },
    [encodePlantUMLCode, lastRenderedCode]
  );

  // 当代码变化时进行渲染
  useEffect(() => {
    if (!currentCode) return;
    renderPlantUML(currentCode);
  }, [currentCode, renderPlantUML]);

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

  const exportJpg = useCallback(() => {
    const svgHtml = ref.current?.innerHTML || '';
    if (!svgHtml) return;
    exportSvgToJpg(svgHtml, 'plantuml');
  }, []);
  const exportSvg = useCallback(() => {
    const svgEl = ref.current?.children[0];
    if (!svgEl) return;
    const svgHtml = ref.current?.innerHTML || '';
    const blob = new Blob([svgHtml], { type: 'image/svg+xml;charset=utf-8' });
    downloadBlob(`plantuml-${Date.now()}.svg`, blob);
  }, [downloadBlob]);

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

  return (
    <>
      <MyPhotoView src={svg || lastStableSvgRef.current}>
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
            dangerouslySetInnerHTML={{ __html: svg || lastStableSvgRef.current }}
          />
          {/* 统一右上角工具栏：编辑 + 导出SVG/PNG */}
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
            <MyTooltip label="Export JPG">
              <MyIcon
                name={'export'}
                w={'18px'}
                color={'myGray.600'}
                _hover={{ color: 'primary.600' }}
                mr={2}
                cursor={'pointer'}
                onClick={exportJpg}
              />
            </MyTooltip>
            {isPc && (
              <Box>
                <PlantUMLEditor code={currentCode} onCodeChange={handleCodeChange} />
              </Box>
            )}
          </Box>
        </Box>
      </MyPhotoView>

      {/* 文本编辑模态框 */}
      <MyModal isOpen={isTextEditOpen} onClose={handleTextCancel} title={'编辑'}>
        <ModalBody>
          <Input
            value={editingText}
            onChange={(e) => setEditingText(e.target.value)}
            placeholder={'请输入文本'}
          />
        </ModalBody>
        <ModalFooter>
          <Button variant="outline" mr={3} onClick={handleTextCancel}>
            {'取消'}
          </Button>
          <Button colorScheme="blue" onClick={handleTextSave}>
            {'保存'}
          </Button>
        </ModalFooter>
      </MyModal>
    </>
  );
};

export default React.memo(PlantUMLBlock, (prevProps, nextProps) => {
  // 仅当 code 或 dataId 变化时才重渲染
  return prevProps.code === nextProps.code && prevProps.dataId === nextProps.dataId;
});

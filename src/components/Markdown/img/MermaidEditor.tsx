import React, { useState, useEffect, useRef } from 'react';
import {
  Box,
  Button,
  useDisclosure,
  ModalBody,
  ModalFooter,
  Flex,
  Text,
  IconButton,
  Textarea
} from '@chakra-ui/react';
import mermaid from 'mermaid';
import MyIcon from '@/components/common/MyIcon';
import MyModal from '@/components/common/MyModal';
import MyTooltip from '@/components/common/MyTooltip';
import { useCopyData } from '@/hooks/useCopyData';
import { ensureMermaidInitialized, exportSvgToJpg } from './utils';

interface MermaidEditorProps {
  code: string;
  onCodeChange?: (newCode: string) => void;
}

const MermaidEditor: React.FC<MermaidEditorProps> = ({ code, onCodeChange }) => {
  const [editCode, setEditCode] = useState('');
  const [previewSvg, setPreviewSvg] = useState('');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [error, setError] = useState<string>('');
  const { isOpen, onOpen, onClose } = useDisclosure();
  const { copyData } = useCopyData();
  const [editWidthPct, setEditWidthPct] = useState(40); // 初始 40%:60%
  const [previewScale, setPreviewScale] = useState(1);
  const [previewPan, setPreviewPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const previewContainerRef = useRef<HTMLDivElement>(null);
  const previewContentRef = useRef<HTMLDivElement>(null);
  const isPanningRef = useRef(false);
  const panStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const headerHeight = '52px';
  const previewMinScale = 0.1;
  const previewMaxScale = 4;
  const previewStep = 0.05;

  const exportJpg = () => {
    if (!previewSvg) return;
    exportSvgToJpg(previewSvg, 'mermaid');
  };

  useEffect(() => {
    const onMove = (e: MouseEvent | TouchEvent) => {
      if (!draggingRef.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const clientX =
        (e as TouchEvent).touches && (e as TouchEvent).touches.length > 0
          ? (e as TouchEvent).touches[0].clientX
          : (e as MouseEvent).clientX;
      let pct = ((clientX - rect.left) / rect.width) * 100;
      pct = Math.max(20, Math.min(80, pct)); // 限制 20% ~ 80%
      setEditWidthPct(pct);
      // 防止页面滚动
      if ('preventDefault' in e) {
        (e as any).preventDefault?.();
      }
    };
    const onUp = () => {
      draggingRef.current = false;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onUp);
    };
  }, []);

  useEffect(() => {
    const handlePanMove = (clientX: number, clientY: number) => {
      if (!isPanningRef.current) return;
      const dx = clientX - panStartRef.current.x;
      const dy = clientY - panStartRef.current.y;
      setPreviewPan({
        x: panStartRef.current.panX + dx,
        y: panStartRef.current.panY + dy
      });
    };

    const onMouseMove = (e: MouseEvent) => handlePanMove(e.clientX, e.clientY);
    const onMouseUp = () => {
      if (!isPanningRef.current) return;
      isPanningRef.current = false;
      setIsPanning(false);
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!isPanningRef.current || e.touches.length === 0) return;
      e.preventDefault();
      handlePanMove(e.touches[0].clientX, e.touches[0].clientY);
    };
    const onTouchEnd = () => {
      if (!isPanningRef.current) return;
      isPanningRef.current = false;
      setIsPanning(false);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onTouchEnd);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
    };
  }, []);

  // Mermaid 配置：统一初始化
  useEffect(() => {
    ensureMermaidInitialized();
  }, []);

  // 实时预览
  useEffect(() => {
    if (!isOpen || !editCode.trim()) {
      setPreviewSvg('');
      setError('');
      return;
    }

    const renderPreview = async () => {
      try {
        const { svg } = await mermaid.render(`mermaid-preview-${Date.now()}`, editCode);
        setPreviewSvg(svg);
        setError('');
      } catch (e: any) {
        setError(e?.message || 'Syntax error');
        setPreviewSvg('');
      }
    };

    const timeoutId = setTimeout(renderPreview, 300); // 防抖
    return () => clearTimeout(timeoutId);
  }, [editCode, isOpen]);

  useEffect(() => {
    if (!previewSvg) {
      setPreviewPan({ x: 0, y: 0 });
      return;
    }
    const rafId = requestAnimationFrame(() => recenterPreview());
    return () => cancelAnimationFrame(rafId);
  }, [previewSvg]);

  const handleEdit = () => {
    setEditCode(code);
    setError('');
    setPreviewScale(1);
    onOpen();
  };

  const handleSave = () => {
    if (error) {
      return;
    }

    if (onCodeChange) {
      onCodeChange(editCode);
    }
    onClose();
  };

  const toggleFullscreen = () => {
    setIsFullscreen(!isFullscreen);
  };

  const handleClose = () => {
    setIsFullscreen(false);
    setPreviewScale(1);
    onClose();
  };

  // ESC 键退出全屏
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isFullscreen) {
        setIsFullscreen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [isOpen, isFullscreen]);

  const handleCopyCode = () => {
    copyData(editCode);
  };

  const clampScale = (value: number) => Math.min(previewMaxScale, Math.max(previewMinScale, value));

  const handleZoomChange = (delta: number) => {
    setPreviewScale((prev) => {
      const nextValue = Number((prev + delta).toFixed(2));
      return clampScale(nextValue);
    });
  };

  const handlePreviewWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -previewStep : previewStep;
    handleZoomChange(delta);
  };

  const recenterPreview = (scale = previewScale) => {
    const container = previewContainerRef.current;
    const content = previewContentRef.current;
    if (!container || !content) return;
    const svg = content.querySelector('svg');
    if (!svg) return;
    const containerRect = container.getBoundingClientRect();
    const bbox = svg.getBBox?.();
    const baseWidth = bbox?.width || svg.clientWidth || 0;
    const baseHeight = bbox?.height || svg.clientHeight || 0;
    if (!baseWidth || !baseHeight) return;
    setPreviewPan({
      x: (containerRect.width - baseWidth * scale) / 2,
      y: (containerRect.height - baseHeight * scale) / 2
    });
  };

  const startPanning = (clientX: number, clientY: number) => {
    const container = previewContainerRef.current;
    if (!container) return;
    isPanningRef.current = true;
    setIsPanning(true);
    panStartRef.current = {
      x: clientX,
      y: clientY,
      panX: previewPan.x,
      panY: previewPan.y
    };
  };

  const handlePanStart = (e: React.MouseEvent) => {
    if (!previewSvg) return;
    e.preventDefault();
    startPanning(e.clientX, e.clientY);
  };

  const handleTouchPanStart = (e: React.TouchEvent) => {
    if (!previewSvg || e.touches.length !== 1) return;
    startPanning(e.touches[0].clientX, e.touches[0].clientY);
  };

  const handleResetView = () => {
    setPreviewScale(1);
    recenterPreview(1);
  };

  return (
    <>
      <Button
        size="sm"
        leftIcon={<MyIcon name="edit" w="14px" />}
        onClick={handleEdit}
        variant="outline"
      >
        {'编辑'} Mermaid
      </Button>

      <MyModal
        isOpen={isOpen}
        onClose={handleClose}
        title={`Mermaid ${'编辑'}`}
        maxW={isFullscreen ? '100vw' : '70vw'}
        maxH={isFullscreen ? '100vh' : '80vh'}
        w={isFullscreen ? '100vw' : '70vw'}
        h={isFullscreen ? '100vh' : '80vh'}
        m={isFullscreen ? 0 : undefined}
        borderRadius={isFullscreen ? 0 : undefined}
      >
        <ModalBody p={0}>
          <Flex ref={containerRef} h={isFullscreen ? 'calc(100vh - 140px)' : '70vh'}>
            {/* 左侧编辑区 */}
            <Box
              flex="none"
              w={`${editWidthPct}%`}
              minW="20%"
              maxW="80%"
              borderRight="1px solid"
              borderColor="gray.200"
            >
              {/* 工具栏 */}
              <Flex
                px={3}
                h={headerHeight}
                borderBottom="1px solid"
                borderColor="gray.200"
                alignItems="center"
                justifyContent="space-between"
                bg="gray.50"
              >
                <Text fontSize="sm" fontWeight="bold">
                  {'编辑'}
                </Text>
                <Flex gap={2}>
                  <MyTooltip label={'复制'}>
                    <IconButton
                      size="sm"
                      variant="ghost"
                      icon={<MyIcon name="copy" w="14px" />}
                      onClick={handleCopyCode}
                      aria-label={'复制'}
                    />
                  </MyTooltip>
                  <MyTooltip label={'下载'}>
                    <IconButton
                      size="sm"
                      variant="ghost"
                      icon={<MyIcon name="common/download" w="14px" />}
                      onClick={exportJpg}
                      aria-label={'下载'}
                    />
                  </MyTooltip>
                  <MyTooltip
                    label={isFullscreen ? '退出全屏' : '全屏'}
                  >
                    <IconButton
                      size="sm"
                      variant="ghost"
                      icon={
                        <MyIcon
                          name={!isFullscreen ? 'common/fullScreenLight' : 'common/miniScreenLight'}
                          w="14px"
                        />
                      }
                      onClick={toggleFullscreen}
                      aria-label={
                        isFullscreen ? '退出全屏' : '全屏'
                      }
                    />
                  </MyTooltip>
                </Flex>
              </Flex>

              {/* 代码编辑器 */}
              <Box p={3} h={`calc(100% - ${headerHeight})`}>
                <Textarea
                  value={editCode}
                  onChange={(e) => setEditCode(e.target.value)}
                  h="100%"
                  fontFamily="Monaco, Menlo, 'Ubuntu Mono', monospace"
                  fontSize="14px"
                  resize="none"
                  bg="gray.50"
                  placeholder="Enter Mermaid code here..."
                />
              </Box>
            </Box>

            {/* 分隔条 */}
            <Box
              w="6px"
              flex="none"
              cursor="col-resize"
              bg="gray.200"
              _hover={{ bg: 'gray.300' }}
              onMouseDown={() => {
                draggingRef.current = true;
              }}
              onTouchStart={() => {
                draggingRef.current = true;
              }}
            />

            {/* 右侧预览区 */}
            <Box flex={1}>
              <Flex
                px={3}
                h={headerHeight}
                borderBottom="1px solid"
                borderColor="gray.200"
                bg="gray.50"
                alignItems="center"
                justifyContent="space-between"
              >
                <Text fontSize="sm" fontWeight="bold">
                  {'预览'}
                </Text>
                <Flex alignItems="center" gap={2}>
                  {error && (
                    <Text fontSize="xs" color="red.500">
                      ⚠️ {error}
                    </Text>
                  )}
                  <Flex alignItems="center" gap={1}>
                    <MyTooltip label={'重置'}>
                      <IconButton
                        size="sm"
                        variant="ghost"
                        icon={<MyIcon name="common/refresh" w="14px" />}
                        onClick={handleResetView}
                        aria-label={'重置'}
                      />
                    </MyTooltip>
                    <MyTooltip label={'缩小'}>
                      <IconButton
                        size="sm"
                        variant="ghost"
                        icon={<MyIcon name="common/subtract" w="14px" />}
                        onClick={() => handleZoomChange(-previewStep)}
                        aria-label={'缩小'}
                        isDisabled={previewScale <= previewMinScale}
                      />
                    </MyTooltip>
                    <Text fontSize="xs" color="gray.600" minW="44px" textAlign="center">
                      {Math.round(previewScale * 100)}%
                    </Text>
                    <MyTooltip label={'放大'}>
                      <IconButton
                        size="sm"
                        variant="ghost"
                        icon={<MyIcon name="common/addLight" w="14px" />}
                        onClick={() => handleZoomChange(previewStep)}
                        aria-label={'放大'}
                        isDisabled={previewScale >= previewMaxScale}
                      />
                    </MyTooltip>
                  </Flex>
                </Flex>
              </Flex>
              <Box
                p={4}
                h={`calc(100% - ${headerHeight})`}
                overflow="hidden"
                bg="white"
                display="flex"
                alignItems="center"
                justifyContent="center"
                onWheel={handlePreviewWheel}
                onMouseDown={handlePanStart}
                onTouchStart={handleTouchPanStart}
                cursor={previewSvg ? (isPanning ? 'grabbing' : 'grab') : 'default'}
                ref={previewContainerRef}
                position="relative"
                userSelect={isPanning ? 'none' : 'auto'}
              >
                {previewSvg ? (
                  <Box
                    ref={previewContentRef}
                    position="absolute"
                    top={0}
                    left={0}
                    transform={`translate(${previewPan.x}px, ${previewPan.y}px) scale(${previewScale})`}
                    transformOrigin="top left"
                    sx={{
                      '& svg': {
                        width: 'auto !important',
                        height: 'auto !important',
                        maxWidth: 'none !important',
                        display: 'block'
                      }
                    }}
                    dangerouslySetInnerHTML={{ __html: previewSvg }}
                  />
                ) : error ? (
                  <Box textAlign="center" color="red.500">
                    <MyIcon name="common/warningLight" w="24px" mb={2} />
                    <Text fontSize="sm">Syntax error, please check code</Text>
                  </Box>
                ) : (
                  <Box textAlign="center" color="gray.400">
                    <MyIcon name="empty" w="24px" mb={2} />
                    <Text fontSize="sm">Enter code to preview</Text>
                  </Box>
                )}
              </Box>
            </Box>
          </Flex>
        </ModalBody>

        <ModalFooter>
          <Button variant="outline" mr={3} onClick={handleClose}>
            {'取消'}
          </Button>
          <Button colorScheme="blue" onClick={handleSave} isDisabled={!!error}>
            {'保存'}
          </Button>
        </ModalFooter>
      </MyModal>
    </>
  );
};

export default MermaidEditor;

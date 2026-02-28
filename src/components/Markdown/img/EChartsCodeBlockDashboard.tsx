import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box } from '@chakra-ui/react';
import json5 from 'json5';
import { useSystem } from '@/hooks/useSystem';
import { useScreen } from '@/hooks/useScreen';
import dynamic from 'next/dynamic';

const EChartsRender = dynamic(
  () => import('@/features/dashboard/components/EChartsRenderViewer'),
  {
    ssr: false
  }
);

const EChartsCodeBlockDashboard = ({ code }: { code: string }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const { isPc } = useSystem();
  const [width, setWidth] = useState(400);

  const baseOption = useMemo(() => {
    try {
      return json5.parse(code.trim());
    } catch {
      return {};
    }
  }, [code]);

  const calcWidth = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;

    // 找到 MessageCard 容器（chat-box-card 的父元素）
    let parent: HTMLElement | null = el.parentElement;
    while (parent && !String(parent.className).includes('chat-box-card')) {
      parent = parent.parentElement;
    }

    // MessageCard 就是 chat-box-card 的父元素
    const messageCard = parent?.parentElement as HTMLElement | undefined;

    if (messageCard?.clientWidth) {
      // 直接使用 MessageCard 的实际宽度，减去其内边距
      // MessageCard 内边距: px: 4 = 32px (16px * 2)
      const messageCardPadding = 32;
      const availableWidth = messageCard.clientWidth - messageCardPadding;

      // 设置合理的最小宽度，确保图表可读
      const minWidth = Math.max(200, Math.min(300, availableWidth * 0.6));
      setWidth(Math.max(availableWidth, minWidth));
    } else {
      // 回退方案：根据屏幕宽度计算
      // 模拟 MessageCard 的 maxW 计算
      const cardMaxWidth = isPc
        ? window.innerWidth - 40 // calc(100% - 40px)
        : window.innerWidth - 25; // calc(100% - 25px)
      const messageCardPadding = 32;
      const availableWidth = cardMaxWidth - messageCardPadding;
      const minWidth = Math.max(200, Math.min(300, availableWidth * 0.6));
      setWidth(Math.max(availableWidth, minWidth));
    }
  }, [isPc]);

  const { screenWidth } = useScreen();
  useEffect(() => {
    calcWidth();
  }, [screenWidth, calcWidth]);

  return (
    <Box overflowX={'auto'} bg={'white'} borderRadius={'md'} ref={containerRef} maxW={'100%'}>
      <EChartsRender option={baseOption} width={`${width}px`} height={'300px'} />
    </Box>
  );
};

export default EChartsCodeBlockDashboard;

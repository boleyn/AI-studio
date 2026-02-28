import { useScreen } from '@/hooks/useScreen';
import { useSystem } from '@/hooks/useSystem';
import { useCallback, useEffect, useRef, useState } from 'react';

export const useMarkdownWidth = (options?: { minWidth?: { base?: number; md?: number } }) => {
  const Ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(400);
  const { screenWidth } = useScreen();
  const { isPc } = useSystem();

  // 从选项获取最小宽度，默认为 150-200px（保持向后兼容）
  const minWidthBase = options?.minWidth?.base ?? 150;
  const minWidthMd = options?.minWidth?.md ?? 200;

  const findMarkdownDom = useCallback(() => {
    if (!Ref.current) return;

    // 找到 MessageCard 容器（chat-box-card 的父元素）
    let parent = Ref.current?.parentElement;
    while (parent && !parent.className.includes('chat-box-card')) {
      parent = parent.parentElement;
    }

    // MessageCard 就是 chat-box-card 的父元素
    const messageCard = parent?.parentElement;

    // 根据设备类型选择最小宽度
    const currentMinWidth = isPc ? minWidthMd : minWidthBase;

    if (messageCard?.clientWidth) {
      // 直接使用 MessageCard 的实际宽度，减去其内边距
      // MessageCard 内边距: px: 4 = 32px (16px * 2)
      const messageCardPadding = 32;
      const availableWidth = messageCard.clientWidth - messageCardPadding;

      // 使用自定义的最小宽度，确保内容可读
      const minWidth = Math.max(
        currentMinWidth,
        Math.min(currentMinWidth * 1.5, availableWidth * 0.5)
      );
      setWidth(Math.max(availableWidth, minWidth));
    } else {
      // 回退方案：根据屏幕宽度计算
      // 模拟 MessageCard 的 maxW 计算
      const cardMaxWidth = isPc
        ? screenWidth - 40 // calc(100% - 40px)
        : screenWidth - 25; // calc(100% - 25px)
      const messageCardPadding = 32;
      const availableWidth = cardMaxWidth - messageCardPadding;
      const minWidth = Math.max(
        currentMinWidth,
        Math.min(currentMinWidth * 1.5, availableWidth * 0.5)
      );
      setWidth(Math.max(availableWidth, minWidth));
    }
    return parent?.parentElement;
  }, [isPc, screenWidth, minWidthBase, minWidthMd]);

  useEffect(() => {
    findMarkdownDom();
  }, [findMarkdownDom, screenWidth, Ref.current]);

  return {
    Ref,
    width
  };
};

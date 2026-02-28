import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ECharts } from 'echarts';
import { Box, Skeleton } from '@chakra-ui/react';
import json5 from 'json5';
import { useMount } from 'ahooks';
import { useSystem } from '@/hooks/useSystem';
import { useScreen } from '@/hooks/useScreen';
import MyPhotoView from '@/components/common/Image/PhotoView';

const EChartsCodeBlock = ({ code }: { code: string }) => {
  const chartRef = useRef<HTMLDivElement>(null);
  const eChart = useRef<ECharts>();
  const { isPc } = useSystem();
  const [option, setOption] = useState<any>();
  const [width, setWidth] = useState(400);
  const [previewUrl, setPreviewUrl] = useState<string>('');

  const findMarkdownDom = useCallback(() => {
    if (!chartRef.current) return;

    // 找到 MessageCard 容器（chat-box-card 的父元素）
    let parent = chartRef.current?.parentElement;
    while (parent && !parent.className.includes('chat-box-card')) {
      parent = parent.parentElement;
    }

    // MessageCard 就是 chat-box-card 的父元素
    const messageCard = parent?.parentElement;

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
    return parent?.parentElement;
  }, [isPc]);

  useMount(() => {
    // @ts-ignore
    import('echarts-gl');
  });

  useLayoutEffect(() => {
    const option = (() => {
      try {
        const parse = {
          ...json5.parse(code.trim()),
          toolbox: {
            // show: true,
            feature: {
              saveAsImage: {}
            }
          }
        };

        return parse;
      } catch (error) {}
    })();

    setOption(option ?? {});

    if (!option) return;

    if (chartRef.current) {
      try {
        import('echarts').then((module) => {
          eChart.current = module.init(chartRef.current!);
          eChart.current.setOption(option);
          // 生成一张高清预览图，用于点击全屏查看（复用 MyPhotoView）
          try {
            const url = eChart.current.getDataURL({
              pixelRatio: 2,
              backgroundColor: '#fff',
              type: 'png'
            });
            setPreviewUrl(url);
          } catch {}
        });
      } catch (error) {
        console.error('ECharts render failed:', error);
      }
    }

    findMarkdownDom();

    return () => {
      if (eChart.current) {
        eChart.current.dispose();
      }
    };
  }, [code, findMarkdownDom]);

  const { screenWidth } = useScreen();
  useEffect(() => {
    findMarkdownDom();
  }, [screenWidth]);

  useEffect(() => {
    eChart.current?.resize();
    // resize 后重新生成一次预览图，避免全屏里还是旧尺寸
    if (eChart.current) {
      try {
        const url = eChart.current.getDataURL({
          pixelRatio: 2,
          backgroundColor: '#fff',
          type: 'png'
        });
        setPreviewUrl(url);
      } catch {}
    }
  }, [width]);

  return (
    <MyPhotoView src={previewUrl}>
      <Box overflowX={'auto'} bg={'white'} borderRadius={'md'} maxW={'100%'} cursor={'zoom-in'}>
        <Box h={'400px'} w={`${width}px`} maxW={'100%'} ref={chartRef} />
        {!option && (
          <Skeleton
            isLoaded={true}
            fadeDuration={2}
            h={'400px'}
            w={`${width}px`}
            maxW={'100%'}
          ></Skeleton>
        )}
      </Box>
    </MyPhotoView>
  );
};

export default EChartsCodeBlock;

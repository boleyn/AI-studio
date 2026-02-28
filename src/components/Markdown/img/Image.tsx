import React, { useState, useEffect, useRef } from 'react';
import { Box, type ImageProps, Skeleton } from '@chakra-ui/react';
import MyPhotoView from '@/components/common/Image/PhotoView';
import { useBoolean } from 'ahooks';
import type { AProps } from '../A';

// 全局缓存已加载的图片 URL，避免流式渲染时重复显示加载状态
const loadedImageCache = new Set<string>();

const MdImage = React.memo(
  ({
    src,
    ...props
  }: { src?: string } & ImageProps & { chatAuthData?: AProps['chatAuthData'] }) => {
    // 如果图片已经在缓存中，初始状态为已加载
    const [isLoaded, { setTrue, setFalse }] = useBoolean(src ? loadedImageCache.has(src) : false);
    const [renderSrc, setRenderSrc] = useState(src);
    // 使用 ref 跟踪已处理的 src，避免流式渲染时重复处理相同 URL
    const processedSrcRef = useRef<string | undefined>(src);

    // 当 src prop 变化时，更新 renderSrc 并重置加载状态
    useEffect(() => {
      // 如果 src 与已处理的不同，需要更新
      if (src && src !== processedSrcRef.current) {
        processedSrcRef.current = src;
        setRenderSrc(src);
        // 如果图片已在缓存中，直接设置为已加载，否则重置加载状态
        if (loadedImageCache.has(src)) {
          setTrue();
        } else {
          setFalse();
        }
      }
    }, [src, setFalse, setTrue]);

    // 检查是否为GIF图片
    const isGif = src?.toLowerCase().includes('.gif');

    if (src?.includes('base64') && !src.startsWith('data:image')) {
      return <Box>Invalid base64 image</Box>;
    }

    if (props.alt?.startsWith('OFFIACCOUNT_MEDIA')) {
      return <Box>{'暂不支持微信图片'}</Box>;
    }

    return (
      <Skeleton isLoaded={isLoaded}>
        <MyPhotoView
          borderRadius={'md'}
          src={renderSrc}
          alt={''}
          fallbackSrc={'/imgs/errImg.png'}
          fallbackStrategy={'onError'}
          loading="lazy"
          objectFit={'contain'}
          referrerPolicy="no-referrer"
          minW={'120px'}
          minH={'120px'}
          maxH={'500px'}
          my={1}
          mx={'auto'}
          style={{
            // 确保GIF动画能够正常播放
            ...(isGif && {
              animationPlayState: 'running',
              animation: 'none',
              willChange: 'auto'
            })
          }}
          onLoad={() => {
            // 将图片 URL 添加到缓存
            if (renderSrc) {
              loadedImageCache.add(renderSrc);
            }
            setTrue();
          }}
          onError={() => {
            setRenderSrc('/imgs/errImg.png');
            setTrue();
          }}
          {...props}
        />
      </Skeleton>
    );
  }
);

MdImage.displayName = 'MdImage';

export default MdImage;

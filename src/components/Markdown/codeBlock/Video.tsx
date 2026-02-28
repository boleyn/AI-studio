import React, { useEffect, useRef } from 'react';
import { Box } from '@chakra-ui/react';
import { useMarkdownWidth } from '../hooks';

const VideoBlock = ({ code: videoUrl }: { code: string }) => {
  const { width, Ref } = useMarkdownWidth();
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    fetch(videoUrl?.trim(), {
      mode: 'cors',
      credentials: 'omit'
    })
      .then((response) => response.blob())
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        videoRef?.current?.setAttribute('src', url);
      })
      .catch((err) => {
        console.log(err);
      });
  }, [videoUrl]);

  return (
    <Box w={width} maxW={'100%'} ref={Ref} my={4} borderRadius={'md'} overflow={'hidden'}>
      <video ref={videoRef} controls style={{ width: '100%', maxWidth: '100%' }} />
    </Box>
  );
};

export default VideoBlock;

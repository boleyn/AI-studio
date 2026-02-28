import React from 'react';
import { Box, Flex } from '@chakra-ui/react';
import { useTranslation } from 'next-i18next';
import MyIcon from '@/components/common/MyIcon';
import Markdown from '@/components/Markdown';

export default function OutlineStreamingCard({
  text,
  isChatting,
  isLastResponseValue
}: {
  text: string;
  isChatting: boolean;
  isLastResponseValue: boolean;
}) {
  const { t } = useTranslation();
  const showAnimation = isChatting && isLastResponseValue;
  return (
    <Box border={'base'} borderRadius={'md'} bg={'white'} overflow={'hidden'}>
      <Flex align={'center'} justify={'space-between'} px={4} py={3} bg={'myGray.50'}>
        <Flex align={'center'} gap={3} color={'myGray.700'}>
          <MyIcon name={'core/workflow/template/longTextOutline'} w={'16px'} />
          <Box fontWeight={'600'} fontSize={'md'}>
            {t('chat:outline.generating')}
          </Box>
        </Flex>
        {showAnimation && <MyIcon name={'common/loading'} w={'14px'} />}
      </Flex>
      <Box p={4}>
        <Markdown source={text} showAnimation={showAnimation} />
      </Box>
    </Box>
  );
}

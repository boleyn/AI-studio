import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Flex, Progress } from '@chakra-ui/react';
import { useTranslation } from 'next-i18next';
import MyIcon from '@/components/common/MyIcon';

interface ProgressCardProps {
  text: string;
  dataId?: string;
}

interface ProgressData {
  id: number | string;
  progress: number;
  total: number;
  title: string;
}

// 进度条状态管理（按 chatDataId+progressId 做隔离，避免跨消息串进度）
const progressMap = new Map<string, ProgressData>();
const firstInstanceMap = new Map<string, ProgressCardInstance>();
const progressCardInstances = new Map<string, Set<ProgressCardInstance>>();

interface ProgressCardInstance {
  scopeKey: string;
  isFirst: boolean;
  updateData: (data: ProgressData) => void;
}

const mergeProgressData = (prev: ProgressData | undefined, next: ProgressData): ProgressData => {
  if (!prev) return next;
  const mergedTotal = Math.max(prev.total, next.total);
  const mergedProgress = Math.min(Math.max(prev.progress, next.progress), mergedTotal);
  const mergedTitle = next.title || prev.title;
  return {
    ...next,
    total: mergedTotal,
    progress: mergedProgress,
    title: mergedTitle
  };
};

const parseProgressData = (text: string): ProgressData | null => {
  try {
    let cleanText = text.trim();

    const jsonStart = cleanText.indexOf('{');
    const jsonEnd = cleanText.lastIndexOf('}');
    if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
      cleanText = cleanText.substring(jsonStart, jsonEnd + 1);
    }

    const lines = cleanText.split('\n');
    const jsonLines: string[] = [];
    let braceCount = 0;
    let foundStart = false;

    for (const line of lines) {
      if (!foundStart && line.trim().startsWith('{')) {
        foundStart = true;
      }
      if (!foundStart) continue;

      jsonLines.push(line);
      braceCount += (line.match(/\{/g) || []).length;
      braceCount -= (line.match(/\}/g) || []).length;

      if (braceCount === 0) break;
    }

    if (jsonLines.length > 0) {
      cleanText = jsonLines.join('\n');
    }

    const data: ProgressData = JSON.parse(cleanText);
    if (
      !data ||
      typeof data !== 'object' ||
      data.id === undefined ||
      data.id === null ||
      typeof data.progress !== 'number' ||
      typeof data.total !== 'number'
    ) {
      return null;
    }

    return data;
  } catch (e) {
    if (process.env.NODE_ENV === 'development') {
      console.error('Failed to parse progress data:', e);
      console.error('Raw text data:', text);
    }
    return null;
  }
};

const ProgressCard: React.FC<ProgressCardProps> = ({ text, dataId }) => {
  const { t } = useTranslation();
  const [progressData, setProgressData] = useState<ProgressData | null>(null);
  const cardRef = useRef<ProgressCardInstance | null>(null);

  const parsed = useMemo(() => parseProgressData(text), [text]);

  useEffect(() => {
    if (!parsed) return;

    const idKey = String(parsed.id);
    const scopeKey = `${dataId || 'unknown'}:${idKey}`;
    const mergedData = mergeProgressData(progressMap.get(scopeKey), parsed);

    // 初始化组件引用（如果还没有）
    if (!cardRef.current) {
      cardRef.current = {
        scopeKey,
        isFirst: false,
        updateData: (newData: ProgressData) => {
          setProgressData(newData);
        }
      };
      const instances = progressCardInstances.get(scopeKey) || new Set();
      instances.add(cardRef.current);
      progressCardInstances.set(scopeKey, instances);
    } else if (cardRef.current.scopeKey !== scopeKey) {
      // 极端情况：同一个组件实例 scopeKey 发生变化，更新引用（通常不应该发生）
      cardRef.current.scopeKey = scopeKey;
    }

    const firstInstance = firstInstanceMap.get(scopeKey);

    if (firstInstance) {
      if (cardRef.current === firstInstance) {
        progressMap.set(scopeKey, mergedData);
        setProgressData(mergedData);
      } else {
        firstInstance.updateData(mergedData);
        progressMap.set(scopeKey, mergedData);
      }
    } else {
      cardRef.current.isFirst = true;
      firstInstanceMap.set(scopeKey, cardRef.current);
      progressMap.set(scopeKey, mergedData);
      setProgressData(mergedData);
    }
  }, [dataId, parsed]);

  // 清理：组件卸载时移除引用
  useEffect(() => {
    return () => {
      if (!cardRef.current) return;
      const scopeKey = cardRef.current.scopeKey;
      const firstInstance = firstInstanceMap.get(scopeKey);

      if (firstInstance === cardRef.current) {
        firstInstanceMap.delete(scopeKey);
      }

      const instances = progressCardInstances.get(scopeKey);
      if (instances) {
        instances.delete(cardRef.current);
        if (instances.size === 0) {
          progressCardInstances.delete(scopeKey);
          progressMap.delete(scopeKey);
        }
      }
    };
  }, []);

  if (!progressData) return null;

  // 如果当前组件不是该 scope 的第一个实例，则不渲染，避免重复占位撑高消息框
  if (!cardRef.current || !cardRef.current.isFirst) return null;

  const { id, progress, total, title } = progressData;
  const percentage = total > 0 ? Math.min(Math.round((progress / total) * 100), 100) : 0;
  const isComplete = progress >= total;

  return (
    <Box
      mb={1.5}
      position={'relative'}
      minW={{ base: '320px', md: '500px' }}
      maxW={'100%'}
      w={'100%'}
    >
      <Box
        bg={'white'}
        borderRadius={'lg'}
        overflow={'hidden'}
        border={'1px solid'}
        borderColor={'myGray.200'}
        _hover={{
          borderColor: 'myGray.300'
        }}
        w={'100%'}
        boxShadow={'sm'}
      >
        <Box py={3} px={4}>
          <Flex align={'center'} mb={2}>
            <Box
              w={'24px'}
              h={'24px'}
              borderRadius={'md'}
              bg={isComplete ? 'green.100' : 'blue.100'}
              display={'flex'}
              alignItems={'center'}
              justifyContent={'center'}
              flexShrink={0}
            >
              <MyIcon
                name={isComplete ? 'common/check' : 'common/loading'}
                w={'16px'}
                color={isComplete ? 'green.500' : 'blue.500'}
              />
            </Box>
            <Box
              ml={3}
              flex={1}
              fontSize={'sm'}
              color={'myGray.800'}
              fontWeight={'500'}
              textAlign={'left'}
            >
              {title || t('workflow:progress')}
              <Box
                as="span"
                ml={2}
                fontSize={'xs'}
                color={isComplete ? 'green.500' : 'blue.500'}
                fontWeight={'400'}
              >
                {isComplete ? t('workflow:progress_completed') : t('workflow:progress_processing')}
              </Box>
            </Box>
          </Flex>

          <Box mt={2}>
            <Flex justify={'space-between'} align={'center'} mb={1}>
              <Box fontSize={'xs'} color={'myGray.600'}>
                {progress} / {total}
              </Box>
              <Box fontSize={'xs'} color={'myGray.600'} fontWeight={'500'}>
                {percentage}%
              </Box>
            </Flex>
            <Progress
              value={percentage}
              colorScheme={isComplete ? 'green' : 'blue'}
              size="sm"
              borderRadius={'full'}
              bg={'myGray.100'}
            />
          </Box>
        </Box>
      </Box>
    </Box>
  );
};

export default ProgressCard;

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Flex,
  Text,
  Spinner,
  Accordion,
  AccordionButton,
  AccordionItem,
  AccordionPanel,
  Button
} from '@chakra-ui/react';
import { useTranslation } from 'next-i18next';
import MyIcon from '@/components/common/MyIcon';
import Avatar from '@/components/common/MyAvatar';
import MyTag from '@/components/common/MyTag';
import { useCopyData } from '@/hooks/useCopyData';
import MyDivider from '@/components/common/MyDivider';

interface InstructionData {
  index: number; // 一次消息中的序号，用于区分同一条消息中的多个指令
  data: string;
  comment?: string; // 指令描述
  status?: 'pending' | 'in_progress' | 'completed' | 'error';
  executionTime?: number;
}

export interface IframeInstructionProps {
  code: string;
  dataId: string;
}

const IframeInstructionBlock: React.FC<IframeInstructionProps> = ({ code, dataId }) => {
  const { t } = useTranslation();
  const { copyData } = useCopyData();

  const [instructionData, setInstructionData] = useState<InstructionData | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  const executionStartTimeRef = useRef<number>(0);
  const hasSentInstructionRef = useRef<boolean>(false);

  // 解析 JSON 数据
  useEffect(() => {
    // 检查 JSON 是否完整（用于流式生成场景）
    const isJsonComplete = (jsonString: string): boolean => {
      try {
        const trimmed = jsonString.trim();
        if (!trimmed.startsWith('{')) return false;

        // 检查括号是否匹配
        let braceCount = 0;
        let inString = false;
        let escapeNext = false;

        for (let i = 0; i < trimmed.length; i++) {
          const char = trimmed[i];

          if (escapeNext) {
            escapeNext = false;
            continue;
          }

          if (char === '\\') {
            escapeNext = true;
            continue;
          }

          if (char === '"') {
            inString = !inString;
            continue;
          }

          if (inString) continue;

          if (char === '{') braceCount++;
          if (char === '}') braceCount--;

          // 如果找到最后一个闭合括号且括号匹配
          if (braceCount === 0 && i === trimmed.length - 1) {
            return true;
          }
        }

        return false;
      } catch {
        return false;
      }
    };

    // 流式生成时，如果 JSON 不完整，不进行解析，避免控制台报错
    if (!isJsonComplete(code)) {
      return;
    }

    try {
      const parsed: InstructionData = JSON.parse(code);
      if (parsed.data) {
        // 验证 status 是否为有效值，如果不是，设置为 pending
        const validStatuses = ['pending', 'in_progress', 'completed', 'error'];
        const validStatus =
          parsed.status && validStatuses.includes(parsed.status) ? parsed.status : 'pending';

        const data: InstructionData = {
          ...parsed,
          status: validStatus
        };
        setInstructionData(data);
      }
    } catch (error) {
      // 只在开发环境输出错误，且只在 JSON 看起来完整时才输出
      if (process.env.NODE_ENV === 'development') {
        console.error('Failed to parse instruction JSON:', error);
      }
      setInstructionData(null);
    }
  }, [code]);

  // 检测是否为 iframe 环境
  const isInIframe = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return window.parent !== window;
  }, []);

  // 重试逻辑
  const handleRetry = useCallback(() => {
    if (!instructionData || instructionData.status === 'in_progress') return;

    // 非 iframe 环境，不允许重试
    if (!isInIframe) {
      console.warn('[IframeInstruction] 当前不在 iframe 环境中，无法执行指令');
      return;
    }

    setIsRetrying(true);
    executionStartTimeRef.current = Date.now();

    // 重置发送标记，允许重新发送
    hasSentInstructionRef.current = false;

    // 重置状态为 pending
    const newData: InstructionData = {
      ...instructionData,
      status: 'pending',
      executionTime: undefined
    };
    setInstructionData(newData);

    // 发送指令到父窗口
    console.log('[IframeInstruction] 重试发送消息到父窗口');
    window.parent.postMessage(
      {
        type: 'iframe-instruction',
        dataId,
        instructionIndex: instructionData.index,
        data: instructionData.data
      },
      '*'
    );

    // 标记已发送
    hasSentInstructionRef.current = true;

    // 更新本地状态为 in_progress（不调用 API）
    setInstructionData((prev) => (prev ? { ...prev, status: 'in_progress' } : null));

    setTimeout(() => setIsRetrying(false), 100);
  }, [instructionData, isInIframe]);

  // 监听来自父窗口的状态更新消息
  useEffect(() => {
    if (!instructionData) return;

    const handleMessage = (event: MessageEvent) => {
      // 快速过滤：只处理 instruction-status-update 类型的消息
      if (event.data.type !== 'instruction-status-update') return;

      // 匹配消息：dataId 和 index 都要匹配
      if (event.data.dataId === dataId && event.data.instructionIndex === instructionData.index) {
        const targetIndex = event.data.instructionIndex;
        const { status, executionTime, error } = event.data;
        console.log('[IframeInstruction] 接收到父窗口状态更新:', { status, executionTime, error });

        setInstructionData((prev) => {
          if (!prev) return prev;
          return { ...prev, status, executionTime, error };
        });

        // 如果是最终状态（completed 或 error），重置发送标记，允许重试
        if (status === 'completed' || status === 'error') {
          hasSentInstructionRef.current = false;
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [dataId, instructionData]);

  // 执行指令的处理函数
  const handleExecute = useCallback(() => {
    if (!instructionData || instructionData.status !== 'pending') return;

    // 非 iframe 环境，不允许执行
    if (!isInIframe) {
      console.warn('[IframeInstruction] 当前不在 iframe 环境中，无法执行指令');
      return;
    }

    executionStartTimeRef.current = Date.now();
    hasSentInstructionRef.current = true;

    const message = {
      type: 'iframe-instruction',
      dataId,
      instructionIndex: instructionData.index,
      data: instructionData.data
    };

    // 发送指令到父窗口
    console.log('[IframeInstruction] 发送消息到父窗口:', message);
    window.parent.postMessage(message, '*');

    // 更新状态为 in_progress（不调用 API，等待消息监听器处理）
    setInstructionData((prev) => (prev ? { ...prev, status: 'in_progress' } : null));
  }, [instructionData, isInIframe]);

  // 状态配置
  const getStatusConfig = (status?: string) => {
    switch (status) {
      case 'completed':
        return {
          colorSchema: 'green' as const,
          text: t('chat:instruction.completed'),
          icon: 'checkCircle'
        };
      case 'in_progress':
        return {
          colorSchema: 'blue' as const,
          text: t('chat:instruction.in_progress'),
          icon: 'common/loading'
        };
      case 'error':
        return {
          colorSchema: 'red' as const,
          text: t('chat:instruction.error'),
          icon: 'common/warn'
        };
      case 'pending':
      default:
        return {
          colorSchema: 'gray' as const,
          text: t('chat:instruction.pending'),
          icon: 'common/time'
        };
    }
  };

  if (!instructionData) {
    return (
      <Box p={4} borderWidth="1px" borderRadius="md" bg="myGray.50" borderColor="red.200">
        <Flex align="center" gap={2}>
          <MyIcon name="common/warn" w="16px" color="red.500" />
          <Text color="red.500">{t('chat:instruction.invalid_format')}</Text>
        </Flex>
      </Box>
    );
  }

  const statusConfig = getStatusConfig(instructionData.status);

  // 格式化数据用于显示
  const formatData = (data: any): string => {
    if (typeof data === 'string') {
      return data;
    }
    try {
      return JSON.stringify(data, null, 2);
    } catch {
      return String(data);
    }
  };

  return (
    <Box borderWidth="1px" borderColor="myGray.200" borderRadius="md" overflow="hidden">
      <Accordion index={isExpanded ? 0 : undefined} allowToggle>
        <AccordionItem border={'none'}>
          <AccordionButton
            py={2}
            px={3}
            bg={'white'}
            _hover={{ bg: 'white' }}
            flexDirection={'column'}
            alignItems={'stretch'}
          >
            {/* 标题行 */}
            <Flex align={'center'} justify={'space-between'} w={'100%'} mb={2}>
              <Avatar src="common/instructionExecution" w={'40px'} h={'40px'} />
              <Flex flexDirection={'column'} flex={1} ml={3}>
                <Box fontSize={'sm'} fontWeight={'600'} color={'myGray.800'}>
                  {instructionData.comment}
                </Box>
                {instructionData.executionTime !== undefined &&
                  instructionData.executionTime !== null && (
                    <Box fontSize={'xs'} color={'myGray.500'} mt={0.5}>
                      {t('chat:instruction.execution_time', {
                        time: instructionData.executionTime / 1000
                      })}
                    </Box>
                  )}
              </Flex>

              <MyTag colorSchema={statusConfig.colorSchema} showDot>
                {instructionData.status === 'in_progress' ? (
                  <Flex align={'center'} gap={1}>
                    <Spinner size="xs" />
                    {statusConfig.text}
                  </Flex>
                ) : (
                  statusConfig.text
                )}
              </MyTag>
            </Flex>

            {/* 环境警告 */}
            {!isInIframe && instructionData.status === 'pending' && (
              <Flex
                align={'center'}
                gap={2}
                bg={'yellow.50'}
                border={'1px solid'}
                borderColor={'yellow.200'}
                borderRadius={'md'}
                p={2}
                mb={2}
              >
                <MyIcon name="common/warn" w="16px" color="yellow.500" />
                <Text fontSize={'xs'} color={'yellow.700'}>
                  {t('chat:instruction.environment_error')}
                </Text>
              </Flex>
            )}
          </AccordionButton>

          {/* 操作按钮 */}
          <Box px={3} py={2} pb={2} bg={'white'}>
            <MyDivider borderBottomWidth={1} mb={2} />
            <Flex gap={2}>
              {/* 待执行状态：显示执行指令按钮 */}
              {instructionData.status === 'pending' && (
                <Button
                  size="xs"
                  variant={'outline'}
                  colorScheme={'blue'}
                  onClick={handleExecute}
                  isDisabled={!isInIframe}
                  leftIcon={<MyIcon name="common/playFill" w="14px" />}
                  title={!isInIframe ? t('chat:instruction.cannot_execute_outside_iframe') : ''}
                >
                  {t('chat:instruction.execute')}
                </Button>
              )}
              {/* 完成或错误状态：显示重新执行按钮 */}
              {(instructionData.status === 'completed' || instructionData.status === 'error') && (
                <Button
                  size="xs"
                  variant={'ghost'}
                  onClick={handleRetry}
                  isDisabled={isRetrying || !isInIframe}
                  leftIcon={<MyIcon name="common/retryLight" w="14px" />}
                  title={!isInIframe ? t('chat:instruction.cannot_retry_outside_iframe') : ''}
                >
                  {t('chat:instruction.retry')}
                </Button>
              )}
              <Button
                size="xs"
                variant={'ghost'}
                onClick={() => {
                  const dataToCopy =
                    typeof instructionData.data === 'string'
                      ? instructionData.data
                      : JSON.stringify(instructionData.data, null, 2);
                  copyData(dataToCopy);
                }}
                leftIcon={<MyIcon name="copy" w="14px" />}
              >
                {t('chat:instruction.copy')}
              </Button>
              <Button
                size="xs"
                variant={'ghost'}
                onClick={() => setIsExpanded(!isExpanded)}
                leftIcon={
                  <MyIcon
                    name={isExpanded ? 'core/chat/chevronUp' : 'core/chat/chevronDown'}
                    w="14px"
                  />
                }
              >
                {isExpanded ? t('chat:instruction.collapse') : t('chat:instruction.expand')}
              </Button>
            </Flex>
          </Box>

          <AccordionPanel px={3} pb={3} bg={'white'}>
            <Box mb={2}>
              <Flex align={'center'}>
                <MyIcon name="code" w="16px" color="myGray.400" mr={2} />
                <Text fontSize={'sm'} color={'myGray.600'}>
                  {t('chat:instruction.data_content')}
                </Text>
              </Flex>
            </Box>

            <Box
              bg={'myGray.50'}
              borderRadius={'md'}
              border={'1px solid'}
              borderColor={'myGray.200'}
              maxH={'300px'}
              overflowY={'auto'}
              p={3}
            >
              <Text
                fontSize={'xs'}
                fontFamily={'mono'}
                whiteSpace={'pre-wrap'}
                wordBreak={'break-word'}
                color={'myGray.800'}
              >
                {formatData(instructionData.data)}
              </Text>
            </Box>
          </AccordionPanel>
        </AccordionItem>
      </Accordion>
    </Box>
  );
};

export default React.memo(IframeInstructionBlock);

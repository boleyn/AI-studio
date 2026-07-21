import Markdown from '@/components/Markdown';
import WorkspaceCard, { type WorkspacePayload } from '@/components/Markdown/chat/WorkspaceCard';
import {
  Accordion,
  AccordionButton,
  AccordionIcon,
  AccordionItem,
  AccordionPanel,
  Box,
  Button,
  Flex,
  HStack
} from '@chakra-ui/react';
import { ChatItemValueTypeEnum } from '@/global/core/chat/constants';
import type {
  AIChatItemValueItemType,
  ToolModuleResponseItemType,
  UserChatItemValueItemType
} from '@/global/core/chat/type';
import React, { useCallback, useMemo } from 'react';
import MyIcon from '@/components/common/MyIcon';
import Avatar from '@/components/common/MyAvatar';
import type {
  InteractiveBasicType,
  PaymentPauseInteractive,
  UserInputInteractive,
  UserSelectInteractive
} from '@/global/core/workflow/template/system/interactive/type';
import { isEqual } from 'lodash';
import { useTranslation } from 'next-i18next';
import { eventBus, EventNameEnum } from '@/shared/utils/eventbus';
import { SelectOptionsComponent, FormInputComponent } from './Interactive/InteractiveComponents';
import { useContextSelector } from 'use-context-selector';
import { useCreation } from 'ahooks';
import { useCopyData } from '@/hooks/useCopyData';
import MyTooltip from '@/components/common/MyTooltip';
import { extractDeepestInteractive } from '@/global/core/workflow/runtime/utils';
type OnOpenCiteModalProps = unknown;
import { WorkflowRuntimeContext } from '../ChatContainer/context/workflowRuntimeContext';
import OutlineInteractive from './Interactive/OutlineInteractive';
import OutlineStreamingCard from './Interactive/OutlineStreamingCard';
import { removeDatasetCiteText } from '@/global/core/ai/llm/utils';

type OutlineInteractivePayload = InteractiveBasicType & {
  type: 'outlineInteractive';
  params: {
    outlineText: string;
    action?: string;
    regeneratePrompt?: string;
    confirmPrompt?: string;
  };
};

const accordionButtonStyle = {
  w: 'auto',
  bg: 'white',
  borderRadius: 'md',
  borderWidth: '1px',
  borderColor: 'myGray.200',
  boxShadow: '1',
  pl: 3,
  pr: 2.5,
  _hover: {
    bg: 'auto'
  }
};

const RenderResoningContent = React.memo(function RenderResoningContent({
  content,
  isChatting,
  isLastResponseValue
}: {
  content: string;
  isChatting: boolean;
  isLastResponseValue: boolean;
}) {
  const { t } = useTranslation();
  const showAnimation = isChatting && isLastResponseValue;

  return (
    <Accordion allowToggle defaultIndex={undefined}>
      <AccordionItem borderTop={'none'} borderBottom={'none'}>
        <AccordionButton {...accordionButtonStyle} py={1}>
          <HStack mr={2} spacing={1}>
            <MyIcon name={'core/chat/think'} w={'0.85rem'} />
            <Box fontSize={'sm'}>{t('chat:ai_reasoning')}</Box>
          </HStack>

          {showAnimation && <MyIcon name={'common/loading'} w={'0.85rem'} />}
          <AccordionIcon color={'myGray.600'} ml={5} />
        </AccordionButton>
        <AccordionPanel
          py={0}
          pr={0}
          pl={3}
          mt={2}
          borderLeft={'2px solid'}
          borderColor={'myGray.300'}
          color={'myGray.500'}
        >
          <Markdown source={content} showAnimation={showAnimation} />
        </AccordionPanel>
      </AccordionItem>
    </Accordion>
  );
});
const RenderText = React.memo(function RenderText({
  showAnimation,
  text,
  chatItemDataId,
  onOpenCiteModal
}: {
  showAnimation: boolean;
  text: string;
  chatItemDataId: string;
  onOpenCiteModal?: (e?: OnOpenCiteModalProps) => void;
}) {
  const appId = useContextSelector(WorkflowRuntimeContext, (v) => v?.appId);
  const chatId = useContextSelector(WorkflowRuntimeContext, (v) => v?.chatId);
  const outLinkAuthData = useContextSelector(WorkflowRuntimeContext, (v) => v?.outLinkAuthData);
  const isShowCite = true;

  const source = useMemo(() => {
    if (!text) return '';
    return isShowCite ? text : removeDatasetCiteText(text, isShowCite);
  }, [text, isShowCite]);

  const chatAuthData = useCreation(() => {
    const safeOutLinkAuthData =
      outLinkAuthData && typeof outLinkAuthData === 'object' ? outLinkAuthData : {};
    return { appId, chatId, chatItemDataId, ...safeOutLinkAuthData };
  }, [appId, chatId, chatItemDataId, outLinkAuthData]);

  return (
    <Markdown
      source={source}
      showAnimation={showAnimation}
      chatAuthData={chatAuthData}
      dataId={chatItemDataId}
      onOpenCiteModal={onOpenCiteModal}
    />
  );
});

const RenderTool = React.memo(
  function RenderTool({
    showAnimation,
    tools
  }: {
    showAnimation: boolean;
    tools: ToolModuleResponseItemType[];
  }) {
    const { t } = useTranslation();
    const { copyData } = useCopyData();

    return (
      <Box>
        {tools.map((tool) => {
          const formatJson = (string: string) => {
            try {
              return JSON.stringify(JSON.parse(string), null, 2);
            } catch (error) {
              return string;
            }
          };

          const toolParams = formatJson(tool.params || '');
          const hasParams = toolParams && toolParams !== '{}';
          const hasResponse = tool.response && tool.response.trim();
          const isThinking = showAnimation && !hasResponse;

          // 改进的JSON解析，处理截断数据并正确提取content中的text
          const parseToolResponse = (response: string) => {
            try {
              // 检查是否被截断了
              const isTruncated = response.includes('...[hide') && response.includes('chars]...');

              if (isTruncated) {
                // 如果数据被截断，直接返回原始内容，但标记为截断
                return { content: response, isTruncated: true };
              }

              const parsed: unknown = JSON.parse(response);
              const parsedObj =
                parsed && typeof parsed === 'object' ? (parsed as { content?: unknown }) : undefined;
              if (parsedObj?.content && Array.isArray(parsedObj.content)) {
                // 提取所有type为text的内容
                const textItems = parsedObj.content.filter(
                  (item): item is { type?: unknown; text?: unknown } =>
                    Boolean(item && typeof item === 'object' && !Array.isArray(item))
                );
                const textContent = textItems
                  .filter((item) => item.type === 'text')
                  .map((item) => (typeof item.text === 'string' ? item.text : ''))
                  .filter(Boolean);
                if (textContent.length > 0) {
                  // 合并所有text内容
                  return {
                    content: textContent.join('\n\n'),
                    isTruncated: false
                  };
                }
              }
              // 如果不是预期格式，返回原始内容
              return { content: response, isTruncated: false };
            } catch {
              return { content: response, isTruncated: false };
            }
          };

          const responseData = hasResponse
            ? parseToolResponse(tool.response || '')
            : { content: '', isTruncated: false };
          const responseContent = responseData.content;
          const isTruncated = responseData.isTruncated;

          return (
            <Box key={tool.id} mb={1.5}>
              {/* 思考过程 - 重新设计，更温和的颜色 */}
              {isThinking && (
                <Box mb={2}>
                  <Flex
                    align={'center'}
                    mb={2}
                    p={2.5}
                    bg={'myGray.50'}
                    borderRadius={'lg'}
                    border={'1px solid'}
                    borderColor={'myGray.200'}
                    position={'relative'}
                    overflow={'hidden'}
                  >
                    {/* 动画背景 */}
                    <Box
                      position={'absolute'}
                      top={0}
                      left={0}
                      h={'full'}
                      w={'3px'}
                      bg={'linear-gradient(to bottom, #4299E1, #63B3ED, #90CDF4)'}
                      animation={'pulse 2s infinite'}
                    />

                    <MyIcon
                      name={'common/loading'}
                      w={'14px'}
                      h={'14px'}
                      color={'myGray.600'}
                      ml={2}
                    />
                    <Box ml={3} flex={1}>
                      <Box fontSize={'sm'} color={'myGray.800'} fontWeight={'600'} mb={1}>
                        {t('chat:calling_tool', { toolName: tool.toolName })}
                      </Box>
                      {hasParams && (
                        <Box fontSize={'xs'} color={'myGray.600'} opacity={0.8} fontFamily={'mono'}>
                          {t('chat:building_params')}...
                        </Box>
                      )}
                    </Box>
                  </Flex>
                </Box>
              )}

              {/* 工具调用结果 */}
              <Accordion allowToggle>
                <AccordionItem
                  borderTop={'none'}
                  borderBottom={'none'}
                  bg={'transparent'}
                  borderRadius={'lg'}
                  overflow={'hidden'}
                  border={'1px solid'}
                  borderColor={'myGray.200'}
                  _hover={{
                    borderColor: 'myGray.300'
                  }}
                >
                  <AccordionButton
                    py={2}
                    px={3}
                    bg={'white'}
                    borderRadius={'lg'}
                    _hover={{
                      bg: 'myGray.25'
                    }}
                    _expanded={{
                      borderBottomRadius: 0,
                      borderBottom: '1px solid',
                      borderBottomColor: 'myGray.200'
                    }}
                  >
                    <Flex align={'center'} flex={1}>
                      <Box
                        w={'1.5rem'}
                        h={'1.5rem'}
                        borderRadius={'lg'}
                        bg={'myGray.100'}
                        display={'flex'}
                        alignItems={'center'}
                        justifyContent={'center'}
                        flexShrink={0}
                        border={'1px solid'}
                        borderColor={'myGray.200'}
                      >
                        {tool.toolAvatar ? (
                          <Avatar src={tool.toolAvatar} w={'full'} h={'full'} borderRadius={'lg'} />
                        ) : (
                          <MyIcon
                            name={'core/app/toolCall'}
                            w={'12px'}
                            h={'12px'}
                            color={'myGray.600'}
                          />
                        )}
                      </Box>
                      <Box ml={2.5} flex={1}>
                        <Flex align={'center'} justify={'space-between'}>
                          <Box
                            fontSize={'sm'}
                            color={'myGray.800'}
                            fontWeight={'500'}
                            textAlign={'left'}
                            letterSpacing={'0.01em'}
                          >
                            {tool.toolName}
                          </Box>
                          {hasResponse && (
                            <Flex align={'center'} ml={2}>
                              <Box
                                w={'6px'}
                                h={'6px'}
                                bg={'green.400'}
                                borderRadius={'full'}
                                mr={1.5}
                              />
                              <Box fontSize={'xs'} color={'myGray.600'} fontWeight={'500'}>
                                {t('chat:completed')}
                              </Box>
                            </Flex>
                          )}
                          {!hasResponse && isThinking && (
                            <Flex align={'center'} ml={2}>
                              <MyIcon
                                name={'common/loading'}
                                w={'12px'}
                                h={'12px'}
                                mr={1.5}
                                color={'myGray.600'}
                              />
                              <Box fontSize={'xs'} color={'myGray.600'} fontWeight={'500'}>
                                执行中...
                              </Box>
                            </Flex>
                          )}
                        </Flex>
                      </Box>
                    </Flex>
                    <AccordionIcon color={'myGray.400'} ml={1.5} />
                  </AccordionButton>

                  <AccordionPanel px={0} py={0}>
                    <Box>
                      {/* 工具参数 */}
                      {hasParams && (
                        <Box
                          p={3}
                          bg={'myGray.25'}
                          borderBottom={'1px solid'}
                          borderColor={'myGray.200'}
                        >
                          <Flex justify={'space-between'} align={'center'} mb={2.5}>
                            <Box
                              fontSize={'xs'}
                              color={'myGray.700'}
                              fontWeight={'600'}
                              display={'flex'}
                              alignItems={'center'}
                            >
                              <Box as={'span'} mr={2} fontSize={'sm'}>
                                ⚙️
                              </Box>
                              {t('chat:tool_input')}
                            </Box>
                            <MyTooltip label={t('common:Copy')}>
                              <MyIcon
                                name={'copy'}
                                w={'14px'}
                                h={'14px'}
                                cursor={'pointer'}
                                color={'myGray.500'}
                                _hover={{ color: 'primary.600' }}
                                onClick={() => copyData(toolParams)}
                              />
                            </MyTooltip>
                          </Flex>
                          <Box
                            bg={'white'}
                            borderRadius={'lg'}
                            border={'1px solid'}
                            borderColor={'myGray.200'}
                            overflow={'hidden'}
                            maxH={'150px'}
                            overflowY={'auto'}
                            p={2.5}
                            sx={{
                              '&::-webkit-scrollbar': {
                                width: '4px'
                              },
                              '&::-webkit-scrollbar-track': {
                                bg: 'myGray.100'
                              },
                              '&::-webkit-scrollbar-thumb': {
                                bg: 'myGray.300',
                                borderRadius: 'full'
                              }
                            }}
                          >
                            <Box
                              fontSize={'xs'}
                              lineHeight={1.6}
                              color={'myGray.700'}
                              fontFamily={'mono'}
                              whiteSpace={'pre-wrap'}
                            >
                              {toolParams}
                            </Box>
                          </Box>
                        </Box>
                      )}

                      {/* 工具响应 */}
                      {hasResponse && (
                        <Box p={3} bg={'myGray.25'}>
                          <Flex justify={'space-between'} align={'center'} mb={2.5}>
                            <Box
                              fontSize={'xs'}
                              color={'myGray.700'}
                              fontWeight={'600'}
                              display={'flex'}
                              alignItems={'center'}
                            >
                              <Box as={'span'} mr={2} fontSize={'sm'}>
                                📤
                              </Box>
                              {t('chat:tool_output')}
                            </Box>
                            <MyTooltip label={t('common:Copy')}>
                              <MyIcon
                                name={'copy'}
                                w={'14px'}
                                h={'14px'}
                                cursor={'pointer'}
                                color={'myGray.500'}
                                _hover={{ color: 'primary.600' }}
                                onClick={() => copyData(responseContent)}
                              />
                            </MyTooltip>
                          </Flex>
                          <Box
                            bg={'white'}
                            borderRadius={'lg'}
                            border={'1px solid'}
                            borderColor={'myGray.200'}
                            overflow={'hidden'}
                            maxH={'300px'}
                            overflowY={'auto'}
                            p={2.5}
                            sx={{
                              '&::-webkit-scrollbar': {
                                width: '4px'
                              },
                              '&::-webkit-scrollbar-track': {
                                bg: 'myGray.100'
                              },
                              '&::-webkit-scrollbar-thumb': {
                                bg: 'myGray.300',
                                borderRadius: 'full'
                              }
                            }}
                          >
                            {isTruncated && (
                              <Box
                                mb={2.5}
                                p={2.5}
                                bg={'orange.50'}
                                borderRadius={'lg'}
                                border={'1px solid'}
                                borderColor={'orange.200'}
                                fontSize={'xs'}
                                color={'orange.700'}
                              >
                                <Flex align={'center'} mb={1}>
                                  <MyIcon name={'common/warn'} w={'12px'} mr={1} />
                                  <Box fontWeight={'500'}>{t('chat:data_truncated')}</Box>
                                </Flex>
                                <Box opacity={0.8}>{t('chat:data_truncated_tip')}</Box>
                              </Box>
                            )}
                            <Markdown source={responseContent} />
                          </Box>
                        </Box>
                      )}
                    </Box>
                  </AccordionPanel>
                </AccordionItem>
              </Accordion>
            </Box>
          );
        })}
      </Box>
    );
  },
  (prevProps, nextProps) => isEqual(prevProps, nextProps)
);

const onSendPrompt = (e: { text: string; isInteractivePrompt: boolean }) =>
  eventBus.emit(EventNameEnum.sendQuestion, e);
const RenderUserSelectInteractive = React.memo(function RenderInteractive({
  interactive
}: {
  interactive: InteractiveBasicType & UserSelectInteractive;
}) {
  return (
    <SelectOptionsComponent
      interactiveParams={interactive.params}
      onSelect={(value) => {
        onSendPrompt({
          text: value,
          isInteractivePrompt: true
        });
      }}
    />
  );
});
const RenderUserFormInteractive = React.memo(function RenderFormInput({
  interactive
}: {
  interactive: InteractiveBasicType & UserInputInteractive;
}) {
  const { t } = useTranslation();

  const defaultValues = useMemo(() => {
    if (interactive.type === 'userInput') {
      return interactive.params.inputForm?.reduce((acc: Record<string, unknown>, item) => {
        // 使用 ?? 运算符，只有 undefined 或 null 时才使用 defaultValue
        acc[item.key] = item.value ?? item.defaultValue;
        return acc;
      }, {});
    }
    return {};
  }, [interactive]);

  const handleFormSubmit = useCallback(
    (data: Record<string, unknown>) => {
      const finalData: Record<string, unknown> = {};
      interactive.params.inputForm?.forEach((item) => {
        if (item.key in data) {
          finalData[item.key] = data[item.key];
        }
      });

      onSendPrompt({
        text: JSON.stringify(finalData),
        isInteractivePrompt: true
      });
    },
    [interactive.params.inputForm]
  );

  return (
    <Flex
      flexDirection={'column'}
      gap={2}
      w={'clamp(250px, 60cqw, 600px)'}
      sx={{
        // 降级方案：不支持 container queries 时使用固定宽度
        '@supports not (width: 1cqw)': {
          width: 'clamp(250px, 500px, 600px)'
        }
      }}
    >
      <FormInputComponent
        interactiveParams={interactive.params}
        defaultValues={defaultValues}
        SubmitButton={({ onSubmit, isFileUploading }) => (
          <Button
            onClick={() => onSubmit(handleFormSubmit)()}
            isDisabled={isFileUploading}
            isLoading={isFileUploading}
          >
            {t('common:Submit')}
          </Button>
        )}
      />
    </Flex>
  );
});
const RenderPaymentPauseInteractive = React.memo(function RenderPaymentPauseInteractive({
  interactive
}: {
  interactive: InteractiveBasicType & PaymentPauseInteractive;
}) {
  const { t } = useTranslation();

  return interactive.params.continue ? (
    <Box>{t('chat:task_has_continued')}</Box>
  ) : (
    <>
      <Box color={'myGray.500'}>
        {typeof interactive.params.description === 'string'
          ? t(interactive.params.description)
          : ''}
      </Box>
      <Button
        maxW={'250px'}
        onClick={() => {
          onSendPrompt({
            text: 'Continue',
            isInteractivePrompt: true
          });
        }}
      >
        {t('chat:continue_run')}
      </Button>
    </>
  );
});

// OutlineInteractive 已抽离为独立文件组件

const AIResponseBox = ({
  chatItemDataId,
  value,
  isLastResponseValue,
  isChatting,
  onOpenCiteModal
}: {
  chatItemDataId: string;
  value: UserChatItemValueItemType | AIChatItemValueItemType;
  isLastResponseValue: boolean;
  isChatting: boolean;
  onOpenCiteModal?: (e?: OnOpenCiteModalProps) => void;
}) => {
  const showRunningStatus = true;
  const workspaceEnabled = false;

  const workspaceCard = useMemo(() => {
    if (value.type !== ChatItemValueTypeEnum.text || !value.text?.content) return null;
    const match = value.text.content.match(/```workspace\s*([\s\S]*?)```/);
    if (!match) return null;
    const raw = (match[1] || '').trim();
    if (!raw) return null;
    let payload: WorkspacePayload | null = null;
    try {
      payload = JSON.parse(raw);
    } catch (err) {
      console.warn('[WorkspaceCard] parse json failed', err);
    }
    return (
      <WorkspaceCard
        raw={raw}
        payload={payload}
        onOpenWorkspace={undefined}
        disabled={!workspaceEnabled}
      />
    );
  }, [value, workspaceEnabled]);

  if (value.type === ChatItemValueTypeEnum.text && value.text) {
    if (workspaceCard) return workspaceCard;

    return (
      <RenderText
        chatItemDataId={chatItemDataId}
        showAnimation={isChatting && isLastResponseValue}
        text={value.text.content}
        onOpenCiteModal={onOpenCiteModal}
      />
    );
  }
  if (value.type === ChatItemValueTypeEnum.reasoning && 'reasoning' in value && value.reasoning) {
    return (
      <RenderResoningContent
        isChatting={isChatting}
        isLastResponseValue={isLastResponseValue}
        content={value.reasoning.content}
      />
    );
  }
  if (value.type === ChatItemValueTypeEnum.tool && 'tools' in value && value.tools && showRunningStatus) {
    return <RenderTool showAnimation={isChatting} tools={value.tools} />;
  }

  // 新增：流式大纲展示（当 value 为 outline 时即时渲染）
  if (value.type === ChatItemValueTypeEnum.outline && 'outline' in value && value.outline) {
    return (
      <OutlineStreamingCard
        text={value.outline.text}
        isChatting={isChatting}
        isLastResponseValue={isLastResponseValue}
      />
    );
  }
  if (value.type === ChatItemValueTypeEnum.interactive && value.interactive) {
    const finalInteractive = extractDeepestInteractive(value.interactive);
    if (finalInteractive.type === 'userSelect') {
      return <RenderUserSelectInteractive interactive={finalInteractive} />;
    }
    if (finalInteractive.type === 'userInput') {
      return <RenderUserFormInteractive interactive={finalInteractive} />;
    }
    if (finalInteractive.type === 'paymentPause') {
      return <RenderPaymentPauseInteractive interactive={finalInteractive} />;
    }
    if (finalInteractive.type === 'outlineInteractive') {
      return <OutlineInteractive interactive={finalInteractive as OutlineInteractivePayload} />;
    }
  }
  return null;
};
export default React.memo(AIResponseBox);

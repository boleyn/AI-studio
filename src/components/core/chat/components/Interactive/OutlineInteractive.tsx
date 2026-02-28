import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Box,
  Button,
  Collapse,
  Flex,
  useDisclosure,
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  ModalCloseButton,
  Textarea
} from '@chakra-ui/react';
import MyIcon from '@/components/common/MyIcon';
import { useCopyData } from '@/hooks/useCopyData';
import type { InteractiveBasicType } from '@/global/core/workflow/template/system/interactive/type';
import { eventBus, EventNameEnum } from '@/shared/utils/eventbus';
import { useTranslation } from 'next-i18next';

type OutlineInteractiveType = InteractiveBasicType & {
  type: 'outlineInteractive';
  params: {
    outlineText: string;
    action?: string;
    regeneratePrompt?: string;
    confirmPrompt?: string;
  };
};

const onSendPrompt = (e: { text: string; isInteractivePrompt: boolean }) =>
  eventBus.emit(EventNameEnum.sendQuestion, e);

export default React.memo(function OutlineInteractive({
  interactive
}: {
  interactive: OutlineInteractiveType;
}) {
  // 如果 action 是 regenerate，不显示组件
  if (interactive.params.action === 'regenerate') {
    return null;
  }

  const { t } = useTranslation();
  const { copyData } = useCopyData();
  const { isOpen, onToggle } = useDisclosure();
  const {
    isOpen: isRegenerateModalOpen,
    onOpen: onRegenerateModalOpen,
    onClose: onRegenerateModalClose
  } = useDisclosure();
  const [editingText, setEditingText] = useState(interactive.params.outlineText || '');
  const [regeneratePrompt, setRegeneratePrompt] = useState(
    interactive.params.regeneratePrompt || ''
  );
  const [confirmPrompt, setConfirmPrompt] = useState(interactive.params.confirmPrompt || '');
  const [isRegenerating, setIsRegenerating] = useState(false);
  const hasAutoExpanded = useRef(false);
  const isSubmitted = !!interactive.params.action;

  // 同步服务器返回的数据到本地编辑状态
  useEffect(() => {
    // 如果服务器返回了新的outlineText，则更新编辑状态
    if (interactive.params.outlineText) {
      setEditingText(interactive.params.outlineText);
      setIsRegenerating(false); // 重置重新生成状态
    }
    // 同步额外提示词
    if (interactive.params.regeneratePrompt !== undefined) {
      setRegeneratePrompt(interactive.params.regeneratePrompt);
    }
    if (interactive.params.confirmPrompt !== undefined) {
      setConfirmPrompt(interactive.params.confirmPrompt);
    }
  }, [
    interactive.params.outlineText,
    interactive.params.regeneratePrompt,
    interactive.params.confirmPrompt
  ]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (interactive.params.outlineText && !hasAutoExpanded.current) {
      hasAutoExpanded.current = true;
      onToggle();
    }
  }, [interactive.params.outlineText, onToggle]);

  const handleConfirm = useCallback(() => {
    onSendPrompt({
      text: JSON.stringify({
        action: 'confirm',
        outlineText: editingText,
        confirmPrompt: confirmPrompt
      }),
      isInteractivePrompt: true
    });
  }, [editingText, confirmPrompt]);

  const handleRegenerate = useCallback(() => {
    // 立即设置重新生成状态
    setIsRegenerating(true);
    setEditingText('');
    onRegenerateModalClose();
    onSendPrompt({
      text: JSON.stringify({
        action: 'regenerate',
        regeneratePrompt: regeneratePrompt
      }),
      isInteractivePrompt: true
    });
  }, [regeneratePrompt, onRegenerateModalClose]);

  return (
    <Box
      border={'base'}
      borderRadius={'md'}
      bg={'white'}
      overflow={'hidden'}
      minW={'520px'}
      w={'100%'}
    >
      <Flex
        align={'center'}
        justify={'space-between'}
        px={4}
        py={3}
        bg={'myGray.50'}
        cursor={'pointer'}
        onClick={onToggle}
        _hover={{ bg: 'myGray.100' }}
        transition={'all 0.2s'}
      >
        <Flex align={'center'} gap={3} color={'myGray.700'}>
          <MyIcon name={'core/workflow/template/longTextOutline'} w={'16px'} />
          <Box fontWeight={'600'} fontSize={'md'}>
            {t('chat:outline.generate_outline')}
          </Box>
          <Box
            fontSize={'sm'}
            color={isRegenerating ? 'orange.500' : isSubmitted ? 'green.500' : 'blue.500'}
          >
            {isRegenerating
              ? t('chat:outline.regenerating')
              : isSubmitted
                ? t('chat:outline.confirmed')
                : t('chat:outline.completed')}
          </Box>
        </Flex>
        <Flex align={'center'} gap={2}>
          {!isOpen ? (
            <Button
              size={'xs'}
              colorScheme={isRegenerating ? 'orange' : isSubmitted ? 'green' : 'blue'}
              variant={'solid'}
              onClick={(e) => {
                e.stopPropagation();
                if (!isSubmitted && !isRegenerating) {
                  handleConfirm();
                }
              }}
              disabled={isSubmitted || isRegenerating}
            >
              {isRegenerating
                ? t('chat:outline.regenerating')
                : isSubmitted
                  ? t('chat:outline.confirmed')
                  : t('common:Confirm')}
            </Button>
          ) : (
            <Button
              size={'xs'}
              variant={'ghost'}
              onClick={(e) => {
                e.stopPropagation();
                copyData(editingText || interactive.params.outlineText || '');
              }}
            >
              <MyIcon name={'copy'} w={'12px'} />
              <Box ml={1}>{t('common:Copy')}</Box>
            </Button>
          )}
          <MyIcon
            name={isOpen ? 'core/chat/chevronUp' : 'core/chat/chevronDown'}
            w={'14px'}
            color={'myGray.500'}
          />
        </Flex>
      </Flex>

      <Collapse in={isOpen} animateOpacity>
        <Box p={4}>
          <Flex direction={'column'} gap={4}>
            <Box>
              <Box fontWeight={'bold'} mb={3} color={'myGray.900'} fontSize={'sm'}>
                {t('common:Edit')}
              </Box>
              <Box
                as={'textarea'}
                w={'100%'}
                minH={'300px'}
                bg={isSubmitted || isRegenerating ? 'myGray.50' : 'white'}
                border={'1px solid'}
                borderColor={'myGray.200'}
                borderRadius={'md'}
                p={3}
                value={editingText}
                onChange={(e: any) => {
                  if (!isSubmitted && !isRegenerating) {
                    setEditingText(e.target.value);
                  }
                }}
                disabled={isSubmitted || isRegenerating}
                style={{
                  resize: 'vertical',
                  cursor: isSubmitted || isRegenerating ? 'not-allowed' : 'text'
                }}
                _focus={{
                  borderColor: isSubmitted || isRegenerating ? 'myGray.200' : 'blue.400',
                  boxShadow:
                    isSubmitted || isRegenerating
                      ? 'none'
                      : '0 0 0 1px var(--chakra-colors-blue-400)'
                }}
              />
            </Box>

            {/* 文章写作要求 */}
            <Box>
              <Box fontWeight={'bold'} mb={2} color={'myGray.900'} fontSize={'sm'}>
                {t('common:outline.confirm_prompt_label')}
              </Box>
              <Box
                as={'textarea'}
                w={'100%'}
                minH={'80px'}
                bg={isSubmitted || isRegenerating ? 'myGray.50' : 'white'}
                border={'1px solid'}
                borderColor={'myGray.200'}
                borderRadius={'md'}
                p={3}
                value={confirmPrompt}
                onChange={(e: any) => {
                  if (!isSubmitted && !isRegenerating) {
                    setConfirmPrompt(e.target.value);
                  }
                }}
                disabled={isSubmitted || isRegenerating}
                placeholder={t('common:outline.confirm_prompt_placeholder')}
                style={{
                  resize: 'vertical',
                  cursor: isSubmitted || isRegenerating ? 'not-allowed' : 'text'
                }}
                _focus={{
                  borderColor: isSubmitted || isRegenerating ? 'myGray.200' : 'blue.400',
                  boxShadow:
                    isSubmitted || isRegenerating
                      ? 'none'
                      : '0 0 0 1px var(--chakra-colors-blue-400)'
                }}
              />
            </Box>

            <Flex gap={3} justify={'flex-end'} pt={2}>
              <Button
                size={'sm'}
                onClick={onRegenerateModalOpen}
                variant={'outline'}
                disabled={isSubmitted || isRegenerating}
              >
                {isRegenerating ? t('core.app.Generating') : t('chat:outline.regenerate')}
              </Button>
              <Button
                size={'sm'}
                colorScheme={isRegenerating ? 'orange' : isSubmitted ? 'green' : 'blue'}
                onClick={handleConfirm}
                disabled={isSubmitted || isRegenerating}
              >
                {isRegenerating
                  ? t('chat:outline.regenerating')
                  : isSubmitted
                    ? t('chat:outline.confirmed')
                    : t('common:Confirm')}
              </Button>
            </Flex>
          </Flex>
        </Box>
      </Collapse>

      {/* 重新生成弹窗 */}
      <Modal isOpen={isRegenerateModalOpen} onClose={onRegenerateModalClose} size={'lg'}>
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>{t('chat:outline.regenerate')}</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <Box mb={4}>
              <Box fontWeight={'bold'} mb={2} color={'myGray.900'} fontSize={'sm'}>
                {t('common:outline.regenerate_prompt_label')}
              </Box>
              <Textarea
                value={regeneratePrompt}
                onChange={(e) => setRegeneratePrompt(e.target.value)}
                placeholder={t('common:outline.regenerate_prompt_placeholder')}
                minH={'120px'}
                resize={'vertical'}
              />
            </Box>
          </ModalBody>
          <ModalFooter>
            <Button variant={'ghost'} mr={3} onClick={onRegenerateModalClose}>
              {t('common:Cancel')}
            </Button>
            <Button colorScheme={'blue'} onClick={handleRegenerate}>
              {t('chat:outline.regenerate')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </Box>
  );
});

import { eventBus, EventNameEnum } from '@/shared/utils/eventbus';
import { Box, Button, Link } from '@chakra-ui/react';
import MyIcon from '@/components/common/MyIcon';
import MyTooltip from '@/components/common/MyTooltip';
import React, { useMemo } from 'react';
import { isObjectId } from '@/global/common/string/utils';
import type { OutLinkChatAuthProps } from '@/global/support/permission/chat';
import { useMarkdownCtx } from './context';

export type AProps = {
  chatAuthData?: {
    appId: string;
    chatId: string;
    chatItemDataId: string;
  } & OutLinkChatAuthProps;
  onOpenCiteModal?: (e?: {
    collectionId?: string;
    sourceId?: string;
    sourceName?: string;
    datasetId?: string;
    quoteId?: string;
  }) => void;
};

const EmptyHrefLink = function EmptyHrefLink({ content }: { content: string }) {
  return (
    <MyTooltip label={'快速提问'}>
      <Button
        variant={'whitePrimary'}
        size={'xs'}
        borderRadius={'md'}
        my={1}
        onClick={() => eventBus.emit(EventNameEnum.sendQuestion, { text: content })}
      >
        {content}
      </Button>
    </MyTooltip>
  );
};

const CiteLink = React.memo(function CiteLink({
  id,
  onOpenCiteModal
}: { id: string; showAnimation?: boolean } & AProps) {
  if (!isObjectId(id)) {
    return <></>;
  }

  return (
    <Button
      variant={'unstyled'}
      minH={0}
      minW={0}
      h={'auto'}
      onClick={() => onOpenCiteModal?.({ quoteId: id })}
    >
      <MyIcon
        name={'core/chat/quoteSign'}
        w={'1rem'}
        color={'primary.700'}
        cursor={'pointer'}
      />
    </Button>
  );
});

const A = ({
  children,
  chatAuthData,
  onOpenCiteModal,
  showAnimation,
  ...props
}: AProps & {
  children: any;
  showAnimation: boolean;
  [key: string]: any;
}) => {
  // 从上下文兜底，避免把这些参数放入 components 依赖导致整体重建
  const ctx = useMarkdownCtx();
  chatAuthData = chatAuthData || ctx.chatAuthData;
  onOpenCiteModal = onOpenCiteModal || ctx.onOpenCiteModal;
  showAnimation = showAnimation ?? ctx.showAnimation;
  const content = useMemo(() => (children === undefined ? '' : String(children)), [children]);

  // empty href link
  if (!props.href && typeof children?.[0] === 'string') {
    return <EmptyHrefLink content={content} />;
  }

  // File tag syntax: [label](FILETAG:%2Fpath%2Fto%2Ffile)
  if (typeof props.href === 'string' && props.href.startsWith('FILETAG:')) {
    const encoded = props.href.slice('FILETAG:'.length);
    let decoded = encoded;
    try {
      decoded = decodeURIComponent(encoded);
    } catch {
      decoded = encoded;
    }
    return (
      <Box
        as="span"
        display="inline-flex"
        alignItems="center"
        px={2}
        py={0.5}
        mr={1.5}
        mb={1}
        borderRadius="8px"
        border="1px solid"
        borderColor="gray.200"
        bg="gray.50"
        color="gray.700"
        fontSize="12px"
        fontWeight={600}
        lineHeight={1.2}
      >
        {decoded}
      </Box>
    );
  }
  // Skill tag syntax: [skill-name](SKILLTAG:skill-name)
  if (typeof props.href === 'string' && props.href.startsWith('SKILLTAG:')) {
    const encoded = props.href.slice('SKILLTAG:'.length);
    let decoded = encoded;
    try {
      decoded = decodeURIComponent(encoded);
    } catch {
      decoded = encoded;
    }
    return (
      <Box
        as="span"
        display="inline-flex"
        alignItems="center"
        px={2}
        py={0.5}
        mr={1.5}
        mb={1}
        borderRadius="8px"
        border="1px solid"
        borderColor="adora.300"
        bg="adora.50"
        color="adora.800"
        fontSize="12px"
        fontWeight={700}
        lineHeight={1.2}
      >
        {decoded}
      </Box>
    );
  }

  // Cite
  if (
    (props.href?.startsWith('CITE') || props.href?.startsWith('QUOTE')) &&
    typeof content === 'string'
  ) {
    return (
      <CiteLink
        id={content}
        chatAuthData={chatAuthData}
        onOpenCiteModal={onOpenCiteModal}
        showAnimation={showAnimation}
      />
    );
  }

  return <Link {...props}>{children || props?.href}</Link>;
};

export default React.memo(A);

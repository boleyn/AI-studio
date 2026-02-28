import { eventBus, EventNameEnum } from '@/shared/utils/eventbus';
import { Button, Link } from '@chakra-ui/react';
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

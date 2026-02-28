import ChatHeader from "./ChatHeader";

import type { ConversationSummary } from "@/types/conversation";

interface ChatTitleSectionProps {
  onReset: () => void;
  model?: string;
  modelOptions?: Array<{ value: string; label: string }>;
  modelLoading?: boolean;
  onChangeModel?: (model: string) => void;
  onNewConversation?: () => void;
  conversations?: ConversationSummary[];
  activeConversationId?: string | null;
  onSelectConversation?: (id: string) => void;
  onDeleteConversation?: (id: string) => void;
  onDeleteAllConversations?: () => void;
  title?: string;
}

const ChatTitleSection = ({
  onReset,
  model,
  modelOptions,
  modelLoading,
  onChangeModel,
  onNewConversation,
  conversations,
  activeConversationId,
  onSelectConversation,
  onDeleteConversation,
  onDeleteAllConversations,
  title,
}: ChatTitleSectionProps) => {
  return (
    <ChatHeader
      activeConversationId={activeConversationId}
      conversations={conversations}
      model={model}
      modelLoading={modelLoading}
      modelOptions={modelOptions}
      onChangeModel={onChangeModel}
      onDeleteAllConversations={onDeleteAllConversations}
      onDeleteConversation={onDeleteConversation}
      onNewConversation={onNewConversation}
      onReset={onReset}
      onSelectConversation={onSelectConversation}
      title={title}
    />
  );
};

export default ChatTitleSection;

import { useEffect, useRef, useState } from "react";
import { ArrowDown } from "lucide-react";
import { Box, Flex, IconButton, Spinner, Text } from "@chakra-ui/react";
import { useChatPanelViewContext } from "../context/ChatPanelViewContext";
import ChatHeader from "./ChatHeader";
import ChatInput from "./ChatInput";
import ChatInteractionSurface from "./message/ChatInteractionSurface";
import ChatMessageTimeline from "./message/ChatMessageTimeline";

const ChatPanelView = () => {
  const context = useChatPanelViewContext();
  const scrolledElement = useRef<HTMLDivElement | null>(null);
  const [awayFromBottom, setAwayFromBottom] = useState(false);
  useEffect(() => {
    setAwayFromBottom(false);
  }, [context.activeConversationId]);

  const centeredComposer = context.hideHeader && !context.showInitialLoading && context.messages.length === 0;

  return (
    <Flex
      backdropFilter="none"
      bg="white"
      border="0"
      borderTop={0}
      borderBottom={0}
      borderBottomLeftRadius={0}
      borderColor="myGray.250"
      borderRight={0}
      borderTopLeftRadius={0}
      boxShadow="none"
      direction="column"
      h={context.height}
      minH={0}
      overflow="hidden"
    >
      {!context.hideHeader && <ChatHeader
        activeConversationId={context.activeConversationId}
        conversations={context.conversations}
        contextUsage={context.contextUsage}
        contextStatus={context.contextStatus}
        messageCount={context.messageCount}
        model={context.model}
        modelLoading={context.modelLoading}
        modelOptions={context.modelOptions}
        onChangeModel={context.onChangeModel}
        onDeleteAllConversations={context.onDeleteAllConversations}
        onDeleteConversation={context.onDeleteConversation}
        onNewConversation={context.onNewConversation}
        onOpenSkills={undefined}
        onRewindLatestTurn={context.onRewindLatestTurn}
        onSelectConversation={context.onSelectConversation}
        title={context.activeConversationTitle}
      />}

      <Flex direction="column" flex="1" minH={0} overflow="hidden"
        justify={centeredComposer ? "center" : undefined} pb={centeredComposer ? { base: 10, md: 24 } : 0}>
        <Box
          ref={context.scrollRef}
          bg="white"
          flex={centeredComposer ? "0 0 auto" : "1"}
          minH={0}
          overflowY="auto"
          sx={{
            scrollbarWidth: "none",
            msOverflowStyle: "none",
            "&::-webkit-scrollbar": {
              display: "none",
            },
          }}
          px={4}
          py={4}
          onScroll={(event) => {
            context.onScroll(event);
            const element = event.currentTarget as HTMLDivElement;
            scrolledElement.current = element;
            setAwayFromBottom(element.scrollHeight - element.scrollTop - element.clientHeight > 160);
          }}
        >
          {context.showInitialLoading ? (
            <Flex align="center" color="gray.600" gap={2} h="full" justify="center">
              <Spinner size="sm" />
              <Text fontSize="sm">
                {context.t("chat:loading_conversation", { defaultValue: "加载对话..." })}
              </Text>
            </Flex>
          ) : context.messages.length === 0 ? (
            <Flex align="center" color="gray.500" h="full" justify="center">
              <Box textAlign="center">
                <Text as="h1" color="gray.900" fontSize={centeredComposer ? { base: "24px", md: "26px" } : "lg"} fontWeight={centeredComposer ? "500" : "600"} letterSpacing="-0.025em">
                  {context.emptyStateTitle ||
                    context.t("chat:ready_start", { defaultValue: "准备开始" })}
                </Text>
                {!centeredComposer && <Text fontSize="sm" mt={1}>
                  {context.emptyStateDescription ||
                    context.t("chat:ready_desc", {
                      defaultValue: "描述你想改的功能，我会直接修改代码",
                    })}
                </Text>}
              </Box>
            </Flex>
          ) : (
            <Flex direction="column" gap={5} minH={0} maxW="800px" mx="auto" w="full">
              <ChatMessageTimeline
                chatInteractionContextValue={context.chatInteractionContextValue}
                isLoadingConversation={context.isLoadingConversation}
                isSending={context.isSending}
                messageRatings={context.messageRatings}
                messages={context.messages}
                onDelete={context.onDeleteMessage}
                onRate={context.onRateMessage}
                onRegenerate={context.onRegenerateMessage}
                onOpenWorkspaceFile={context.onOpenWorkspaceFile}
                streamingMessageId={context.streamingMessageId}
                t={context.t}
              />
            </Flex>
          )}
        </Box>

        <Box w="full" maxW="832px" mx="auto" position="relative" pt={centeredComposer ? 2 : 0}>
        {context.hideHeader && awayFromBottom && context.messages.length > 0 && (
          <IconButton aria-label="回到最新消息" icon={<ArrowDown size={17} />} size="sm"
            position="absolute" bottom="100%" left="50%" transform="translateX(-50%)"
            zIndex={1} borderRadius="full" bg="white" boxShadow="sm" border="1px solid"
            borderColor="gray.200" onClick={() => {
              const element = scrolledElement.current;
              if (element) element.scrollTop = element.scrollHeight;
            }} />
        )}
        <ChatInteractionSurface
          interaction={context.chatInteractionContextValue}
        />

        <ChatInput
          workspaceLayout={context.hideHeader}
          key={context.hideHeader ? context.activeConversationId ?? "new-conversation" : "composer"}
          draftStorageKey={context.hideHeader && context.activeConversationId
            ? `aistudio:draft:${context.token}:${context.activeConversationId}`
            : undefined}
          placeholder={context.hideHeader ? "发消息给 AI Studio" : undefined}
          isSending={context.isSending}
          model={context.model}
          modelLoading={context.modelLoading}
          modelOptions={context.modelOptions}
          modelGroups={context.modelGroups}
          thinkingEnabled={context.thinkingEnabled}
          mode={context.chatMode}
          showThinkingToggle={context.selectedModelSupportsReasoning}
          thinkingTooltipEnabled={context.thinkingTooltipEnabled}
          thinkingTooltipDisabled={context.thinkingTooltipDisabled}
          selectedSkill={context.selectedSkills[0]}
          selectedSkills={context.selectedSkills}
          skillOptions={context.skillOptions}
          fileOptions={context.fileOptions}
          addFileRequest={context.addFileRequest}
          onChangeModel={context.onChangeModel}
          onChangeMode={context.onChangeMode}
          onChangeThinkingEnabled={context.onChangeThinkingEnabled}
          onChangeSelectedSkills={context.onChangeSelectedSkills}
          onUploadFiles={context.onUploadFiles}
          onSend={context.onSend}
          onStop={context.onStop}
        />
        </Box>
      </Flex>
    </Flex>
  );
};

export default ChatPanelView;

import { Box, Flex, Spinner, Text } from "@chakra-ui/react";
import { useChatPanelViewContext } from "../context/ChatPanelViewContext";
import ChatHeader from "./ChatHeader";
import ChatInput from "./ChatInput";
import ChatRuntimePanels from "./ChatRuntimePanels";
import SkillsManagerModal from "./SkillsManagerModal";
import ChatMessageTimeline from "./message/ChatMessageTimeline";

const ChatPanelView = () => {
  const context = useChatPanelViewContext();

  return (
    <Flex
      backdropFilter="none"
      bg="myGray.50"
      border="1px solid"
      borderTop={0}
      borderBottom={0}
      borderBottomLeftRadius={0}
      borderColor="myGray.250"
      borderRight={0}
      borderTopLeftRadius={0}
      boxShadow="none"
      direction="column"
      h={context.height}
      overflow="hidden"
    >
      <ChatHeader
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
        onSelectConversation={context.onSelectConversation}
        title={context.activeConversationTitle}
      />

      <Flex direction="column" flex="1" overflow="hidden">
        <Box
          ref={context.scrollRef}
          bg="myGray.50"
          flex="1"
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
          onScroll={context.onScroll}
        >
          <ChatRuntimePanels
            agentTaskFilter={context.agentTaskFilter}
            agentTasks={context.agentTasks}
            filteredAgentTaskList={context.filteredAgentTaskList}
            filteredSessionTaskList={context.filteredSessionTaskList}
            onClearCompletedSessionTasks={context.onClearCompletedSessionTasks}
            onSetAgentTaskFilter={context.onSetAgentTaskFilter}
            onSetSessionTaskFilter={context.onSetSessionTaskFilter}
            onToggleShowAgentTasks={context.onToggleShowAgentTasks}
            onToggleShowSessionTasks={context.onToggleShowSessionTasks}
            sessionTaskFilter={context.sessionTaskFilter}
            sessionTasks={context.sessionTasks}
            showAgentTasks={context.showAgentTasks}
            showSessionTasks={context.showSessionTasks}
          />

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
                <Text color="myGray.700" fontSize="lg" fontWeight="700">
                  {context.emptyStateTitle ||
                    context.t("chat:ready_start", { defaultValue: "准备开始" })}
                </Text>
                <Text fontSize="sm" mt={1}>
                  {context.emptyStateDescription ||
                    context.t("chat:ready_desc", {
                      defaultValue: "描述你想改的功能，我会直接修改代码",
                    })}
                </Text>
              </Box>
            </Flex>
          ) : (
            <Flex direction="column" gap={3} pt={14}>
              <ChatMessageTimeline
                chatInteractionContextValue={context.chatInteractionContextValue}
                isLoadingConversation={context.isLoadingConversation}
                isSending={context.isSending}
                messageRatings={context.messageRatings}
                messages={context.messages}
                onDelete={context.onDeleteMessage}
                onRate={context.onRateMessage}
                onRegenerate={context.onRegenerateMessage}
                streamingMessageId={context.streamingMessageId}
                t={context.t}
              />
            </Flex>
          )}
        </Box>

        <ChatInput
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
          onChangeModel={context.onChangeModel}
          onChangeThinkingEnabled={context.onChangeThinkingEnabled}
          onChangeSelectedSkills={context.onChangeSelectedSkills}
          onUploadFiles={context.onUploadFiles}
          onSend={context.onSend}
          onStop={context.onStop}
        />
      </Flex>

      {!context.hideSkillsManager ? (
        <SkillsManagerModal
          isOpen={context.isSkillsOpen}
          onClose={context.onCloseSkills}
          projectToken={context.token.startsWith("skill-studio:") ? "" : context.token}
          onFilesApplied={context.onFilesApplied}
          onCreateViaChat={context.onCreateSkillViaChat}
          onUseSkill={context.onUseSkill}
        />
      ) : null}
    </Flex>
  );
};

export default ChatPanelView;

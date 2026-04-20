import { extractText } from "@shared/chat/messages";
import { useCallback } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { ConversationMessage } from "@/types/conversation";
import { updateMessageFeedback } from "../services/feedback";
import { deleteConversationMessageById, truncateConversationFromMessageId } from "../services/conversations";
import type { ChatInputSubmitPayload } from "../types/chatInput";
import type { UploadedFileArtifact } from "../types/fileArtifact";
import { stripInlineImageMarkdown, stripTagMarkersFromUserContent } from "../utils/chatPanelUtils";
import type { MessageRating } from "../components/message/MessageActionBar";

const VIRTUAL_FAILED_ASSISTANT_PREFIX = "virtual-failed-assistant:";

export const useChatMessageActions = ({
  token,
  activeConversationId,
  isSending,
  messages,
  setMessages,
  streamingMessageId,
  setStreamingMessageId,
  setMessageRatings,
  selectedSkills,
  handleSend,
}: {
  token: string;
  activeConversationId?: string;
  isSending: boolean;
  messages: ConversationMessage[];
  setMessages: Dispatch<SetStateAction<ConversationMessage[]>>;
  streamingMessageId: string | null;
  setStreamingMessageId: Dispatch<SetStateAction<string | null>>;
  setMessageRatings: Dispatch<SetStateAction<Record<string, MessageRating | undefined>>>;
  selectedSkills: string[];
  handleSend: (
    payload: ChatInputSubmitPayload,
    options?: {
      echoUserMessage?: boolean;
      persistIncomingMessages?: boolean;
      continueAssistantMessageId?: string;
      baseMessagesOverride?: ConversationMessage[];
    }
  ) => Promise<void>;
}) => {
  const handleRateMessage = useCallback(
    async (messageId: string, nextRating: MessageRating) => {
      const conversationId = activeConversationId;
      if (!conversationId) return;

      let previous: MessageRating | undefined;
      let resolved: MessageRating | undefined;

      setMessageRatings((prev) => {
        previous = prev[messageId];
        resolved = previous === nextRating ? undefined : nextRating;
        return {
          ...prev,
          [messageId]: resolved,
        };
      });

      setMessages((prev) =>
        prev.map((message) => {
          if (message.id !== messageId) return message;
          const kwargs =
            message.additional_kwargs && typeof message.additional_kwargs === "object"
              ? message.additional_kwargs
              : {};
          return {
            ...message,
            additional_kwargs: {
              ...kwargs,
              userFeedback: resolved,
            },
          };
        })
      );

      try {
        await updateMessageFeedback({
          token,
          conversationId,
          messageId,
          feedback: resolved,
        });
      } catch {
        setMessageRatings((prev) => ({
          ...prev,
          [messageId]: previous,
        }));
        setMessages((prev) =>
          prev.map((message) => {
            if (message.id !== messageId) return message;
            const kwargs =
              message.additional_kwargs && typeof message.additional_kwargs === "object"
                ? message.additional_kwargs
                : {};
            return {
              ...message,
              additional_kwargs: {
                ...kwargs,
                userFeedback: previous,
              },
            };
          })
        );
      }
    },
    [activeConversationId, setMessageRatings, setMessages, token]
  );

  const handleDeleteMessage = useCallback(
    async (messageId: string) => {
      if (isSending) return;
      const snapshot = [...messages];
      const isVirtualFailedAssistant = messageId.startsWith(VIRTUAL_FAILED_ASSISTANT_PREFIX);
      const resolvedDeleteId = isVirtualFailedAssistant
        ? messageId.slice(VIRTUAL_FAILED_ASSISTANT_PREFIX.length)
        : messageId;
      if (!resolvedDeleteId) return;

      const targetIndex = snapshot.findIndex((message) => message.id === resolvedDeleteId);
      if (targetIndex < 0) return;

      const remainedMessages = snapshot.filter((message) => message.id !== resolvedDeleteId);
      const conversationId = activeConversationId;
      if (conversationId) {
        const deleted = await deleteConversationMessageById(token, conversationId, resolvedDeleteId);
        if (!deleted) return;
      }

      setMessages(remainedMessages);
      setMessageRatings((prev) => {
        const next = { ...prev };
        delete next[resolvedDeleteId];
        return next;
      });
      if (streamingMessageId === resolvedDeleteId) {
        setStreamingMessageId(null);
      }
    },
    [
      activeConversationId,
      isSending,
      messages,
      setMessageRatings,
      setMessages,
      setStreamingMessageId,
      streamingMessageId,
      token,
    ]
  );

  const handleRegenerateMessage = useCallback(
    async (assistantMessageId: string) => {
      if (isSending) return;
      const snapshot = [...messages];
      let userIndex = -1;
      let assistantIndex = snapshot.findIndex((message) => message.id === assistantMessageId);
      if (assistantIndex >= 0) {
        const assistantMessage = snapshot[assistantIndex];
        if (assistantMessage.role !== "assistant") return;
        for (let i = assistantIndex - 1; i >= 0; i -= 1) {
          if (snapshot[i].role === "user") {
            userIndex = i;
            break;
          }
        }
      } else if (assistantMessageId.startsWith(VIRTUAL_FAILED_ASSISTANT_PREFIX)) {
        const failedUserId = assistantMessageId.slice(VIRTUAL_FAILED_ASSISTANT_PREFIX.length);
        userIndex = snapshot.findIndex((message) => message.role === "user" && message.id === failedUserId);
        assistantIndex = userIndex >= 0 ? userIndex + 1 : -1;
      }
      if (userIndex < 0) return;
      const userMessage = snapshot[userIndex];

      const text = stripInlineImageMarkdown(stripTagMarkersFromUserContent(extractText(userMessage.content)));
      if (!text) return;
      const uploadedFiles =
        userMessage.artifact && typeof userMessage.artifact === "object"
          ? (
              Array.isArray((userMessage.artifact as { files?: unknown }).files)
                ? ((userMessage.artifact as { files?: unknown }).files as unknown[])
                : []
            ).filter((item): item is UploadedFileArtifact => Boolean(item && typeof item === "object"))
          : [];

      const conversationId = activeConversationId;
      if (!conversationId) return;

      const cutIndex = Math.max(0, Math.min(assistantIndex, snapshot.length));
      const truncated = await truncateConversationFromMessageId(
        token,
        conversationId,
        assistantMessageId,
        userMessage.id
      );
      if (!truncated) return;

      setMessages((prev) => prev.slice(0, cutIndex));
      setMessageRatings((prev) => {
        const next = { ...prev };
        for (const message of snapshot.slice(cutIndex)) {
          if (!message.id) continue;
          delete next[message.id];
        }
        return next;
      });
      if (streamingMessageId && snapshot.slice(cutIndex).some((message) => message.id === streamingMessageId)) {
        setStreamingMessageId(null);
      }

      await handleSend(
        {
          text,
          files: [],
          uploadedFiles,
          selectedSkill: Array.from(new Set(selectedSkills.filter(Boolean)))[0],
          selectedSkills: Array.from(new Set(selectedSkills.filter(Boolean))),
          selectedFilePaths:
            userMessage.additional_kwargs &&
            typeof userMessage.additional_kwargs === "object" &&
            Array.isArray((userMessage.additional_kwargs as { selectedFilePaths?: unknown }).selectedFilePaths)
              ? ((userMessage.additional_kwargs as { selectedFilePaths?: unknown }).selectedFilePaths as unknown[])
                  .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
              : undefined,
        },
        {
          echoUserMessage: false,
          persistIncomingMessages: false,
          baseMessagesOverride: snapshot.slice(0, cutIndex),
        }
      );
    },
    [
      activeConversationId,
      handleSend,
      isSending,
      messages,
      selectedSkills,
      setMessageRatings,
      setMessages,
      setStreamingMessageId,
      streamingMessageId,
      token,
    ]
  );

  const handleRewindLatestTurn = useCallback(async () => {
    if (isSending) return false;
    const snapshot = [...messages];
    const lastAssistantIndex = [...snapshot]
      .map((message, index) => ({ message, index }))
      .reverse()
      .find(({ message }) => message.role === "assistant" && Boolean(message.id))?.index ?? -1;
    if (lastAssistantIndex < 0) return false;

    let anchorUserIndex = -1;
    for (let index = lastAssistantIndex - 1; index >= 0; index -= 1) {
      if (snapshot[index].role === "user" && snapshot[index].id) {
        anchorUserIndex = index;
        break;
      }
    }
    if (anchorUserIndex < 0) return false;

    const anchorMessage = snapshot[anchorUserIndex];
    const conversationId = activeConversationId;
    if (!conversationId || !anchorMessage.id) return false;

    const truncated = await truncateConversationFromMessageId(
      token,
      conversationId,
      anchorMessage.id
    );
    if (!truncated) return false;

    const nextMessages = snapshot.slice(0, anchorUserIndex);
    setMessages(nextMessages);
    setMessageRatings((prev) => {
      const next = { ...prev };
      for (const message of snapshot.slice(anchorUserIndex)) {
        if (!message.id) continue;
        delete next[message.id];
      }
      return next;
    });
    if (streamingMessageId && snapshot.slice(anchorUserIndex).some((message) => message.id === streamingMessageId)) {
      setStreamingMessageId(null);
    }
    return true;
  }, [
    activeConversationId,
    isSending,
    messages,
    setMessageRatings,
    setMessages,
    setStreamingMessageId,
    streamingMessageId,
    token,
  ]);

  return {
    handleRateMessage,
    handleDeleteMessage,
    handleRegenerateMessage,
    handleRewindLatestTurn,
  };
};

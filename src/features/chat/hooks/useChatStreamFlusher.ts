import { useCallback, useRef, useEffect } from "react";
import type { ConversationMessage } from "@/types/conversation";

export const useChatStreamFlusher = (
  setMessages: React.Dispatch<React.SetStateAction<ConversationMessage[]>>
) => {
  const streamingTextRef = useRef("");
  const streamingReasoningRef = useRef("");
  const streamFlushFrameRef = useRef<number | null>(null);
  const reasoningFlushFrameRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (streamFlushFrameRef.current !== null) {
        window.cancelAnimationFrame(streamFlushFrameRef.current);
        streamFlushFrameRef.current = null;
      }
      if (reasoningFlushFrameRef.current !== null) {
        window.cancelAnimationFrame(reasoningFlushFrameRef.current);
        reasoningFlushFrameRef.current = null;
      }
    };
  }, []);

  const flushAssistantReasoning = useCallback(
    (assistantMessageId: string, reasoningText: string) => {
      setMessages((prev) =>
        prev.map((msg) => {
          if (msg.id !== assistantMessageId) return msg;
          const currentKwargs =
            msg.additional_kwargs && typeof msg.additional_kwargs === "object"
              ? msg.additional_kwargs
              : {};
          return {
            ...msg,
            additional_kwargs: {
              ...currentKwargs,
              reasoning_text: reasoningText,
            },
          };
        })
      );
    },
    [setMessages]
  );

  const flushAssistantText = useCallback(
    (assistantMessageId: string, content: string) => {
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantMessageId
            ? {
                ...msg,
                content,
              }
            : msg
        )
      );
    },
    [setMessages]
  );

  const scheduleAssistantTextFlush = useCallback(
    (assistantMessageId: string) => {
      if (streamFlushFrameRef.current !== null) return;

      streamFlushFrameRef.current = window.requestAnimationFrame(() => {
        streamFlushFrameRef.current = null;
        flushAssistantText(assistantMessageId, streamingTextRef.current);
      });
    },
    [flushAssistantText]
  );

  const scheduleAssistantReasoningFlush = useCallback(
    (assistantMessageId: string) => {
      if (reasoningFlushFrameRef.current !== null) return;

      reasoningFlushFrameRef.current = window.requestAnimationFrame(() => {
        reasoningFlushFrameRef.current = null;
        flushAssistantReasoning(assistantMessageId, streamingReasoningRef.current);
      });
    },
    [flushAssistantReasoning]
  );

  const cancelPendingFlushes = useCallback(() => {
    if (streamFlushFrameRef.current !== null) {
      window.cancelAnimationFrame(streamFlushFrameRef.current);
      streamFlushFrameRef.current = null;
    }
    if (reasoningFlushFrameRef.current !== null) {
      window.cancelAnimationFrame(reasoningFlushFrameRef.current);
      reasoningFlushFrameRef.current = null;
    }
  }, []);

  return {
    streamingTextRef,
    streamingReasoningRef,
    flushAssistantReasoning,
    flushAssistantText,
    scheduleAssistantTextFlush,
    scheduleAssistantReasoningFlush,
    cancelPendingFlushes,
  };
};

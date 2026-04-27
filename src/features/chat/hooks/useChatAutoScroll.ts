import { useEffect, useRef } from "react";
import type { ConversationMessage } from "@/types/conversation";

export const useChatAutoScroll = (messages: ConversationMessage[]) => {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const shouldAutoScrollRef = useRef(true);
  const scrollRafRef = useRef<number | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (!shouldAutoScrollRef.current) return;
    if (scrollRafRef.current !== null) {
      window.cancelAnimationFrame(scrollRafRef.current);
    }
    scrollRafRef.current = window.requestAnimationFrame(() => {
      const target = scrollRef.current;
      if (!target) return;
      target.scrollTop = target.scrollHeight;
      scrollRafRef.current = null;
    });
  }, [messages]);

  useEffect(() => {
    return () => {
      if (scrollRafRef.current !== null) {
        window.cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = null;
      }
    };
  }, []);

  return { scrollRef, shouldAutoScrollRef, scrollRafRef };
};

import { Box, Button, Flex, Portal } from "@chakra-ui/react";
import { MessageSquareText, PanelRight } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

export interface SelectedMessagePayload {
  text: string;
  messageId?: string;
  role?: "user" | "assistant" | "system";
}

interface SelectionPopoverProps {
  containerRef: React.RefObject<HTMLElement | null>;
  onAskInMain: (selection: SelectedMessagePayload) => void;
  onAskInSideChat: (selection: SelectedMessagePayload) => void;
}

interface PopoverState {
  text: string;
  messageId?: string;
  role?: "user" | "assistant" | "system";
  top: number;
  left: number;
  placement: "top" | "bottom";
}

const POPOVER_ESTIMATED_WIDTH = 264;
const POPOVER_ESTIMATED_HEIGHT = 40;
const VIEWPORT_PADDING = 12;

const findSelectableMessageHost = (node: Node | null): HTMLElement | null => {
  if (!node) return null;
  const el = node.nodeType === Node.ELEMENT_NODE ? (node as HTMLElement) : node.parentElement;
  return el?.closest?.('[data-chat-selectable-message="true"]') as HTMLElement | null;
};

const isEditableElement = (node: Node | null): boolean => {
  if (!node) return false;
  const el = node.nodeType === Node.ELEMENT_NODE ? (node as HTMLElement) : node.parentElement;
  if (!el) return false;
  return Boolean(el.closest("input, textarea, [contenteditable='true'], [contenteditable='']"));
};

const SelectionPopover = ({
  containerRef,
  onAskInMain,
  onAskInSideChat,
}: SelectionPopoverProps) => {
  const [popover, setPopover] = useState<PopoverState | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  const clearPopover = useCallback(() => {
    setPopover(null);
  }, []);

  const updateFromSelection = useCallback(() => {
    const container = containerRef.current;
    if (!container || typeof window === "undefined") {
      setPopover(null);
      return;
    }

    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      setPopover(null);
      return;
    }

    const text = selection.toString().trim();
    if (!text) {
      setPopover(null);
      return;
    }

    const range = selection.getRangeAt(0);
    if (isEditableElement(range.startContainer) || isEditableElement(range.endContainer)) {
      setPopover(null);
      return;
    }

    // Ensure the selection is inside our chat message container
    const commonAncestor = range.commonAncestorContainer;
    if (!container.contains(commonAncestor)) {
      setPopover(null);
      return;
    }

    const startHost = findSelectableMessageHost(range.startContainer);
    const endHost = findSelectableMessageHost(range.endContainer);
    const host = startHost || endHost;
    if (!host) {
      setPopover(null);
      return;
    }

    const rect = range.getBoundingClientRect();
    if (!rect || (rect.width === 0 && rect.height === 0)) {
      setPopover(null);
      return;
    }

    // Check that selection rect is still roughly visible inside container
    const containerRect = container.getBoundingClientRect();
    if (rect.bottom < containerRect.top || rect.top > containerRect.bottom) {
      setPopover(null);
      return;
    }

    const popoverWidth = popoverRef.current?.offsetWidth || POPOVER_ESTIMATED_WIDTH;
    const popoverHeight = popoverRef.current?.offsetHeight || POPOVER_ESTIMATED_HEIGHT;

    const rawCenterX = rect.left + rect.width / 2;
    const clampedLeft = Math.max(
      VIEWPORT_PADDING,
      Math.min(
        rawCenterX - popoverWidth / 2,
        window.innerWidth - popoverWidth - VIEWPORT_PADDING
      )
    );

    const spaceAbove = rect.top;
    const placement: "top" | "bottom" =
      spaceAbove >= popoverHeight + 14 ? "top" : "bottom";
    const top =
      placement === "top"
        ? Math.max(VIEWPORT_PADDING, rect.top - popoverHeight - 10)
        : Math.min(window.innerHeight - popoverHeight - VIEWPORT_PADDING, rect.bottom + 10);

    const messageId = host.getAttribute("data-message-id") || undefined;
    const rawRole = host.getAttribute("data-message-role");
    const role =
      rawRole === "user" || rawRole === "assistant" || rawRole === "system"
        ? rawRole
        : undefined;

    setPopover({
      text,
      messageId,
      role,
      top,
      left: clampedLeft,
      placement,
    });
  }, [containerRef]);

  useEffect(() => {
    let rafId: number | null = null;
    const scheduleUpdate = () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        rafId = null;
        updateFromSelection();
      });
    };

    const handleMouseDown = (event: MouseEvent) => {
      if (popoverRef.current?.contains(event.target as Node)) return;
      // Hide immediately when starting a new click/drag outside
      setPopover(null);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPopover(null);
      }
    };

    const handleSelectionChange = () => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || !selection.toString().trim()) {
        setPopover(null);
      }
    };

    document.addEventListener("mouseup", scheduleUpdate);
    document.addEventListener("keyup", scheduleUpdate);
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("selectionchange", handleSelectionChange);
    window.addEventListener("scroll", clearPopover, { passive: true, capture: true });
    window.addEventListener("resize", clearPopover);

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      document.removeEventListener("mouseup", scheduleUpdate);
      document.removeEventListener("keyup", scheduleUpdate);
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("selectionchange", handleSelectionChange);
      window.removeEventListener("scroll", clearPopover, { capture: true });
      window.removeEventListener("resize", clearPopover);
    };
  }, [clearPopover, containerRef, updateFromSelection]);

  const handleAction = useCallback(
    (callback: (payload: SelectedMessagePayload) => void) => {
      if (!popover) return;
      const payload: SelectedMessagePayload = {
        text: popover.text,
        messageId: popover.messageId,
        role: popover.role,
      };
      setPopover(null);
      window.getSelection()?.removeAllRanges();
      callback(payload);
    },
    [popover]
  );

  if (!popover) return null;

  return (
    <Portal>
      <Flex
        ref={popoverRef}
        role="group"
        aria-label="选中文本操作"
        position="fixed"
        top={`${popover.top}px`}
        left={`${popover.left}px`}
        zIndex={1500}
        bg="white"
        border="1px solid"
        borderColor="rgba(0, 0, 0, 0.09)"
        borderRadius="10px"
        boxShadow="0 4px 18px rgba(0, 0, 0, 0.10), 0 1px 3px rgba(0, 0, 0, 0.06)"
        overflow="hidden"
        align="center"
        userSelect="none"
        onMouseDown={(e) => {
          // Keep text selection alive until click handler runs
          e.preventDefault();
        }}
        sx={{
          animation: "selectionPopoverIn 0.12s ease-out",
          "@keyframes selectionPopoverIn": {
            from: {
              opacity: 0,
              transform: popover.placement === "top" ? "translateY(4px) scale(0.98)" : "translateY(-4px) scale(0.98)",
            },
            to: {
              opacity: 1,
              transform: "translateY(0) scale(1)",
            },
          },
        }}
      >
        <Button
          type="button"
          size="sm"
          h="34px"
          px={3}
          borderRadius={0}
          variant="ghost"
          bg="white"
          color="#18181b"
          fontSize="13px"
          fontWeight="500"
          leftIcon={<MessageSquareText size={14} strokeWidth={1.9} />}
          _hover={{ bg: "#f4f4f5" }}
          _active={{ bg: "#e4e4e7" }}
          onClick={() => handleAction(onAskInMain)}
        >
          向 AI 提问
        </Button>
        <Box w="1px" h="18px" bg="rgba(0, 0, 0, 0.1)" flexShrink={0} />
        <Button
          type="button"
          size="sm"
          h="34px"
          px={3}
          borderRadius={0}
          variant="ghost"
          bg="white"
          color="#18181b"
          fontSize="13px"
          fontWeight="500"
          leftIcon={<PanelRight size={14} strokeWidth={1.9} />}
          _hover={{ bg: "#f4f4f5" }}
          _active={{ bg: "#e4e4e7" }}
          onClick={() => handleAction(onAskInSideChat)}
        >
          在侧边聊天中提问
        </Button>
      </Flex>
    </Portal>
  );
};

export default SelectionPopover;

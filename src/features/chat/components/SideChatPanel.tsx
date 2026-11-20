import {
  Box,
  Button,
  CloseButton,
  Flex,
  IconButton,
  Menu,
  MenuButton,
  MenuDivider,
  MenuItem,
  MenuList,
  Popover,
  PopoverBody,
  PopoverContent,
  PopoverTrigger,
  Portal,
  Spinner,
  Text,
  Textarea,
} from "@chakra-ui/react";
import {
  ArrowUp,
  Copy,
  CornerDownRight,
  Maximize2,
  MessageCirclePlus,
  MessageSquareText,
  Minimize2,
  MoreHorizontal,
  SlidersHorizontal,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import Markdown from "@/components/Markdown";
import { useCopyData } from "@/hooks/useCopyData";
import type { ChatInputModelGroup, ChatInputModelOption } from "../types/chatInput";
import type { SideChatThread } from "../types/selectionChat";
import ModelCascader from "./ModelCascader";

interface SideChatPanelProps {
  thread: SideChatThread;
  pendingQuote: string | null;
  focusSignal: number;
  isStreaming: boolean;
  errorMessage: string | null;
  model: string;
  modelLoading?: boolean;
  modelOptions: ChatInputModelOption[];
  modelGroups?: ChatInputModelGroup[];
  onChangeModel: (model: string) => void;
  onClearPendingQuote: () => void;
  onNewThread: () => void;
  onDeleteThread: (threadId: string) => void;
  onSend: (prompt: string) => Promise<void> | void;
  onStop: () => void;
  onClose: () => void;
}

const SideChatPanel = ({
  thread,
  pendingQuote,
  focusSignal,
  isStreaming,
  errorMessage,
  model,
  modelLoading,
  modelOptions,
  modelGroups,
  onChangeModel,
  onClearPendingQuote,
  onNewThread,
  onDeleteThread,
  onSend,
  onStop,
  onClose,
}: SideChatPanelProps) => {
  const [input, setInput] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const [paneWidth, setPaneWidth] = useState(50);
  const [isDragging, setIsDragging] = useState(false);
  const [resourcesOpen, setResourcesOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const { copyData } = useCopyData();

  const clampPaneWidth = (width: number) => Math.min(72, Math.max(28, width));
  const expanded = paneWidth >= 64;

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      textareaRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [thread.id, focusSignal]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [thread.messages, isStreaming]);

  const canSend = !isStreaming && (input.trim().length > 0 || Boolean(pendingQuote?.trim()));
  const activeSourceQuote = pendingQuote || thread.quoteText || "";

  const handleSubmit = async () => {
    if (!canSend) return;
    const value = input.trim();
    setInput("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "46px";
      textareaRef.current.style.overflowY = "hidden";
    }
    await onSend(value);
  };

  return (
    <Flex
      as="aside"
      aria-label="侧边聊天"
      direction="column"
      flexShrink={0}
      w={{ base: "100%", md: `${paneWidth}%` }}
      minW={{ base: "100%", md: "320px" }}
      maxW={{ base: "100%", md: "75%" }}
      h="100%"
      minH={0}
      bg="white"
      borderLeft={{ base: "none", md: "1px solid rgba(0, 0, 0, 0.08)" }}
      position={{ base: "absolute", md: "relative" }}
      inset={{ base: 0, md: "auto" }}
      zIndex={{ base: 30, md: 10 }}
    >
      {/* Draggable Vertical Divider — runs full height from top to bottom */}
      <Box
        role="separator"
        aria-label="调整侧边聊天宽度"
        aria-orientation="vertical"
        aria-valuemin={28}
        aria-valuemax={72}
        aria-valuenow={paneWidth}
        aria-valuetext={`${paneWidth}%`}
        tabIndex={0}
        display={{ base: "none", md: "flex" }}
        alignItems="center"
        justifyContent="center"
        position="absolute"
        insetY={0}
        left="-5px"
        w="10px"
        zIndex={20}
        cursor="col-resize"
        style={{ touchAction: "none" }}
        _focusVisible={{ outline: "2px solid currentColor" }}
        sx={{
          "&:hover .divider-bar": { opacity: 1 },
        }}
        onDoubleClick={() => setPaneWidth(50)}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          setIsDragging(true);
        }}
        onPointerMove={(event) => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
          const pane = event.currentTarget.parentElement;
          const containerWidth = pane?.parentElement?.getBoundingClientRect().width;
          if (!pane || !containerWidth) return;
          const nextWidth = pane.getBoundingClientRect().right - event.clientX;
          setPaneWidth(clampPaneWidth(Math.round((100 * nextWidth) / containerWidth)));
        }}
        onPointerUp={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
          setIsDragging(false);
        }}
        onPointerCancel={() => setIsDragging(false)}
        onKeyDown={(event) => {
          const nextByKey: Record<string, number> = {
            ArrowLeft: paneWidth + 2,
            ArrowRight: paneWidth - 2,
            Home: 28,
            End: 72,
          };
          if (Object.prototype.hasOwnProperty.call(nextByKey, event.key)) {
            event.preventDefault();
            setPaneWidth(clampPaneWidth(nextByKey[event.key]));
          }
        }}
      >
        <Box
          className="divider-bar"
          w="3px"
          h="100%"
          bg={isDragging ? "rgba(0, 0, 0, 0.24)" : "rgba(0, 0, 0, 0.16)"}
          opacity={isDragging ? 1 : 0}
          transition="opacity 0.15s ease"
        />
      </Box>

      {/* Top Header — flush with main chat header (minH="52px"), left: 侧边聊天, right: expand + close */}
      <Flex
        align="center"
        justify="space-between"
        px={4}
        minH="52px"
        h="52px"
        flexShrink={0}
      >
        <Button
          type="button"
          variant="ghost"
          size="sm"
          h="32px"
          px={2}
          borderRadius="10px"
          color="#18181b"
          fontSize="14px"
          fontWeight="500"
          leftIcon={<MessageCirclePlus size={16} strokeWidth={1.75} />}
          _hover={{ bg: "#f4f4f5" }}
          onClick={onNewThread}
          title="新建侧边聊天"
        >
          侧边聊天
        </Button>

        <Flex align="center" gap={0.5}>
          <IconButton
            display={{ base: "none", md: "inline-flex" }}
            aria-label={expanded ? "还原侧边聊天宽度" : "加宽侧边聊天"}
            title={expanded ? "还原宽度" : "加宽"}
            icon={expanded ? <Minimize2 size={14} strokeWidth={1.8} /> : <Maximize2 size={14} strokeWidth={1.8} />}
            size="sm"
            variant="ghost"
            borderRadius="lg"
            color="#71717a"
            _hover={{ bg: "#f4f4f5", color: "#18181b" }}
            onClick={() => setPaneWidth((prev) => (prev >= 64 ? 50 : 68))}
          />
          <IconButton
            aria-label="关闭侧边聊天"
            title="关闭侧边聊天"
            icon={<X size={15} strokeWidth={1.8} />}
            size="sm"
            variant="ghost"
            borderRadius="lg"
            color="#71717a"
            _hover={{ bg: "#f4f4f5", color: "#18181b" }}
            onClick={onClose}
          />
        </Flex>
      </Flex>

      {/* Message Canvas + Top-Right Floating Circular Buttons (exact ChatGPT layout: 输出/来源 & 更多) */}
      <Box flex="1" minH={0} position="relative" overflow="hidden" display="flex" flexDirection="column">
        <Flex
          position="absolute"
          top={1}
          right={4}
          zIndex={5}
          align="center"
          gap={2}
        >
          {/* Button 1: 输出 / 来源 (matches ChatGPT SlidersHorizontal button) */}
          <Popover
            placement="bottom-end"
            isLazy
            isOpen={resourcesOpen}
            onOpen={() => setResourcesOpen(true)}
            onClose={() => setResourcesOpen(false)}
          >
            <PopoverTrigger>
              <IconButton
                aria-label="侧边聊天输出与来源"
                title="输出与来源"
                icon={<SlidersHorizontal size={15} strokeWidth={1.8} />}
                size="sm"
                w="34px"
                h="34px"
                minW="34px"
                borderRadius="full"
                bg={resourcesOpen ? "#f4f4f5" : "white"}
                border="1px solid rgba(0, 0, 0, 0.08)"
                boxShadow="0 2px 8px rgba(0, 0, 0, 0.06)"
                color="#18181b"
                _hover={{ bg: "#f4f4f5" }}
              />
            </PopoverTrigger>
            <Portal>
              <PopoverContent
                aria-label="输出与来源"
                w="268px"
                borderRadius="16px"
                borderColor="rgba(0, 0, 0, 0.08)"
                boxShadow="0 6px 20px rgba(0, 0, 0, 0.08)"
                zIndex={1500}
              >
                <PopoverBody px={4} py={3.5}>
                  <Text fontSize="13px" fontWeight="500" color="#52525b" mb={2}>
                    输出
                  </Text>
                  <Text fontSize="13px" color="#a1a1aa" mb={4}>
                    暂无输出
                  </Text>
                  <Text fontSize="13px" fontWeight="500" color="#52525b" mb={2}>
                    来源
                  </Text>
                  {activeSourceQuote ? (
                    <Box
                      bg="#f9f9fa"
                      border="1px solid rgba(0, 0, 0, 0.07)"
                      borderRadius="10px"
                      px={2.5}
                      py={2}
                    >
                      <Text fontSize="12px" color="#3f3f46" noOfLines={3} lineHeight="1.5">
                        {activeSourceQuote}
                      </Text>
                    </Box>
                  ) : (
                    <Text fontSize="13px" color="#a1a1aa">
                      暂无来源
                    </Text>
                  )}
                </PopoverBody>
              </PopoverContent>
            </Portal>
          </Popover>

          {/* Button 2: 更多操作 (matches ChatGPT ... button) */}
          <Menu placement="bottom-end" isLazy>
            <MenuButton
              as={IconButton}
              aria-label="更多操作"
              title="更多操作"
              icon={<MoreHorizontal size={15} strokeWidth={1.8} />}
              size="sm"
              w="34px"
              h="34px"
              minW="34px"
              borderRadius="full"
              bg="white"
              border="1px solid rgba(0, 0, 0, 0.08)"
              boxShadow="0 2px 8px rgba(0, 0, 0, 0.06)"
              color="#18181b"
              _hover={{ bg: "#f4f4f5" }}
              _active={{ bg: "#f4f4f5" }}
            />
            <Portal>
              <MenuList
                minW="192px"
                borderRadius="14px"
                p={1.5}
                borderColor="rgba(0, 0, 0, 0.08)"
                boxShadow="0 6px 20px rgba(0, 0, 0, 0.08)"
                zIndex={1500}
              >
                <MenuItem
                  borderRadius="8px"
                  fontSize="13.5px"
                  color="#18181b"
                  py={2}
                  icon={<Trash2 size={14} strokeWidth={1.8} />}
                  onClick={() => onDeleteThread(thread.id)}
                >
                  删除此侧边聊天
                </MenuItem>
                <MenuDivider my={1} />
                <MenuItem
                  borderRadius="8px"
                  fontSize="13.5px"
                  color="#18181b"
                  py={2}
                  icon={<X size={14} strokeWidth={1.8} />}
                  onClick={onClose}
                >
                  关闭
                </MenuItem>
              </MenuList>
            </Portal>
          </Menu>
        </Flex>

        <Box
          ref={scrollRef}
          flex="1"
          minH={0}
          overflowY="auto"
          px={5}
          pt={10}
          pb={4}
          sx={{
            scrollbarWidth: "none",
            msOverflowStyle: "none",
            "&::-webkit-scrollbar": { display: "none" },
          }}
        >
          {thread.messages.length > 0 ? (
            <Flex direction="column" gap={5} w="100%">
              {thread.messages.map((msg, index) => {
                const isUser = msg.role === "user";
                const isLastAssistant =
                  !isUser && index === thread.messages.length - 1 && isStreaming;
                const displayQuote =
                  isUser && (msg.quoteText || (index === 0 ? thread.quoteText : ""));

                return (
                  <Flex
                    key={msg.id}
                    direction="column"
                    align={isUser ? "flex-end" : "flex-start"}
                    w="100%"
                    sx={{
                      "&:hover .side-msg-actions": { opacity: 1 },
                    }}
                  >
                    {isUser ? (
                      <Flex
                        direction="column"
                        gap={1.5}
                        bg="#f4f4f4"
                        color="#0d0d0d"
                        borderRadius="20px"
                        px={4}
                        py={2.5}
                        maxW="85%"
                      >
                        {displayQuote ? (
                          <Flex
                            align="flex-start"
                            gap={1.5}
                            bg="rgba(0, 0, 0, 0.04)"
                            borderLeft="2.5px solid rgba(0, 0, 0, 0.22)"
                            borderRadius="8px"
                            px={2.5}
                            py={1.5}
                          >
                            <Box mt="3px" color="#71717a" flexShrink={0}>
                              <CornerDownRight size={12} />
                            </Box>
                            <Text
                              fontSize="12.5px"
                              lineHeight="1.5"
                              color="#52525b"
                              noOfLines={3}
                              wordBreak="break-word"
                              title={displayQuote}
                            >
                              {displayQuote}
                            </Text>
                          </Flex>
                        ) : null}
                        <Text
                          fontSize="15px"
                          lineHeight="1.65"
                          whiteSpace="pre-wrap"
                          wordBreak="break-word"
                        >
                          {msg.content}
                        </Text>
                      </Flex>
                    ) : (
                      <Box
                        w="100%"
                        fontSize="15px"
                        lineHeight="1.75"
                        color="#0d0d0d"
                        sx={{
                          "& .markdown": { fontSize: "15px", lineHeight: 1.75, color: "#0d0d0d" },
                          "& .markdown p": { marginTop: "8px", marginBottom: "8px" },
                          "& .markdown p:first-of-type": { marginTop: "0" },
                          "& .markdown p:last-of-type": { marginBottom: "0" },
                        }}
                      >
                        {msg.content ? (
                          <Markdown source={msg.content} showAnimation={isLastAssistant} />
                        ) : isLastAssistant ? (
                          <Flex align="center" gap={2} color="#71717a" py={1}>
                            <Spinner size="xs" />
                            <Text fontSize="13.5px">正在思考...</Text>
                          </Flex>
                        ) : null}

                        {!isLastAssistant && msg.content ? (
                          <Flex
                            className="side-msg-actions"
                            align="center"
                            gap={1}
                            mt={1.5}
                            opacity={0}
                            transition="opacity 0.15s"
                          >
                            <IconButton
                              aria-label="复制回复"
                              title="复制"
                              icon={<Copy size={14} />}
                              size="xs"
                              variant="ghost"
                              borderRadius="md"
                              color="#71717a"
                              _hover={{ bg: "#f4f4f5", color: "#18181b" }}
                              onClick={() => copyData(msg.content)}
                            />
                          </Flex>
                        ) : null}
                      </Box>
                    )}
                  </Flex>
                );
              })}
            </Flex>
          ) : null}

          {errorMessage ? (
            <Box
              mt={3}
              px={3}
              py={2}
              borderRadius="10px"
              bg="#fef2f2"
              border="1px solid #fecaca"
              color="#b91c1c"
              fontSize="12.5px"
            >
              {errorMessage}
            </Box>
          ) : null}
        </Box>
      </Box>

      {/* Bottom Composer — exact same styling & colors as main ChatInput */}
      <Box px={4} py={3} flexShrink={0}>
        <Flex
          bg="white"
          border="1px solid"
          borderColor={isFocused ? "rgba(0, 0, 0, 0.18)" : "rgba(0, 0, 0, 0.09)"}
          borderRadius="22px"
          boxShadow={
            isFocused
              ? "0px 4px 18px rgba(0, 0, 0, 0.06)"
              : "0px 2px 10px rgba(0, 0, 0, 0.035)"
          }
          direction="column"
          minH="96px"
          overflow="visible"
          transition="border-color 0.15s, box-shadow 0.15s"
        >
          {pendingQuote ? (
            <Flex gap={2.5} px={3.5} pt={3} pb={0.5} wrap="wrap" userSelect="none">
              <Box
                position="relative"
                w="162px"
                minH="114px"
                bg="white"
                border="1px solid"
                borderColor="rgba(0, 0, 0, 0.11)"
                borderRadius="16px"
                px={3}
                py={2.5}
                display="flex"
                flexDirection="column"
                justifyContent="space-between"
                transition="border-color 0.15s, box-shadow 0.15s"
                _hover={{
                  borderColor: "rgba(0, 0, 0, 0.2)",
                  boxShadow: "0 2px 8px rgba(0, 0, 0, 0.05)",
                }}
                sx={{
                  "@media (hover: hover) and (pointer: fine)": {
                    "&:not(:hover):not(:focus-within) .side-quote-close": { opacity: 0 },
                  },
                }}
              >
                <CloseButton
                  className="side-quote-close"
                  aria-label="移除选中引用"
                  size="sm"
                  w="20px"
                  h="20px"
                  fontSize="9px"
                  position="absolute"
                  top="-7px"
                  right="-7px"
                  bg="#18181b"
                  color="white"
                  borderRadius="full"
                  boxShadow="0 1px 4px rgba(0,0,0,0.2)"
                  _hover={{ bg: "#3f3f46" }}
                  transition="opacity 0.12s ease"
                  onClick={() => {
                    onClearPendingQuote();
                    textareaRef.current?.focus();
                  }}
                />
                <Text
                  fontSize="12.5px"
                  lineHeight="1.45"
                  color="#3f3f46"
                  noOfLines={4}
                  wordBreak="break-word"
                  title={pendingQuote}
                >
                  {pendingQuote}
                </Text>
                <Flex align="center" gap={1.5} mt={2.5} color="#52525b">
                  <MessageSquareText size={13} strokeWidth={1.9} />
                  <Text fontSize="11.5px" fontWeight="500" color="#3f3f46">
                    选中引用
                  </Text>
                </Flex>
              </Box>
            </Flex>
          ) : null}

          <Flex align="center" px={4} pt={3}>
            <Textarea
              ref={textareaRef}
              value={input}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              onChange={(e) => {
                setInput(e.target.value);
                const el = e.target;
                el.style.height = "46px";
                const nextHeight = Math.max(46, Math.min(el.scrollHeight, 140));
                el.style.height = `${nextHeight}px`;
                el.style.overflowY = el.scrollHeight > 140 ? "auto" : "hidden";
              }}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void handleSubmit();
                }
              }}
              placeholder="发消息..."
              aria-label="侧边聊天输入框"
              bg="transparent"
              border="none"
              outline="none"
              boxShadow="none"
              _hover={{ border: "none", boxShadow: "none" }}
              _focus={{ border: "none", boxShadow: "none", outline: "none" }}
              _focusVisible={{ border: "none", boxShadow: "none", outline: "none" }}
              p={0}
              minH="46px"
              maxH="140px"
              resize="none"
              rows={1}
              overflowX="hidden"
              overflowY="hidden"
              fontSize="15px"
              lineHeight="1.5"
              color="myGray.700"
              _placeholder={{ color: "#707070", fontSize: "15px" }}
              isDisabled={isStreaming}
              whiteSpace="pre-wrap"
            />
          </Flex>

          <Flex align="center" h="44px" justify="flex-end" gap={1.5} mt="auto" pb={2} px={3}>
            <ModelCascader
              showLabel
              disabled={Boolean(modelLoading || isStreaming)}
              loading={modelLoading}
              model={model}
              modelOptions={modelOptions}
              modelGroups={modelGroups}
              onChangeModel={onChangeModel}
            />
            <IconButton
              aria-label={isStreaming ? "停止生成" : "发送"}
              icon={
                isStreaming ? (
                  <Square size={13} fill="currentColor" />
                ) : (
                  <ArrowUp size={17} strokeWidth={2.2} />
                )
              }
              size="sm"
              w="34px"
              h="34px"
              minW="34px"
              borderRadius="full"
              bg={isStreaming ? "#f4f4f5" : canSend ? "#0f172a" : "#f4f4f5"}
              color={isStreaming ? "#0f172a" : canSend ? "#ffffff" : "#71717a"}
              _hover={{
                bg: isStreaming
                  ? "rgba(15, 23, 42, 0.14)"
                  : canSend
                  ? "#111827"
                  : "#e4e4e7",
              }}
              isDisabled={!isStreaming && !canSend}
              onClick={() => {
                if (isStreaming) {
                  onStop();
                  return;
                }
                void handleSubmit();
              }}
              flexShrink={0}
              type="button"
            />
          </Flex>
        </Flex>
      </Box>
    </Flex>
  );
};

export default SideChatPanel;

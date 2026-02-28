import {
  Box,
  CloseButton,
  Flex,
  IconButton,
  Input,
  Text,
  Textarea,
} from "@chakra-ui/react";
import { getFileIcon } from "@fastgpt/global/common/file/icon";
import { createId } from "@shared/chat/messages";
import { useTranslation } from "next-i18next";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ChatInputFile, ChatInputProps, ChatInputSubmitPayload } from "../types/chatInput";
import type { UploadedFileArtifact } from "../types/fileArtifact";
import ModelCascader from "./ModelCascader";

type LocalInputFile = ChatInputFile & {
  uploadState: "uploading" | "ready" | "error";
  uploadedArtifact?: UploadedFileArtifact;
  uploadError?: string;
};

const ChatInput = ({
  isSending,
  model,
  modelOptions,
  modelLoading,
  selectedSkill,
  skillOptions = [],
  prefillText,
  prefillVersion,
  onChangeModel,
  onChangeSelectedSkill,
  onUploadFiles,
  onSend,
  onStop,
}: ChatInputProps) => {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const [files, setFiles] = useState<LocalInputFile[]>([]);
  const [isComposing, setIsComposing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [activeSkillIndex, setActiveSkillIndex] = useState(0);
  const [skillQuery, setSkillQuery] = useState("");
  const [mentionRange, setMentionRange] = useState<{ start: number; end: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textAreaRef = useRef<HTMLTextAreaElement | null>(null);
  const updateMentionState = useCallback((value: string, cursorPosition: number) => {
    const safeCursor = Math.max(0, Math.min(cursorPosition, value.length));
    const prefix = value.slice(0, safeCursor);
    const match = prefix.match(/(^|\s)@([a-zA-Z0-9_-]*)$/);
    if (!match) {
      setMentionRange(null);
      setSkillQuery("");
      return;
    }
    const query = match[2] || "";
    const mentionStart = safeCursor - query.length - 1;
    setMentionRange({ start: mentionStart, end: safeCursor });
    setSkillQuery(query.toLowerCase());
  }, []);
  const resetTextareaHeight = useCallback(() => {
    const textarea = textAreaRef.current;
    if (!textarea) return;
    textarea.style.height = "50px";
    textarea.style.overflowY = "hidden";
  }, []);
  const isInputLocked = isSending || isSubmitting;
  const hasUploadingFiles = useMemo(
    () => files.some((item) => item.uploadState === "uploading"),
    [files]
  );
  const hasUploadErrors = useMemo(
    () => files.some((item) => item.uploadState === "error"),
    [files]
  );

  const canSend = useMemo(
    () =>
      !isSending &&
      !isSubmitting &&
      !hasUploadingFiles &&
      !hasUploadErrors &&
      (text.trim().length > 0 || files.length > 0),
    [files.length, hasUploadErrors, hasUploadingFiles, isSending, isSubmitting, text]
  );
  const filteredSkillOptions = useMemo(() => {
    const keyword = skillQuery.trim();
    const available = skillOptions.filter((item) => Boolean(item.name && item.name !== selectedSkill));
    if (!keyword) return available.slice(0, 8);
    return available
      .filter((item) => {
        const name = item.name.toLowerCase();
        const description = (item.description || "").toLowerCase();
        return name.includes(keyword) || description.includes(keyword);
      })
      .slice(0, 8);
  }, [selectedSkill, skillOptions, skillQuery]);
  const showSkillPicker =
    Boolean(mentionRange) &&
    filteredSkillOptions.length > 0 &&
    !isSending &&
    !isSubmitting;
  const previewFiles = useMemo(
    () =>
      files.map((item) => {
        const icon = getFileIcon(item.file.name);
        const isImage = item.file.type.startsWith("image/") || icon === "image";
        return {
          ...item,
          icon,
          isImage,
          previewUrl: isImage ? URL.createObjectURL(item.file) : "",
        };
      }),
    [files]
  );

  useEffect(() => {
    return () => {
      previewFiles.forEach((item) => {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      });
    };
  }, [previewFiles]);

  useEffect(() => {
    if (!prefillVersion || !prefillText?.trim()) return;
    setText((prev) => {
      const current = prev.trim();
      if (!current) return prefillText.trim();
      return `${prev}\n${prefillText.trim()}`;
    });
    setTimeout(() => {
      const textarea = textAreaRef.current;
      if (!textarea) return;
      textarea.focus();
      resetTextareaHeight();
      const nextHeight = Math.min(textarea.scrollHeight, 128);
      textarea.style.height = `${nextHeight}px`;
      textarea.style.overflowY = textarea.scrollHeight > 128 ? "auto" : "hidden";
    }, 0);
  }, [prefillText, prefillVersion, resetTextareaHeight]);

  useEffect(() => {
    if (text.length > 0) return;
    resetTextareaHeight();
  }, [resetTextareaHeight, text]);
  useEffect(() => {
    setActiveSkillIndex(0);
  }, [skillQuery, showSkillPicker]);

  const applySelectedSkill = useCallback(
    (skillName: string) => {
      onChangeSelectedSkill?.(skillName);
      if (!mentionRange) return;
      const nextText = `${text.slice(0, mentionRange.start)}${text.slice(mentionRange.end)}`.replace(
        /\s{2,}/g,
        " "
      );
      setText(nextText);
      setMentionRange(null);
      setSkillQuery("");
      window.requestAnimationFrame(() => {
        const textarea = textAreaRef.current;
        if (!textarea) return;
        const cursor = Math.max(0, mentionRange.start);
        textarea.focus();
        textarea.setSelectionRange(cursor, cursor);
        resetTextareaHeight();
        const nextHeight = Math.min(textarea.scrollHeight, 128);
        textarea.style.height = `${nextHeight}px`;
        textarea.style.overflowY = textarea.scrollHeight > 128 ? "auto" : "hidden";
      });
    },
    [mentionRange, onChangeSelectedSkill, resetTextareaHeight, text]
  );

  const uploadSingleFile = useCallback(
    async (fileItem: LocalInputFile) => {
      try {
        const uploaded = await onUploadFiles([
          {
            id: fileItem.id,
            file: fileItem.file,
          },
        ]);
        const matched = uploaded.find((artifact) => artifact.id === fileItem.id) || uploaded[0];

        setFiles((prev) =>
          prev.map((item) =>
            item.id === fileItem.id
              ? matched
                ? {
                    ...item,
                    uploadState: "ready",
                    uploadedArtifact: matched,
                    uploadError: undefined,
                  }
                : {
                    ...item,
                    uploadState: "error",
                    uploadError: "上传失败，请重试",
                  }
              : item
          )
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "上传失败，请重试";
        setFiles((prev) =>
          prev.map((item) =>
            item.id === fileItem.id
              ? {
                  ...item,
                  uploadState: "error",
                  uploadError: message,
                }
              : item
          )
        );
      }
    },
    [onUploadFiles]
  );

  const retryUploadFile = useCallback(
    (fileItem: LocalInputFile) => {
      setFiles((prev) =>
        prev.map((item) =>
          item.id === fileItem.id
            ? {
                ...item,
                uploadState: "uploading",
                uploadError: undefined,
                uploadedArtifact: undefined,
              }
            : item
        )
      );
      void uploadSingleFile(fileItem);
    },
    [uploadSingleFile]
  );

  const onPickFiles = useCallback(
    async (picked: FileList | null) => {
      if (!picked || picked.length === 0) return;
      const next = Array.from(picked).map((file) => ({
        id: createId(),
        file,
        uploadState: "uploading" as const,
      }));
      setFiles((prev) => [...prev, ...next]);
      await Promise.allSettled(next.map((fileItem) => uploadSingleFile(fileItem)));
    },
    [uploadSingleFile]
  );

  const handleSend = useCallback(() => {
    if (!canSend) return;
    const selectedFiles: ChatInputFile[] = files.map((item) => ({
      id: item.id,
      file: item.file,
    }));
    const uploadedFiles = files
      .map((item) => item.uploadedArtifact)
      .filter((item): item is UploadedFileArtifact => Boolean(item));

    const payload: ChatInputSubmitPayload = {
      text: text.trim(),
      files: selectedFiles,
      uploadedFiles,
      selectedSkill: selectedSkill || undefined,
    };

    setIsSubmitting(true);
    setText("");
    setFiles([]);
    resetTextareaHeight();
    window.requestAnimationFrame(() => {
      resetTextareaHeight();
    });
    if (fileInputRef.current) fileInputRef.current.value = "";

    Promise.resolve(onSend(payload)).finally(() => {
      setIsSubmitting(false);
    });
  }, [canSend, files, onSend, resetTextareaHeight, text]);

  return (
    <Box px={4} py={3}>
      <Flex
        bg="white"
        border="0.5px solid"
        borderColor={isFocused ? "rgba(0,0,0,0.24)" : "rgba(0,0,0,0.18)"}
        borderRadius="18px"
        boxShadow={
          isFocused
            ? "0px 5px 20px -4px rgba(19, 51, 107, 0.13)"
            : "0px 5px 16px -4px rgba(19, 51, 107, 0.08)"
        }
        direction="column"
        minH="108px"
        overflow="hidden"
      >
        {previewFiles.length > 0 ? (
          <Flex gap="6px" mb={2} pt={2} px={3} userSelect="none" wrap="wrap">
            {previewFiles.map((item) => (
              <Box
                key={item.id}
                aspectRatio={item.isImage ? 1 : 4}
                maxW={item.isImage ? "56px" : "224px"}
                w={item.isImage ? "12.5%" : "calc(50% - 3px)"}
              >
                <Box
                  _hover={{ ".file-preview-close": { display: "block" } }}
                  alignItems="center"
                  border="1px solid #E2E8F0"
                  borderRadius="8px"
                  boxShadow="0px 2.571px 6.429px 0px rgba(19, 51, 107, 0.08), 0px 0px 0.643px 0px rgba(19, 51, 107, 0.08)"
                  h="100%"
                  pl={item.isImage ? 0 : 2}
                  position="relative"
                  w="100%"
                >
                  <CloseButton
                    bg="white"
                    borderRadius="999px"
                    className="file-preview-close"
                    display={["block", "none"]}
                    onClick={() => setFiles((prev) => prev.filter((f) => f.id !== item.id))}
                    position="absolute"
                    right="-8px"
                    size="sm"
                    top="-8px"
                    zIndex={10}
                  />
                  {item.uploadState === "error" ? (
                    <Text
                      as="button"
                      bg="rgba(255,255,255,0.95)"
                      border="1px solid"
                      borderColor="red.200"
                      borderRadius="999px"
                      color="red.500"
                      fontSize="10px"
                      left="6px"
                      lineHeight="16px"
                      onClick={() => retryUploadFile(item)}
                      px="6px"
                      position="absolute"
                      top="6px"
                      zIndex={12}
                    >
                      重试
                    </Text>
                  ) : null}
                  {item.isImage ? (
                    <Box
                      alt={item.file.name}
                      as="img"
                      borderRadius="8px"
                      h="100%"
                      objectFit="contain"
                      src={item.previewUrl}
                      w="100%"
                    />
                  ) : (
                    <Flex align="center" gap={2} h="100%" pr={2}>
                      <Box as="img" h="24px" src={`/icons/chat/${item.icon}.svg`} w="24px" />
                      <Box minW={0}>
                        <Text className="textEllipsis" fontSize="xs" noOfLines={1}>
                          {item.file.name}
                        </Text>
                        <Text
                          color={item.uploadState === "error" ? "red.500" : "gray.500"}
                          fontSize="10px"
                          noOfLines={1}
                        >
                          {item.uploadState === "uploading"
                            ? "上传中..."
                            : item.uploadState === "error"
                            ? item.uploadError || "上传失败，可重试"
                            : "已上传"}
                        </Text>
                      </Box>
                    </Flex>
                  )}
                </Box>
              </Box>
            ))}
          </Flex>
        ) : null}

        <Flex align="center" px={2}>
          <Box position="relative" w="100%">
            {selectedSkill ? (
              <Flex px={2} pt={2}>
                <Flex
                  align="center"
                  bg="#EFF6FF"
                  border="1px solid"
                  borderColor="#BFDBFE"
                  borderRadius="10px"
                  color="#1E40AF"
                  gap={1}
                  h="28px"
                  maxW="380px"
                  pl={2.5}
                  pr={1}
                >
                  <Text color="#1D4ED8" fontSize="11px" fontWeight={700} opacity={0.88}>
                    skill
                  </Text>
                  <Text fontSize="13px" fontWeight={600} noOfLines={1}>
                    {selectedSkill}
                  </Text>
                  <CloseButton
                    color="#1D4ED8"
                    onClick={() => onChangeSelectedSkill?.(undefined)}
                    aria-label="清除技能选择"
                    size="sm"
                    transform="scale(0.88)"
                  />
                </Flex>
              </Flex>
            ) : null}
            <Textarea
              ref={textAreaRef}
              _focusVisible={{ border: "none", boxShadow: "none" }}
              _placeholder={{
                color: "#707070",
                fontSize: "13px",
              }}
              border="none"
              color="myGray.900"
              fontSize="1rem"
              fontWeight={400}
              lineHeight="1.5"
              maxH="128px"
              mb={0}
              minH="50px"
              isDisabled={isInputLocked}
              onBlur={() => {
                setIsFocused(false);
                window.setTimeout(() => {
                  setMentionRange(null);
                  setSkillQuery("");
                }, 80);
              }}
              onChange={(event) => {
                const nextValue = event.target.value;
                setText(nextValue);
                updateMentionState(nextValue, event.target.selectionStart ?? nextValue.length);
                const textarea = event.target;
                resetTextareaHeight();
                const nextHeight = Math.min(textarea.scrollHeight, 128);
                textarea.style.height = `${nextHeight}px`;
                textarea.style.overflowY = textarea.scrollHeight > 128 ? "auto" : "hidden";
              }}
              onCompositionEnd={() => setIsComposing(false)}
              onCompositionStart={() => setIsComposing(true)}
              onFocus={() => setIsFocused(true)}
              onKeyDown={(event) => {
                if (showSkillPicker) {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    setActiveSkillIndex((prev) => (prev + 1) % filteredSkillOptions.length);
                    return;
                  }
                  if (event.key === "ArrowUp") {
                    event.preventDefault();
                    setActiveSkillIndex((prev) =>
                      prev <= 0 ? filteredSkillOptions.length - 1 : prev - 1
                    );
                    return;
                  }
                  if (event.key === "Enter" && !event.shiftKey) {
                    // Keep Enter for normal send; skill selection should be explicit (click/Tab).
                    setMentionRange(null);
                    setSkillQuery("");
                  }
                  if (event.key === "Tab") {
                    event.preventDefault();
                    const picked = filteredSkillOptions[activeSkillIndex];
                    if (picked?.name) {
                      applySelectedSkill(picked.name);
                    }
                    return;
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    setMentionRange(null);
                    setSkillQuery("");
                    return;
                  }
                }
                if (event.key === "Enter" && !event.shiftKey) {
                  if (isComposing) return;
                  event.preventDefault();
                  handleSend();
                }
              }}
              overflowX="hidden"
              overflowY="hidden"
              placeholder={t("chat:input_placeholder", {
                defaultValue: "输入你的问题，按 Enter 发送，Shift + Enter 换行",
              })}
              px={2}
              resize="none"
              rows={1}
              value={text}
              w="100%"
              whiteSpace="pre-wrap"
            />
            {showSkillPicker ? (
              <Box
                bg="white"
                border="1px solid"
                borderColor="blue.100"
                borderRadius="10px"
                boxShadow="0 8px 24px rgba(15, 23, 42, 0.14)"
                left={0}
                maxH="220px"
                overflowY="auto"
                position="absolute"
                right={0}
                top="calc(100% + 4px)"
                zIndex={30}
              >
                <Flex direction="column" p={1}>
                  {filteredSkillOptions.map((item, index) => {
                    const isActive = index === activeSkillIndex;
                    return (
                      <Box
                        key={item.name}
                        bg={isActive ? "blue.50" : "transparent"}
                        borderRadius="8px"
                        cursor="pointer"
                        onMouseDown={(event) => {
                          event.preventDefault();
                          applySelectedSkill(item.name);
                        }}
                        px={2}
                        py={1.5}
                      >
                        <Text color="myGray.900" fontSize="sm" fontWeight={700} noOfLines={1}>
                          {item.name}
                        </Text>
                        <Text color="myGray.500" fontSize="11px" mt={0.5} noOfLines={1}>
                          {item.description || "无描述"}
                        </Text>
                      </Box>
                    );
                  })}
                </Flex>
              </Box>
            ) : null}
          </Box>
        </Flex>

        <Flex align="center" h="44px" justify="space-between" pb={2} pl={3} pr={3}>
          <Flex align="center" gap={2} minW={0}>
            <ModelCascader
              disabled={Boolean(modelLoading || isSending || isSubmitting)}
              loading={modelLoading}
              model={model}
              modelOptions={modelOptions}
              onChangeModel={onChangeModel}
            />
            {isSending ? (
              <Text color="myGray.500" fontSize="xs">
                {t("chat:generating", { defaultValue: "正在生成回复..." })}
              </Text>
            ) : hasUploadingFiles ? (
              <Text color="myGray.500" fontSize="xs">
                {t("chat:uploading_files", { defaultValue: "文件上传中..." })}
              </Text>
            ) : hasUploadErrors ? (
              <Text color="red.500" fontSize="xs">
                {t("chat:upload_failed", { defaultValue: "存在上传失败文件，请移除后重试" })}
              </Text>
            ) : null}
          </Flex>

          <Flex align="center" gap={1}>
            <Input
              ref={fileInputRef}
              display="none"
              onChange={(event) => onPickFiles(event.target.files)}
              type="file"
              multiple
            />
            <Flex
              _hover={{ bg: "rgba(0, 0, 0, 0.04)" }}
              align="center"
              borderRadius="6px"
              cursor={isSending || isSubmitting ? "not-allowed" : "pointer"}
              h="36px"
              justify="center"
              onClick={() => {
                if (isSending || isSubmitting) return;
                fileInputRef.current?.click();
              }}
              w="36px"
            >
              <Box alt="attach" as="img" h="16px" opacity={0.75} src="/icons/chat/fileSelect.svg" w="16px" />
            </Flex>

            <Box bg="myGray.200" h="20px" mx={1} w="2px" />

            <IconButton
              _hover={{ bg: isSending ? "primary.100" : canSend ? "#2563EB" : "rgba(17, 24, 36, 0.1)" }}
              aria-label={
                isSending
                  ? t("chat:stop_generating", { defaultValue: "停止生成" })
                  : t("common:Send", { defaultValue: "发送" })
              }
              bg={isSending ? "primary.50" : canSend ? "primary.500" : "rgba(17, 24, 36, 0.1)"}
              borderRadius="12px"
              h="36px"
              icon={
                <Box
                  as="img"
                  h="18px"
                  src={isSending ? "/icons/chat/stop.svg" : "/icons/chat/sendFill.svg"}
                  sx={{
                    filter: isSending ? "none" : "brightness(0) invert(1)",
                  }}
                  w="18px"
                />
              }
              isDisabled={!isSending && !canSend}
              onClick={() => {
                if (isSending) {
                  onStop?.();
                  return;
                }
                handleSend();
              }}
              type="button"
              w="36px"
            />
          </Flex>
        </Flex>
      </Flex>
    </Box>
  );
};

export default ChatInput;

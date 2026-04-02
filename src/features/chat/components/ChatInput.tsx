import {
  Box,
  CloseButton,
  Flex,
  IconButton,
  Input,
  Text,
  Textarea,
  useTheme,
} from "@chakra-ui/react";
import { getFileIcon } from "@fastgpt/global/common/file/icon";
import { AgentSkillsIcon } from "@components/common/Icon";
import { createId } from "@shared/chat/messages";
import { useTranslation } from "next-i18next";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MyTooltip from "@/components/ui/MyTooltip";

import type { ChatInputFile, ChatInputProps, ChatInputSubmitPayload } from "../types/chatInput";
import type { UploadedFileArtifact } from "../types/fileArtifact";
import { toFileTagLabel } from "../utils/chatPanelUtils";
import ModelCascader from "./ModelCascader";
import SlashFilePicker from "./SlashFilePicker";
import SkillMentionPicker from "./SkillMentionPicker";

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
  thinkingEnabled = true,
  showThinkingToggle = true,
  thinkingTooltipEnabled,
  thinkingTooltipDisabled,
  selectedSkill,
  selectedSkills,
  skillOptions = [],
  fileOptions = [],
  prefillText,
  prefillVersion,
  onChangeModel,
  onChangeThinkingEnabled,
  onChangeSelectedSkill,
  onChangeSelectedSkills,
  onUploadFiles,
  onSend,
  onStop,
}: ChatInputProps) => {
  const { t } = useTranslation();
  const theme = useTheme() as Record<string, any>;
  const chatInputTheme = theme?.workspace?.chatInput || {};
  const skillTheme = chatInputTheme?.skillMention || {};
  const [text, setText] = useState("");
  const [files, setFiles] = useState<LocalInputFile[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [activeSkillIndex, setActiveSkillIndex] = useState(0);
  const [activeFileIndex, setActiveFileIndex] = useState(0);
  const [skillQuery, setSkillQuery] = useState("");
  const [fileQuery, setFileQuery] = useState("");
  const [selectedFilePaths, setSelectedFilePaths] = useState<string[]>([]);
  const [mentionRange, setMentionRange] = useState<{ start: number; end: number } | null>(null);
  const [fileRange, setFileRange] = useState<{ start: number; end: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textAreaRef = useRef<HTMLTextAreaElement | null>(null);
  const skillPickerRef = useRef<HTMLDivElement | null>(null);
  const filePickerRef = useRef<HTMLDivElement | null>(null);
  const updateTriggerState = useCallback((value: string, cursorPosition: number) => {
    const safeCursor = Math.max(0, Math.min(cursorPosition, value.length));
    const prefix = value.slice(0, safeCursor);
    const skillMatch = prefix.match(/(^|\s)@([a-zA-Z0-9_-]*)$/);
    if (skillMatch) {
      const query = skillMatch[2] || "";
      const triggerStart = safeCursor - query.length - 1;
      setMentionRange({ start: triggerStart, end: safeCursor });
      setSkillQuery(query.toLowerCase());
      setFileRange(null);
      setFileQuery("");
      return;
    }
    const fileMatch = prefix.match(/(^|\s)\/([^\s/]*)$/);
    if (fileMatch) {
      const query = fileMatch[2] || "";
      const triggerStart = safeCursor - query.length - 1;
      setFileRange({ start: triggerStart, end: safeCursor });
      setFileQuery(query.toLowerCase());
      setMentionRange(null);
      setSkillQuery("");
      return;
    }
    setMentionRange(null);
    setSkillQuery("");
    setFileRange(null);
    setFileQuery("");
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
      (text.trim().length > 0 || files.length > 0 || selectedFilePaths.length > 0),
    [files.length, hasUploadErrors, hasUploadingFiles, isSending, isSubmitting, selectedFilePaths.length, text]
  );
  const selectedSkillList = useMemo(() => {
    if (Array.isArray(selectedSkills) && selectedSkills.length > 0) {
      return selectedSkills.filter(Boolean);
    }
    return selectedSkill ? [selectedSkill] : [];
  }, [selectedSkill, selectedSkills]);
  const commitSelectedSkills = useCallback(
    (next: string[]) => {
      if (onChangeSelectedSkills) {
        onChangeSelectedSkills(next);
        return;
      }
      onChangeSelectedSkill?.(next[0]);
    },
    [onChangeSelectedSkill, onChangeSelectedSkills]
  );

  const filteredSkillOptions = useMemo(() => {
    const keyword = skillQuery.trim();
    const selectedSet = new Set(selectedSkillList);
    const available = skillOptions.filter((item) => Boolean(item.name && !selectedSet.has(item.name)));
    if (!keyword) return available.slice(0, 8);
    return available
      .filter((item) => {
        const name = item.name.toLowerCase();
        const description = (item.description || "").toLowerCase();
        return name.includes(keyword) || description.includes(keyword);
      })
      .slice(0, 8);
  }, [selectedSkillList, skillOptions, skillQuery]);
  const showSkillPicker =
    Boolean(mentionRange) &&
    filteredSkillOptions.length > 0 &&
    !isSending &&
    !isSubmitting;
  const filteredFileOptions = useMemo(() => {
    const keyword = fileQuery.trim();
    const selectedSet = new Set(selectedFilePaths);
    const available = fileOptions.filter((item) => !selectedSet.has(item));
    if (!keyword) return available.slice(0, 10);
    return available
      .filter((item) => item.toLowerCase().includes(keyword))
      .slice(0, 10);
  }, [fileOptions, fileQuery, selectedFilePaths]);
  const showFilePicker = Boolean(fileRange) && filteredFileOptions.length > 0 && !isSending && !isSubmitting;
  const inputPlaceholder = useMemo(() => {
    if (isSending) {
      return t("chat:generating", { defaultValue: "正在生成回复..." });
    }
    return t("chat:input_placeholder", {
      defaultValue: "输入你的问题，按 Enter 发送，Shift + Enter 换行",
    });
  }, [isSending, t]);
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
  useEffect(() => {
    setActiveFileIndex(0);
  }, [fileQuery, showFilePicker]);
  useEffect(() => {
    if (!showSkillPicker || filteredSkillOptions.length === 0) return;
    setActiveSkillIndex((prev) => Math.min(prev, filteredSkillOptions.length - 1));
  }, [filteredSkillOptions.length, showSkillPicker]);
  useEffect(() => {
    if (!showFilePicker || filteredFileOptions.length === 0) return;
    setActiveFileIndex((prev) => Math.min(prev, filteredFileOptions.length - 1));
  }, [filteredFileOptions.length, showFilePicker]);
  useEffect(() => {
    if (!showSkillPicker) return;
    const container = skillPickerRef.current;
    if (!container) return;
    const activeNode = container.querySelector<HTMLElement>(`[data-skill-option-index="${activeSkillIndex}"]`);
    activeNode?.scrollIntoView({ block: "nearest" });
  }, [activeSkillIndex, showSkillPicker]);
  useEffect(() => {
    if (!showFilePicker) return;
    const container = filePickerRef.current;
    if (!container) return;
    const activeNode = container.querySelector<HTMLElement>(`[data-file-option-index="${activeFileIndex}"]`);
    activeNode?.scrollIntoView({ block: "nearest" });
  }, [activeFileIndex, showFilePicker]);

  const applySelectedSkill = useCallback(
    (skillName: string) => {
      const next = selectedSkillList.includes(skillName)
        ? selectedSkillList
        : [...selectedSkillList, skillName];
      commitSelectedSkills(next);
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
    [commitSelectedSkills, mentionRange, resetTextareaHeight, selectedSkillList, text]
  );
  const applySelectedFile = useCallback(
    (filePath: string) => {
      if (!fileRange) return;
      const nextText = `${text.slice(0, fileRange.start)}${text.slice(fileRange.end)}`.replace(/\s{2,}/g, " ");
      const nextCursor = fileRange.start;
      setText(nextText);
      setSelectedFilePaths((prev) => (prev.includes(filePath) ? prev : [...prev, filePath]));
      setFileRange(null);
      setFileQuery("");
      window.requestAnimationFrame(() => {
        const textarea = textAreaRef.current;
        if (!textarea) return;
        textarea.focus();
        textarea.setSelectionRange(nextCursor, nextCursor);
        resetTextareaHeight();
        const nextHeight = Math.min(textarea.scrollHeight, 128);
        textarea.style.height = `${nextHeight}px`;
        textarea.style.overflowY = textarea.scrollHeight > 128 ? "auto" : "hidden";
      });
    },
    [fileRange, resetTextareaHeight, text]
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
    async (picked: FileList | File[] | null) => {
      if (!picked || picked.length === 0) return;
      const pickedFiles = Array.isArray(picked) ? picked : Array.from(picked);
      const next = pickedFiles.map((file) => ({
        id: createId(),
        file,
        uploadState: "uploading" as const,
      }));
      setFiles((prev) => [...prev, ...next]);
      await Promise.allSettled(next.map((fileItem) => uploadSingleFile(fileItem)));
    },
    [uploadSingleFile]
  );
  const getPastedFiles = useCallback((data: DataTransfer | null) => {
    if (!data) return [] as File[];

    const itemFiles = Array.from(data.items || [])
      .map((item) => (item.kind === "file" ? item.getAsFile() : null))
      .filter((item): item is File => item instanceof File);

    if (itemFiles.length > 0) return itemFiles;

    return Array.from(data.files || []);
  }, []);

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
      selectedSkill: selectedSkillList[0] || undefined,
      selectedSkills: selectedSkillList.length > 0 ? selectedSkillList : undefined,
      selectedFilePaths: selectedFilePaths.length > 0 ? selectedFilePaths : undefined,
      thinkingEnabled: showThinkingToggle ? thinkingEnabled : undefined,
    };

    setIsSubmitting(true);
    setText("");
    setFiles([]);
    setSelectedFilePaths([]);
    resetTextareaHeight();
    window.requestAnimationFrame(() => {
      resetTextareaHeight();
    });
    if (fileInputRef.current) fileInputRef.current.value = "";

    Promise.resolve(onSend(payload)).finally(() => {
      setIsSubmitting(false);
    });
  }, [canSend, files, onSend, resetTextareaHeight, selectedFilePaths, text, selectedSkillList, thinkingEnabled, showThinkingToggle]);

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
        overflow="visible"
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
            {selectedSkillList.length > 0 || selectedFilePaths.length > 0 ? (
              <Flex px={2} pt={2}>
                <Flex align="center" gap={1.5} wrap="wrap">
                  {selectedSkillList.map((skill) => (
                    <Flex
                      key={skill}
                      align="center"
                      bg={skillTheme.bg || "adora.50"}
                      border="1px solid"
                      borderColor={skillTheme.borderColor || "adora.300"}
                      borderRadius="10px"
                      color={skillTheme.color || "adora.800"}
                      gap={1}
                      h="28px"
                      maxW="280px"
                      pl={2.5}
                      pr={1}
                    >
                      <Box as={AgentSkillsIcon} color={skillTheme.labelColor || "adora.700"} h="13px" w="13px" />
                      <Text fontSize="13px" fontWeight={600} noOfLines={1}>
                        {skill}
                      </Text>
                      <CloseButton
                        color={skillTheme.labelColor || "adora.700"}
                        onClick={() => {
                          const next = selectedSkillList.filter((item) => item !== skill);
                          commitSelectedSkills(next);
                        }}
                        aria-label={`移除技能 ${skill}`}
                        size="sm"
                        transform="scale(0.88)"
                      />
                    </Flex>
                  ))}
                  {selectedFilePaths.map((filePath) => {
                    const fileLabel = toFileTagLabel(filePath);
                    const fileIcon = getFileIcon(fileLabel);
                    return (
                      <Flex
                        key={filePath}
                        align="center"
                        bg="white"
                        border="1px solid"
                        borderColor="#E2E8F0"
                        borderRadius="10px"
                        boxShadow="0px 2.571px 6.429px 0px rgba(19, 51, 107, 0.08), 0px 0px 0.643px 0px rgba(19, 51, 107, 0.08)"
                        color="gray.700"
                        gap={2}
                        h="28px"
                        maxW="320px"
                        pl={2}
                        pr={1}
                      >
                        <Box as="img" h="16px" src={`/icons/chat/${fileIcon}.svg`} w="16px" />
                        <Text fontSize="12px" fontWeight={600} noOfLines={1}>
                          {fileLabel}
                        </Text>
                        <CloseButton
                          color="gray.500"
                          onClick={() => {
                            setSelectedFilePaths((prev) => prev.filter((item) => item !== filePath));
                          }}
                          aria-label={`移除文件 ${fileLabel}`}
                          size="sm"
                          transform="scale(0.88)"
                        />
                      </Flex>
                    );
                  })}
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
              color="myGray.700"
              fontSize="15px"
              fontWeight={400}
              lineHeight="1.45"
              maxH="128px"
              mb={0}
              minH="50px"
              isDisabled={isInputLocked}
              onBlur={() => {
                setIsFocused(false);
                window.setTimeout(() => {
                  setMentionRange(null);
                  setSkillQuery("");
                  setFileRange(null);
                  setFileQuery("");
                }, 80);
              }}
              onChange={(event) => {
                const nextValue = event.target.value;
                setText(nextValue);
                updateTriggerState(nextValue, event.target.selectionStart ?? nextValue.length);
                const textarea = event.target;
                resetTextareaHeight();
                const nextHeight = Math.min(textarea.scrollHeight, 128);
                textarea.style.height = `${nextHeight}px`;
                textarea.style.overflowY = textarea.scrollHeight > 128 ? "auto" : "hidden";
              }}
              onFocus={() => setIsFocused(true)}
              onPaste={(event) => {
                if (isInputLocked) return;
                const pastedFiles = getPastedFiles(event.clipboardData);
                if (pastedFiles.length === 0) return;

                void onPickFiles(pastedFiles);
                event.preventDefault();
                event.stopPropagation();
              }}
              onKeyDown={(event) => {
                if (showFilePicker) {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    setActiveFileIndex((prev) => (prev + 1) % filteredFileOptions.length);
                    return;
                  }
                  if (event.key === "ArrowUp") {
                    event.preventDefault();
                    setActiveFileIndex((prev) => (prev <= 0 ? filteredFileOptions.length - 1 : prev - 1));
                    return;
                  }
                  if ((event.key === "Enter" && !event.shiftKey) || event.key === "Tab") {
                    event.preventDefault();
                    const picked = filteredFileOptions[activeFileIndex];
                    if (picked) {
                      applySelectedFile(picked);
                    }
                    return;
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    setFileRange(null);
                    setFileQuery("");
                    return;
                  }
                }
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
                    event.preventDefault();
                    const picked = filteredSkillOptions[activeSkillIndex];
                    if (picked?.name) {
                      applySelectedSkill(picked.name);
                    } else {
                      setMentionRange(null);
                      setSkillQuery("");
                    }
                    return;
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
                  const nativeEvent = event.nativeEvent as { isComposing?: boolean; keyCode?: number };
                  if (nativeEvent.isComposing || nativeEvent.keyCode === 229) return;
                  event.preventDefault();
                  handleSend();
                }
              }}
              overflowX="hidden"
              overflowY="hidden"
              placeholder={inputPlaceholder}
              px={2}
              resize="none"
              rows={1}
              value={text}
              w="100%"
              whiteSpace="pre-wrap"
            />
            {showFilePicker ? (
              <SlashFilePicker
                activeIndex={activeFileIndex}
                onPick={applySelectedFile}
                options={filteredFileOptions}
                pickerRef={filePickerRef}
              />
            ) : null}
            {showSkillPicker ? (
              <SkillMentionPicker
                activeIndex={activeSkillIndex}
                onPick={applySelectedSkill}
                options={filteredSkillOptions}
                pickerRef={skillPickerRef}
              />
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
            {showThinkingToggle ? (
              <MyTooltip
                fontSize="12px"
                label={
                  thinkingEnabled
                    ? thinkingTooltipEnabled || "思考模式：开启"
                    : thinkingTooltipDisabled || "思考模式：关闭"
                }
                openDelay={150}
              >
                <IconButton
                  _hover={{
                    bg: "rgba(0, 0, 0, 0.04)",
                  }}
                  aria-label={thinkingEnabled ? "关闭思考模式" : "开启思考模式"}
                  bg="transparent"
                  border="1px solid transparent"
                  borderRadius="8px"
                  h="30px"
                  icon={
                    <Flex
                      align="center"
                      bg={thinkingEnabled ? "#16A34A" : "transparent"}
                      border="1px solid"
                      borderColor={thinkingEnabled ? "#16A34A" : "#CBD5E1"}
                      borderRadius="999px"
                      h="20px"
                      justify="center"
                      w="20px"
                    >
                      <Box
                        as="svg"
                        fill="none"
                        h="13px"
                        viewBox="0 0 24 24"
                        w="13px"
                      >
                        <path
                          d="M12 3.5a6.5 6.5 0 0 0-3.5 12v2.25a.75.75 0 0 0 .75.75h5.5a.75.75 0 0 0 .75-.75V15.5A6.5 6.5 0 0 0 12 3.5Z"
                          stroke={thinkingEnabled ? "#FFFFFF" : "#64748B"}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2"
                        />
                        <path
                          d="M9.5 21h5"
                          stroke={thinkingEnabled ? "#FFFFFF" : "#64748B"}
                          strokeLinecap="round"
                          strokeWidth="2"
                        />
                      </Box>
                    </Flex>
                  }
                  isDisabled={Boolean(modelLoading || isSending || isSubmitting)}
                  minW="30px"
                  onClick={() => onChangeThinkingEnabled?.(!thinkingEnabled)}
                  variant="ghost"
                />
              </MyTooltip>
            ) : null}
            {hasUploadingFiles ? (
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

import ImageCreationTemplates from "./ImageCreationTemplates";
import { getCloudHostStatusMeta } from "@shared/sandbox/cloudHostStatus";
import { ChatModeOptions, modeOptions } from "./ChatModeOptions";
import {
  Box,
  Button,
  CloseButton,
  Portal,
  Flex,
  HStack,
  IconButton,
  Input,
  Menu,
  MenuButton,
  MenuDivider,
  MenuItem,
  MenuList,
  MenuItemOption,
  MenuOptionGroup,
  Text,
  Textarea,
  useTheme,
  useToast,
} from "@chakra-ui/react";
import {
  ArrowUp,
  ChevronRight,
  Cloud,
  CircleAlert,
  RotateCcw,
  Laptop,
  Layers,
  Plus,
  Square,
  Settings2,
} from "lucide-react";
import { libraryOrigin } from "../services/libraryFileOrigin";
import LibraryItemIcon from "@/components/agent-workspace/LibraryItemIcon";
import { getFileIcon } from "@fastgpt/global/common/file/icon";
import { AgentSkillsIcon } from "@components/common/Icon";
import { createId } from "@shared/chat/messages";
import { useTranslation } from "next-i18next";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MyTooltip from "@/components/ui/MyTooltip";

import {
  getReasoningEffortLabel,
  type ChatInputFile,
  type ChatInputProps,
  type ChatInputSubmitPayload,
  type ReasoningEffortLevel,
} from "../types/chatInput";
import type { UploadedFileArtifact } from "../types/fileArtifact";
import { normalizeAttachmentWorkspacePath, toFileTagLabel } from "../utils/chatPanelUtils";
import ModelCascader from "./ModelCascader";
import LibraryAttachmentPicker from "./LibraryAttachmentPicker";
import SlashFilePicker from "./SlashFilePicker";
import SkillMentionPicker from "./SkillMentionPicker";

type LocalInputFile = ChatInputFile & {
  uploadState: "uploading" | "ready" | "error";
  uploadedArtifact?: UploadedFileArtifact;
  uploadError?: string;
};

const ChatInput = ({
  placeholder,
  artifactRevision,
  draftStorageKey,
  workspaceLayout = false,
  workspaceComposer,
  isSending,
  model,
  modelOptions,
  modelGroups,
  modelLoading,
  thinkingEnabled = true,
  reasoningEffort = "high",
  showThinkingToggle = true,
  mode = "default",
  thinkingTooltipEnabled,
  thinkingTooltipDisabled,
  selectedSkill,
  selectedSkills,
  skillOptions = [],
  fileOptions = [],
  addFileRequest,
  prefillText,
  prefillVersion,
  onChangeModel,
  onChangeMode,
  onChangeThinkingEnabled,
  onChangeReasoningEffort,
  onChangeSelectedSkill,
  onChangeSelectedSkills,
  onUploadFiles,
  onSend,
  onStop,
}: ChatInputProps) => {
  const toast = useToast();
  const ModeIcon = modeOptions[mode].Icon;
  const { t } = useTranslation();
  const theme = useTheme() as Record<string, any>;
  const chatInputTheme = theme?.workspace?.chatInput || {};
  const skillTheme = chatInputTheme?.skillMention || {};
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [imageModeKey,setImageModeKey] = useState<string>();
  const imageMode = Boolean(draftStorageKey && imageModeKey === draftStorageKey);
  const [text, setText] = useState("");
  const [loadedDraftKey, setLoadedDraftKey] = useState<string>();
  useEffect(() => {
    if (!draftStorageKey) return;
    try {
      setImageModeKey(sessionStorage.getItem(draftStorageKey+":image-mode") ? draftStorageKey : undefined);
      setText(sessionStorage.getItem(draftStorageKey) ?? "");
    } catch {
      // Storage can be unavailable in restricted browser sessions.
    }
    setLoadedDraftKey(draftStorageKey);
  }, [draftStorageKey]);
  useEffect(() => {
    if (!artifactRevision) return;
    setText((draft) => draft ? `${draft}\n\n${artifactRevision.text}` : artifactRevision.text);
    const frame = requestAnimationFrame(() => {
      const textarea = textAreaRef.current;
      if (textarea) {
        textarea.focus();
        const end = textarea.value.length;
        textarea.setSelectionRange(end, end);
        textarea.style.height = `${inputBaseHeight}px`;
        textarea.style.height = `${Math.max(inputBaseHeight, Math.min(textarea.scrollHeight, 128))}px`;
        textarea.style.overflowY = textarea.scrollHeight > 128 ? "auto" : "hidden";
      }
      artifactRevision.onApplied();
    });
    return () => cancelAnimationFrame(frame);
  }, [artifactRevision]);
  useEffect(() => {
    if (!draftStorageKey || loadedDraftKey !== draftStorageKey) return;
    try {
      if (text) sessionStorage.setItem(draftStorageKey, text);
      else sessionStorage.removeItem(draftStorageKey);
    } catch {
      // Draft editing still works without browser storage.
    }
  }, [draftStorageKey, loadedDraftKey, text]);
  const [files, setFiles] = useState<LocalInputFile[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [activeSkillIndex, setActiveSkillIndex] = useState(0);
  const [activeFileIndex, setActiveFileIndex] = useState(0);
  const [skillQuery, setSkillQuery] = useState("");
  const [fileQuery, setFileQuery] = useState("");
  const [selectedFilePaths, setSelectedFilePaths] = useState<string[]>([]);
  useEffect(() => {
    const requestedPath = addFileRequest?.path?.trim();
    if (!requestedPath) return;
    const normalizedPath = requestedPath.startsWith("/") ? requestedPath : `/${requestedPath}`;
    setSelectedFilePaths((current) =>
      current.includes(normalizedPath) ? current : [...current, normalizedPath]
    );
    textAreaRef.current?.focus();
  }, [addFileRequest]);
  const [mentionRange, setMentionRange] = useState<{ start: number; end: number } | null>(null);
  const [fileRange, setFileRange] = useState<{ start: number; end: number } | null>(null);
  const inputBaseHeight = 50;
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
    textarea.style.height = `${inputBaseHeight}px`;
    textarea.style.overflowY = "hidden";
  }, [inputBaseHeight]);
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
    const all = skillOptions.filter((item) => Boolean(item.name));
    const ranked = all.sort((a, b) => {
      const aSelected = selectedSet.has(a.name) ? 1 : 0;
      const bSelected = selectedSet.has(b.name) ? 1 : 0;
      // Unselected first, selected later (still visible).
      if (aSelected !== bSelected) return aSelected - bSelected;
      return a.name.localeCompare(b.name);
    });
    if (!keyword) return ranked.slice(0, 8);
    return ranked
      .filter((item) => {
        const name = item.name.toLowerCase();
        const description = (item.description || "").toLowerCase();
        return name.includes(keyword) || description.includes(keyword);
      })
      .slice(0, 8);
  }, [selectedSkillList, skillOptions, skillQuery]);
  const showSkillPicker =
    Boolean(mentionRange) &&
    !isSending &&
    !isSubmitting;
  const filteredFileOptions = useMemo(() => {
    const keyword = fileQuery.trim();
    const selectedSet = new Set(selectedFilePaths);
    const available = fileOptions
      .map((item) => normalizeAttachmentWorkspacePath(item))
      .filter(Boolean)
      .filter((item, index, arr) => arr.indexOf(item) === index)
      .filter((item) => !selectedSet.has(item));
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
    return placeholder ?? t("chat:input_placeholder", {
      defaultValue: "输入你的问题，按 Enter 发送，Shift + Enter 换行",
    });
  }, [isSending, placeholder, t]);
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
      const nextHeight = Math.max(inputBaseHeight, Math.min(textarea.scrollHeight, 128));
      textarea.style.height = `${nextHeight}px`;
      textarea.style.overflowY = textarea.scrollHeight > 128 ? "auto" : "hidden";
    }, 0);
  }, [inputBaseHeight, prefillText, prefillVersion, resetTextareaHeight]);

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
      const beforeMention = text.slice(0, mentionRange.start);
      const afterMention = text.slice(mentionRange.end);
      const shouldInsertSpacer =
        beforeMention.length > 0 &&
        !/\s$/.test(beforeMention) &&
        afterMention.length > 0 &&
        !/^\s/.test(afterMention);
      const nextText = `${beforeMention}${shouldInsertSpacer ? " " : ""}${afterMention}`.replace(
        /\s{2,}/g,
        " "
      );
      setText(nextText);
      setMentionRange(null);
      setSkillQuery("");
      window.requestAnimationFrame(() => {
        const textarea = textAreaRef.current;
        if (!textarea) return;
        const cursor = Math.max(0, beforeMention.length + (shouldInsertSpacer ? 1 : 0));
        textarea.focus();
        textarea.setSelectionRange(cursor, cursor);
        resetTextareaHeight();
        const nextHeight = Math.max(inputBaseHeight, Math.min(textarea.scrollHeight, 128));
        textarea.style.height = `${nextHeight}px`;
        textarea.style.overflowY = textarea.scrollHeight > 128 ? "auto" : "hidden";
      });
    },
    [commitSelectedSkills, inputBaseHeight, mentionRange, resetTextareaHeight, selectedSkillList, text]
  );
  const applySelectedFile = useCallback(
    (filePath: string) => {
      if (!fileRange) return;
      const normalizedPath = normalizeAttachmentWorkspacePath(filePath);
      const nextText = `${text.slice(0, fileRange.start)}${text.slice(fileRange.end)}`.replace(/\s{2,}/g, " ");
      const nextCursor = fileRange.start;
      setText(nextText);
      setSelectedFilePaths((prev) => (prev.includes(normalizedPath) ? prev : [...prev, normalizedPath]));
      setFileRange(null);
      setFileQuery("");
      window.requestAnimationFrame(() => {
        const textarea = textAreaRef.current;
        if (!textarea) return;
        textarea.focus();
        textarea.setSelectionRange(nextCursor, nextCursor);
        resetTextareaHeight();
        const nextHeight = Math.max(inputBaseHeight, Math.min(textarea.scrollHeight, 128));
        textarea.style.height = `${nextHeight}px`;
        textarea.style.overflowY = textarea.scrollHeight > 128 ? "auto" : "hidden";
      });
    },
    [fileRange, inputBaseHeight, resetTextareaHeight, text]
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
        return matched ? undefined : "上传失败，请重试";
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
        return message;
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
    async (picked: FileList | File[] | null, fromLibrary = false) => {
      if (!picked || picked.length === 0) return [];
      const pickedFiles = Array.isArray(picked) ? picked : Array.from(picked);
      const next = pickedFiles.map((file) => ({
        id: createId(),
        file,
        uploadState: "uploading" as const,
      }));
      setFiles((prev) => [...prev, ...next]);
      const errors = await Promise.all(next.map(uploadSingleFile));
      if (fromLibrary && errors.some(Boolean)) {
        const failedIds = new Set(next.filter((_, index) => errors[index]).map(item => item.id));
        setFiles(previous => previous.filter(item => !failedIds.has(item.id)));
      }
      return errors;
    },
    [uploadSingleFile]
  );
  const consumedLibraryDrafts = useRef(new WeakSet<object>());
  useEffect(() => {
    const draft = workspaceComposer?.libraryDraft;
    if (!draft || consumedLibraryDrafts.current.has(draft) ||
      loadedDraftKey !== draftStorageKey || draftStorageKey !== `aistudio:draft:${workspaceComposer?.projectToken}:${draft.chatId}`) return;
    consumedLibraryDrafts.current.add(draft);
    if (draft.imageMode) {
      setImageModeKey(draftStorageKey);
      try { sessionStorage.setItem(draftStorageKey+":image-mode","1"); } catch {}
      requestAnimationFrame(() => textAreaRef.current?.focus());
    }
    const incomingText = draft.text;
    if (incomingText) {
      setText(previous => previous ? previous.trimEnd() + "\n\n" + incomingText : incomingText);
      requestAnimationFrame(() => textAreaRef.current?.focus());
    }
    if (draft.files.length) void onPickFiles(draft.files);
    workspaceComposer?.onLibraryDraftConsumed?.();
  },[workspaceComposer,draftStorageKey,loadedDraftKey,onPickFiles]);
  const getPastedFiles = useCallback((data: DataTransfer | null) => {
    if (!data) return [] as File[];

    const itemFiles = Array.from(data.items || [])
      .map((item) => (item.kind === "file" ? item.getAsFile() : null))
      .filter((item): item is File => item instanceof File);

    if (itemFiles.length > 0) return itemFiles;

    return Array.from(data.files || []);
  }, []);

  const handleSend = useCallback(async () => {
    if (!canSend) return;
    const selectedFiles: ChatInputFile[] = files.map((item) => ({
      id: item.id,
      file: item.file,
    }));
    const uploadedFiles = files
      .map((item) => item.uploadedArtifact)
      .filter((item): item is UploadedFileArtifact => Boolean(item));

    const payload: ChatInputSubmitPayload = {
      text: imageMode ? "创建图像：" + text.trim() : text.trim(),
      files: selectedFiles,
      uploadedFiles,
      selectedSkill: selectedSkillList[0] || undefined,
      selectedSkills: selectedSkillList.length > 0 ? selectedSkillList : undefined,
      selectedFilePaths: selectedFilePaths.length > 0 ? selectedFilePaths : undefined,
      thinkingEnabled: showThinkingToggle ? thinkingEnabled : undefined,
      reasoningEffort: workspaceLayout || showThinkingToggle ? reasoningEffort : undefined,
    };

    setIsSubmitting(true);
    try {
      await onSend(payload, { onAccepted: () => {
        setImageModeKey(undefined);
        try { sessionStorage.removeItem(draftStorageKey+":image-mode"); } catch {}
        setText("");
        setFiles([]);
        setSelectedFilePaths([]);
        resetTextareaHeight();
        if (fileInputRef.current) fileInputRef.current.value = "";
      } });
    } catch {
      toast({ status: "error", title: "发送失败", description: "请检查连接后重试。", isClosable: true });
    } finally {
      setIsSubmitting(false);
    }
  }, [canSend, imageMode, draftStorageKey, files, onSend, toast, reasoningEffort, resetTextareaHeight, selectedFilePaths, text, selectedSkillList, thinkingEnabled, showThinkingToggle, workspaceLayout]);

  return (
    <Box px={4} py={3}>
      <Flex
        bg="white"
        border={workspaceLayout ? "1px solid" : "0.5px solid"}
        borderColor={
          workspaceLayout
            ? isFocused
              ? "rgba(0,0,0,0.18)"
              : "rgba(0,0,0,0.09)"
            : isFocused
            ? "rgba(0,0,0,0.24)"
            : "rgba(0,0,0,0.18)"
        }
        borderRadius={workspaceLayout ? "22px" : "26px"}
        boxShadow={
          workspaceLayout
            ? isFocused
              ? "0px 4px 18px rgba(0, 0, 0, 0.06)"
              : "0px 2px 10px rgba(0, 0, 0, 0.035)"
            : isFocused
            ? "0px 5px 20px -4px rgba(19, 51, 107, 0.13)"
            : "0px 5px 16px -4px rgba(19, 51, 107, 0.08)"
        }
        direction="column"
        minH={workspaceLayout ? "96px" : "116px"}
        overflow="visible"
      >
        {previewFiles.length > 0 ? (
          <Flex gap="6px" mb={2} pt={2} px={3} userSelect="none" wrap="wrap">
            {previewFiles.map((item) => item.uploadState === "error" ? (
              <Flex key={item.id} align="center" gap={2} bg="#fffaf6" border="1px solid #eadbd0" borderRadius="12px"
                px={2.5} py={2} maxW="100%" minW={0}>
                <CircleAlert size={16} color="#975735" aria-hidden="true"/>
                <Box minW={0} maxW="200px"><Text noOfLines={1} fontSize="xs" fontWeight="600">{item.file.name}</Text>
                  <Text color="#785d4c" fontSize="11px" role="status">{item.uploadError || "上传未完成"}</Text></Box>
                <Button size="xs" variant="ghost" color="#754a32" leftIcon={<RotateCcw size={12}/>} onClick={() => retryUploadFile(item)}>重试</Button>
                <CloseButton size="sm" aria-label={`移除 ${item.file.name}`} onClick={() => setFiles(prev => prev.filter(file => file.id !== item.id))}/>
              </Flex>
            ) : (
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
                      {libraryOrigin(item.file) ? <LibraryItemIcon item={{name:item.file.name}}/> : <Box as="img" h="24px" src={`/icons/chat/${item.icon}.svg`} w="24px" />}
                      <Box minW={0}>
                        <Text className="textEllipsis" fontSize="xs" noOfLines={1}>
                          {item.file.name}
                        </Text>
                        <Text
                          color="gray.500"
                          fontSize="10px"
                          noOfLines={1}
                        >
                          {item.uploadState === "uploading"
                            ? "上传中..."
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
            {imageMode && <Flex align="center" gap={1} w="fit-content" mx={2} mt={2} pl={2} bg="gray.100" borderRadius="full">
              <Text fontSize="sm">创建图像</Text><CloseButton size="sm" aria-label="退出创建图像" onClick={()=>{
                setImageModeKey(undefined);
                try { sessionStorage.removeItem(draftStorageKey+":image-mode"); } catch {}
                textAreaRef.current?.focus();
              }}/></Flex>}
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
            <Flex align="center" gap={2} px={3} pt={3}>
              <Textarea
                ref={textAreaRef}
                _focusVisible={{ border: "none", boxShadow: "none" }}
                _placeholder={{
                  color: "#707070",
                  fontSize: "15px",
                }}
                border="none"
                color="myGray.700"
                flex="1"
                fontSize="15px"
                fontWeight={400}
                lineHeight="1.45"
                maxH="128px"
                mb={0}
                minH={`${inputBaseHeight}px`}
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
                  const nextHeight = Math.max(inputBaseHeight, Math.min(textarea.scrollHeight, 128));
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
                aria-label={placeholder ?? t("chat:ready_start", { defaultValue: "输入消息" })}
                placeholder={inputPlaceholder}
                px={2}
                resize="none"
                rows={1}
                value={text}
                w="100%"
                whiteSpace="pre-wrap"
              />
            </Flex>
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

        <Flex align="center" h="44px" justify="space-between" mt="auto" pb={2} pl={3} pr={3}>
          <Flex align="center" gap={workspaceLayout ? 1 : 2} minW={0} flex={workspaceLayout ? 1 : undefined}>
            <Input
              ref={fileInputRef}
              display="none"
              onChange={(event) => onPickFiles(event.target.files)}
              type="file"
              multiple
            />
            <Menu placement="top-start" isLazy>
              <MenuButton as={IconButton} aria-label="添加文件" icon={<Plus size={18} strokeWidth={1.8}/>}
                isDisabled={isSending || isSubmitting} size="sm" variant="ghost" borderRadius="full"/>
              <Portal><MenuList>
                <MenuItem onClick={() => fileInputRef.current?.click()}>从本机上传</MenuItem>
                <MenuItem onClick={() => setLibraryOpen(true)}>从资料空间添加</MenuItem>
              </MenuList></Portal>
            </Menu>
            {libraryOpen && <LibraryAttachmentPicker onClose={() => setLibraryOpen(false)} onAdd={picked => onPickFiles(picked, true)}/>}
            {workspaceLayout ? (
              <>
                <Box w="1px" h="16px" bg="rgba(0,0,0,0.1)" mx={1} flexShrink={0} />
                {workspaceComposer?.onOpenDeviceManagement && (
                  <Menu onOpen={workspaceComposer.onOpenHostMenu} placement="top-start" gutter={8} isLazy>
                    <MenuButton as={Button} size="xs" h="30px" px={2.5} maxW="150px" variant="ghost"
                      borderRadius="full" fontSize="12.5px" fontWeight="500" color="#374151"
                      _hover={{ bg: "#f4f4f5" }}
                      aria-label={workspaceComposer.deviceAccessKind ? `访问设备：${workspaceComposer.deviceAccessLabel}` : "访问设备"}
                      isLoading={workspaceComposer.requestingDeviceAccess} loadingText="等待授权"
                      leftIcon={workspaceComposer.deviceAccessKind === "remote-vm" ? <Cloud size={14} /> : <Laptop size={14} />}
                      rightIcon={<ChevronRight size={13} color="#9ca3af" />}>
                      <Text as="span" isTruncated>{workspaceComposer.deviceAccessLabel || "访问设备"}</Text>
                    </MenuButton>
                    <Portal>
                      <MenuList w="min(320px, calc(100vw - 24px))" minW={0} maxH="65dvh" overflowY="auto"
                        p={2} borderRadius="14px" border="1px solid #dfe5ef" boxShadow="0 10px 36px rgba(33,48,78,.13)">
                        <MenuOptionGroup type="radio" title="允许 AI 访问"
                          value={workspaceComposer.selectedDeviceId || workspaceComposer.deviceAccessKind || "none"}
                          onChange={value => {
                            if (value === "none") workspaceComposer.onClearDeviceAccess?.();
                            else if (value === "remote-vm") workspaceComposer.onSelectCloudHost?.();
                            else {
                              const device = workspaceComposer.devices?.find(item => item.deviceId === value);
                              if (device) workspaceComposer.onSelectDeviceHost?.(device);
                            }
                          }}>
                          <MenuItemOption value="none">仅使用项目工作空间</MenuItemOption>
                          <MenuItemOption value="remote-vm">
                            <HStack><Cloud size={16} /><Text>云电脑</Text>
                              <Text fontSize="xs" color="ink.muted">{getCloudHostStatusMeta(workspaceComposer.cloudHostStatus).label}</Text>
                            </HStack>
                          </MenuItemOption>
                          {workspaceComposer.devices?.map(device => (
                            <MenuItemOption key={device.deviceId} value={device.deviceId} isDisabled={!device.online}>
                              <HStack minW={0}><Laptop size={16} /><Text noOfLines={1}>{device.name}</Text>
                                <Text fontSize="xs" color="ink.muted" flexShrink={0}>{device.online ? "在线" : "离线"}</Text>
                              </HStack>
                            </MenuItemOption>
                          ))}
                        </MenuOptionGroup>
                        <MenuDivider my={2} />
                        <MenuItem px={3} borderRadius="8px" fontSize="sm" icon={<Settings2 size={15} />}
                          onClick={workspaceComposer.onOpenDeviceManagement}>我的设备</MenuItem>
                      </MenuList>
                    </Portal>
                  </Menu>
                )}

                <Menu placement="top-start" isLazy>
                  <MenuButton
                    as={Button}
                    size="xs"
                    h="30px"
                    px={2.5}
                    borderRadius="full"
                    variant="ghost"
                    fontSize="12.5px"
                    fontWeight="500"
                    color="#374151"
                    _hover={{ bg: "#f4f4f5" }}
                    leftIcon={<Layers size={14} />}
                    rightIcon={<ChevronRight size={13} color="#9ca3af" />}
                    flexShrink={0}
                  >
                    技能
                  </MenuButton>
                  <MenuList minW="210px" maxH="260px" overflowY="auto">
                    {skillOptions.length === 0 ? (
                      <MenuItem fontSize="13px" isDisabled>
                        暂无可用技能
                      </MenuItem>
                    ) : (
                      skillOptions.map((skill) => {
                        const checked = selectedSkillList.includes(skill.name);
                        return (
                          <MenuItem
                            key={skill.name}
                            fontSize="13px"
                            fontWeight={checked ? "600" : "400"}
                            onClick={() => {
                              const next = checked
                                ? selectedSkillList.filter((s) => s !== skill.name)
                                : [...selectedSkillList, skill.name];
                              commitSelectedSkills(next);
                            }}
                          >
                            <HStack justify="space-between" w="full">
                              <Text noOfLines={1}>{skill.name}</Text>
                              {checked ? <Text color="blue.600" fontSize="xs">已选</Text> : null}
                            </HStack>
                          </MenuItem>
                        );
                      })
                    )}
                  </MenuList>
                </Menu>

                <Menu placement="top-start" isLazy>
                  <MenuButton
                    as={Button}
                    size="xs"
                    h="30px"
                    px={2.5}
                    borderRadius="full"
                    variant="ghost"
                    fontSize="12.5px"
                    fontWeight="500"
                    color="#374151"
                    bg={mode === "default" ? "transparent" : "#f3f3f3"}
                    _hover={{ bg: "#ededed" }}
                    leftIcon={<ModeIcon size={15} />}
                    rightIcon={<ChevronRight size={13} color="#9ca3af" />}
                    flexShrink={0}
                  >
                    {modeOptions[mode].label}
                  </MenuButton>
                  <MenuList minW="160px">
                    <ChatModeOptions mode={mode} onChangeMode={onChangeMode} />
                    {showThinkingToggle && (
                      <>
                        <MenuDivider />
                        <MenuItem
                          fontSize="13px"
                          onClick={() => onChangeThinkingEnabled?.(!thinkingEnabled)}
                        >
                          深度思考：{thinkingEnabled ? "开启" : "关闭"}
                        </MenuItem>
                      </>
                    )}
                  </MenuList>
                </Menu>
                <Box flex={1} />
              </>
            ) : (
              <>
                <ModelCascader
                  showLabel={false}
                  disabled={Boolean(modelLoading || isSending || isSubmitting)}
                  loading={modelLoading}
                  model={model}
                  modelOptions={modelOptions}
                  modelGroups={modelGroups}
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
                <Menu>
                  <MenuButton as={Button} size="sm" variant="ghost" isDisabled={Boolean(isSending || isSubmitting)} aria-label="选择工作模式" leftIcon={<ModeIcon size={15} />}>
                    {mode === "goal" ? "目标" : mode === "plan" ? "计划" : "执行"}
                  </MenuButton>
                  <MenuList>
                    <ChatModeOptions mode={mode} onChangeMode={onChangeMode} />
                  </MenuList>
                </Menu>
              </>
            )}
            {hasUploadingFiles ? (
              <Text color="myGray.500" fontSize="xs">
                {t("chat:uploading_files", { defaultValue: "文件上传中..." })}
              </Text>
            ) : null}
          </Flex>

          <Flex align="center" gap={1.5}>
            {workspaceLayout && (
              <ModelCascader
                showLabel
                rightSuffix={getReasoningEffortLabel(reasoningEffort, true)}
                reasoningEffort={reasoningEffort}
                onChangeReasoningEffort={onChangeReasoningEffort}
                disabled={Boolean(modelLoading || isSending || isSubmitting)}
                loading={modelLoading}
                model={model}
                modelOptions={modelOptions}
                modelGroups={modelGroups}
                onChangeModel={onChangeModel}
              />
            )}
            <IconButton
              _hover={{
                bg: isSending
                  ? "rgba(15, 23, 42, 0.14)"
                  : canSend
                  ? "#111827"
                  : "#e4e4e7",
              }}
              aria-label={
                isSending
                  ? t("chat:stop_generating", { defaultValue: "停止生成" })
                  : t("common:Send", { defaultValue: "发送" })
              }
              bg={isSending ? "#f4f4f5" : canSend ? "#0f172a" : "#f4f4f5"}
              color={isSending ? "#0f172a" : canSend ? "#ffffff" : "#71717a"}
              borderRadius="full"
              h="34px"
              icon={
                isSending ? (
                  <Square size={13} fill="currentColor" />
                ) : (
                  <ArrowUp size={17} strokeWidth={2.2} />
                )
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
              w="34px"
              minW="34px"
            />
          </Flex>
        </Flex>
      </Flex>
      {imageMode && <ImageCreationTemplates onUpload={()=>fileInputRef.current?.click()} onPick={prompt=>{
        setText(previous=>previous.trim() ? previous.trimEnd()+"\n\n"+prompt : prompt);
        requestAnimationFrame(()=>textAreaRef.current?.focus());
      }}/>}
    </Box>
  );
};

export default ChatInput;

import AttachmentFilename from "./AttachmentFilename";
import { Box, Button, Collapse, Flex, Grid, Icon, IconButton, Link, Modal, ModalBody, ModalCloseButton, ModalContent, ModalHeader, ModalOverlay, Spinner, Text, useToast } from "@chakra-ui/react";
import LibraryItemIcon from "@/components/agent-workspace/LibraryItemIcon";
import React from "react";
import { CornerDownRight, Download } from "lucide-react";
import { useChatPanelViewContext } from "../context/ChatPanelViewContext";
import { extractSelectionQuotesFromMessage } from "../types/selectionChat";
import { redirectedToLogin } from "../services/files";
import { LibraryReadError, libraryReadMessage, loadLibraryFiles, readLibraryAttachment, recordLibraryOpen, sharedSpacePageLocation } from "../services/libraryAttachment";
import { withAuthHeaders } from "@features/auth/client/authClient";
import InteractiveHtmlPreview from "@/components/workspace/InteractiveHtmlPreview";
import LibraryMarkdown from "@/components/agent-workspace/LibraryMarkdown";
import { toProjectFileViewUrl, resolveChatUploadUrl } from "../utils/chatPanelUtils";
import { downloadWorkspaceArtifact } from "../services/files";
import { artifactFileType } from "@/components/workspace/ArtifactFileIcon";
import Markdown from "@/components/Markdown";
import StreamdownMarkdown from "@/components/Markdown/StreamdownMarkdown";
import { ChevronDownIcon } from "@/components/common/Icon";
import { useCopyData } from "@/hooks/useCopyData";
import { useChatItemViewModel } from "../hooks/useChatItemViewModel";
import type { MessageExecutionSummary } from "../utils/executionSummary";
import AgentTimelineCard from "./message/timeline/AgentTimelineCard";
import ToolTimelineCard from "./message/timeline/ToolTimelineCard";
import {
  PLAN_MODE_TOOL_NAMES,
  isImageFile,
} from "../utils/chatItemParsers";

import type { ConversationMessage } from "@/types/conversation";

function ReplyArtifact({ path, version, onOpen }: {
  path: string;
  version?: string;
  onOpen: () => void;
}) {
  const { token } = useChatPanelViewContext();
  const toast = useToast();
  const [downloading, setDownloading] = React.useState(false);
  const name = path.split("/").pop() || path;
  const { label } = artifactFileType(name);

  return (
    <Flex
      align="center"
      maxW="100%"
      bg="#f9f9fa"
      border="1px solid rgba(0, 0, 0, 0.08)"
      borderRadius="14px"
      px={1.5}
      py={0.5}
      transition="background 0.15s, border-color 0.15s"
      _hover={{ bg: "#f4f4f5", borderColor: "rgba(0, 0, 0, 0.14)" }}
    >
      <Button size="sm" h="auto" py={2} px={2} variant="ghost" minW={0} justifyContent="flex-start"
        _hover={{ bg: "transparent" }}
        leftIcon={<LibraryItemIcon item={{name}}/>}
        title={path} aria-label={`打开 ${name} 的预览`} onClick={onOpen}>
        <Box minW={0} textAlign="left">
          <Text fontSize="13.5px" fontWeight="500" color="#18181b" isTruncated>{name}</Text>
          <Text fontSize="11px" fontWeight="normal" color="#71717a" mt={0.5}>{label}</Text>
        </Box>
      </Button>
      <IconButton
        size="sm"
        variant="ghost"
        borderRadius="full"
        color="#52525b"
        _hover={{ bg: "rgba(0, 0, 0, 0.06)", color: "#18181b" }}
        flexShrink={0}
        icon={<Download size={15} />}
        aria-label={`下载 ${name}`}
        isLoading={downloading}
        onClick={async () => {
          setDownloading(true);
          try {
            await downloadWorkspaceArtifact(token, path, version);
          } catch {
            toast({ title: "无法下载文件，请稍后重试", status: "error" });
          } finally {
            setDownloading(false);
          }
        }}
      />
    </Flex>
  );
}

const ChatItem = ({
  message,
  isStreaming,
  messageId,
  executionSummary,
  requestMessage,
  requestContent,
  isLatestRun,
  hideInteractiveCards: _hideInteractiveCards,
  onOpenWorkspaceFile,
}: {
  message: ConversationMessage;
  isStreaming?: boolean;
  messageId: string;
  executionSummary?: MessageExecutionSummary | null;
  requestMessage?: ConversationMessage;
  requestContent?: string;
  isLatestRun?: boolean;
  hideInteractiveCards?: boolean;
  onOpenWorkspaceFile?: (filePath: string, version?: string) => boolean;
}) => {
  const {token,activeConversationId} = useChatPanelViewContext();
  const [preview,setPreview] = React.useState<{name:string;url:string;alternateUrls?:string[];html:boolean;libraryItemId?:string}>();
  const [failedImages,setFailedImages] = React.useState<Set<string>>(() => new Set());
  const [previewText,setPreviewText] = React.useState<string>();
  const [showLibrarySource,setShowLibrarySource] = React.useState(false);
  const [previewError,setPreviewError] = React.useState("");
  function openPreview(next: NonNullable<typeof preview>) {
    setPreviewText(undefined);
    setPreviewError("");
    setShowLibrarySource(false);
    setPreview({...next});
  }
  React.useEffect(() => {
    if (!preview) return;
    if (!preview.url && !preview.libraryItemId) {
      setPreviewError("这条历史消息缺少附件地址，请从资料空间重新添加文件。");
      return;
    }
    const controller = new AbortController();
    void (async () => {
      const signal = controller.signal;
      function showContent(value: string, fromLibrary: boolean) {
        if (signal.aborted) return;
        setPreviewText(value);
        setShowLibrarySource(fromLibrary);
        if (preview?.libraryItemId) recordLibraryOpen(preview.libraryItemId);
      }
      let copyError: unknown;
      for (const address of new Set([preview.url,...(preview.alternateUrls ?? [])])) {
        if (!address) continue;
        try {
          const url = new URL(address,window.location.href);
          const externalAttachment = url.origin !== window.location.origin;
          if (!externalAttachment && url.pathname === "/api/code" && url.searchParams.get("action") === "view-url") {
            url.searchParams.set("action", "view");
          }
          const response = await fetch(url, {signal,headers:externalAttachment ? undefined : withAuthHeaders()});
          const needsLogin = redirectedToLogin(response);
          if (needsLogin || !response.ok) throw new LibraryReadError(needsLogin ? 401 : response.status, preview.name);
          showContent(await response.text(), false);
          return;
        } catch (error) {
          if (signal.aborted) throw error;
          copyError = error;
        }
      }
      // The conversation copy and the library original have independent access checks.
      if (preview.libraryItemId) {
        const location = sharedSpacePageLocation(preview.libraryItemId);
        if (location) {
          const original = await fetch(location.api,{headers:withAuthHeaders(),signal});
          if (redirectedToLogin(original)) throw new LibraryReadError(401,preview.name);
          if (!original.ok) throw new LibraryReadError(original.status,preview.name);
          showContent(await original.text(), true);
          return;
        }
        const items = await loadLibraryFiles(signal);
        const item = items.find(entry => entry.id === preview.libraryItemId && !entry.deleted);
        if (item) {
          const value = await (await readLibraryAttachment(item,signal)).text();
          showContent(value, true);
          return;
        }
      }
      throw copyError ?? new LibraryReadError(404, preview.name);
    })().catch(error => {
      if (controller.signal.aborted) return;
      setPreviewError(error instanceof Error && !(error instanceof LibraryReadError) && !(error instanceof TypeError)
        ? error.message
        : libraryReadMessage(error));
    });
    return () => controller.abort();
  },[preview]);
  const [activityOpen, setActivityOpen] = React.useState<boolean>();
  const activityExpanded = activityOpen ?? Boolean(isStreaming);
  const { copyData } = useCopyData();
  const {
    content,
    isUser,
    isSystem,
    isAssistant,
    files,
    sortedFiles,
    timelineItems,
    expandedTimelineReasoningKeys,
    expandedTimelineToolKeys,
    expandedTimelineAgentKeys,
    detailModalData,
    isDetailModalOpen,
    planProgress,
    timelineHasAnswer,
    hasAnswerText,
    latestAnswerIndex,
    showAssistantAnimation,
    hasRunningTool,
    toggleTimelineReasoningDetails,
    toggleTimelineToolDetails,
    toggleTimelineAgentDetails,
    openToolDetailModal,
    handleCloseDetailModal,
    getReasoningPhaseText,
  } = useChatItemViewModel({
    message,
    requestMessage,
    requestContent,
    isStreaming,
    isLatestRun,
    messageId,
  });

  const artifactVersion = message.additional_kwargs?.workspaceArtifactVersion;
  const artifactPaths = message.additional_kwargs?.workspaceArtifactPaths;
  const workspaceArtifacts = React.useMemo(() => Array.isArray(artifactPaths)
    ? [...new Set(artifactPaths.filter((path): path is string => typeof path === "string" && path.length > 0))]
    : [], [artifactPaths]);

  const findReplyArtifact = React.useCallback((path: string) => {
    let decodedPath = path;
    try {
      decodedPath = decodeURIComponent(path);
    } catch {
      // Tool paths can contain literal percent signs.
    }
    const candidates = [path, decodedPath];
    for (const candidate of [path, decodedPath]) {
      const normalized = `/${candidate.replace(/^\/+/, "")}`;
      candidates.push(normalized, normalized.slice(1));
      if (normalized.startsWith("/mnt/data/")) {
        const relative = normalized.slice("/mnt/data/".length);
        candidates.push("/" + relative, relative);
      }
    }
    return candidates.find((candidate) => workspaceArtifacts.includes(candidate));
  }, [workspaceArtifacts]);

  const openReplyArtifact = React.useCallback((path: string) => {
    if (!onOpenWorkspaceFile) return false;
    if (workspaceArtifacts.length) {
      const artifact = findReplyArtifact(path);
      if (artifact) return onOpenWorkspaceFile(artifact, typeof artifactVersion === "string" ? artifactVersion : undefined);
    }
    return onOpenWorkspaceFile(path);
  }, [artifactVersion, findReplyArtifact, onOpenWorkspaceFile, workspaceArtifacts.length]);

  const resolveWorkspaceImage = React.useCallback((source: string) => {
    if (!token || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(source)) return;
    const path = findReplyArtifact(source);
    if (path && /\.(png|jpe?g|gif|webp|avif|bmp)$/i.test(path)) {
      return { token, path, version: typeof artifactVersion === "string" ? artifactVersion : undefined };
    }
  }, [token, findReplyArtifact, artifactVersion]);

  const isWorkspaceChat = Boolean(onOpenWorkspaceFile);
  const visibleToolCount = timelineItems.filter((item) =>
    item.type === "tool" && !PLAN_MODE_TOOL_NAMES.has((item.toolName || "").trim().toLowerCase()),
  ).length;
  const hasActivity = Boolean(planProgress) || timelineItems.some((item) =>
    item.type !== "answer" &&
    (!isWorkspaceChat || item.type !== "compact") &&
    (item.type !== "tool" || !PLAN_MODE_TOOL_NAMES.has((item.toolName || "").trim().toLowerCase())),
  );

  const runningActivityLabel = hasRunningTool
    ? "正在使用工具"
    : planProgress?.plan.some((step) => step.status === "in_progress")
      ? "正在执行计划"
      : visibleToolCount > 0 ? "已调用工具" : "正在思考";

  const usePlainAnswer = isWorkspaceChat && isAssistant;
  const openingAnswer = isWorkspaceChat && hasActivity && timelineItems[0]?.type === "answer"
    ? timelineItems[0]
    : undefined;
  const duration = executionSummary?.durationSeconds;
  const seconds = Math.max(1, Math.round(duration ?? 0));
  const elapsedLabel = seconds >= 60
    ? `用时 ${Math.floor(seconds / 60)} 分钟 ${seconds % 60} 秒`
    : `用时 ${seconds} 秒`;
  const showElapsedLabel = isWorkspaceChat && !isStreaming && duration !== undefined;

  const selectionQuotes = React.useMemo(
    () => (isUser ? extractSelectionQuotesFromMessage(message) : []),
    [isUser, message]
  );

  if (!content.trim() && !isStreaming && files.length === 0 && workspaceArtifacts.length === 0 && timelineItems.length === 0 && selectionQuotes.length === 0) return null;

  const markdownSx = {
    "& .markdown": { fontSize: "15px", lineHeight: 1.75, color: "#0d0d0d" },
    "& .markdown p": { marginTop: "10px", marginBottom: "10px" },
    "& .markdown p:first-of-type": { marginTop: "0" },
    "& .markdown p:last-of-type": { marginBottom: "0" },
    "& .markdown ul, & .markdown ol": { marginTop: "6px", marginBottom: "6px" },
    "& .markdown li": { marginTop: "3px", marginBottom: "3px", lineHeight: 1.65 },
    "& .markdown li > p": { marginTop: "2px", marginBottom: "2px" },
    "& .markdown li > ul, & .markdown li > ol": { marginTop: "2px", marginBottom: "2px" },
  } as const;

  const previewSourceLink = preview?.libraryItemId && (
    <Link href={sharedSpacePageLocation(preview.libraryItemId)?.href ?? "/?"+new URLSearchParams({view:"library",libraryItem:preview.libraryItemId})}
      isExternal textDecoration="underline">在资料空间打开</Link>
  );
  return (
    <Flex justify={isUser ? "flex-end" : "flex-start"} w="100%">
      <Modal isOpen={Boolean(preview)} onClose={()=>setPreview(undefined)} size="2xl" scrollBehavior="inside" isCentered>
        <ModalOverlay/><ModalContent mx={4} borderRadius="18px"><ModalHeader pr={12} fontSize="md" overflowWrap="anywhere">{preview?.name}</ModalHeader>
          <ModalCloseButton aria-label="关闭附件预览"/><ModalBody pb={6} minW={0}>
            {previewError ? <Flex direction="column" align="center" gap={3} py={6}>
              <Box role="alert" textAlign="center"><Text fontWeight="600">无法预览附件</Text>
                <Text fontSize="sm" color="gray.600" mt={1}>{previewError}</Text></Box>
              {(preview?.url || preview?.libraryItemId) && <Button size="sm" variant="outline" borderRadius="full" onClick={()=>preview && openPreview(preview)}>重新加载</Button>}
              <Flex align="center" justify="center" wrap="wrap" gap={3} fontSize="sm">
                {previewSourceLink}
                {preview?.name && <Link href={"/?" + new URLSearchParams({view:"library",librarySearch:preview.name})}
                  isExternal textDecoration="underline">在资料空间查找同名文件</Link>}
              </Flex>
            </Flex> :
              previewText === undefined ? <Spinner aria-label="正在加载附件" size="sm"/> :
              <>{preview?.libraryItemId && <Flex mb={3} gap={2} align="baseline" wrap="wrap" fontSize="xs" color="gray.600">
                {showLibrarySource && <Text>正在显示资料空间中的版本</Text>}
                {previewSourceLink}
              </Flex>}{previewText.trim() && preview?.html ? <Box h="min(65dvh, 600px)"><InteractiveHtmlPreview name={preview.name} body={previewText}/></Box> : previewText.trim() ? <LibraryMarkdown>{previewText}</LibraryMarkdown> :
                <Text textAlign="center" py={6} fontSize="sm" color="gray.600">此附件没有正文。</Text>}</>}
          </ModalBody></ModalContent></Modal>
      <Box
        data-chat-selectable-message="true"
        data-message-id={messageId}
        data-message-role={message.role}
        bg={isUser ? "#f4f4f4" : isSystem || usePlainAnswer ? "transparent" : "myWhite.100"}
        border={!isWorkspaceChat && isAssistant ? "1px solid" : "none"}
        borderColor={isUser ? "myGray.300" : isAssistant ? "myGray.200" : "transparent"}
        borderRadius={
          isWorkspaceChat && isUser
            ? "20px"
            : isUser
            ? "16px 16px 6px 16px"
            : isAssistant
            ? "16px 16px 16px 6px"
            : 0
        }
        boxShadow="none"
        className="chat-message"
        color="#0d0d0d"
        fontSize={isWorkspaceChat ? "15px" : "sm"}
        lineHeight={isWorkspaceChat ? "1.7" : undefined}
        maxW={isUser ? { base: "88%", md: "74%" } : "100%"}
        w={isUser ? "fit-content" : "100%"}
        minW={0}
        px={isUser || (isAssistant && !isWorkspaceChat && !usePlainAnswer) ? 4 : 0}
        py={isWorkspaceChat && isUser ? 2.5 : isUser || isAssistant ? 3 : 0}
        sx={markdownSx}
      >
        {isUser ? (
          <Flex direction="column" gap={2}>
            {selectionQuotes.length > 0 ? (
              <Flex direction="column" gap={1.5}>
                {selectionQuotes.map((quote) => (
                  <Flex
                    key={quote.id}
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
                      title={quote.text}
                    >
                      {quote.text}
                    </Text>
                  </Flex>
                ))}
              </Flex>
            ) : null}
            {sortedFiles.length > 0 ? (
              <Grid alignItems="flex-start" gap={3} gridTemplateColumns={{ base: "1fr", md: sortedFiles.length > 1 ? "repeat(2, minmax(0, 1fr))" : "minmax(0, 1fr)" }}>
                {sortedFiles.map((file, index) => {
                  const name = file.name || file.storagePath?.split("/").pop() || `文件 ${index + 1}`;
                  const image = isImageFile({...file,name});
                  const storagePath = file.storagePath?.replace(/^\/+/,"");
                  const mediaType = file.type?.split(";")[0].trim().toLowerCase();
                  const previewName = [storagePath, name].find(value => value && /\.(html?|md|markdown)$/i.test(value)) || "";
                  const isMarkdown = mediaType === "text/markdown" || mediaType === "text/x-markdown" ||
                    (mediaType !== "text/html" && /\.(md|markdown)$/i.test(previewName));
                  const isHtml = !isMarkdown && (mediaType === "text/html" || /\.html?$/i.test(previewName));
                  const fileUrl = storagePath?.startsWith("chat_uploads/")
                    ? resolveChatUploadUrl(file,token,activeConversationId || "")
                    : file.downloadUrl?.startsWith("/api/") && !file.previewUrl?.startsWith("/api/code?")
                      ? file.downloadUrl : file.previewUrl || file.downloadUrl || file.publicUrl || toProjectFileViewUrl({storagePath:file.storagePath,token});
                  const sharedPage = file.libraryItemId ? sharedSpacePageLocation(file.libraryItemId) : undefined;
                  const originalUrl = file.libraryItemId && (sharedPage?.href ??
                    "/?" + new URLSearchParams({view:"library",libraryItem:file.libraryItemId}));
                  const imageFailed = image && failedImages.has(fileUrl);
                  const openUrl = imageFailed ? originalUrl : fileUrl || originalUrl;
                  const unavailable = imageFailed ? "图片无法加载" : "缺少附件地址";
                  const canOpen = Boolean(openUrl) || isMarkdown || isHtml;
                  return (
                    <Box
                      key={`${file.name || "file"}-${index}`}
                      bg="myWhite.100"
                      border="1px solid"
                      borderColor="myGray.200"
                      borderRadius="md"
                      overflow="hidden"
                    >
                      {image && fileUrl && !imageFailed ? (
                        <Link href={fileUrl} target="_blank" rel="noopener noreferrer" aria-label={`查看原图：${name}`}
                          display="block" cursor="zoom-in" _focusVisible={{outline:"2px solid currentColor",outlineOffset:"-2px"}}>
                          <Box as="img" src={fileUrl} alt={name} onError={()=>setFailedImages(previous=>new Set(previous).add(fileUrl))} maxH="220px" objectFit="contain" w="100%" />
                        </Link>
                      ) : (
                        <Flex
                          alignItems="center" gap={2}
                          as="button" type="button" disabled={!canOpen} aria-label={canOpen ? `打开 ${name}` : `${name}，${unavailable}`}
                          cursor={canOpen ? "pointer" : "default"}
                          onClick={() => {
                            if (isMarkdown || isHtml) openPreview({name,url:fileUrl,alternateUrls:[file.previewUrl,file.downloadUrl].filter((url): url is string => Boolean(url?.startsWith("/api/"))),html:isHtml,libraryItemId:file.libraryItemId});
                            else if (openUrl) window.open(openUrl,"_blank","noopener,noreferrer");
                          }}
                          p={2}
                          w="100%"
                        >
                          <LibraryItemIcon item={{name,path:storagePath,sharedPage:Boolean(sharedPage)}}/>
                          <AttachmentFilename name={name}/>
                          {imageFailed && originalUrl && <Text as="span" fontSize="xs" color="gray.600">查看原件</Text>}
                          {!canOpen && <Text as="span" fontSize="xs" color="gray.600">{unavailable}</Text>}
                        </Flex>
                      )}
                      {!canOpen && file.name && <Link display="inline-block" mx={2} mb={2} fontSize="xs" textDecoration="underline"
                        href={"/?" + new URLSearchParams({view:"library",librarySearch:file.name})}
                        isExternal aria-label={`在资料空间查找 ${file.name}`}>在资料空间查找同名文件</Link>}
                      {imageFailed && <Button size="xs" variant="ghost" mx={2} mb={2} aria-label={`重新加载 ${name}`}
                        onClick={() => setFailedImages(previous => {
                          const next = new Set(previous);
                          next.delete(fileUrl);
                          return next;
                        })}>重新加载</Button>}
                    </Box>
                  );
                })}
              </Grid>
            ) : null}
            {content ? <Markdown source={content} /> : null}
          </Flex>
        ) : isSystem ? (
          <Text color="myGray.500" fontSize="xs">{content}</Text>
        ) : (
          <Flex direction="column" gap={2} w="100%">
            {isStreaming && openingAnswer && (
              isWorkspaceChat ? (
                <StreamdownMarkdown
                  onOpenWorkspaceFile={openReplyArtifact}
                  resolveWorkspaceFile={workspaceArtifacts.length ? findReplyArtifact : undefined}
                  resolveWorkspaceImage={workspaceArtifacts.length ? resolveWorkspaceImage : undefined}
                  showAnimation={showAssistantAnimation && latestAnswerIndex === 0}
                  source={openingAnswer.text || ""}
                />
              ) : (
                <Markdown
                  onOpenWorkspaceFile={openReplyArtifact}
                  showAnimation={showAssistantAnimation && latestAnswerIndex === 0}
                  source={openingAnswer.text || ""}
                />
              )
            )}
            {hasActivity && (
              <Button
                alignSelf="flex-start"
                aria-expanded={activityExpanded}
                onClick={() => setActivityOpen(!activityExpanded)}
                leftIcon={isStreaming && isWorkspaceChat ? <Spinner size="xs" aria-hidden="true" /> : undefined}
                rightIcon={<Icon as={ChevronDownIcon} boxSize="14px" transform={activityExpanded ? "rotate(180deg)" : undefined} transition="transform 0.18s ease" />}
                size="xs"
                h="28px"
                px={2.5}
                borderRadius="full"
                variant="ghost"
                fontSize="12.5px"
                fontWeight="500"
                bg={activityExpanded ? "#f4f4f5" : "transparent"}
                color="#52525b"
                _hover={{ bg: "#f4f4f5", color: "#18181b" }}
              >
                {isStreaming ? (isWorkspaceChat ? runningActivityLabel : "正在处理") : showElapsedLabel ? elapsedLabel : "工作过程"}
                {!isStreaming && !showElapsedLabel && visibleToolCount > 0 && (
                  <Text as="span" ml={2} fontWeight="normal" color="gray.500">
                    {visibleToolCount} 次工具调用
                  </Text>
                )}
              </Button>
            )}
            <Box hidden={!activityExpanded}>
            {planProgress ? (
              <Box bg="purple.50" border="1px solid" borderColor="purple.200" borderRadius="10px" p={3}>
                <Flex align="center" gap={2} mb={2}>
                  <Box bg="purple.500" borderRadius="full" h="7px" w="7px" />
                  <Text color="purple.700" fontSize="12px" fontWeight="600">执行计划</Text>
                </Flex>
                {planProgress.explanation ? (
                  <Box mb={3}>
                    <Markdown source={planProgress.explanation} />
                  </Box>
                ) : null}
                <Flex direction="column" gap={2}>
                  {planProgress.plan.map((item, index) => (
                    <Flex key={index} align="flex-start" gap={2}>
                      <Box mt="2px">
                        {item.status === "completed" ? (
                          <Icon viewBox="0 0 24 24" color="green.500" boxSize="14px" fill="currentColor">
                            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
                          </Icon>
                        ) : item.status === "in_progress" ? (
                          <Spinner color="purple.500" size="xs" speed="0.7s" thickness="2px" />
                        ) : (
                          <Icon viewBox="0 0 24 24" color="myGray.400" boxSize="14px" fill="currentColor">
                            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8z"/>
                          </Icon>
                        )}
                      </Box>
                      <Box
                        color={item.status === "completed" ? "myGray.500" : "myGray.700"}
                        fontSize="12px"
                        textDecoration={item.status === "completed" ? "line-through" : "none"}
                      >
                        <Markdown source={item.step} />
                      </Box>
                    </Flex>
                  ))}
                </Flex>
              </Box>
            ) : null}

            </Box>
            {timelineItems.length > 0 ? (
              <Box w="100%">
                <Flex direction="column" gap={2} w="100%">
                  {timelineItems.map((item, index) => {
                    if (index === 0 && openingAnswer && (isStreaming || (!activityExpanded && latestAnswerIndex > 0))) return null;
                    if (!activityExpanded && item.type !== "answer") return null;

                    if (item.type === "agent") {
                      return (
                        <AgentTimelineCard
                          key={item.id || `${messageId}-timeline-agent-${index}`}
                          index={index}
                          isExpanded={Boolean(expandedTimelineAgentKeys[item.id || `${messageId}-timeline-agent-${index}`])}
                          isStreaming={isStreaming}
                          item={item}
                          onOpenToolDetailModal={openToolDetailModal}
                          onToggle={() => toggleTimelineAgentDetails(item.id || `${messageId}-timeline-agent-${index}`)}
                        />
                      );
                    }

                    if (item.type === "reasoning") {
                      const reasoningKey = item.id || `${messageId}-timeline-reasoning-${index}`;
                      const isExpanded = Boolean(expandedTimelineReasoningKeys[reasoningKey]);
                      const reasoningPhaseText = getReasoningPhaseText(index);
                      const isReasoningRunning =
                        Boolean(reasoningPhaseText) && !hasRunningTool && !hasAnswerText && !timelineHasAnswer;
                      if (isWorkspaceChat) return (
                        <Box key={reasoningKey} borderLeft="2px solid" borderColor="gray.200" pl={3} py={1}>
                          <Text fontSize="xs" fontWeight="600" color="gray.600" mb={1}>思考摘要</Text>
                          <Markdown source={item.text || reasoningPhaseText || ""} />
                        </Box>
                      );
                      return (
                        <Box key={reasoningKey} bg="green.50" border="1px solid" borderColor="green.200" borderRadius="10px" p={2}>
                          <Flex align="center" gap={2}>
                            {isReasoningRunning ? (
                              <Spinner color="green.500" size="xs" speed="0.7s" thickness="2.5px" />
                            ) : (
                              <Box bg="green.500" borderRadius="full" h="7px" w="7px" />
                            )}
                            <Text color="myGray.700" flex="1" fontSize="12px" fontWeight="600">
                              思考过程
                            </Text>
                            <IconButton
                              aria-label={isExpanded ? "收起思考内容" : "展开思考内容"}
                              icon={
                                <Icon
                                  as={ChevronDownIcon}
                                  boxSize="14px"
                                  color="myGray.500"
                                  transform={isExpanded ? "rotate(180deg)" : "rotate(0deg)"}
                                  transition="transform 0.2s ease"
                                />
                              }
                              h="22px"
                              minW="22px"
                              onClick={() => toggleTimelineReasoningDetails(reasoningKey)}
                              size="xs"
                              variant="ghost"
                            />
                          </Flex>
                          <Collapse animateOpacity in={isExpanded}>
                            <Box mt={2}>
                              <Markdown source={item.text || ""} />
                            </Box>
                          </Collapse>
                        </Box>
                      );
                    }

                    if (item.type === "tool") {
                      const normalizedToolName = (item.toolName || "").trim().toLowerCase();
                      const isPlanModeTool = PLAN_MODE_TOOL_NAMES.has(normalizedToolName);
                      if (isPlanModeTool) {
                        return null;
                      }
                      const toolKey = `${messageId}-timeline-tool-${item.id || "unknown"}-${index}`;
                      return (
                        <ToolTimelineCard
                          key={toolKey}
                          index={index}
                          isExpanded={Boolean(expandedTimelineToolKeys[toolKey])}
                          isStreaming={isStreaming}
                          item={item}
                          onOpenWorkspaceFile={onOpenWorkspaceFile ? openReplyArtifact : undefined}
                          onOpenToolDetailModal={openToolDetailModal}
                          onToggle={() => toggleTimelineToolDetails(toolKey)}
                        />
                      );
                    }

                    if (item.type === "compact") {
                      if (isWorkspaceChat) return null;
                      const compact = item.compact || { trigger: "auto" as const };
                      const preText =
                        typeof compact.preTokens === "number"
                          ? `${(compact.preTokens / 1000).toFixed(1)}k`
                          : "--";
                      const postText =
                        typeof compact.postTokens === "number"
                          ? `${(compact.postTokens / 1000).toFixed(1)}k`
                          : "--";
                      const savedText =
                        typeof compact.savedTokens === "number"
                          ? `${(compact.savedTokens / 1000).toFixed(1)}k`
                          : "";
                      const afterPercentText =
                        typeof compact.usedPercentAfter === "number"
                          ? `${compact.usedPercentAfter.toFixed(1)}%`
                          : "";
                      return (
                        <Box
                          key={`${messageId}-timeline-compact-${index}`}
                          bg={compact.trigger === "manual" ? "orange.50" : "blue.50"}
                          border="1px solid"
                          borderColor={compact.trigger === "manual" ? "orange.200" : "blue.200"}
                          borderRadius="10px"
                          p={2}
                        >
                          <Flex align="center" gap={2} justify="space-between">
                            <Text color="myGray.700" fontSize="12px" fontWeight="700">
                              {compact.trigger === "manual" ? "已手动压缩上下文" : "已自动压缩上下文"}
                            </Text>
                            {savedText ? (
                              <Text color="green.600" fontFamily="mono" fontSize="11px" fontWeight="700">
                                -{savedText}
                              </Text>
                            ) : null}
                          </Flex>
                          <Flex color="myGray.600" fontFamily="mono" fontSize="11px" gap={3} mt={1} wrap="wrap">
                            <Text>{preText} → {postText} tokens</Text>
                            {afterPercentText ? <Text>压缩后占用 {afterPercentText}</Text> : null}
                          </Flex>
                        </Box>
                      );
                    }

                    return (
                      <Box key={`${messageId}-timeline-answer-${index}`} pl={0} w="100%">
                        {isWorkspaceChat ? (
                          <StreamdownMarkdown
                            onOpenWorkspaceFile={onOpenWorkspaceFile ? openReplyArtifact : undefined}
                            resolveWorkspaceFile={workspaceArtifacts.length ? findReplyArtifact : undefined}
                            resolveWorkspaceImage={workspaceArtifacts.length ? resolveWorkspaceImage : undefined}
                            showAnimation={showAssistantAnimation && index === latestAnswerIndex}
                            source={item.text || ""}
                          />
                        ) : (
                          <Markdown
                            onOpenWorkspaceFile={onOpenWorkspaceFile ? openReplyArtifact : undefined}
                            showAnimation={showAssistantAnimation && index === latestAnswerIndex}
                            source={item.text || ""}
                          />
                        )}
                      </Box>
                    );
                  })}
                </Flex>
              </Box>
            ) : null}

            {(!timelineHasAnswer || timelineItems.length === 0) && content ? (
              isWorkspaceChat ? (
                <StreamdownMarkdown
                  onOpenWorkspaceFile={onOpenWorkspaceFile ? openReplyArtifact : undefined}
                  resolveWorkspaceFile={workspaceArtifacts.length ? findReplyArtifact : undefined}
                  resolveWorkspaceImage={workspaceArtifacts.length ? resolveWorkspaceImage : undefined}
                  showAnimation={showAssistantAnimation}
                  source={content}
                />
              ) : (
                <Markdown
                  onOpenWorkspaceFile={onOpenWorkspaceFile ? openReplyArtifact : undefined}
                  showAnimation={showAssistantAnimation}
                  source={content}
                />
              )
            ) : null}

            {isWorkspaceChat && isStreaming && !hasActivity && (
              <Flex role="status" align="center" gap={2} py={2} color="gray.600">
                <Spinner size="xs" aria-hidden="true" />
                <Text fontSize="sm">{runningActivityLabel}</Text>
              </Flex>
            )}

            {onOpenWorkspaceFile && workspaceArtifacts.length > 0 && (
              <Flex gap={2} wrap="wrap" aria-label="此回复生成的文件" mt={1}>
                {workspaceArtifacts.map((path) => (
                  <ReplyArtifact key={path} path={path} version={typeof artifactVersion === "string" ? artifactVersion : undefined}
                    onOpen={() => openReplyArtifact(path)} />
                ))}
              </Flex>
            )}
          </Flex>
        )}
      </Box>

      <Modal isOpen={isDetailModalOpen} onClose={handleCloseDetailModal} size="xl">
        <ModalOverlay bg="blackAlpha.400" />
        <ModalContent>
          <ModalHeader fontSize="sm">{detailModalData?.title || "工具详情"}</ModalHeader>
          <ModalCloseButton />
          <ModalBody pb={4}>
            <Flex justify="flex-end" mb={2}>
              <Button colorScheme="primary" onClick={() => copyData(detailModalData?.content || "")} size="xs" variant="outline">
                复制
              </Button>
            </Flex>
            <Box bg="myGray.50" border="1px solid" borderColor="myGray.200" borderRadius="8px" maxH="60vh" overflow="auto" p={3}>
              <Markdown source={detailModalData?.content || ""} />
            </Box>
          </ModalBody>
        </ModalContent>
      </Modal>
    </Flex>
  );
};

export default React.memo(
  ChatItem,
  (prevProps, nextProps) =>
    prevProps.isStreaming === nextProps.isStreaming &&
    prevProps.messageId === nextProps.messageId &&
    prevProps.message === nextProps.message &&
    prevProps.executionSummary?.nodeCount === nextProps.executionSummary?.nodeCount &&
    prevProps.executionSummary?.durationSeconds === nextProps.executionSummary?.durationSeconds &&
    prevProps.requestContent === nextProps.requestContent &&
    prevProps.isLatestRun === nextProps.isLatestRun &&
    prevProps.onOpenWorkspaceFile === nextProps.onOpenWorkspaceFile
);

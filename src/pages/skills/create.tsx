import { Box, Flex, Spinner, Text } from "@chakra-ui/react";
import { withAuthHeaders } from "@features/auth/client/authClient";
import ChatPanel from "@features/chat/components/ChatPanel";
import SkillsEditorPanel from "@features/skills-studio/components/SkillsEditorPanel";
import SkillsFileTreePanel from "@features/skills-studio/components/SkillsFileTreePanel";
import SkillsPageHeader from "@features/skills-studio/components/SkillsPageHeader";
import SkillsStudioTopBar from "@features/skills-studio/components/SkillsStudioTopBar";
import { buildTree } from "@components/workspace/fileExplorer/utils";
import type { SandpackFilesPayload } from "@components/workspace/fileExplorer/types";
import type { GetServerSideProps } from "next";
import { useRouter } from "next/router";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { getAuthUserFromRequest } from "@server/auth/ssr";
import VectorBackground from "@/components/auth/VectorBackground";

type FileMap = Record<string, { code: string }>;

const SkillCreatePage = () => {
  const router = useRouter();
  const [workspaceId, setWorkspaceId] = useState("");
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [bootstrapError, setBootstrapError] = useState("");
  const [activeView, setActiveView] = useState<"preview" | "code">("code");
  const [files, setFiles] = useState<FileMap>({});
  const [selectedFile, setSelectedFile] = useState("");
  const [openedFiles, setOpenedFiles] = useState<string[]>([]);
  const [draftCode, setDraftCode] = useState("");
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [fileTreeWidth, setFileTreeWidth] = useState(280);
  const [isResizingTree, setIsResizingTree] = useState(false);
  const contentAreaRef = useRef<HTMLDivElement | null>(null);
  const resizeStartRef = useRef<{ startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    if (!router.isReady) return;
    let cancelled = false;

    const bootstrap = async () => {
      setIsBootstrapping(true);
      setBootstrapError("");
      try {
        if (typeof router.query.conversation === "string" && router.query.conversation) {
          const nextQuery = { ...router.query };
          delete nextQuery.conversation;
          void router.replace(
            {
              pathname: router.pathname,
              query: nextQuery,
            },
            undefined,
            { shallow: true }
          );
        }

        const projectToken =
          typeof router.query.projectToken === "string" ? router.query.projectToken.trim() : "";
        if (!projectToken) {
          throw new Error("缺少 projectToken，无法绑定项目");
        }

        const res = await fetch("/api/skills/workspaces/create", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...withAuthHeaders(),
          },
          body: JSON.stringify({ projectToken }),
        });

        const payload = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(typeof payload?.error === "string" ? payload.error : "创建 workspace 失败");
        }
        if (cancelled) return;

        const id = typeof payload.workspaceId === "string" ? payload.workspaceId : "";
        const nextFiles = payload.files && typeof payload.files === "object" ? (payload.files as FileMap) : {};
        setWorkspaceId(id);
        setFiles(nextFiles);

        const firstFile = Object.keys(nextFiles).sort((a, b) => a.localeCompare(b))[0] || "";
        setSelectedFile(firstFile);
        setOpenedFiles(firstFile ? [firstFile] : []);
      } catch (error) {
        if (cancelled) return;
        setBootstrapError(error instanceof Error ? error.message : "初始化失败");
      } finally {
        if (!cancelled) setIsBootstrapping(false);
      }
    };

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [router]);

  const fileList = useMemo(() => Object.keys(files).sort((a, b) => a.localeCompare(b)), [files]);
  const fileMap = useMemo<SandpackFilesPayload>(() => files as SandpackFilesPayload, [files]);
  const fileTreeRoot = useMemo(() => buildTree(fileMap), [fileMap]);
  const activeFile = selectedFile && files[selectedFile] ? selectedFile : fileList[0] || "";
  const selectedCode = activeFile ? files[activeFile]?.code || "" : "";
  const isMarkdownFile = /\.md$/i.test(activeFile);
  const workspaceStatus: "idle" | "loading" | "ready" | "error" = isBootstrapping
    ? "loading"
    : bootstrapError
    ? "error"
    : workspaceId
    ? "ready"
    : "idle";

  useEffect(() => {
    if (!selectedFile && fileList.length > 0) {
      setSelectedFile(fileList[0]);
      return;
    }
    if (selectedFile && !files[selectedFile]) {
      setSelectedFile(fileList[0] || "");
    }
  }, [fileList, files, selectedFile]);

  useEffect(() => {
    setOpenedFiles((prev) => prev.filter((path) => Boolean(files[path])));
  }, [files]);

  useEffect(() => {
    setDraftCode(selectedCode);
    setIsDirty(false);
    setSaveError("");
  }, [activeFile, selectedCode]);

  const handleSelectFile = (filePath: string) => {
    if (filePath === activeFile) return;
    if (isDirty && typeof window !== "undefined") {
      const ok = window.confirm("当前文件有未保存修改，是否放弃修改并切换文件？");
      if (!ok) return;
    }
    setSelectedFile(filePath);
    setOpenedFiles((prev) => (prev.includes(filePath) ? prev : [...prev, filePath]));
  };

  const handleSaveFile = async () => {
    if (!workspaceId || !activeFile || isSaving) return;
    setIsSaving(true);
    setSaveError("");

    try {
      const res = await fetch(`/api/skills/workspaces/${encodeURIComponent(workspaceId)}/files`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...withAuthHeaders(),
        },
        body: JSON.stringify({
          projectToken: typeof router.query.projectToken === "string" ? router.query.projectToken : "",
          path: activeFile,
          content: draftCode,
        }),
      });

      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof payload?.error === "string" ? payload.error : "保存失败");
      }

      const nextFiles = payload.files && typeof payload.files === "object" ? (payload.files as FileMap) : null;
      if (nextFiles) {
        setFiles(nextFiles);
      } else {
        setFiles((prev) => ({
          ...prev,
          [activeFile]: { code: draftCode },
        }));
      }
      setIsDirty(false);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "保存失败");
    } finally {
      setIsSaving(false);
    }
  };

  const applyWorkspaceFiles = async (nextFilesMap: FileMap, nextActiveFile?: string) => {
    if (!workspaceId) return;
    const res = await fetch(`/api/skills/workspaces/${encodeURIComponent(workspaceId)}/files`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        ...withAuthHeaders(),
      },
      body: JSON.stringify({
        projectToken: typeof router.query.projectToken === "string" ? router.query.projectToken : "",
        files: nextFilesMap,
      }),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(typeof payload?.error === "string" ? payload.error : "写入失败");
    }
    const persistedFiles = payload.files && typeof payload.files === "object" ? (payload.files as FileMap) : null;
    if (persistedFiles) {
      setFiles(persistedFiles);
    } else {
      setFiles(nextFilesMap);
    }
    if (nextActiveFile) {
      setSelectedFile(nextActiveFile);
      setOpenedFiles((prev) => (prev.includes(nextActiveFile) ? prev : [...prev, nextActiveFile]));
    } else if (selectedFile && !(persistedFiles || nextFilesMap)[selectedFile]) {
      const fallback = Object.keys(persistedFiles || nextFilesMap).sort((a, b) => a.localeCompare(b))[0] || "";
      setSelectedFile(fallback);
    }
  };

  const handleStartResizeTree = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    resizeStartRef.current = {
      startX: event.clientX,
      startWidth: fileTreeWidth,
    };
    setIsResizingTree(true);
  };

  useEffect(() => {
    if (!isResizingTree) return;

    const handleMouseMove = (event: MouseEvent) => {
      const resizeStart = resizeStartRef.current;
      const contentEl = contentAreaRef.current;
      if (!resizeStart || !contentEl) return;

      const deltaX = event.clientX - resizeStart.startX;
      const containerWidth = contentEl.clientWidth;
      const minWidth = 220;
      const maxWidth = Math.min(520, Math.floor(containerWidth * 0.55));
      const nextWidth = Math.max(minWidth, Math.min(maxWidth, resizeStart.startWidth + deltaX));
      setFileTreeWidth(nextWidth);
    };

    const handleMouseUp = () => {
      setIsResizingTree(false);
      resizeStartRef.current = null;
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizingTree]);

  const handleCloseFileTab = (filePath: string) => {
    if (!openedFiles.includes(filePath)) return;
    if (filePath === activeFile && isDirty && typeof window !== "undefined") {
      const ok = window.confirm("当前文件有未保存修改，关闭标签会丢失修改，是否继续？");
      if (!ok) return;
    }

    let nextActiveFile = activeFile;
    setOpenedFiles((prev) => {
      const index = prev.indexOf(filePath);
      const next = prev.filter((path) => path !== filePath);
      if (filePath === activeFile) {
        const fallback = next[index] || next[index - 1] || next[0] || "";
        nextActiveFile = fallback;
      }
      return next;
    });

    if (filePath === activeFile) {
      setSelectedFile(nextActiveFile);
    }
  };

  return (
    <Box position="relative" minH="100vh" overflow="hidden">
      <VectorBackground />
      <Flex
        direction="column"
        minH="100vh"
        align="stretch"
        justify="flex-start"
        px={{ base: 4, md: 8, xl: 10 }}
        py={{ base: 6, md: 8 }}
        position="relative"
        zIndex={1}
        gap={{ base: 4, md: 5 }}
        overflow="hidden"
        boxSizing="border-box"
      >
        <Box>
          <SkillsPageHeader
            onBack={() => {
              if (window.history.length > 1) {
                router.back();
                return;
              }
              void router.push("/");
            }}
          />
        </Box>
        <Flex as="main" align="stretch" gap={0} flex="1" minH="0">
          <Box flex="0 0 auto" minW="320px" maxW="728px" w="560px" alignSelf="stretch" minH={0}>
            {isBootstrapping ? (
              <Flex
                h="100%"
                align="center"
                justify="center"
                border="1px solid"
                borderColor="rgba(203,213,225,0.85)"
                borderBottomLeftRadius="xl"
                borderTopLeftRadius="xl"
                backdropFilter="blur(10px)"
                bg="rgba(255,255,255,0.9)"
              >
                <Flex align="center" color="myGray.500" gap={2}>
                  <Spinner size="sm" />
                  <Text fontSize="sm">正在初始化技能工作区...</Text>
                </Flex>
              </Flex>
            ) : (
              <ChatPanel
                key={workspaceId}
                token={`skill-studio:${workspaceId}`}
                height="100%"
                completionsPath="/api/skills/chat/completions"
                completionsStream
                completionsExtraBody={{
                  workspaceId,
                  projectToken: typeof router.query.projectToken === "string" ? router.query.projectToken : "",
                }}
                hideSkillsManager
                autoCreateInitialConversation={false}
                roundTop
                defaultHeaderTitle="技能助手"
                emptyStateTitle="创建你的第一个技能"
                emptyStateDescription="先用一句话描述能力目标，我会生成 SKILL.md 并同步到右侧文件。"
                defaultSelectedSkill="skill-creator"
                onFilesUpdated={(nextFiles) => setFiles(nextFiles)}
              />
            )}
          </Box>

          <Box
            w="10px"
            bg="transparent"
            position="relative"
            _before={{
              content: '\"\"',
              position: "absolute",
              left: "50%",
              top: "20%",
              transform: "translateX(-50%)",
              width: "2px",
              height: "60%",
              borderRadius: "999px",
              background: "rgba(148,163,184,0.35)",
            }}
          />

          <Flex
            as="section"
            direction="column"
            flex="1"
            minH="0"
            border="1px solid rgba(255,255,255,0.75)"
            borderTopLeftRadius={0}
            borderBottomLeftRadius={0}
            borderTopRightRadius="2xl"
            borderBottomRightRadius="2xl"
            bg="rgba(255,255,255,0.75)"
            backdropFilter="blur(22px)"
            boxShadow="0 24px 42px -28px rgba(15, 23, 42, 0.35)"
            overflow="hidden"
          >
            <SkillsStudioTopBar
              activeView={activeView}
              onChangeView={setActiveView}
              openedFiles={openedFiles}
              activeFile={activeFile}
              onSelectFileTab={handleSelectFile}
              onCloseFileTab={handleCloseFileTab}
              status={workspaceStatus}
              error={bootstrapError}
            />

            <Flex
              ref={contentAreaRef}
              position="relative"
              flex="1"
              minH="0"
              overflow="hidden"
              bg="rgba(248,250,252,0.65)"
            >
              <Box w={`${fileTreeWidth}px`} flexShrink={0} minH={0} h="100%">
                <SkillsFileTreePanel
                  root={fileTreeRoot}
                  files={fileMap}
                  activeFile={activeFile}
                  onSelectFile={handleSelectFile}
                  onApplyFiles={async (nextFiles, nextActiveFile) => {
                    await applyWorkspaceFiles(nextFiles as FileMap, nextActiveFile);
                  }}
                />
              </Box>

              <Box
                w="8px"
                flexShrink={0}
                cursor="col-resize"
                onMouseDown={handleStartResizeTree}
                position="relative"
                bg={isResizingTree ? "rgba(148,163,184,0.16)" : "transparent"}
                _hover={{ bg: "rgba(148,163,184,0.16)" }}
                _before={{
                  content: '""',
                  position: "absolute",
                  left: "50%",
                  top: "50%",
                  transform: "translate(-50%, -50%)",
                  width: "2px",
                  height: "42px",
                  borderRadius: "999px",
                  background: "rgba(148,163,184,0.5)",
                }}
              />

              <Box flex="1" minH={0} h="100%" overflow="hidden">
                <SkillsEditorPanel
                  activeView={activeView}
                  activeFile={activeFile}
                  isMarkdownFile={isMarkdownFile}
                  selectedCode={selectedCode}
                  draftCode={draftCode}
                  isDirty={isDirty}
                  isSaving={isSaving}
                  saveError={saveError}
                  onChangeDraft={(next) => {
                    setDraftCode(next);
                    setIsDirty(next !== selectedCode);
                    setSaveError("");
                  }}
                  onSave={() => {
                    void handleSaveFile();
                  }}
                />
              </Box>
            </Flex>
          </Flex>
        </Flex>
      </Flex>
    </Box>
  );
};

export const getServerSideProps: GetServerSideProps = async (context) => {
  const authUser = getAuthUserFromRequest(context.req);
  if (!authUser) {
    return {
      redirect: {
        destination: `/login?lastRoute=${encodeURIComponent(context.resolvedUrl)}`,
        permanent: false,
      },
    };
  }
  return { props: {} };
};

export default SkillCreatePage;

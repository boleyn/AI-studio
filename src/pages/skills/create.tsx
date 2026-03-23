import { Box, Button, Flex, Spinner, Text, useToast } from "@chakra-ui/react";
import { SandpackProvider, type SandpackPredefinedTemplate } from "@codesandbox/sandpack-react";
import { githubLight } from "@codesandbox/sandpack-themes";
import type { GetServerSideProps } from "next";
import { useRouter } from "next/router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import CodeChangeListener, { type SaveStatus } from "@/components/CodeChangeListener";
import WorkspaceShell from "@/components/WorkspaceShell";
<<<<<<< HEAD
import TopBar from "@/components/TopBar";
=======
import VectorBackground from "@/components/auth/VectorBackground";
import { BackIcon } from "@/components/common/Icon";
>>>>>>> aiid/dev
import { withAuthHeaders } from "@features/auth/client/authClient";
import ChatPanel from "@features/chat/components/ChatPanel";
import { buildSandpackCustomSetup } from "@shared/sandpack/registry";
import { getAuthUserFromRequest } from "@server/auth/ssr";

type FileMap = Record<string, { code: string }>;

<<<<<<< HEAD
type ActiveView = "preview" | "code" | "logs";
=======
type ActiveView = "preview" | "code";
>>>>>>> aiid/dev

const DEFAULT_TEMPLATE: SandpackPredefinedTemplate = "react";
const SKILL_ROOT = "/skills";
const isSkillPath = (path: string) => path === SKILL_ROOT || path.startsWith(`${SKILL_ROOT}/`);

<<<<<<< HEAD
const fallbackSkillFiles: FileMap = {};
=======
const fallbackSkillFiles: FileMap = {
  "/skills/README.md": {
    code: "# Skills\\n\\nStore project-bound skills here, for example:\\n- /skills/my-skill/SKILL.md\\n",
  },
};
>>>>>>> aiid/dev

const normalizeSkillFiles = (rawFiles: unknown): FileMap => {
  if (!rawFiles || typeof rawFiles !== "object") return {};

  const next: FileMap = {};
  Object.entries(rawFiles as Record<string, unknown>).forEach(([path, value]) => {
    if (!isSkillPath(path)) return;

    if (typeof value === "string") {
      next[path] = { code: value };
      return;
    }

    if (value && typeof value === "object" && typeof (value as { code?: unknown }).code === "string") {
      next[path] = { code: (value as { code: string }).code };
    }
  });

  return next;
};

const SkillCreatePage = () => {
  const router = useRouter();
  const toast = useToast();

  const [workspaceId, setWorkspaceId] = useState("");
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [bootstrapError, setBootstrapError] = useState("");
  const [files, setFiles] = useState<FileMap>({});
  const [activeView, setActiveView] = useState<ActiveView>("code");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
<<<<<<< HEAD
  const [skillName, setSkillName] = useState("未命名技能");
=======
>>>>>>> aiid/dev
  const [isValidatingSkills, setIsValidatingSkills] = useState(false);
  const [skillsValidationIssueCount, setSkillsValidationIssueCount] = useState(0);
  const [skillsValidationMessage, setSkillsValidationMessage] = useState("");

  const latestFilesRef = useRef<FileMap>({});

  const containerRef = useRef<HTMLDivElement | null>(null);
  const mainRef = useRef<HTMLDivElement | null>(null);
  const [workspaceHeight, setWorkspaceHeight] = useState("100%");
  const [chatWidth, setChatWidth] = useState(546);
  const resizingRef = useRef(false);

  const projectToken = useMemo(
    () => (typeof router.query.projectToken === "string" ? router.query.projectToken.trim() : ""),
    [router.query.projectToken]
  );
<<<<<<< HEAD
  const skillId = useMemo(
    () => (typeof router.query.skillId === "string" ? router.query.skillId.trim() : ""),
    [router.query.skillId]
  );

  useEffect(() => {
    if (skillId) {
      setSkillName(skillId);
    }
  }, [skillId]);

=======
>>>>>>> aiid/dev
  const isWorkspaceReady = !isBootstrapping && !bootstrapError && Boolean(workspaceId);

  useEffect(() => {
    if (!router.isReady) return;
<<<<<<< HEAD
=======
    if (!projectToken) {
      setBootstrapError("缺少 projectToken，无法绑定项目");
      setIsBootstrapping(false);
      return;
    }
>>>>>>> aiid/dev

    let cancelled = false;

    const bootstrap = async () => {
      setIsBootstrapping(true);
      setBootstrapError("");

      try {
        const res = await fetch("/api/skills/workspaces/create", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...withAuthHeaders(),
          },
          body: JSON.stringify({
            projectToken: projectToken || undefined,
            skillId: skillId || undefined,
          }),
        });

        const payload = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(typeof payload?.error === "string" ? payload.error : "创建 workspace 失败");
        }
        if (cancelled) return;

        const nextWorkspaceId =
          typeof payload.workspaceId === "string" && payload.workspaceId.trim()
            ? payload.workspaceId.trim()
<<<<<<< HEAD
            : skillId || projectToken;
=======
            : projectToken;
>>>>>>> aiid/dev
        const nextFiles = normalizeSkillFiles(payload.files);

        setWorkspaceId(nextWorkspaceId);
        setFiles(nextFiles);
        latestFilesRef.current = nextFiles;
      } catch (error) {
        if (!cancelled) {
          setBootstrapError(error instanceof Error ? error.message : "初始化失败");
        }
      } finally {
        if (!cancelled) setIsBootstrapping(false);
      }
    };

    void bootstrap();

    return () => {
      cancelled = true;
    };
<<<<<<< HEAD
  }, [projectToken, router.isReady, skillId]);
=======
  }, [projectToken, router.isReady]);
>>>>>>> aiid/dev

  const persistSkillFiles = useCallback(
    async (nextFiles: FileMap) => {
      if (!workspaceId) {
        throw new Error("workspace 尚未初始化");
      }

      const normalized = normalizeSkillFiles(nextFiles);
<<<<<<< HEAD
      const queryParams = new URLSearchParams();
      if (projectToken) queryParams.set("projectToken", projectToken);
      if (skillId) queryParams.set("skillId", skillId);
      const query = queryParams.toString() ? `?${queryParams.toString()}` : "";
=======
      const query = projectToken ? `?projectToken=${encodeURIComponent(projectToken)}` : "";
>>>>>>> aiid/dev
      const response = await fetch(
        `/api/skills/workspaces/${encodeURIComponent(workspaceId)}/files${query}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            ...withAuthHeaders(),
          },
          body: JSON.stringify({
            projectToken,
<<<<<<< HEAD
            skillId,
=======
>>>>>>> aiid/dev
            files: normalized,
          }),
        }
      );

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof payload?.error === "string" ? payload.error : "保存失败");
      }

      const persistedFiles = normalizeSkillFiles(payload.files);
      latestFilesRef.current = persistedFiles;
      setFiles(persistedFiles);
    },
<<<<<<< HEAD
    [projectToken, skillId, workspaceId]
  );

  const getSkillNameFromFiles = useCallback((currentFiles: FileMap) => {
    // 优先从 SKILL.md 的 frontmatter 中拉取 name
    const skillMdEntry = Object.entries(currentFiles).find(([path]) => path.endsWith("SKILL.md"));
    if (skillMdEntry) {
      const code = skillMdEntry[1].code;
      // 匹配 name: "xxx" 或 name: xxx
      const nameMatch = code.match(/name:\s*["']?([^"'\n]+)["']?/i);
      if (nameMatch?.[1]) {
        return nameMatch[1].trim();
      }
      // 如果没有 name，尝试匹配一级标题
      const h1Match = code.match(/^#\s+(.+)$/m);
      if (h1Match?.[1]) {
        return h1Match[1].trim();
      }
    }
    return "";
  }, []);

  const handleAgentFilesUpdated = useCallback(
    (updated: FileMap) => {
      const normalized = normalizeSkillFiles(updated);
      if (Object.keys(normalized).length === 0) return;

      const merged: FileMap = {
        ...latestFilesRef.current,
        ...normalized,
      };
      latestFilesRef.current = merged;
      setFiles(merged);

      // 当机器人更新文件时，也尝试同步解析一下名字（比如机器人刚写完 SKILL.md）
      const nameInFiles = getSkillNameFromFiles(merged);
      if (nameInFiles) {
        setSkillName(nameInFiles);
      }
    },
    [getSkillNameFromFiles]
  );

  const handleValidateSkills = useCallback(
    async (silent = false) => {
      setIsValidatingSkills(true);
      try {
        const response = await fetch("/api/agent/skills/validate", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...withAuthHeaders(),
          },
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(typeof payload?.error === "string" ? payload.error : "校验失败");
        }

        const issueCount = Array.isArray(payload?.issues) ? payload.issues.length : 0;
        setSkillsValidationIssueCount(issueCount);
        if (issueCount === 0) {
          setSkillsValidationMessage("校验通过");
          if (!silent) {
            toast({
              status: "success",
              title: "Skills 校验通过",
              description: "frontmatter 与目录规范都通过了。",
              duration: 2600,
              isClosable: true,
            });
          }
          return;
        }

        const firstIssue = payload.issues?.[0];
        const firstMessage =
          typeof firstIssue?.message === "string" && firstIssue.message
            ? firstIssue.message
            : "请检查 SKILL.md 的 frontmatter 与目录命名。";
        setSkillsValidationMessage(firstMessage);
        toast({
          status: "error",
          title: `发现 ${issueCount} 个规范问题`,
          description: firstMessage,
          duration: 4200,
          isClosable: true,
        });
      } catch (error) {
        setSkillsValidationIssueCount(1);
        setSkillsValidationMessage(error instanceof Error ? error.message : "请稍后重试");
        toast({
          status: "error",
          title: "Skills 校验失败",
          description: error instanceof Error ? error.message : "请稍后重试",
          duration: 3200,
          isClosable: true,
        });
      } finally {
        setIsValidatingSkills(false);
      }
    },
    [toast]
  );
=======
    [projectToken, workspaceId]
  );

  const handleAgentFilesUpdated = useCallback((updated: FileMap) => {
    const normalized = normalizeSkillFiles(updated);
    if (Object.keys(normalized).length === 0) return;

    const merged: FileMap = {
      ...latestFilesRef.current,
      ...normalized,
    };
    latestFilesRef.current = merged;
    setFiles(merged);
  }, []);

  const handleValidateSkills = useCallback(async (silent = false) => {
    setIsValidatingSkills(true);
    try {
      const response = await fetch("/api/agent/skills/validate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...withAuthHeaders(),
        },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof payload?.error === "string" ? payload.error : "校验失败");
      }

      const issueCount = Array.isArray(payload?.issues) ? payload.issues.length : 0;
      setSkillsValidationIssueCount(issueCount);
      if (issueCount === 0) {
        setSkillsValidationMessage("校验通过");
        if (!silent) {
          toast({
            status: "success",
            title: "Skills 校验通过",
            description: "frontmatter 与目录规范都通过了。",
            duration: 2600,
            isClosable: true,
          });
        }
        return;
      }

      const firstIssue = payload.issues?.[0];
      const firstMessage =
        typeof firstIssue?.message === "string" && firstIssue.message
          ? firstIssue.message
          : "请检查 SKILL.md 的 frontmatter 与目录命名。";
      setSkillsValidationMessage(firstMessage);
      toast({
        status: "error",
        title: `发现 ${issueCount} 个规范问题`,
        description: firstMessage,
        duration: 4200,
        isClosable: true,
      });
    } catch (error) {
      setSkillsValidationIssueCount(1);
      setSkillsValidationMessage(error instanceof Error ? error.message : "请稍后重试");
      toast({
        status: "error",
        title: "Skills 校验失败",
        description: error instanceof Error ? error.message : "请稍后重试",
        duration: 3200,
        isClosable: true,
      });
    } finally {
      setIsValidatingSkills(false);
    }
  }, [toast]);
>>>>>>> aiid/dev

  const saveStatusRef = useRef<SaveStatus>("idle");
  useEffect(() => {
    const prev = saveStatusRef.current;
    saveStatusRef.current = saveStatus;
    if (prev !== "saved" && saveStatus === "saved" && isWorkspaceReady) {
      void handleValidateSkills(true);
<<<<<<< HEAD

      // 保存成功后尝试从文件中重新解析一次名字
      const nameInFiles = getSkillNameFromFiles(latestFilesRef.current);
      if (nameInFiles && nameInFiles !== skillName) {
        setSkillName(nameInFiles);
      }
    }
  }, [getSkillNameFromFiles, handleValidateSkills, isWorkspaceReady, saveStatus, skillName]);
=======
    }
  }, [handleValidateSkills, isWorkspaceReady, saveStatus]);
>>>>>>> aiid/dev

  useEffect(() => {
    if (!isWorkspaceReady) return;
    void handleValidateSkills(true);
<<<<<<< HEAD

    // 初始化准备好后也尝试拉取一次名字
    const nameInFiles = getSkillNameFromFiles(latestFilesRef.current);
    if (nameInFiles) {
      setSkillName(nameInFiles);
    }
  }, [getSkillNameFromFiles, handleValidateSkills, isWorkspaceReady]);
=======
  }, [handleValidateSkills, isWorkspaceReady]);
>>>>>>> aiid/dev

  useEffect(() => {
    const handleMove = (event: MouseEvent) => {
      if (!resizingRef.current) return;
      const containerLeft = containerRef.current?.getBoundingClientRect().left || 0;
      const next = Math.min(728, Math.max(300, event.clientX - containerLeft));
      setChatWidth(next);
    };

    const handleUp = () => {
      resizingRef.current = false;
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);

    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    const main = mainRef.current;
    if (!container || !main) return;

    const updateHeight = () => {
      const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
      const mainTop = main.getBoundingClientRect().top;
      const containerStyles = getComputedStyle(container);
      const paddingBottom = parseFloat(containerStyles.paddingBottom || "0") || 0;
      const borderBottom = parseFloat(containerStyles.borderBottomWidth || "0") || 0;
      const nextHeight = Math.max(0, viewportHeight - mainTop - paddingBottom - borderBottom);
      setWorkspaceHeight(`${nextHeight}px`);
    };

    updateHeight();
    const observer = new ResizeObserver(() => updateHeight());
    observer.observe(container);
    observer.observe(main);
    window.addEventListener("resize", updateHeight);
    window.visualViewport?.addEventListener("resize", updateHeight);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateHeight);
      window.visualViewport?.removeEventListener("resize", updateHeight);
    };
  }, []);

  const workspaceStatus: "idle" | "loading" | "ready" | "error" = isBootstrapping
    ? "loading"
    : bootstrapError
    ? "error"
    : workspaceId
    ? "ready"
    : "idle";

  const sandpackFiles = useMemo<FileMap>(() => {
    if (Object.keys(files).length > 0) return files;
    return fallbackSkillFiles;
  }, [files]);

  const customSetup = useMemo(() => buildSandpackCustomSetup({}), []);

  return (
<<<<<<< HEAD
    <Box
      position="relative"
      minH="100dvh"
      h="100dvh"
      overflow="hidden"
      bg="#0f131b"
      backgroundImage="radial-gradient(circle at 1px 1px, rgba(173,184,203,0.22) 1px, transparent 0)"
      backgroundSize="18px 18px"
      p={0}
    >
      <Flex
        ref={containerRef}
        direction="column"
        minH="100dvh"
        h="100dvh"
=======
    <Box position="relative" minH="100vh" overflow="hidden">
      <VectorBackground />
      <Flex
        ref={containerRef}
        direction="column"
        minH="100vh"
>>>>>>> aiid/dev
        align="stretch"
        justify="flex-start"
        px={0}
        py={0}
        position="relative"
        zIndex={1}
        gap={0}
        overflow="hidden"
        boxSizing="border-box"
        borderRadius={0}
        border="none"
        bg="#f3f4fa"
        boxShadow="none"
      >
<<<<<<< HEAD
        <TopBar
          projectName={skillName}
          activeView={activeView}
          onChangeView={setActiveView}
          onBack={() => {
            const target = projectToken ? `/project/${encodeURIComponent(projectToken)}` : "/";
            if (typeof window !== "undefined") {
              window.location.assign(target);
              return;
            }
            void router.push(target);
          }}
          onOpenSettings={() => {
            toast({
              title: "技能工作区暂不支持技能管理弹窗",
              status: "info",
              duration: 1800,
            });
          }}
          onProjectNameChange={(v) => {
            setSkillName(v);
          }}
        />

        <SandpackProvider
          template={DEFAULT_TEMPLATE}
          files={sandpackFiles}
          customSetup={customSetup}
          theme={githubLight}
          options={{ autorun: false }}
        >
          <CodeChangeListener
            token={workspaceId}
            template={DEFAULT_TEMPLATE}
            onSaveStatusChange={setSaveStatus}
            onFilesChange={(nextFiles) => {
              latestFilesRef.current = normalizeSkillFiles(nextFiles);
            }}
            onPersistFiles={persistSkillFiles}
          />

          <Flex ref={mainRef} as="main" align="stretch" gap={0} flex="1" minH="0" h={workspaceHeight}>
            <Box
              flex="0 0 auto"
              minW="300px"
              maxW="728px"
              w={`${chatWidth}px`}
              alignSelf="stretch"
              h="100%"
              minH="0"
            >
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
                    projectToken,
                    skillId,
                  }}
                  hideSkillsManager
                  autoCreateInitialConversation={false}
                  roundTop
                  defaultHeaderTitle="技能助手"
                  emptyStateTitle="创建你的第一个技能"
                  emptyStateDescription="先用一句话描述能力目标，我会生成 SKILL.md 并同步到右侧文件。"
                  defaultSelectedSkill="skill-creator"
                  fileOptions={Object.keys(sandpackFiles).sort((a, b) => a.localeCompare(b))}
                  skillsProjectToken={projectToken || undefined}
                  onFilesUpdated={handleAgentFilesUpdated}
                />
              )}
            </Box>

            <Box
              w="0"
              cursor="col-resize"
              bg="transparent"
              position="relative"
              flexShrink={0}
              _before={{
                content: '""',
                position: "absolute",
                left: "-5px",
                top: 0,
                width: "10px",
                height: "100%",
                cursor: "col-resize",
              }}
              _hover={{ bg: "transparent" }}
=======
        <Flex
          as="header"
          align="center"
          justify="space-between"
          border="1px solid rgba(255,255,255,0.7)"
          bg="rgba(255,255,255,0.75)"
          backdropFilter="blur(18px)"
          borderRadius="2xl"
          px={4}
          py={3}
          boxShadow="0 18px 40px -24px rgba(15, 23, 42, 0.25)"
        >
          <Flex align="center" gap={3} minW={0}>
            <Button
              size="sm"
              variant="ghost"
              leftIcon={<BackIcon />}
              onClick={() => {
                if (window.history.length > 1) {
                  router.back();
                  return;
                }
                void router.push("/");
              }}
            >
              返回
            </Button>
            <Text fontSize="md" fontWeight="700" color="myGray.800" noOfLines={1}>
              技能工作区
            </Text>
            <Text fontSize="sm" color="myGray.500" noOfLines={1}>
              统一编辑器视图
            </Text>
          </Flex>

          <Text fontSize="xs" color={saveStatus === "error" ? "red.500" : "myGray.500"}>
            {saveStatus === "saving"
              ? "保存中..."
              : saveStatus === "saved"
              ? "已保存"
              : saveStatus === "error"
              ? "保存失败"
              : "自动保存"}
          </Text>
        </Flex>

        <SandpackProvider
          template={DEFAULT_TEMPLATE}
          files={sandpackFiles}
          customSetup={customSetup}
          theme={githubLight}
          options={{ autorun: false }}
        >
          <CodeChangeListener
            token={workspaceId}
            template={DEFAULT_TEMPLATE}
            onSaveStatusChange={setSaveStatus}
            onFilesChange={(nextFiles) => {
              latestFilesRef.current = normalizeSkillFiles(nextFiles);
            }}
            onPersistFiles={persistSkillFiles}
          />

          <Flex ref={mainRef} as="main" align="stretch" gap={0} flex="1" minH="0" h={workspaceHeight}>
            <Box
              flex="0 0 auto"
              minW="300px"
              maxW="728px"
              w={`${chatWidth}px`}
              alignSelf="stretch"
              h="100%"
              minH="0"
            >
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
                    projectToken,
                  }}
                  hideSkillsManager
                  autoCreateInitialConversation={false}
                  roundTop
                  defaultHeaderTitle="技能助手"
                  emptyStateTitle="创建你的第一个技能"
                  emptyStateDescription="先用一句话描述能力目标，我会生成 SKILL.md 并同步到右侧文件。"
                  defaultSelectedSkill="skill-creator"
                  fileOptions={Object.keys(sandpackFiles).sort((a, b) => a.localeCompare(b))}
                  skillsProjectToken={projectToken || undefined}
                  onFilesUpdated={handleAgentFilesUpdated}
                />
              )}
            </Box>

            <Box
              w="10px"
              cursor="col-resize"
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
              _hover={{
                bg: "rgba(148,163,184,0.12)",
                _before: { background: "rgba(71,85,105,0.5)" },
              }}
>>>>>>> aiid/dev
              onMouseDown={() => {
                resizingRef.current = true;
              }}
            />

            <WorkspaceShell
              token={workspaceId || projectToken}
              status={workspaceStatus}
              error={bootstrapError}
              activeView={activeView}
              onChangeView={setActiveView}
              workspaceMode="skills"
<<<<<<< HEAD
              saveStatus={saveStatus}
              onManualPreview={() => setActiveView("preview")}
              onManualSave={() => {
                if (isWorkspaceReady && latestFilesRef.current) {
                  void persistSkillFiles(latestFilesRef.current);
                  toast({
                    title: "已保存技能文件",
                    status: "success",
                    duration: 2000,
                  });
                }
              }}
              onManualShare={() => {
                toast({
                  title: "发布功能暂未实现",
                  status: "info",
                  duration: 1800,
                });
              }}
=======
>>>>>>> aiid/dev
              onPersistFiles={persistSkillFiles}
              filePathFilter={isSkillPath}
              defaultFolderPath={SKILL_ROOT}
              customStatusBadge={{
                text: isValidatingSkills
                  ? "校验中"
                  : skillsValidationIssueCount > 0
                  ? `校验失败 ${skillsValidationIssueCount}`
                  : "校验 Skills",
                colorScheme: isValidatingSkills ? "orange" : skillsValidationIssueCount > 0 ? "red" : "green",
                title: skillsValidationMessage || "点击立即校验 Skills",
                clickable: !isValidatingSkills,
                onClick: () => {
                  void handleValidateSkills(false);
                },
              }}
            />
          </Flex>
        </SandpackProvider>
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

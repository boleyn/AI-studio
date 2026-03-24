import {
  Box,
  Button,
  Flex,
  FormControl,
  FormLabel,
  Input,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Spinner,
  Text,
  Textarea,
  useToast,
} from "@chakra-ui/react";
import { SandpackProvider } from "@codesandbox/sandpack-react";
import { githubLight } from "@codesandbox/sandpack-themes";
import type { GetServerSideProps } from "next";
import dynamic from "next/dynamic";
import { useRouter } from "next/router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import CodeChangeListener, { type SaveStatus } from "@/components/CodeChangeListener";
import WorkspaceShell from "@/components/WorkspaceShell";
import TopBar from "@/components/TopBar";
import { withAuthHeaders } from "@features/auth/client/authClient";
import ChatPanel from "@features/chat/components/ChatPanel";
import { buildSandpackCustomSetup } from "@shared/sandpack/registry";
import { getAuthUserFromRequest } from "@server/auth/ssr";

type FileMap = Record<string, { code: string }>;
const MonacoDiffEditor = dynamic(
  () => import("@monaco-editor/react").then((mod) => mod.DiffEditor),
  { ssr: false }
);

type ActiveView = "preview" | "code" | "logs";
type PublishDraft = {
  slug: string;
  displayName: string;
  summary: string;
  tags: string;
  changelog: string;
  version: string;
  latestVersion: string;
  fileCount: number;
};
type ImportVersionCheck = {
  incomingVersion: string;
  localVersion: string;
  sameVersion: boolean;
};
type ImportDiffStatus = "added" | "removed" | "changed" | "same";
type ImportDiffItem = {
  path: string;
  status: ImportDiffStatus;
  localCode: string;
  incomingCode: string;
};
type ImportDiffPayload = {
  files: ImportDiffItem[];
  summary: {
    added: number;
    removed: number;
    changed: number;
    same: number;
  };
};
type ImportConflictDraft = {
  skillId: string;
  skillName: string;
  versionCheck: ImportVersionCheck;
  importDiff: ImportDiffPayload;
};

const SKILL_ROOT = "/";
const isSkillPath = (path: string) => /^\/[^/]+\/.+/.test(path);
const RUNTIME_ENTRY_PATH = "/__skill_runtime__/index.ts";
const RUNTIME_ENTRY_CODE = "export {};\n";
const fallbackSkillFiles: FileMap = {};
const isNonEmptyString = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const isRuntimeSupportPath = (path: string) => /^\/__skill_runtime__(\/|$)/i.test(path);
const diffStatusLabelMap: Record<ImportDiffStatus, string> = {
  added: "新增",
  removed: "删除",
  changed: "修改",
  same: "相同",
};
const languageByExt: Record<string, string> = {
  js: "javascript",
  jsx: "javascript",
  ts: "typescript",
  tsx: "typescript",
  json: "json",
  css: "css",
  scss: "scss",
  less: "less",
  html: "html",
  md: "markdown",
  yml: "yaml",
  yaml: "yaml",
  xml: "xml",
  sh: "shell",
  py: "python",
  java: "java",
  go: "go",
  rs: "rust",
};
const getDiffLanguage = (filePath: string) => {
  const ext = filePath.split(".").pop()?.toLowerCase() || "";
  return languageByExt[ext] || "plaintext";
};

const normalizeSkillFiles = (rawFiles: unknown): FileMap => {
  if (!rawFiles || typeof rawFiles !== "object") return {};

  const next: FileMap = {};
  Object.entries(rawFiles as Record<string, unknown>).forEach(([path, value]) => {
    if (!isSkillPath(path)) return;
    if (isRuntimeSupportPath(path)) return;

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
  const [skillName, setSkillName] = useState("未命名技能");
  const [isValidatingSkills, setIsValidatingSkills] = useState(false);
  const [skillsValidationIssueCount, setSkillsValidationIssueCount] = useState(0);
  const [skillsValidationMessage, setSkillsValidationMessage] = useState("");
  const [skillsValidationUpdatedAt, setSkillsValidationUpdatedAt] = useState("");
  const [isPublishingToHub, setIsPublishingToHub] = useState(false);
  const [isPublishDialogOpen, setIsPublishDialogOpen] = useState(false);
  const [isLoadingPublishPreview, setIsLoadingPublishPreview] = useState(false);
  const [publishPreviewError, setPublishPreviewError] = useState("");
  const [publishDraft, setPublishDraft] = useState<PublishDraft>({
    slug: "",
    displayName: "",
    summary: "",
    tags: "latest",
    changelog: "Published from AI Studio",
    version: "1.0.0",
    latestVersion: "",
    fileCount: 0,
  });
  const [publishResult, setPublishResult] = useState<{ slug: string; version: string; skillUrl: string } | null>(
    null
  );
  const [isImportConflictOpen, setIsImportConflictOpen] = useState(false);
  const [isResolvingImportConflict, setIsResolvingImportConflict] = useState(false);
  const [importConflictDraft, setImportConflictDraft] = useState<ImportConflictDraft | null>(null);
  const [importConflictSelectedPath, setImportConflictSelectedPath] = useState("");

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
  const conversationId = useMemo(
    () => (typeof router.query.conversation === "string" ? router.query.conversation.trim() : ""),
    [router.query.conversation]
  );
  const skillId = useMemo(
    () => (typeof router.query.skillId === "string" ? router.query.skillId.trim() : ""),
    [router.query.skillId]
  );
  const hubSlug = useMemo(
    () => (typeof router.query.hubSlug === "string" ? router.query.hubSlug.trim() : ""),
    [router.query.hubSlug]
  );
  const hubKey = useMemo(
    () => (typeof router.query.key === "string" ? router.query.key.trim() : ""),
    [router.query.key]
  );
  useEffect(() => {
    if (skillId || hubSlug) {
      setSkillName(skillId || hubSlug);
    }
  }, [hubSlug, skillId]);

  const normalizeCreateRoute = useCallback(
    (nextSkillId: string) => {
      if (!router.isReady || !nextSkillId) return;
      const query: Record<string, string> = { skillId: nextSkillId };
      if (conversationId) query.conversation = conversationId;
      if (projectToken) query.projectToken = projectToken;
      void router.replace(
        {
          pathname: "/skills/create",
          query,
        },
        undefined,
        { shallow: true }
      );
    },
    [conversationId, projectToken, router]
  );

  const isWorkspaceReady = !isBootstrapping && !bootstrapError && Boolean(workspaceId);

  useEffect(() => {
    if (!router.isReady) return;

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
            hubSlug: hubSlug || undefined,
            hubKey: hubKey || undefined,
          }),
        });

        const payload = (await res.json().catch(() => ({}))) as {
          error?: string;
          workspaceId?: string;
          skillId?: string;
          files?: unknown;
          overwriteRequired?: boolean;
          versionCheck?: Partial<ImportVersionCheck>;
          importDiff?: Partial<ImportDiffPayload>;
        };
        if (!res.ok) {
          throw new Error(typeof payload?.error === "string" ? payload.error : "创建 workspace 失败");
        }
        if (cancelled) return;

        const nextWorkspaceId =
          typeof payload.workspaceId === "string" && payload.workspaceId.trim()
            ? payload.workspaceId.trim()
            : skillId || projectToken || hubSlug;
        const nextFiles = normalizeSkillFiles(payload.files);

        setWorkspaceId(nextWorkspaceId);
        setFiles(nextFiles);
        latestFilesRef.current = nextFiles;
        if (hubSlug && hubKey) {
          normalizeCreateRoute(nextWorkspaceId);
        }

        if (payload.overwriteRequired && payload.skillId) {
          const normalizedDiffFiles = Array.isArray(payload.importDiff?.files)
            ? payload.importDiff.files
                .filter(
                  (item): item is ImportDiffItem =>
                    typeof item?.path === "string" &&
                    (item?.status === "added" ||
                      item?.status === "removed" ||
                      item?.status === "changed" ||
                      item?.status === "same")
                )
                .map((item) => ({
                  path: item.path,
                  status: item.status,
                  localCode: typeof item.localCode === "string" ? item.localCode : "",
                  incomingCode: typeof item.incomingCode === "string" ? item.incomingCode : "",
                }))
            : [];
          const normalizedDiff: ImportDiffPayload = {
            files: normalizedDiffFiles,
            summary: {
              added: Number(payload.importDiff?.summary?.added || 0),
              removed: Number(payload.importDiff?.summary?.removed || 0),
              changed: Number(payload.importDiff?.summary?.changed || 0),
              same: Number(payload.importDiff?.summary?.same || 0),
            },
          };
          const nextVersionCheck: ImportVersionCheck = {
            incomingVersion: payload.versionCheck?.incomingVersion || "",
            localVersion: payload.versionCheck?.localVersion || "",
            sameVersion: Boolean(payload.versionCheck?.sameVersion),
          };
          setImportConflictDraft({
            skillId: payload.skillId,
            skillName: hubSlug || skillName || payload.skillId,
            versionCheck: nextVersionCheck,
            importDiff: normalizedDiff,
          });
          const changedFirst =
            normalizedDiff.files.find((item) => item.status !== "same")?.path || normalizedDiff.files[0]?.path || "";
          setImportConflictSelectedPath(changedFirst);
          setIsImportConflictOpen(true);
        } else {
          setImportConflictDraft(null);
          setImportConflictSelectedPath("");
          setIsImportConflictOpen(false);
        }
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
  }, [hubKey, hubSlug, normalizeCreateRoute, projectToken, router.isReady, skillId, skillName]);

  const resolveImportConflictByOverwrite = useCallback(async () => {
    if (!hubSlug || !hubKey || !importConflictDraft?.skillId) return;
    setIsResolvingImportConflict(true);
    try {
      const res = await fetch("/api/skills/workspaces/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...withAuthHeaders(),
        },
        body: JSON.stringify({
          hubSlug,
          hubKey,
          importStrategy: "overwrite",
          targetSkillId: importConflictDraft.skillId,
        }),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        error?: string;
        workspaceId?: string;
        files?: unknown;
      };
      if (!res.ok) {
        throw new Error(payload.error || "覆盖导入失败");
      }
      const nextFiles = normalizeSkillFiles(payload.files);
      setWorkspaceId((payload.workspaceId || importConflictDraft.skillId).trim() || importConflictDraft.skillId);
      setFiles(nextFiles);
      latestFilesRef.current = nextFiles;
      normalizeCreateRoute((payload.workspaceId || importConflictDraft.skillId).trim() || importConflictDraft.skillId);
      setIsImportConflictOpen(false);
      toast({
        status: "success",
        title: "保存成功",
        description: "已同步 skill 文件。",
        duration: 2000,
        isClosable: true,
      });
    } catch (error) {
      toast({
        status: "error",
        title: "覆盖导入失败",
        description: error instanceof Error ? error.message : "请稍后重试",
        duration: 3200,
        isClosable: true,
      });
    } finally {
      setIsResolvingImportConflict(false);
    }
  }, [hubKey, hubSlug, importConflictDraft, normalizeCreateRoute, toast]);

  const persistSkillFiles = useCallback(
    async (nextFiles: FileMap) => {
      if (!workspaceId) {
        throw new Error("workspace 尚未初始化");
      }

      const normalized = normalizeSkillFiles(nextFiles);
      const queryParams = new URLSearchParams();
      if (projectToken) queryParams.set("projectToken", projectToken);
      if (skillId) queryParams.set("skillId", skillId);
      const query = queryParams.toString() ? `?${queryParams.toString()}` : "";
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
            skillId,
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
        setSkillsValidationUpdatedAt(new Date().toLocaleString("zh-CN", { hour12: false }));
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
        setSkillsValidationUpdatedAt(new Date().toLocaleString("zh-CN", { hour12: false }));
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

  const saveStatusRef = useRef<SaveStatus>("idle");
  useEffect(() => {
    const prev = saveStatusRef.current;
    saveStatusRef.current = saveStatus;
    if (prev !== "saved" && saveStatus === "saved" && isWorkspaceReady) {
      void handleValidateSkills(true);

      // 保存成功后尝试从文件中重新解析一次名字
      const nameInFiles = getSkillNameFromFiles(latestFilesRef.current);
      if (nameInFiles && nameInFiles !== skillName) {
        setSkillName(nameInFiles);
      }
    }
  }, [getSkillNameFromFiles, handleValidateSkills, isWorkspaceReady, saveStatus, skillName]);

  useEffect(() => {
    if (!isWorkspaceReady) return;
    void handleValidateSkills(true);

    // 初始化准备好后也尝试拉取一次名字
    const nameInFiles = getSkillNameFromFiles(latestFilesRef.current);
    if (nameInFiles) {
      setSkillName(nameInFiles);
    }
  }, [getSkillNameFromFiles, handleValidateSkills, isWorkspaceReady]);

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
  const sandpackRuntimeFiles = useMemo<FileMap>(() => {
    return {
      ...sandpackFiles,
      [RUNTIME_ENTRY_PATH]: {
        code: RUNTIME_ENTRY_CODE,
      },
    };
  }, [sandpackFiles]);

  const customSetup = useMemo(
    () => ({
      ...buildSandpackCustomSetup({}),
      environment: "static" as const,
      entry: RUNTIME_ENTRY_PATH,
    }),
    []
  );
  const skillRoots = useMemo(() => {
    const roots = new Set<string>();
    Object.keys(files).forEach((path) => {
      const skillRootMatch = path.match(/^\/[^/]+\/SKILL\.md$/i);
      if (!skillRootMatch) return;
      roots.add(skillRootMatch[0].replace(/\/SKILL\.md$/i, ""));
    });
    return roots;
  }, [files]);
  const skillFilePathFilter = useCallback(
    (path: string) => {
      if (!isSkillPath(path)) return false;
      const root = path.match(/^\/[^/]+/)?.[0] || "";
      if (!root || skillRoots.size === 0) return false;
      return skillRoots.has(root);
    },
    [skillRoots]
  );

  const openPublishDialog = useCallback(async () => {
    if (!isWorkspaceReady || !workspaceId) {
      toast({
        title: "工作区尚未准备好",
        status: "warning",
        duration: 1800,
      });
      return;
    }

    setIsPublishDialogOpen(true);
    setPublishResult(null);
    setPublishPreviewError("");
    setIsLoadingPublishPreview(true);
    try {
      const response = await fetch("/api/skills/publish-to-hub", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...withAuthHeaders(),
        },
        body: JSON.stringify({
          preview: true,
          workspaceId,
          projectToken: projectToken || undefined,
          skillId: skillId || undefined,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        preview?: {
          slug?: string;
          displayName?: string;
          summary?: string;
          tags?: string[];
          changelog?: string;
          version?: string;
          latestVersion?: string;
          fileCount?: number;
        };
      };
      if (!response.ok) {
        throw new Error(payload.error || "加载发布信息失败");
      }
      setPublishDraft({
        slug: payload.preview?.slug || skillName || "",
        displayName: payload.preview?.displayName || skillName || "",
        summary: payload.preview?.summary || "",
        tags: Array.isArray(payload.preview?.tags) ? payload.preview?.tags.join(", ") : "latest",
        changelog: payload.preview?.changelog || "Published from AI Studio",
        version: payload.preview?.version || "1.0.0",
        latestVersion: payload.preview?.latestVersion || "",
        fileCount: Number(payload.preview?.fileCount || 0),
      });
    } catch (error) {
      setPublishPreviewError(error instanceof Error ? error.message : "加载发布信息失败");
    } finally {
      setIsLoadingPublishPreview(false);
    }
  }, [isWorkspaceReady, projectToken, skillId, skillName, toast, workspaceId]);

  const confirmPublishToHub = useCallback(async () => {
    if (!workspaceId || isPublishingToHub) return;
    setIsPublishingToHub(true);
    setPublishPreviewError("");
    try {
      const response = await fetch("/api/skills/publish-to-hub", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...withAuthHeaders(),
        },
        body: JSON.stringify({
          workspaceId,
          projectToken: projectToken || undefined,
          skillId: skillId || undefined,
          slug: publishDraft.slug,
          displayName: publishDraft.displayName,
          summary: publishDraft.summary,
          tags: publishDraft.tags,
          changelog: publishDraft.changelog,
          version: publishDraft.version,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        slug?: string;
        version?: string;
        skillUrl?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error || "发布失败");
      }
      const nextResult = {
        slug: payload.slug || publishDraft.slug,
        version: payload.version || publishDraft.version,
        skillUrl: payload.skillUrl || "",
      };
      setPublishResult(nextResult);
      toast({
        title: `发布成功：${nextResult.slug}`,
        description: `版本 ${nextResult.version}`,
        status: "success",
        duration: 2600,
        isClosable: true,
      });
    } catch (error) {
      setPublishPreviewError(error instanceof Error ? error.message : "发布失败");
    } finally {
      setIsPublishingToHub(false);
    }
  }, [isPublishingToHub, projectToken, publishDraft, skillId, toast, workspaceId]);

  return (
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

        {isWorkspaceReady && Object.keys(sandpackFiles).length > 0 ? (
          <SandpackProvider
            files={sandpackRuntimeFiles}
            customSetup={customSetup}
            theme={githubLight}
            options={{ autorun: false }}
          >
            <CodeChangeListener
              token={workspaceId}
              template="skills"
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
                  void openPublishDialog();
                }}
                shareLabel={isPublishingToHub ? "发布中..." : "一键发布"}
                shareAriaLabel="一键发布到 ClawHub"
                onPersistFiles={persistSkillFiles}
                filePathFilter={skillFilePathFilter}
                defaultFolderPath={SKILL_ROOT}
                skillsValidationLog={{
                  status: isValidatingSkills
                    ? "validating"
                    : skillsValidationIssueCount > 0
                    ? "fail"
                    : skillsValidationMessage
                    ? "pass"
                    : "idle",
                  issueCount: skillsValidationIssueCount,
                  message: skillsValidationMessage,
                  updatedAt: skillsValidationUpdatedAt,
                }}
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
        ) : (
          <Flex
            ref={mainRef}
            as="main"
            align="center"
            justify="center"
            gap={2}
            flex="1"
            minH="0"
            h={workspaceHeight}
            color="myGray.500"
          >
            {isBootstrapping ? <Spinner size="sm" /> : null}
            <Text fontSize="sm">
              {isBootstrapping ? "正在初始化技能工作区..." : bootstrapError || "工作区暂无 skill 文件"}
            </Text>
          </Flex>
        )}
      </Flex>

      <Modal
        isOpen={isImportConflictOpen}
        onClose={() => {
          if (isResolvingImportConflict) return;
          if (importConflictDraft?.skillId) {
            normalizeCreateRoute(importConflictDraft.skillId);
          }
          setIsImportConflictOpen(false);
        }}
        size="6xl"
        isCentered
      >
        <ModalOverlay />
        <ModalContent maxW="min(1400px, 96vw)" w="96vw" maxH="92vh">
          <ModalHeader>发现同名 Skill</ModalHeader>
          <ModalCloseButton isDisabled={isResolvingImportConflict} />
          <ModalBody overflowY="auto">
            <Text fontSize="sm" color="myGray.700" mb={3}>
              当前账号下已存在同名 skill：{importConflictDraft?.skillName || hubSlug}
            </Text>
            <Box
              border="1px solid"
              borderColor="rgba(148,163,184,0.35)"
              borderRadius="10px"
              px={3}
              py={2.5}
              bg="rgba(15,23,42,0.03)"
            >
              <Text fontSize="sm" color="myGray.700">
                本地版本：{importConflictDraft?.versionCheck.localVersion || "未读取到"}
              </Text>
              <Text fontSize="sm" color="myGray.700">
                远端版本：{importConflictDraft?.versionCheck.incomingVersion || "未读取到"}
              </Text>
            </Box>
            <Text mt={3} fontSize="sm" color={importConflictDraft?.versionCheck.sameVersion ? "orange.600" : "blue.600"}>
              {importConflictDraft?.versionCheck.sameVersion
                ? "版本相同，是否仍要覆盖本地 skill 文件？"
                : "版本不同，是否用 ClawHub 版本覆盖本地 skill 文件？"}
            </Text>
            <Text mt={2} fontSize="xs" color="myGray.500">
              仅覆盖 skill 相关文件，不会重置当前对话记录。
            </Text>
            <Box mt={4}>
              <Flex align="center" gap={2} wrap="wrap" mb={2}>
                <Text fontSize="xs" color="myGray.500">
                  文件变化：
                </Text>
                <Text fontSize="xs" color="blue.600">
                  新增 {importConflictDraft?.importDiff.summary.added || 0}
                </Text>
                <Text fontSize="xs" color="orange.600">
                  删除 {importConflictDraft?.importDiff.summary.removed || 0}
                </Text>
                <Text fontSize="xs" color="purple.600">
                  修改 {importConflictDraft?.importDiff.summary.changed || 0}
                </Text>
                <Text fontSize="xs" color="green.600">
                  相同 {importConflictDraft?.importDiff.summary.same || 0}
                </Text>
              </Flex>
              <Flex
                border="1px solid"
                borderColor="rgba(148,163,184,0.3)"
                borderRadius="10px"
                overflow="hidden"
                h="min(62vh, 680px)"
              >
                <Box w="38%" borderRight="1px solid" borderColor="rgba(148,163,184,0.3)" overflowY="auto" bg="rgba(15,23,42,0.02)">
                  {(importConflictDraft?.importDiff.files || []).map((file) => (
                    <Button
                      key={`${file.status}-${file.path}`}
                      variant="ghost"
                      justifyContent="flex-start"
                      w="100%"
                      h="auto"
                      py={2}
                      px={3}
                      borderRadius={0}
                      bg={importConflictSelectedPath === file.path ? "rgba(59,130,246,0.1)" : "transparent"}
                      onClick={() => setImportConflictSelectedPath(file.path)}
                    >
                      <Flex align="center" gap={2} minW={0}>
                        <Text
                          fontSize="11px"
                          color={
                            file.status === "added"
                              ? "blue.600"
                              : file.status === "removed"
                              ? "orange.600"
                              : file.status === "changed"
                              ? "purple.600"
                              : "green.600"
                          }
                          minW="38px"
                        >
                          {diffStatusLabelMap[file.status]}
                        </Text>
                        <Text fontSize="12px" color="myGray.700" noOfLines={1}>
                          {file.path}
                        </Text>
                      </Flex>
                    </Button>
                  ))}
                </Box>
                <Box w="62%" overflow="hidden" display="flex" flexDirection="column">
                  {(() => {
                    const selected = (importConflictDraft?.importDiff.files || []).find(
                      (item) => item.path === importConflictSelectedPath
                    );
                    if (!selected) {
                      return (
                        <Flex flex={1} align="center" justify="center">
                          <Text fontSize="12px" color="myGray.500">
                            请选择文件查看改动
                          </Text>
                        </Flex>
                      );
                    }
                    return (
                      <Flex flex={1} direction="column" minH={0}>
                        <Flex px={3} py={2} borderBottom="1px solid" borderColor="rgba(148,163,184,0.25)" bg="rgba(15,23,42,0.02)">
                          <Text fontSize="12px" color="myGray.700" noOfLines={1}>
                            {selected.path}
                          </Text>
                        </Flex>
                        <Flex flex={1} minH={0}>
                          <Box w="100%" display="flex" flexDirection="column" minH={0}>
                            <Text
                              px={2.5}
                              py={1.5}
                              fontSize="11px"
                              color="myGray.500"
                              borderBottom="1px solid"
                              borderColor="rgba(148,163,184,0.2)"
                            >
                              本地（左） / ClawHub（右）差异对比
                            </Text>
                            <Box flex={1} minH={0} bg="white">
                              <MonacoDiffEditor
                                original={selected.localCode || ""}
                                modified={selected.incomingCode || ""}
                                language={getDiffLanguage(selected.path)}
                                theme="vs"
                                options={{
                                  readOnly: true,
                                  automaticLayout: true,
                                  renderSideBySide: true,
                                  minimap: { enabled: false },
                                  scrollBeyondLastLine: false,
                                  wordWrap: "on",
                                  ignoreTrimWhitespace: false,
                                  lineNumbers: "on",
                                }}
                                width="100%"
                                height="100%"
                              />
                            </Box>
                          </Box>
                        </Flex>
                      </Flex>
                    );
                  })()}
                </Box>
              </Flex>
            </Box>
          </ModalBody>
          <ModalFooter>
            <Button
              mr={3}
              variant="whitePrimary"
              isDisabled={isResolvingImportConflict}
              onClick={() => {
                if (importConflictDraft?.skillId) {
                  normalizeCreateRoute(importConflictDraft.skillId);
                }
                setIsImportConflictOpen(false);
              }}
            >
              保持本地
            </Button>
            <Button
              variant="primary"
              isLoading={isResolvingImportConflict}
              onClick={() => {
                void resolveImportConflictByOverwrite();
              }}
            >
              覆盖 skill 文件
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <Modal
        isOpen={isPublishDialogOpen}
        onClose={() => {
          if (isPublishingToHub) return;
          setIsPublishDialogOpen(false);
          setPublishResult(null);
          setPublishPreviewError("");
        }}
        size="4xl"
        isCentered
      >
        <ModalOverlay />
        <ModalContent maxW="min(980px, 94vw)" w="94vw" maxH="90vh">
          <ModalHeader borderBottom="1px solid" borderColor="myGray.200" pb={4}>
            <Flex direction="column" gap={1}>
              <Text fontSize="12px" color="primary.600" fontWeight="700" textTransform="uppercase" letterSpacing="0.08em">
                Publish Flow
              </Text>
              <Text fontSize="34px" lineHeight="1.05" fontWeight="800" color="myGray.900">
                一键发布到 ClawHub
              </Text>
              <Text fontSize="sm" color="myGray.500">
                校验元信息后发布到 Hub，默认版本按 patch 自动递增。
              </Text>
            </Flex>
          </ModalHeader>
          <ModalCloseButton isDisabled={isPublishingToHub} />
          <ModalBody overflowY="auto" py={5}>
            {isLoadingPublishPreview ? (
              <Flex align="center" justify="center" py={12} gap={2}>
                <Spinner size="sm" />
                <Text fontSize="sm">加载发布信息...</Text>
              </Flex>
            ) : publishResult ? (
              <Box
                borderRadius="16px"
                border="1px solid"
                borderColor="primary.200"
                bg="primary.50"
                p={5}
              >
                <Text fontSize="md" color="primary.700" mb={1} fontWeight="700">
                  发布成功：{publishResult.slug} v{publishResult.version}
                </Text>
                <Text fontSize="sm" color="myGray.600">是否跳转到 ClawHub 查看详情？</Text>
              </Box>
            ) : (
              <Flex direction="column" gap={4}>
                <Flex
                  borderRadius="14px"
                  border="1px solid"
                  borderColor="myGray.200"
                  bg="myGray.50"
                  px={4}
                  py={3}
                  align="center"
                  justify="space-between"
                >
                  <Text fontSize="13px" color="myGray.600">发布文件数</Text>
                  <Text fontSize="20px" fontWeight="800" color="primary.700">
                    {publishDraft.fileCount}
                  </Text>
                </Flex>

                <FormControl>
                  <FormLabel color="myGray.700" fontWeight="700">Slug</FormLabel>
                  <Input
                    value={publishDraft.slug}
                    onChange={(event) => setPublishDraft((prev) => ({ ...prev, slug: event.target.value }))}
                    focusBorderColor="primary.400"
                  />
                </FormControl>
                <FormControl>
                  <FormLabel color="myGray.700" fontWeight="700">显示名</FormLabel>
                  <Input
                    value={publishDraft.displayName}
                    onChange={(event) => setPublishDraft((prev) => ({ ...prev, displayName: event.target.value }))}
                    focusBorderColor="primary.400"
                  />
                </FormControl>
                <FormControl>
                  <FormLabel color="myGray.700" fontWeight="700">简介</FormLabel>
                  <Textarea
                    value={publishDraft.summary}
                    onChange={(event) => setPublishDraft((prev) => ({ ...prev, summary: event.target.value }))}
                    rows={3}
                    focusBorderColor="primary.400"
                  />
                </FormControl>
                <Flex gap={3}>
                  <FormControl>
                    <FormLabel color="myGray.700" fontWeight="700">版本（默认 patch +1）</FormLabel>
                    <Input
                      value={publishDraft.version}
                      onChange={(event) => setPublishDraft((prev) => ({ ...prev, version: event.target.value }))}
                      focusBorderColor="primary.400"
                    />
                  </FormControl>
                  <FormControl>
                    <FormLabel color="myGray.700" fontWeight="700">当前线上版本</FormLabel>
                    <Input value={publishDraft.latestVersion || "尚无版本"} isReadOnly bg="myGray.100" />
                  </FormControl>
                </Flex>
                <FormControl>
                  <FormLabel color="myGray.700" fontWeight="700">标签（逗号分隔）</FormLabel>
                  <Input
                    value={publishDraft.tags}
                    onChange={(event) => setPublishDraft((prev) => ({ ...prev, tags: event.target.value }))}
                    focusBorderColor="primary.400"
                  />
                </FormControl>
                <FormControl>
                  <FormLabel color="myGray.700" fontWeight="700">更新说明</FormLabel>
                  <Textarea
                    value={publishDraft.changelog}
                    onChange={(event) => setPublishDraft((prev) => ({ ...prev, changelog: event.target.value }))}
                    rows={4}
                    focusBorderColor="primary.400"
                  />
                </FormControl>
                <Text fontSize="xs" color="myGray.500">
                  将发布 {publishDraft.fileCount} 个文件（来源：当前 skill 工作区）
                </Text>
              </Flex>
            )}
            {publishPreviewError ? (
              <Box mt={3} borderRadius="12px" border="1px solid" borderColor="red.200" bg="red.50" px={3} py={2}>
                <Text fontSize="sm" color="red.700">{publishPreviewError}</Text>
              </Box>
            ) : null}
          </ModalBody>
          <ModalFooter borderTop="1px solid" borderColor="myGray.200">
            {publishResult ? (
              <>
                <Button
                  mr={3}
                  variant="primary"
                  onClick={() => {
                    if (isNonEmptyString(publishResult.skillUrl) && typeof window !== "undefined") {
                      window.open(publishResult.skillUrl, "_blank", "noopener,noreferrer");
                    }
                    setIsPublishDialogOpen(false);
                    setPublishResult(null);
                    setPublishPreviewError("");
                  }}
                >
                  跳转 ClawHub
                </Button>
                <Button
                  variant="whitePrimary"
                  onClick={() => {
                    setIsPublishDialogOpen(false);
                    setPublishResult(null);
                    setPublishPreviewError("");
                  }}
                >
                  关闭
                </Button>
              </>
            ) : (
              <>
                <Button
                  mr={3}
                  variant="whitePrimary"
                  isDisabled={isPublishingToHub}
                  onClick={() => {
                    setIsPublishDialogOpen(false);
                    setPublishResult(null);
                    setPublishPreviewError("");
                  }}
                >
                  取消
                </Button>
                <Button
                  variant="primary"
                  isLoading={isPublishingToHub}
                  isDisabled={isLoadingPublishPreview || !isNonEmptyString(publishDraft.slug)}
                  onClick={() => {
                    void confirmPublishToHub();
                  }}
                >
                  确定发布
                </Button>
              </>
            )}
          </ModalFooter>
        </ModalContent>
      </Modal>
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

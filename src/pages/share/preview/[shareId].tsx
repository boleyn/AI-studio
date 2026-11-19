import { sitePreviewPath } from "@/types/library";
import LibraryConnectors from "@/components/agent-workspace/LibraryConnectors";
import { getMongoDb } from "@server/db/mongo";
import Head from "next/head";
import { useEffect, useMemo, useState } from "react";
import type { GetServerSideProps } from "next";
import { Box, Button, Flex } from "@chakra-ui/react";
import { SandpackProvider, SandpackPreview, SandpackStack, type SandpackPredefinedTemplate } from "@codesandbox/sandpack-react";
import { githubLight } from "@codesandbox/sandpack-themes";

import type { SandpackFiles } from "../../../components/StudioShell";
import { getAuthUserFromRequest } from "@server/auth/ssr";
import { canViewRestrictedSite, getSiteSettings } from "@server/library/sites";
import { getProject } from "@server/projects/projectStorage";
import { recordSiteVisit } from "@server/shares/siteVisits";
import { getShareLink } from "@server/shares/shareStorage";
import { buildSandpackCustomSetup } from "@shared/sandpack/registry";

type PreviewProject = {
  token: string;
  name: string;
  template: SandpackPredefinedTemplate;
  files: SandpackFiles;
  dependencies: Record<string, string>;
  updatedAt: string;
};

type SharePreviewPageProps = {
  previewPath: string;
  shareId: string;
  initialProject: PreviewProject;
  driveEnabled: boolean;
  signedIn: boolean;
  connectorStatus: string | null;
};

type SharePayload = {
  mode: "editable" | "preview";
  project: PreviewProject;
};

const EMPTY_PROJECT_PLACEHOLDER_PATH = "/.ai-studio-empty.js";
const EMPTY_PROJECT_PROVIDER_FILES: SandpackFiles = {
  [EMPTY_PROJECT_PLACEHOLDER_PATH]: {
    code: "export default function EmptyProjectPlaceholder() { return null; }",
    hidden: true,
  },
};
const ENTRY_CANDIDATES = [
  "/src/main.tsx",
  "/src/main.jsx",
  "/src/main.ts",
  "/src/main.js",
  "/index.tsx",
  "/index.jsx",
  "/index.ts",
  "/index.js",
  "/main.tsx",
  "/main.jsx",
  "/main.ts",
  "/main.js",
  "/App.tsx",
  "/App.jsx",
  "/App.ts",
  "/App.js",
] as const;
const isVueLikeTemplate = (value: SandpackPredefinedTemplate | undefined): boolean =>
  value === "vue" || value === "vue-ts" || value === "vite-vue" || value === "vite-vue-ts";
const EXTERNAL_RESOURCE_HTML_CANDIDATES = ["/public/index.html", "/index.html"] as const;
const extractExternalResources = (files: SandpackFiles): string[] => {
  const resources = new Set<string>();
  const htmlPath = EXTERNAL_RESOURCE_HTML_CANDIDATES.find((path) => Boolean(files[path]));
  if (!htmlPath) return [];
  const html = files[htmlPath]?.code || "";
  if (!html) return [];

  const scriptSrcRegex = /<script[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>\s*<\/script>/gi;
  const stylesheetRegex = /<link[^>]*\brel\s*=\s*["']stylesheet["'][^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi;

  let match: RegExpExecArray | null = null;
  while ((match = scriptSrcRegex.exec(html)) !== null) {
    const url = (match[1] || "").trim();
    if (/^https?:\/\//i.test(url)) resources.add(url);
  }
  while ((match = stylesheetRegex.exec(html)) !== null) {
    const url = (match[1] || "").trim();
    if (/^https?:\/\//i.test(url)) resources.add(url);
  }

  return Array.from(resources);
};

const normalizeFiles = (rawFiles: unknown): SandpackFiles => {
  if (!rawFiles || typeof rawFiles !== "object") return {};
  const output: SandpackFiles = {};
  Object.entries(rawFiles as Record<string, unknown>).forEach(([path, value]) => {
    const trimmedPath = path.trim();
    if (!trimmedPath) return;
    const normalizedPath = trimmedPath.startsWith("/") ? trimmedPath : `/${trimmedPath}`;
    if (typeof value === "string") {
      output[normalizedPath] = { code: value };
      return;
    }
    if (
      value &&
      typeof value === "object" &&
      "code" in value &&
      typeof (value as { code?: unknown }).code === "string"
    ) {
      output[normalizedPath] = value as { code: string; hidden?: boolean };
    }
  });
  return output;
};

const SharePreviewPage = ({ shareId, previewPath, initialProject, driveEnabled, signedIn, connectorStatus }: SharePreviewPageProps) => {
  const [connectionsOpen,setConnectionsOpen] = useState(Boolean(connectorStatus));
  const [project, setProject] = useState<PreviewProject>({
    ...initialProject,
    files: normalizeFiles(initialProject.files),
  });

  const [unavailable, setUnavailable] = useState("");
  useEffect(() => {
    if (unavailable) return;
    const controller = new AbortController();
    let loading = false;
    const timer = window.setInterval(async () => {
      if (loading) return;
      loading = true;
      try {
        const response = await fetch(`/api/share/${encodeURIComponent(shareId)}`, {signal:controller.signal});
        if (response.status === 401) {
          window.location.replace("/login?lastRoute=" + encodeURIComponent(previewPath));
          return;
        }
        if (response.status === 403 || response.status === 404) {
          setUnavailable(response.status === 403 ? "当前账号已无权查看此站点。" : "此站点的分享链接已失效。");
          return;
        }
        if (!response.ok) return;
        const payload = (await response.json()) as SharePayload;
        if (payload.mode !== "preview") return;
        if (payload.project.updatedAt !== project.updatedAt) {
          setProject({
            ...payload.project,
            files: normalizeFiles(payload.project.files),
          });
        } else if (payload.project.name !== project.name) {
          setProject(current => ({...current, name:payload.project.name}));
        }
      } catch {
        // Keep the current preview during a temporary network outage.
      } finally {
        loading = false;
      }
    }, 5000);

    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [shareId, previewPath, project.updatedAt, project.name, unavailable]);

  const customSetup = useMemo(() => {
    return buildSandpackCustomSetup(project.dependencies);
  }, [project.dependencies, project.files]);
  const providerFiles = useMemo(() => {
    const files = (project.files || {}) as SandpackFiles;
    const hasRealFiles = Object.keys(files).some((filePath) => filePath !== "/package.json");
    return hasRealFiles ? files : EMPTY_PROJECT_PROVIDER_FILES;
  }, [project.files]);
  const providerCustomSetup = useMemo(() => {
    if (isVueLikeTemplate(project.template)) {
      return customSetup;
    }
    const entry =
      ENTRY_CANDIDATES.find((path) => Boolean(providerFiles[path])) || EMPTY_PROJECT_PLACEHOLDER_PATH;
    return {
      ...customSetup,
      entry,
    };
  }, [customSetup, providerFiles, project.template]);
  const providerExternalResources = useMemo(() => extractExternalResources(providerFiles), [providerFiles]);
  const sandpackRuntimeId = useMemo(
    () =>
      [
        shareId,
        project.token,
        project.updatedAt,
        project.template,
        Object.keys(providerFiles).sort().join("|"),
      ].join("::"),
    [project.template, project.token, project.updatedAt, providerFiles, shareId]
  );

  if (unavailable) return <Flex as="main" minH="100vh" align="center" justify="center">
    <Head><title>站点无法访问</title></Head><Box role="alert">{unavailable}</Box>
  </Flex>;
  return (
    <Flex direction="column" h="100vh" bg="gray.50" overflow="hidden">
      <Head><title>{project.name}</title></Head>
      {driveEnabled && <Flex justify="end" px={3} py={1}>
        <Button size="sm" variant="ghost" onClick={() => signedIn ? setConnectionsOpen(true) : window.location.assign("/login?lastRoute="+encodeURIComponent(previewPath))}>连接我的 Google Drive</Button>
      </Flex>}
      {driveEnabled && signedIn && connectionsOpen && <LibraryConnectors siteId={shareId} callbackStatus={connectorStatus || undefined} close={()=>setConnectionsOpen(false)}/>}
      <Box flex="1" minH="0" position="relative">
        <SandpackProvider
          key={sandpackRuntimeId}
          template={isVueLikeTemplate(project.template) ? project.template : undefined}
          files={providerFiles}
          customSetup={providerCustomSetup}
          theme={githubLight}
          options={{
            id: sandpackRuntimeId,
            autorun: true,
            experimental_enableServiceWorker: true,
            externalResources: providerExternalResources,
          }}
        >
          <SandpackStack
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
            }}
          >
            <SandpackPreview
              showNavigator={false}
              showOpenInCodeSandbox={false}
              style={{ width: "100%", height: "100%", border: 0 }}
            />
          </SandpackStack>
        </SandpackProvider>
      </Box>
    </Flex>
  );
};

export const getServerSideProps: GetServerSideProps<SharePreviewPageProps> = async (context) => {
  const shareId = typeof context.params?.shareId === "string" ? context.params.shareId : "";
  if (!shareId) {
    return { notFound: true };
  }

  const previewPath = sitePreviewPath(shareId, typeof context.params?.slug === "string" ? context.params.slug : undefined);
  const share = await getShareLink(shareId);
  if (!share || share.mode !== "preview") {
    return { notFound: true };
  }

  context.res.setHeader("Cache-Control", "private, no-store");
  const settings = await getSiteSettings(share.ownerUserId, share.projectToken);
  if (settings?.restricted) {
    const userId = getAuthUserFromRequest(context.req)?.sub;
    if (!userId) return {redirect:{destination:"/login?lastRoute="+encodeURIComponent(previewPath),permanent:false}};
    if (!await canViewRestrictedSite(share.ownerUserId, share.projectToken, userId)) return {notFound:true};
  }

  const project = await getProject(share.projectToken);
  if (!project) {
    return { notFound: true };
  }

  await recordSiteVisit(share, context.req.cookies.auth_token).catch(() => {
    console.warn("Could not record site preview visit");
  });

  return {
    props: {
      shareId,
      previewPath,
      driveEnabled: Boolean(await (await getMongoDb()).collection("site_plugins").findOne({owner:share.ownerUserId,projectToken:share.projectToken,id:"google-drive"},{projection:{_id:1}})),
      signedIn: Boolean(getAuthUserFromRequest(context.req)?.sub),
      connectorStatus: typeof context.query.libraryConnectors === "string" ? context.query.libraryConnectors : null,
      initialProject: {
        token: project.token,
        name: settings?.name || project.name,
        template: project.template as SandpackPredefinedTemplate,
        files: project.files,
        dependencies: project.dependencies || {},
        updatedAt: project.updatedAt,
      },
    },
  };
};

export default SharePreviewPage;

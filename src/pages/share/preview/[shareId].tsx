import { useEffect, useMemo, useState } from "react";
import type { GetServerSideProps } from "next";
import { Box, Flex } from "@chakra-ui/react";
import { SandpackProvider, SandpackPreview, SandpackStack, type SandpackPredefinedTemplate } from "@codesandbox/sandpack-react";
import { githubLight } from "@codesandbox/sandpack-themes";

import type { SandpackFiles } from "../../../components/StudioShell";
import { getProject } from "@server/projects/projectStorage";
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
  shareId: string;
  initialProject: PreviewProject;
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

const SharePreviewPage = ({ shareId, initialProject }: SharePreviewPageProps) => {
  const [project, setProject] = useState<PreviewProject>({
    ...initialProject,
    files: normalizeFiles(initialProject.files),
  });

  useEffect(() => {
    const timer = window.setInterval(async () => {
      try {
        const response = await fetch(`/api/share/${encodeURIComponent(shareId)}`);
        if (!response.ok) return;
        const payload = (await response.json()) as SharePayload;
        if (payload.mode !== "preview") return;
        if (payload.project.updatedAt !== project.updatedAt) {
          setProject({
            ...payload.project,
            files: normalizeFiles(payload.project.files),
          });
        }
      } catch {
        // ignore polling errors in preview mode
      }
    }, 5000);

    return () => {
      window.clearInterval(timer);
    };
  }, [shareId, project.updatedAt]);

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

  return (
    <Flex direction="column" h="100vh" bg="gray.50" overflow="hidden">
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

  const share = await getShareLink(shareId);
  if (!share || share.mode !== "preview") {
    return { notFound: true };
  }

  const project = await getProject(share.projectToken);
  if (!project) {
    return { notFound: true };
  }

  return {
    props: {
      shareId,
      initialProject: {
        token: project.token,
        name: project.name,
        template: project.template as SandpackPredefinedTemplate,
        files: project.files,
        dependencies: project.dependencies || {},
        updatedAt: project.updatedAt,
      },
    },
  };
};

export default SharePreviewPage;

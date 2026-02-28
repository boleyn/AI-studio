import { useEffect, useMemo, useState } from "react";
import type { GetServerSideProps } from "next";
import { Box, Flex } from "@chakra-ui/react";
import { SandpackProvider, SandpackPreview, SandpackStack, type SandpackPredefinedTemplate } from "@codesandbox/sandpack-react";
import { githubLight } from "@codesandbox/sandpack-themes";

import type { SandpackFiles } from "../../../components/StudioShell";
import { getProject } from "@server/projects/projectStorage";
import { getShareLink } from "@server/shares/shareStorage";

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

const SharePreviewPage = ({ shareId, initialProject }: SharePreviewPageProps) => {
  const [project, setProject] = useState<PreviewProject>(initialProject);

  useEffect(() => {
    const timer = window.setInterval(async () => {
      try {
        const response = await fetch(`/api/share/${encodeURIComponent(shareId)}`);
        if (!response.ok) return;
        const payload = (await response.json()) as SharePayload;
        if (payload.mode !== "preview") return;
        if (payload.project.updatedAt !== project.updatedAt) {
          setProject(payload.project);
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
    if (!project.dependencies || Object.keys(project.dependencies).length === 0) {
      return undefined;
    }
    return { dependencies: project.dependencies };
  }, [project.dependencies]);

  return (
    <Flex direction="column" h="100vh" bg="gray.50" overflow="hidden">
      <Box flex="1" minH="0" position="relative">
        <SandpackProvider
          template={project.template}
          files={project.files}
          customSetup={customSetup}
          theme={githubLight}
          options={{ autorun: true }}
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

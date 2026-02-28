import type { GetServerSideProps } from "next";
import type { SandpackPredefinedTemplate } from "@codesandbox/sandpack-react";

import StudioShell, { type SandpackFiles } from "../../components/StudioShell";
import { getProject } from "@server/projects/projectStorage";
import { getAuthUserFromRequest } from "@server/auth/ssr";

type ProjectPageProps = {
  di: string;
  initialProject?: {
    token: string;
    name: string;
    template: SandpackPredefinedTemplate;
    files: SandpackFiles;
    dependencies?: Record<string, string>;
  } | null;
};

const ProjectPage = ({ di, initialProject }: ProjectPageProps) => {
  if (!di) {
    return null;
  }

  return (
    <StudioShell
      initialToken={di}
      initialProject={initialProject ?? undefined}
      key={di}
    />
  );
};

export const getServerSideProps: GetServerSideProps<ProjectPageProps> = async (context) => {
  const authUser = getAuthUserFromRequest(context.req);
  if (!authUser) {
    return {
      redirect: {
        destination: `/login?lastRoute=${encodeURIComponent(context.resolvedUrl)}`,
        permanent: false,
      },
    };
  }

  const di = typeof context.params?.di === "string" ? context.params.di : "";

  if (!di) {
    return { notFound: true };
  }

  const project = await getProject(di);

  if (!project) {
    return { notFound: true };
  }
  if (project.userId && project.userId !== authUser.sub) {
    return { notFound: true };
  }

  return {
    props: {
      di,
      initialProject: {
        token: project.token,
        name: project.name,
        template: project.template as SandpackPredefinedTemplate,
        files: project.files,
        dependencies: project.dependencies || {},
      },
    },
  };
};

export default ProjectPage;

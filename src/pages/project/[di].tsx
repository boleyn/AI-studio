import type { GetServerSideProps } from "next";
import AgentWorkspace from "../../components/AgentWorkspace";
import { getProjectOutputs } from "@server/projects/projectOutputs";
import { getProject } from "@server/projects/projectStorage";
import { getAuthUserFromRequest } from "@server/auth/ssr";

type ProjectPageProps = {
  di: string;
  initialProject?: {
    token: string;
    name: string;
    files: Record<string, { code: string }>;
  } | null;
};

const ProjectPage = ({ di, initialProject }: ProjectPageProps) => {
  if (!di) return null;

  return (
    <AgentWorkspace
      key={di}
      initialProjectToken={di}
      initialProjectName={initialProject?.name}
      initialFiles={initialProject?.files || {}}
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
  if (!di) return { notFound: true };

  const project = await getProject(di);
  if (!project) return { notFound: true };
  if (project.userId && project.userId !== authUser.sub) return { notFound: true };

  return {
    props: {
      di,
      initialProject: {
        token: project.token,
        name: project.name,
        files: await getProjectOutputs(project),
      },
    },
  };
};

export default ProjectPage;

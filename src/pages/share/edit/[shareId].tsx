import type { GetServerSideProps } from "next";

import { getAuthUserFromRequest } from "@server/auth/ssr";
import { generateToken, getProject, saveProject, type ProjectData } from "@server/projects/projectStorage";
import { getShareLink } from "@server/shares/shareStorage";

type ShareEditPageProps = Record<string, never>;

const ShareEditPage = () => {
  return null;
};

const buildForkedName = (name: string) => {
  const trimmed = name.trim();
  if (!trimmed) return "未命名项目 副本";
  return trimmed.endsWith("副本") ? trimmed : `${trimmed} 副本`;
};

export const getServerSideProps: GetServerSideProps<ShareEditPageProps> = async (context) => {
  const authUser = getAuthUserFromRequest(context.req);
  if (!authUser) {
    return {
      redirect: {
        destination: `/login?lastRoute=${encodeURIComponent(context.resolvedUrl)}`,
        permanent: false,
      },
    };
  }

  const shareId = typeof context.params?.shareId === "string" ? context.params.shareId : "";
  if (!shareId) {
    return { notFound: true };
  }

  const share = await getShareLink(shareId);
  if (!share || share.mode !== "editable") {
    return { notFound: true };
  }

  const sourceProject = await getProject(share.projectToken);
  if (!sourceProject) {
    return { notFound: true };
  }

  const now = new Date().toISOString();
  const nextToken = generateToken();
  const copiedProject: ProjectData = {
    token: nextToken,
    name: buildForkedName(sourceProject.name),
    template: sourceProject.template,
    userId: authUser.sub,
    files: sourceProject.files,
    dependencies: sourceProject.dependencies || {},
    sandpackCompileInfo: sourceProject.sandpackCompileInfo,
    createdAt: now,
    updatedAt: now,
  };

  await saveProject(copiedProject);

  return {
    redirect: {
      destination: `/project/${nextToken}`,
      permanent: false,
    },
  };
};

export default ShareEditPage;

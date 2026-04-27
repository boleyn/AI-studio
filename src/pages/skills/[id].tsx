import type { GetServerSideProps } from "next";

import { getAuthUserFromRequest } from "@server/auth/ssr";

export default function SkillEditRedirectPage() {
  return null;
}

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

  const idParam = context.params?.id;
  const id = Array.isArray(idParam) ? idParam[0] || "" : typeof idParam === "string" ? idParam : "";
  const returnToParam = context.query?.returnTo;
  const returnTo =
    typeof returnToParam === "string"
      ? returnToParam.trim()
      : Array.isArray(returnToParam)
      ? returnToParam[0]?.trim() || ""
      : "";
  if (!id) {
    return {
      redirect: {
        destination: "/skills/create",
        permanent: false,
      },
    };
  }

  return {
    redirect: {
      destination: `/skills/create?skillId=${encodeURIComponent(id)}${
        returnTo ? `&returnTo=${encodeURIComponent(returnTo)}` : ""
      }`,
      permanent: false,
    },
  };
};

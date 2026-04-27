import type { GetServerSideProps } from "next";
import { getAuthUserFromRequest } from "@server/auth/ssr";
export default function ModelUsagePage() {
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

  return {
    redirect: {
      destination: "/models?tab=usage",
      permanent: false,
    },
  };
};

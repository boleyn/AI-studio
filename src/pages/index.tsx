import type { GetServerSideProps } from "next";
import AgentWorkspace from "../components/AgentWorkspace";
import { getAuthUserFromRequest } from "@server/auth/ssr";

const HomePage = () => {
  return <AgentWorkspace />;
};

export default HomePage;

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

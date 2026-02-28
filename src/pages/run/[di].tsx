import type { GetServerSideProps } from "next";

const RunRedirect = () => null;

export const getServerSideProps: GetServerSideProps = async (context) => {
  const di = typeof context.params?.di === "string" ? context.params.di : "";
  if (!di) {
    return { notFound: true };
  }

  return {
    redirect: {
      destination: `/project/${di}`,
      permanent: false,
    },
  };
};

export default RunRedirect;

import type { GetServerSideProps } from "next";
import { getMongoDb } from "@server/db/mongo";
import { getShareLink } from "@server/shares/shareStorage";
import { getSiteSettings } from "@server/library/sites";
import { sitePreviewPath } from "@/types/library";
import AgentWorkspace from "../components/AgentWorkspace";
import { getAuthUserFromRequest } from "@server/auth/ssr";

const HomePage = () => {
  return <AgentWorkspace />;
};

export default HomePage;

export const getServerSideProps: GetServerSideProps = async (context) => {
  const origin = process.env.SITE_PUBLIC_ORIGIN;
  if (origin) {
    const canonical = new URL(origin);
    const host = context.req.headers.host?.split(":")[0].toLowerCase().replace(/\.$/,"");
    if (host && host !== canonical.hostname) {
      context.res.setHeader("Cache-Control","private, no-store");
      const db = await getMongoDb();
      const binding = await db.collection("site_domains").findOne({host,verified:true},{projection:{shareId:1}});
      const share = binding && await getShareLink(binding.shareId);
      if (!share || share.mode !== "preview") return {notFound:true};
      const settings = await getSiteSettings(share.ownerUserId,share.projectToken);
      const path = sitePreviewPath(share.shareId,settings?.siteSlug);
      return {redirect:{destination:new URL(path,canonical.origin).href,permanent:false}};
    }
  }
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

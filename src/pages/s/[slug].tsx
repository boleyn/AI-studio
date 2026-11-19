import { getMongoDb } from "@server/db/mongo";
import Preview, { getServerSideProps as previewProps } from "../share/preview/[shareId]";

export const getServerSideProps: typeof previewProps = async context => {
  const slug = context.params?.slug;
  if (typeof slug !== "string") return {notFound:true};
  const db = await getMongoDb();
  const settings = await db.collection("library_file_settings").findOne({siteSlug:slug});
  if (!settings || typeof settings.siteProjectToken !== "string" || typeof settings.owner !== "string") return {notFound:true};
  const link = await db.collection("share_links").findOne(
    {projectToken:settings.siteProjectToken,ownerUserId:settings.owner,mode:"preview"},
    {sort:{createdAt:-1,_id:-1},projection:{shareId:1}}
  );
  if (!link) return {notFound:true};
  return previewProps({...context,params:{slug,shareId:link.shareId}});
};

export default Preview;

import { getProjectAccessState } from "@server/projects/projectStorage";
import { getUserSkill } from "@server/skills/skillStorage";

export type ChatTokenAccessStatus = "ok_project" | "ok_skill" | "forbidden" | "not_found";

export const getChatTokenAccessState = async (
  token: string,
  userId: string
): Promise<ChatTokenAccessStatus> => {
  const projectAccess = await getProjectAccessState(token, userId);
  if (projectAccess === "ok") return "ok_project";

  const skill = await getUserSkill({ token, userId });
  if (skill) return "ok_skill";

  if (projectAccess === "forbidden") return "forbidden";
  return "not_found";
};


export async function canAccessArtifactSource(token: string, userId: string, chatUpload: boolean) {
  if (!chatUpload) return (await getProjectAccessState(token, userId)) === "ok";
  const access = await getChatTokenAccessState(token, userId);
  return access === "ok_project" || access === "ok_skill";
}

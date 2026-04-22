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


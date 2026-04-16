import { loadMcpTools } from "./mcpClient";
import { createPlanModeTools } from "./planModeTools";
import { createSkillLoadTool, createSkillRunScriptTool } from "./skills/tool";
import type { RuntimeSkill } from "./skills/types";
import { createBashTool } from "./tools/bashTool";
import { createProjectTools } from "./tools";
import type { AgentToolDefinition } from "./tools/types";
import type { ProjectWorkspaceManager } from "./workspace/projectWorkspaceManager";

type BuildRuntimeToolsInput = {
  token: string;
  chatId: string;
  workspaceManager: ProjectWorkspaceManager;
  effectiveSkills: RuntimeSkill[];
  historyMessages?: unknown[];
};

export const buildRuntimeTools = async ({
  token,
  chatId,
  workspaceManager,
  effectiveSkills,
  historyMessages,
}: BuildRuntimeToolsInput): Promise<AgentToolDefinition[]> => {
  const changeTracker = {
    changed: false,
    paths: new Set<string>(),
  };

  const projectTools = createProjectTools(token, changeTracker, {
    chatId,
    workspaceManager,
    historyMessages,
  });
  const mcpTools = await loadMcpTools();
  const skillLoadTool =
    effectiveSkills.length > 0 ? await createSkillLoadTool({ skills: effectiveSkills }) : null;
  const skillRunScriptTool =
    effectiveSkills.length > 0
      ? await createSkillRunScriptTool({
          skills: effectiveSkills,
          sessionId: chatId,
          workspaceManager,
          projectToken: token,
        })
      : null;
  const planTools = createPlanModeTools();
  const bashTool = createBashTool({
    sessionId: chatId,
    workspaceManager,
    fallbackProjectToken: token,
    allowedProjectToken: token,
  });

  const all = [
    ...projectTools,
    ...mcpTools,
    ...(skillLoadTool ? [skillLoadTool] : []),
    ...(skillRunScriptTool ? [skillRunScriptTool] : []),
    ...planTools,
    bashTool,
  ];

  const dedupedByName = new Map<string, AgentToolDefinition>();
  for (const tool of all) {
    if (!dedupedByName.has(tool.name)) {
      dedupedByName.set(tool.name, tool);
    }
  }
  return [...dedupedByName.values()];
};


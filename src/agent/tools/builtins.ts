import { MemoryTool } from "../memory/tool";
import { compileProjectTool } from "./builtin/compileProjectTool";
import { AgentTool, AgentTaskTool } from "./builtin/delegationTool";
import { ReadTool, WriteTool, EditTool, GlobTool, GrepTool } from "./builtin/fileTools";
import { TodoWriteTool, updatePlanTool, AskUserQuestionTool, ExitPlanModeTool } from "./builtin/planningTools";
import { SkillTool } from "./builtin/skillTool";
import { BashTool } from "./builtin/terminalTool";
import { WebFetchTool, WebSearchTool } from "./builtin/webTools";

/** Explicit manifest: no import-time registration or cross-request mutable singleton. */
export const builtinTools = [
  MemoryTool,
  compileProjectTool,
  AgentTool, AgentTaskTool,
  ReadTool, WriteTool, EditTool, GlobTool, GrepTool,
  TodoWriteTool, updatePlanTool, AskUserQuestionTool, ExitPlanModeTool,
  SkillTool,
  BashTool,
  WebFetchTool, WebSearchTool,
];

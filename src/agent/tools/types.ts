import type { Sandbox } from "../sandbox";

/** JSON Schema（OpenAI function calling parameters） */
export type JsonSchema = {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
};

export type InteractionKind = "plan_question" | "plan_approval" | "permission";

export type InteractionDecision = {
  decision: "approve" | "reject";
  answers?: Record<string, string>;
  note?: string;
  updatedInput?: unknown;
};

export type ToolResult = {
  /** 返回给模型的文本内容 */
  content: string;
  isError?: boolean;
  /** 本次调用修改过的虚拟路径（用于实时推送 files_updated） */
  changedPaths?: string[];
};

export type ToolEventEmitter = (event: "stream_event" | "status" | "control", data: Record<string, unknown>) => void;

/** 子 Agent 运行器（由 app 层注入，避免 tools → app 的循环依赖） */
export type SubagentRunner = (params: {
  toolUseId: string;
  prompt: string;
  description?: string;
  subagentType?: string;
  signal?: AbortSignal;
}) => Promise<string>;

export type ToolContext = {
  backgroundTasks?: {
    start: (prompt: string) => Promise<unknown>;
    list: () => Promise<unknown>;
    get: (id: string) => Promise<unknown>;
    cancel: (id: string) => Promise<unknown>;
  };
  skills?: import("../skills/catalog").SkillCatalog;
  sandbox: Sandbox;
  toolUseId: string;
  signal?: AbortSignal;
  emit: ToolEventEmitter;
  /** 发起需要用户响应的交互（提问 / 计划审批 / 权限），返回 null 代表取消 */
  requestInteraction: (kind: InteractionKind, input: unknown) => Promise<InteractionDecision | null>;
  runSubagent?: SubagentRunner;
  /** 当前项目 token（compile_project 等项目级工具使用） */
  projectToken?: string;
  /** 当前权限模式：default / plan / acceptEdits / bypassPermissions */
  permissionMode: string;
  /** 是否在子 Agent 内运行 */
  isSubagent?: boolean;
};

export type ToolDefinition<Input = Record<string, unknown>> = {
  name: string;
  /** Hermes 风格的 toolset 分组，用于按场景启用/禁用 */
  toolset: string;
  description: string;
  instructionSkills?: string[];
  parameters: JsonSchema;
  /** 只读工具在 plan 模式下仍然可用 */
  readOnly?: boolean;
  /** 可选的可用性检查（Hermes check_fn） */
  isAvailable?: (ctx: { sandbox: Sandbox; projectToken?: string }) => boolean;
  handler: (input: Input, ctx: ToolContext) => Promise<ToolResult>;
};

/** Preserve typed handler inputs while exporting declarative tool contributions. */
export const defineTool = <Input>(tool: ToolDefinition<Input>): ToolDefinition<Input> => tool;

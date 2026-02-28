import { ClassifyQuestionAgentItemType } from '../workflow/template/system/classifyQuestion/type';
import type { SearchDataResponseItemType } from '../dataset/type';
import type {
  ChatFileTypeEnum,
  ChatItemValueTypeEnum,
  ChatRoleEnum,
  ChatSourceEnum,
  ChatStatusEnum
} from './constants';
import type { FlowNodeTypeEnum } from '../workflow/node/constant';
import type { NodeInputKeyEnum, NodeOutputKeyEnum } from '../workflow/constants';
import type { DispatchNodeResponseKeyEnum } from '../workflow/runtime/constants';
import type { AppSchema, VariableItemType } from '../app/type';
import { AppChatConfigType } from '../app/type';
import type { AppSchema as AppType } from '@fastgpt/global/core/app/type.d';
import { DatasetSearchModeEnum } from '../dataset/constants';
import type { DispatchNodeResponseType } from '../workflow/runtime/type.d';
import type { ChatBoxInputType } from '../../../../projects/app/src/components/core/chat/ChatContainer/ChatBox/type';
import type { WorkflowInteractiveResponseType } from '../workflow/template/system/interactive/type';
import type { FlowNodeInputItemType } from '../workflow/type/io';
import type { FlowNodeTemplateType } from '../workflow/type/node.d';
import type { ScheduledTaskCardType } from '../workflow/scheduledTask/type';

/* --------- chat ---------- */
export type ChatSchemaType = {
  _id: string;
  chatId: string;
  userId: string;
  teamId: string;
  tmbId: string;
  appId: string;
  appVersionId?: string;
  entryId?: string;
  createTime: Date;
  updateTime: Date;
  title: string;
  customTitle: string;
  top: boolean;
  source: `${ChatSourceEnum}`;
  sourceName?: string;

  shareId?: string;
  outLinkUid?: string;
  finalUserId?: string;

  variableList?: VariableItemType[];
  welcomeText?: string;
  variables: Record<string, any>;
  pluginInputs?: FlowNodeInputItemType[];
  metadata?: Record<string, any>;

  // Boolean flags for efficient filtering
  hasGoodFeedback?: boolean;
  hasBadFeedback?: boolean;
  hasUnreadGoodFeedback?: boolean;
  hasUnreadBadFeedback?: boolean;

  deleteTime?: Date | null;
};

export type ChatWithAppSchema = Omit<ChatSchemaType, 'appId'> & {
  appId: AppSchema;
};

/* --------- chat item ---------- */
export type UserChatItemFileItemType = {
  type: `${ChatFileTypeEnum}`;
  name?: string;
  key?: string;
  url: string;
};
export type UserChatItemValueItemType = {
  type: ChatItemValueTypeEnum.text | ChatItemValueTypeEnum.file;
  text?: {
    content: string;
  };
  file?: UserChatItemFileItemType;
};
export type UserChatItemType = {
  obj: ChatRoleEnum.Human;
  value: UserChatItemValueItemType[];
  hideInUI?: boolean;
  // Entry 应用选择信息
  entryAppSelection?: {
    selectedAppId: string;
    selectedAppTag: string;
    isAIRouted?: boolean; // 是否通过AI路由选择
    routeReason?: string; // 路由原因
  };
};

export type SystemChatItemValueItemType = {
  type: ChatItemValueTypeEnum.text;
  text?: {
    content: string;
  };
};
export type SystemChatItemType = {
  obj: ChatRoleEnum.System;
  value: SystemChatItemValueItemType[];
};

export type AIChatItemValueItemType = {
  type:
    | ChatItemValueTypeEnum.text
    | ChatItemValueTypeEnum.reasoning
    | ChatItemValueTypeEnum.tool
    | ChatItemValueTypeEnum.interactive
    | ChatItemValueTypeEnum.outline
    | ChatItemValueTypeEnum.paragraph
    | ChatItemValueTypeEnum.instruction
    | ChatItemValueTypeEnum.scheduledTask;

  text?: {
    content: string;
  };
  reasoning?: {
    content: string;
  };
  tools?: ToolModuleResponseItemType[];
  interactive?: WorkflowInteractiveResponseType;
  outline?: {
    text: string;
    confirmed?: boolean;
    confirmedText?: string;
    structuredData?: Array<{
      id: string;
      title: string;
      description: string;
      order: number;
      estimatedWords?: number;
      keyPoints?: string[];
      contextBefore?: string;
      contextAfter?: string;
      status?: 'pending' | 'generating' | 'completed' | 'error';
    }>;
  };
  paragraph?: {
    outlineItem: {
      id: string;
      title: string;
      order: number;
    };
    content: string; // Markdown content
    status: 'generating' | 'completed' | 'error';
    fileId?: string; // GridFS文件ID(生成完成后存储)
    metadata?: {
      searchResults?: any[];
      tokensUsed?: number;
    };
    progress?: {
      current: number;
      total: number;
      currentTitle?: string;
    };
    currentTitle?: string;
  };
  instruction?: {
    id: string;
    data: string;
    status: 'pending' | 'in_progress' | 'completed' | 'error';
    executionTime?: number;
    error?: string;
  };
  scheduledTask?: ScheduledTaskCardType;
};

// 段落信息类型（用于数据库存储）
export type ParagraphItem = {
  outlineItem: {
    id: string;
    title: string;
    level: number;
    number: string;
  };
  content: string;
  searchResults: any[]; // SearchDataResponseItemType[] 包含知识库和网络搜索结果
  order: number;
  status: 'generating' | 'completed' | 'error';
};

// 数据来源（用于文末参考资料列表）
export type ParagraphSource = {
  id: number;
  title: string;
  url: string;
};
export type AIChatItemType = {
  obj: ChatRoleEnum.AI;
  value: AIChatItemValueItemType[];
  memories?: Record<string, any>;
  userGoodFeedback?: string;
  userBadFeedback?: string;
  customFeedbacks?: string[];
  adminFeedback?: AdminFbkType;
  isFeedbackRead?: boolean;

  durationSeconds?: number;
  errorMsg?: string;
  citeCollectionIds?: string[];

  // @deprecated 不再存储在 chatItemSchema 里，分别存储到 chatItemResponseSchema
  [DispatchNodeResponseKeyEnum.nodeResponse]?: ChatHistoryItemResType[];
};

export type ChatItemValueItemType =
  | UserChatItemValueItemType
  | SystemChatItemValueItemType
  | AIChatItemValueItemType;
export type ChatItemMergeType = UserChatItemType | SystemChatItemType | AIChatItemType;

export type ChatItemSchemaType = ChatItemMergeType & {
  dataId: string;
  chatId: string;
  userId: string;
  teamId: string;
  tmbId: string;
  appId: string;
  time: Date;
  deleteTime?: Date | null;
};

export type AdminFbkType = {
  feedbackDataId: string;
  datasetId: string;
  collectionId: string;
  q: string;
  a?: string;
};

export type ResponseTagItemType = {
  totalQuoteList?: SearchDataResponseItemType[];
  llmModuleAccount?: number;
  historyPreviewLength?: number;
  toolCiteLinks?: ToolCiteLinksType[];
};

export type ChatItemType = ChatItemMergeType & {
  dataId?: string;
  // 可选：流程运行的详细响应数据（前端/接口处理中会注入）
  responseData?: ChatHistoryItemResType[];
  time?: Date | string;
} & ResponseTagItemType;

// Frontend type
export type ChatSiteItemType = ChatItemMergeType & {
  _id?: string;
  id: string;
  dataId: string;
  status: `${ChatStatusEnum}`;
  moduleName?: string;
  ttsBuffer?: Uint8Array;
  responseData?: ChatHistoryItemResType[];
  time?: Date;
  durationSeconds?: number;
  errorMsg?: string;
  // Entry 应用选择信息
  entryAppSelection?: {
    selectedAppId: string;
    selectedAppTag: string;
    isAIRouted?: boolean;
    routeReason?: string;
  };
  deleteTime?: Date | null;
  collapseTop?: {
    count: number;
    dataIds: string[];
    isExpanded: boolean;
  };
  collapseBottom?: {
    count: number;
    dataIds: string[];
    isExpanded: boolean;
  };
} & ChatBoxInputType &
  ResponseTagItemType;

/* --------- chat item response ---------- */
export type ChatItemResponseSchemaType = {
  teamId: string;
  appId: string;
  chatId: string;
  chatItemDataId: string;
  data: ChatHistoryItemResType;
};

/* --------- team chat --------- */
export type ChatAppListSchema = {
  apps: AppType[];
  teamInfo: teamInfoSchema;
  uid?: string;
};

/* ---------- history ------------- */
export type HistoryItemType = {
  chatId: string;
  updateTime: Date;
  customTitle?: string;
  title: string;
};
export type ChatHistoryItemType = HistoryItemType & {
  appId: string;
  top?: boolean;
};

/* ------- response data ------------ */
export type ChatHistoryItemResType = DispatchNodeResponseType & {
  nodeId: string;
  id: string;
  moduleType: FlowNodeTypeEnum;
  moduleName: string;
};

/* ---------- node outputs ------------ */
export type NodeOutputItemType = {
  nodeId: string;
  key: NodeOutputKeyEnum;
  value: any;
};

/* One tool run response  */
export type ToolRunResponseItemType = any;
/* tool module response */
export type ToolModuleResponseItemType = {
  id: string;
  toolName: string; // tool name
  toolAvatar: string;
  params: string; // tool params
  response: string;
  functionName: string;
};

export type ToolCiteLinksType = {
  name: string;
  url: string;
};
export type ChatHistoryWithSummaryType = {
  histories: ChatItemType[];
  summary?: string;
};
/* dispatch run time */
export type RuntimeUserPromptType = {
  files: UserChatItemValueItemType['file'][];
  text: string;
};

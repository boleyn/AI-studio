import type { ChatNodeUsageType } from '../../../support/wallet/bill/type';
import type {
  ChatItemType,
  ChatHistoryWithSummaryType,
  ToolRunResponseItemType,
  AIChatItemValueItemType,
  ChatHistoryItemResType
} from '../../chat/type';
import type { FlowNodeInputItemType, FlowNodeOutputItemType } from '../type/io.d';
import type { NodeToolConfigType, StoreNodeItemType } from '../type/node';
import type { DispatchNodeResponseKeyEnum } from './constants';
import type { StoreEdgeItemType } from '../type/edge';
import type { NodeInputKeyEnum, NodeOutputKeyEnum } from '../constants';
import type { ClassifyQuestionAgentItemType } from '../template/system/classifyQuestion/type';
import type { NextApiResponse } from 'next';
import { UserModelSchema } from '../../../support/user/type';
import type { AppSchema } from '../../app/type';
import { AppDetailType } from '../../app/type';
import type { RuntimeNodeItemType } from '../runtime/type';
import type { RuntimeEdgeItemType } from './edge';
import type { ReadFileNodeResponse } from '../template/system/readFiles/type';
import { UserSelectOptionType } from '../template/system/userSelect/type';
import type { WorkflowResponseType } from '../../../../service/core/workflow/dispatch/type';
import type { AiChatQuoteRoleType } from '../template/system/aiChat/type';
import type { OpenaiAccountType } from '../../../support/user/team/type';
import { LafAccountType } from '../../../support/user/team/type';
import type { CompletionFinishReason } from '../../ai/type';
import type {
  InteractiveNodeResponseType,
  WorkflowInteractiveResponseType
} from '../template/system/interactive/type';
import type { SearchDataResponseItemType } from '../../dataset/type';
import type { localeType } from '../../../common/i18n/type';
import { type UserChatItemValueItemType } from '../../chat/type';

export type ExternalProviderType = {
  openaiAccount?: OpenaiAccountType;
  externalWorkflowVariables?: Record<string, string>;
};

/* workflow props */
export type ChatDispatchProps = {
  res?: NextApiResponse;
  checkIsStopping: () => boolean;
  lang?: localeType;
  requestOrigin?: string;
  mode: 'test' | 'chat' | 'debug';
  timezone: string;
  externalProvider: ExternalProviderType;

  runningAppInfo: {
    id: string; // May be the id of the system plug-in (cannot be used directly to look up the table)
    teamId: string;
    tmbId: string; // App tmbId
    name: string;
    isChildApp?: boolean;
  };
  runningUserInfo: {
    username: string;
    teamName: string;
    memberName: string;
    contact: string;
    teamId: string;
    tmbId: string;
  };
  uid: string; // Who run this workflow
  username?: string; // User username (for logged in users)
  memberName?: string; // User member name (for logged in users)
  finalUserId?: string; // Final user ID (e.g., external system user ID)

  chatId: string;
  responseChatItemId?: string;
  histories: ChatHistoryWithSummaryType;
  variables: Record<string, any>; // global variable
  cloneVariables?: Record<string, any>; // cloned variables for entry routing
  query: UserChatItemValueItemType[]; // trigger query
  chatConfig: AppSchema['chatConfig'];
  lastInteractive?: WorkflowInteractiveResponseType; // last interactive response
  stream: boolean;
  retainDatasetCite?: boolean;
  maxRunTimes: number;
  isToolCall?: boolean;
  workflowStreamResponse?: WorkflowResponseType;
  apiVersion?: 'v1' | 'v2';

  workflowDispatchDeep: number;

  responseAllData?: boolean;
  responseDetail?: boolean;
  usageId?: string;
};

export type ModuleDispatchProps<T> = ChatDispatchProps & {
  node: RuntimeNodeItemType;
  runtimeNodes: RuntimeNodeItemType[];
  runtimeEdges: RuntimeEdgeItemType[];
  params: T;

  mcpClientMemory: Record<string, MCPClient>; // key: url
};

export type SystemVariablesType = {
  userId: string;
  userName?: string; // User name (memberName for logged in users, or uid for anonymous)
  finalUserId?: string; // Final user ID
  appId: string;
  chatId?: string;
  responseChatItemId?: string;
  histories: ChatHistoryWithSummaryType;
  cTime: string;
};

/* node props */
export type RuntimeNodeItemType = {
  nodeId: StoreNodeItemType['nodeId'];
  name: StoreNodeItemType['name'];
  avatar?: StoreNodeItemType['avatar'];
  intro?: StoreNodeItemType['intro'];
  toolDescription?: StoreNodeItemType['toolDescription'];
  flowNodeType: StoreNodeItemType['flowNodeType'];
  showStatus?: StoreNodeItemType['showStatus'];
  isEntry?: boolean;
  version?: string;

  inputs: FlowNodeInputItemType[];
  outputs: FlowNodeOutputItemType[];

  pluginId?: string; // workflow id / plugin id

  // Tool
  toolConfig?: StoreNodeItemType['toolConfig'];

  // catch error
  catchError?: boolean;
};

export type RuntimeEdgeItemType = StoreEdgeItemType & {
  status: 'waiting' | 'active' | 'skipped';
};

export type DispatchNodeResponseType = {
  // common
  moduleLogo?: string;
  runningTime?: number;
  query?: string;
  textOutput?: string;

  // Client will toast
  error?: Record<string, any> | string;
  // Just show
  errorText?: string;

  customInputs?: Record<string, any>;
  customOutputs?: Record<string, any>;
  nodeInputs?: Record<string, any>;
  nodeOutputs?: Record<string, any>;
  mergeSignId?: string;

  // bill
  tokens?: number; // deprecated
  inputTokens?: number;
  outputTokens?: number;
  model?: string;
  contextTotalLen?: number;
  totalPoints?: number;
  childTotalPoints?: number;

  // chat
  temperature?: number;
  maxToken?: number;
  quoteList?: SearchDataResponseItemType[];
  reasoningText?: string;
  historyPreview?: {
    obj: `${ChatRoleEnum}`;
    value: string;
  }[]; // completion context array. history will slice
  finishReason?: CompletionFinishReason;
  taskRecognizeResult?: Record<string, any>;

  // dataset search
  embeddingModel?: string;
  embeddingTokens?: number;
  similarity?: number;
  rerankSimilarity?: number;
  limit?: number;
  searchMode?: `${DatasetSearchModeEnum}`;
  embeddingWeight?: number;
  rerankModel?: string;
  rerankWeight?: number;
  reRankInputTokens?: number;
  searchUsingReRank?: boolean;
  queryExtensionResult?: {
    model: string;
    inputTokens: number;
    outputTokens: number;
    query: string;
  };
  deepSearchResult?: {
    model: string;
    inputTokens: number;
    outputTokens: number;
  };

  // dataset concat
  concatLength?: number;

  // cq
  cqList?: ClassifyQuestionAgentItemType[];
  cqResult?: string;
  cqLastScene?: string;

  // history summary
  historySummary?: string;

  // content extract
  extractDescription?: string;
  extractResult?: Record<string, any>;

  // http
  params?: Record<string, any>;
  body?: Record<string, any> | string;
  headers?: Record<string, any>;
  httpResult?: Record<string, any>;

  // Tool
  toolInput?: Record<string, any>;
  pluginOutput?: Record<string, any>;
  pluginDetail?: ChatHistoryItemResType[];

  // if-else
  ifElseResult?: string;
  ifElseResultDetail?: {
    name: string; // e.g., "IF", "ELSE IF 1"
    isMatch: boolean;
    condition: string; // "AND" | "OR"
    conditions: {
      variable: string;
      variableValue: any;
      condition: string;
      value: any;
      result: boolean;
    }[];
  }[];

  // tool call
  toolCallInputTokens?: number;
  toolCallOutputTokens?: number;
  toolDetail?: ChatHistoryItemResType[];
  toolStop?: boolean;

  // code
  codeLog?: string;

  // read files
  readFilesResult?: string;
  readFiles?: ReadFileNodeResponse;

  // user select
  userSelectResult?: string;

  // update var
  updateVarResult?: any[];

  // loop
  loopResult?: any[];
  loopInput?: any[];
  loopDetail?: ChatHistoryItemResType[];
  // loop start
  loopInputValue?: any;
  // loop end
  loopOutputValue?: any;

  // form input
  formInputResult?: Record<string, any>;

  // tool params
  toolParamsResult?: Record<string, any>;

  toolRes?: any;

  // AI routing
  runResult?: {
    selectedApp: string;
    selectedAppId: string;
    reason: string;
    availableApps: string[];
    userQuery: string;
    aiResponse?: string;
    model?: string;
    usage?: any;
    error?: string;
    // 新增：知识库搜索信息记录
    datasetSearchInfo?: {
      searchPerformed: boolean;
      searchResultsCount: number;
      searchResults: Array<{
        id?: string;
        q: string;
        a?: string;
        source: string;
        sourceId?: string;
      }>;
      searchParams?: {
        userInput: string;
        searchMode?: string;
        similarity?: number;
        rerankSimilarity?: number;
        limit?: number;
        datasetsCount: number;
      };
    };
  };
  airoutingData?: {
    selectedAppTag: string;
    routeReason: string;
    availableApps: string[];
    userQuery: string;
    aiResponse: string;
    error: string;
    // 新增：知识库搜索信息（前端可用的简化版本）
    datasetSearchInfo?: {
      searchPerformed: boolean;
      searchResultsCount: number;
      searchResults: Array<{
        q: string;
        source: string;
      }>;
    };
  };

  // abandon
  extensionModel?: string;
  extensionResult?: string;
  extensionTokens?: number;
};

export type DispatchNodeResultType<T = {}, ERR = { [NodeOutputKeyEnum.errorText]?: string }> = {
  [DispatchNodeResponseKeyEnum.answerText]?: string;
  [DispatchNodeResponseKeyEnum.reasoningText]?: string;
  [DispatchNodeResponseKeyEnum.skipHandleId]?: string[]; // skip some edge handle id
  [DispatchNodeResponseKeyEnum.nodeResponse]?: DispatchNodeResponseType; // The node response detail
  [DispatchNodeResponseKeyEnum.nodeDispatchUsages]?: ChatNodeUsageType[]; // Node total usage
  [DispatchNodeResponseKeyEnum.childrenResponses]?: DispatchNodeResultType[]; // Children node response
  [DispatchNodeResponseKeyEnum.toolResponses]?: ToolRunResponseItemType; // Tool response
  [DispatchNodeResponseKeyEnum.assistantResponses]?: AIChatItemValueItemType[]; // Assistant response(Store to db)
  [DispatchNodeResponseKeyEnum.rewriteHistories]?: ChatItemType[];
  [DispatchNodeResponseKeyEnum.runTimes]?: number;
  [DispatchNodeResponseKeyEnum.newVariables]?: Record<string, any>;
  [DispatchNodeResponseKeyEnum.memories]?: Record<string, any>;
  [DispatchNodeResponseKeyEnum.interactive]?: InteractiveNodeResponseType;
  [DispatchNodeResponseKeyEnum.customFeedbacks]?: string[];

  data?: T;
  error?: ERR;
};

/* Single node props */
export type AIChatNodeProps = {
  [NodeInputKeyEnum.aiModel]: string;
  [NodeInputKeyEnum.aiSystemPrompt]?: string;
  [NodeInputKeyEnum.aiChatTemperature]?: number;
  [NodeInputKeyEnum.aiChatMaxToken]?: number;
  [NodeInputKeyEnum.aiChatIsResponseText]: boolean;
  [NodeInputKeyEnum.aiChatVision]?: boolean;
  [NodeInputKeyEnum.aiChatReasoning]?: boolean;
  [NodeInputKeyEnum.aiChatTopP]?: number;
  [NodeInputKeyEnum.aiChatStopSign]?: string;
  [NodeInputKeyEnum.aiChatResponseFormat]?: string;
  [NodeInputKeyEnum.aiChatJsonSchema]?: string;
  [NodeInputKeyEnum.aiChatPromptCache]?: boolean;

  [NodeInputKeyEnum.historySummaryEnabled]?: boolean;
  [NodeInputKeyEnum.historySummaryModel]?: string;
  [NodeInputKeyEnum.historySummaryPrompt]?: string;
  [NodeInputKeyEnum.historySummaryKeepRounds]?: number;
  [NodeInputKeyEnum.historySummaryWindowRounds]?: number;
  [NodeInputKeyEnum.historySummaryMaxTokens]?: number;

  [NodeInputKeyEnum.aiChatQuoteRole]?: AiChatQuoteRoleType;
  [NodeInputKeyEnum.aiChatQuoteTemplate]?: string;
  [NodeInputKeyEnum.aiChatQuotePrompt]?: string;

  [NodeInputKeyEnum.stringQuoteText]?: string;
  [NodeInputKeyEnum.fileUrlList]?: string[];
};

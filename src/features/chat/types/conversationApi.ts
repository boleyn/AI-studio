import type { Conversation, ConversationMessage, ConversationSummary } from "@/types/conversation";

export interface ChatHistoryItemType {
  id?: string;
  chatId?: string;
  title?: string;
  customTitle?: string;
  createdAt?: string;
  updatedAt?: string;
  createTime?: string;
  updateTime?: string;
  top?: boolean;
}

export interface GetHistoriesBodyType {
  token?: string;
  appId?: string;
  shareId?: string;
  outLinkUid?: string;
  teamId?: string;
  teamToken?: string;
  source?: string;
  startCreateTime?: string;
  endCreateTime?: string;
  startUpdateTime?: string;
  endUpdateTime?: string;
}

export interface GetHistoriesResponseType {
  list: ChatHistoryItemType[];
  total: number;
}

export interface UpdateHistoryBodyType {
  token?: string;
  appId?: string;
  shareId?: string;
  outLinkUid?: string;
  teamId?: string;
  teamToken?: string;
  chatId: string;
  title?: string;
  customTitle?: string;
  top?: boolean;
  messages?: ConversationMessage[];
}

export interface UpdateHistoryResponseType {
  history?: Conversation;
}

export interface DelChatHistoryType {
  token?: string;
  appId?: string;
  shareId?: string;
  outLinkUid?: string;
  teamId?: string;
  teamToken?: string;
  chatId: string;
}

export interface ClearChatHistoriesType {
  token?: string;
  appId?: string;
  shareId?: string;
  outLinkUid?: string;
  teamId?: string;
  teamToken?: string;
}

export interface ClearChatHistoriesResponseType {
  deletedCount?: number;
}

export interface ChatBatchDeleteBodyType {
  token?: string;
  appId?: string;
  chatIds: string[];
}

export interface InitChatQueryType {
  token: string;
  chatId: string;
}

export interface InitChatResponseType {
  chatId?: string;
  title?: string;
}

export interface GetChatRecordsV2BodyType {
  token: string;
  chatId: string;
  pageSize?: number;
  initialId?: string;
  prevId?: string;
  nextId?: string;
  includeDeleted?: boolean;
}

export interface GetChatRecordsV2ResponseType {
  list?: ConversationMessage[];
  total?: number;
  hasMorePrev?: boolean;
  hasMoreNext?: boolean;
}

export interface StopConversationBodyType {
  token: string;
  chatId: string;
}

export interface StopConversationResponseType {
  success: boolean;
  stopped: boolean;
}

export type ConversationListResult = ConversationSummary[];

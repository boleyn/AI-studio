import type {
  ClearChatHistoriesResponseType,
  ClearChatHistoriesType,
  DelChatHistoryType,
  GetChatRecordsV2BodyType,
  GetChatRecordsV2ResponseType,
  GetHistoriesBodyType,
  GetHistoriesResponseType,
  InitChatQueryType,
  InitChatResponseType,
  UpdateHistoryMessageActionBodyType,
  UpdateHistoryBodyType,
  UpdateHistoryResponseType,
} from "../types/conversationApi";

import { httpDelete, httpGet, httpPost, httpPut } from "./http";

export const getConversationHistories = (data: GetHistoriesBodyType) =>
  httpPost<GetHistoriesResponseType>("/core/chat/history/getHistories", data);

export const putConversationHistory = (data: UpdateHistoryBodyType) =>
  httpPut<UpdateHistoryResponseType>("/core/chat/history/updateHistory", data);

export const deleteConversationMessage = (data: UpdateHistoryMessageActionBodyType) =>
  httpPost<{ success?: boolean }>("/core/chat/history/deleteMessage", data);

export const truncateConversationFromMessage = (data: UpdateHistoryMessageActionBodyType) =>
  httpPost<{ success?: boolean }>("/core/chat/history/truncateFromMessage", data);

export const rewindConversationLatestTurn = (data: { token: string; chatId: string }) =>
  httpPost<{ success?: boolean; files?: Record<string, { code: string }> }>(
    "/core/chat/history/rewindLatestTurn",
    data
  );

export const deleteConversationHistory = (data: DelChatHistoryType) =>
  httpDelete<{ success?: boolean }>("/core/chat/history/delHistory", data);

export const clearConversationHistories = (data: ClearChatHistoriesType) =>
  httpDelete<ClearChatHistoriesResponseType>("/core/chat/history/clearHistories", data);

export const getConversationInit = (data: InitChatQueryType) =>
  httpGet<InitChatResponseType>("/core/chat/init", data);

export const getConversationRecordsV2 = (data: GetChatRecordsV2BodyType) =>
  httpPost<GetChatRecordsV2ResponseType>("/core/chat/record/getRecords_v2", data);

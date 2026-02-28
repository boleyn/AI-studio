import { withAuthHeaders } from "@features/auth/client/authClient";

export interface ChatModelCatalog {
  channels: Array<{
    id: string;
    label: string;
    source: "aiproxy" | "env";
  }>;
  defaultChannel: string;
  models: Array<{
    id: string;
    label: string;
    channel: string;
    source: "aiproxy" | "env";
  }>;
  defaultModel: string;
  toolCallModel: string;
  normalModel: string;
  source: "aiproxy" | "env";
  fetchedAt: string;
  warning?: string;
}

export const getChatModels = async (forceRefresh = false): Promise<ChatModelCatalog> => {
  const response = await fetch(`/api/chat/models${forceRefresh ? "?refresh=1" : ""}`, {
    cache: "no-store",
    headers: withAuthHeaders(),
  });

  if (!response.ok) {
    throw new Error(`模型列表获取失败: ${response.status}`);
  }

  return response.json();
};

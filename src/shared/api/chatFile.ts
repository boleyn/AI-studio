export const getPresignedChatFileGetUrl = async (params: { key: string }): Promise<string> => {
  return `/api/core/chat/files/view?storagePath=${encodeURIComponent(params.key)}`;
};

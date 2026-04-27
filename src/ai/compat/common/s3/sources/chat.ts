import { createGetObjectPresignedUrl } from "@server/storage/s3";
import { CHAT_FILE_GET_URL_EXPIRES_IN_SECONDS } from "@server/chat/presign";

export const getS3ChatSource = () => ({
  createGetChatFileURL: async ({
    key,
  }: {
    key: string;
  }) =>
    createGetObjectPresignedUrl({
      key,
      bucketType: "private",
      expiresIn: CHAT_FILE_GET_URL_EXPIRES_IN_SECONDS,
    }),
});

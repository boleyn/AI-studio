import { createGetObjectPresignedUrl } from "@server/storage/s3";

export const getS3ChatSource = () => ({
  createGetChatFileURL: async ({
    key,
  }: {
    key: string;
  }) => createGetObjectPresignedUrl({ key, bucketType: "private" }),
});

import { requireAuth } from "@server/auth/session";
import { assertChatStoragePath, getObjectFromStorage, uploadObjectToStorage } from "@server/storage/s3";
import type { NextApiRequest, NextApiResponse } from "next";

import { parseFileToMarkdown, readCustomPdfParseConfig } from "./parser";
import type { UploadFileResult } from "./types";

const getFiles = (req: NextApiRequest): UploadFileResult[] =>
  Array.isArray(req.body?.files) ? (req.body.files as UploadFileResult[]) : [];

const callInternalParse = async (input: {
  fileName: string;
  type: string;
  buffer: Buffer;
}) => {
  const config = await readCustomPdfParseConfig();
  return parseFileToMarkdown({
    fileName: input.fileName,
    type: input.type,
    buffer: input.buffer,
    pdfParserConfig: config,
  });
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<{ files: UploadFileResult[] } | { error: string }>
) {
  const auth = await requireAuth(req, res);
  if (!auth) return;

  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    res.status(405).json({ error: `方法 ${req.method} 不被允许` });
    return;
  }

  const files = getFiles(req);
  if (files.length === 0) {
    res.status(400).json({ error: "缺少 files 参数" });
    return;
  }

  const parsedFiles = await Promise.all(
    files.map(async (file) => {
      if (!file.storagePath) {
        return {
          ...file,
          parse: {
            status: "error" as const,
            progress: 100,
            parser: "metadata" as const,
            markdown: file.parse?.markdown || "",
            error: "缺少文件路径",
          },
        };
      }

      try {
        const storagePath = assertChatStoragePath(file.storagePath);
        const { buffer } = await getObjectFromStorage({
          key: storagePath,
          bucketType: "private",
        });

        const parse = await callInternalParse({
          fileName: file.name,
          type: file.type,
          buffer,
        });

        if (file.markdownStoragePath) {
          const markdownPath = assertChatStoragePath(file.markdownStoragePath);
          await uploadObjectToStorage({
            key: markdownPath,
            body: parse.markdown || "",
            contentType: "text/markdown; charset=utf-8",
            bucketType: "private",
          });
        }

        return {
          ...file,
          parse,
        };
      } catch (error) {
        return {
          ...file,
          parse: {
            status: "error" as const,
            progress: 100,
            parser: "metadata" as const,
            markdown: file.parse?.markdown || "",
            error: error instanceof Error ? error.message : "解析失败",
          },
        };
      }
    })
  );

  res.status(200).json({ files: parsedFiles });
}

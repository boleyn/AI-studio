import type { NextApiRequest, NextApiResponse } from "next";

type FeishuConfigResponse = {
  enabled: boolean;
  appId: string;
  redirectUri: string;
};

const getFeishuConfig = (): FeishuConfigResponse => {
  const appId = process.env.FEISHU_APP_ID || "";
  const redirectUri = process.env.FEISHU_REDIRECT_URI || "";
  return {
    enabled: Boolean(appId && redirectUri),
    appId,
    redirectUri,
  };
};

export default function handler(req: NextApiRequest, res: NextApiResponse<FeishuConfigResponse | { error: string }>) {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    res.status(405).json({ error: `方法 ${req.method} 不被允许` });
    return;
  }

  res.status(200).json(getFeishuConfig());
}

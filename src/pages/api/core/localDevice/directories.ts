import path from "node:path";
import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { requireAuth } from "@server/auth/session";
import { findDevice } from "@server/localDevice/store";
import { requestProjectGrant } from "@server/localDevice/requestProjectGrant";
import { createLocalDeviceExecutor } from "@/agent/sandbox/environments/localDevice";

const inputSchema = z.object({ deviceId: z.string().uuid(), directory: z.string().max(4096).optional() }).strict();

export default async function directories(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).end();
  const auth = await requireAuth(req, res);
  if (!auth) return;
  const parsed = inputSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "目录请求无效" });
  const userId = String(auth.user._id);
  const { deviceId, directory } = parsed.data;
  const device = await findDevice(deviceId);
  if (!device || device.revoked || device.teamId !== userId || device.memberId !== userId)
    return res.status(404).json({ error: "设备不可用" });
  const windows = device.platform === "windows";
  const paths = windows ? path.win32 : path.posix;
  if (directory && (!paths.isAbsolute(directory) || directory.includes("\0")))
    return res.status(400).json({ error: "目录路径无效" });
  try {
    const token = "workspace-directory-picker";
    const grant = await requestProjectGrant({
      userId, memberName: auth.user.displayName || auth.user.username || userId,
      project: { token, name: "工作目录选择" }, deviceId,
    });
    const { exec } = await createLocalDeviceExecutor({ userId, deviceId, projectToken: token, grantId: grant.grantId });
    const current = directory ?? grant.workdir;
    let command: string;
    if (windows) {
      const literal = current.replaceAll("'", "''");
      const script = current === "" ? "Get-PSDrive -PSProvider FileSystem | ForEach-Object { $_.Root }"
        : `Get-ChildItem -LiteralPath '${literal}' -Directory -Force -ErrorAction Stop | ForEach-Object { $_.FullName }`;
      const encoded = Buffer.from(`$ErrorActionPreference='Stop'; $rows=@(${script}); [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -InputObject $rows -Compress)))`, "utf16le").toString("base64");
      command = `powershell.exe -NoProfile -NonInteractive -EncodedCommand ${encoded}`;
    } else {
      const literal = "'" + current.replaceAll("'", "'\\''") + "'";
      command = `cd ${literal} && test -r . && test -x . && { for f in ./* ./.[!.]* ./..?*; do if [ -d "$f" ]; then printf '%s\\0' "\${f#./}"; fi; done; } | base64`;
    }
    const native = current ? await exec("exit 97\n# ai-studio-directories-v1 " + Buffer.from(current).toString("base64"), { timeoutMs: 15000 }) : undefined;
    const legacy = !native || native.code === 97;
    const result = legacy ? await exec(command, { timeoutMs: 15000 }) : native;
    if (result.code !== 0) throw new Error();
    const encodedOutput = result.stdout.replace(/\s/g, "");
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encodedOutput)) throw new Error("incomplete_listing");
    const decoded = Buffer.from(encodedOutput, "base64").toString("utf8");
    if (!(windows && legacy) && decoded && !decoded.endsWith("\0")) throw new Error("incomplete_listing");
    const children: string[] = windows && legacy ? z.array(z.string()).parse(JSON.parse(decoded))
      : decoded.split("\0").filter(Boolean).map(name => paths.join(current, name));
    const parent = paths.dirname(current);
    return res.json({ current, parent: !current || parent === current ? (windows && current ? "" : null) : parent, children: children.sort() });
  } catch {
    return res.status(400).json({ error: "无法读取目录，请检查设备连接、账号授权或目录权限" });
  }
}

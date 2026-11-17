import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';

// 凭据仅从环境读取，不作为命令行参数、URL 或日志输出；拒绝跨域重定向泄露凭据。
const [base, manifestPath, packagePath] = process.argv.slice(2);
if (!base || !manifestPath || !packagePath || !process.env.CONNECTOR_ADMIN_TOKEN) {
  throw new Error(
    'Usage: CONNECTOR_ADMIN_TOKEN=<root session token> node packaging/push.mjs https://platform manifest.json installer.dmg (macOS) / executable (Windows/Linux)'
  );
}
const url = new URL('/api/admin/connector/push', base);
if (url.protocol !== 'https:' || url.username || url.password)
  throw new Error('A credential-free HTTPS platform URL is required');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
if (manifest.productionReady !== false)
  throw new Error('This endpoint is for internal test builds only');
const hash = createHash('sha256');
for await (const chunk of createReadStream(packagePath)) hash.update(chunk);
const sha256 = hash.digest('hex');
if (!manifest.artifacts?.some((artifact) => artifact.sha256 === sha256))
  throw new Error('Package hash is absent from manifest');
url.search = new URLSearchParams({
  platform: manifest.platform,
  arch: manifest.arch,
  version: manifest.version,
  sha256
}).toString();
const size = (await stat(packagePath)).size;
if (size > 128 * 1024 * 1024) throw new Error('Package exceeds 128 MiB');
const response = await fetch(url, {
  method: 'POST',
  redirect: 'error',
  duplex: 'half',
  headers: {
    'Content-Type': 'application/octet-stream',
    'Content-Length': String(size),
    token: process.env.CONNECTOR_ADMIN_TOKEN
  },
  body: createReadStream(packagePath)
});
const result = await response.json();
if (!response.ok || result.code !== 200)
  throw new Error(`Publish failed (${response.status}): ${result.message ?? result.code}`);
console.log(JSON.stringify(result.data, null, 2));

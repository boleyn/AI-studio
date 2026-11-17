import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOptions, readBranding, validatePlatformURL } from './build.mjs';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('release platform is required and contains only a public HTTPS origin', () => {
  assert.equal(validatePlatformURL('http://localhost:3000', true), 'http://localhost:3000');
  assert.throws(() => validatePlatformURL('http://localhost:3000'));
  assert.throws(() => validatePlatformURL('http://10.21.8.6:3000', true));
  assert.throws(() => validatePlatformURL('http://localhost:3000/path', true));
  assert.equal(validatePlatformURL('https://chat.asiainfo.tech/'), 'https://chat.asiainfo.tech');
  for (const value of [undefined, '', 'http://localhost:3000', 'https://user:pass@example.com',
    'https://example.com/path', 'https://example.com?token=secret', 'https://example.com/#fragment',
    "https://example.com/'"]) {
    assert.throws(() => validatePlatformURL(value));
  }
  assert.equal(parseOptions(['--version', '0.1.6', '--platform-url', 'https://example.com'],
    { platform: 'windows', arch: 'x64' }).platformURL, 'https://example.com');
});

test('OEM name uses connector override, then platform name, and rejects unsafe filenames', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'connector-brand-'));
  const config = join(directory, 'config.json');
  try {
    for (const [feConfigs, expected] of [
      [{ systemTitle: '腾云平台' }, '腾云平台连接器'],
      [{ systemTitle: '平台', connector: { name: '定制连接器' } }, '定制连接器'],
      [{}, 'AI-Chat连接器']
    ]) {
      await writeFile(config, JSON.stringify({ feConfigs, systemEnv: { secret: 'never bundled' } }));
      const branding = await readBranding(config);
      assert.equal(branding.name, expected);
      assert.ok(branding.iconPath.endsWith(join('public', 'favicon.ico')));
      assert.equal(branding.bundleId, 'tech.fastgpt.local-device');
    }
    await writeFile(config, JSON.stringify({ feConfigs: { connector: { name: '../escape' } } }));
    await assert.rejects(readBranding(config), /filename/);
    await writeFile(config, JSON.stringify({ feConfigs: { connector: { name: 'OEM', icon: '/brand/icon.png', bundleId: 'com.example.connector' } } }));
    const custom = await readBranding(config);
    assert.equal(custom.bundleId, 'com.example.connector');
    assert.ok(custom.iconPath.endsWith(join('public', 'brand', 'icon.png')));
    await writeFile(config, JSON.stringify({ feConfigs: { connector: { icon: '/../../private.png' } } }));
    await assert.rejects(readBranding(config), /outside public/);
    await writeFile(config, JSON.stringify({ feConfigs: { connector: { bundleId: 'bad<id' } } }));
    await assert.rejects(readBranding(config), /identifier/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('packaging validates explicit version and native GUI targets', () => {
  const host = { platform: 'darwin', arch: 'arm64' };
  assert.equal(parseOptions(['--version', '0.1.0'], host).arch, 'arm64');
  const win = parseOptions(['--version', '0.1.0', '--platform', 'windows', '--arch', 'amd64'], host);
  assert.equal(win.platform, 'windows');
  for (const args of [[], ['--version'], ['--version', '../escape'], ['--version', '1.0.0', '--shell', 'cmd'], ['--version', '1.0.0', '--version', '2.0.0'], ['--version', '1.0.0', '--platform', 'linux'], ['--version', '1.0.0', '--arch', 'unknown']]) {
    assert.throws(() => parseOptions(args, host));
  }
});

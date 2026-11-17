import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, symlink } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(project, '../..');

/** 只读取 OEM 展示字段；私有平台配置绝不写入安装包或 manifest。 */
export async function readBranding(configPath) {
  let feConfigs = {};
  try {
    const raw = await readFile(configPath, 'utf8');
    feConfigs = JSON.parse(raw)?.feConfigs ?? {};
  } catch {
    // Fallback to AI Studio defaults when no external config file exists
  }
  const name = feConfigs.connector?.name ?? 'AI Studio 连接器';
  if (
    typeof name !== 'string' ||
    !name.trim() ||
    name.length > 100 ||
    /[\x00-\x1f\x7f/\\:"'<>|?*]/u.test(name)
  )
    throw new Error('OEM connector name must be a valid application filename');
  const icon = feConfigs.connector?.icon ?? feConfigs.favicon ?? '/favicon.ico';
  const publicRoot = resolve(repoRoot, 'public');
  if (typeof icon !== 'string' || !icon.startsWith('/') || icon.startsWith('//'))
    throw new Error('Connector icon must reference a local public PNG/ICO/ICNS asset');
  const iconPath = resolve(publicRoot, icon.slice(1));
  if (!iconPath.startsWith(publicRoot + sep))
    throw new Error('Connector icon is outside public assets');
  const bundleId = feConfigs.connector?.bundleId ?? 'ai.studio.local-device';
  if (typeof bundleId !== 'string' || !/^[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+$/.test(bundleId))
    throw new Error('Invalid OEM bundle identifier');
  return { name, iconPath, bundleId };
}

/** Only explicit known targets/versions are accepted; no shell interpolation or deployment. */
export function parseOptions(argv, host = { platform: process.platform, arch: process.arch }) {
  const values = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    if (
      ![
        '--platform',
        '--arch',
        '--version',
        '--output',
        '--go',
        '--config',
        '--platform-url',
        '--dev-loopback',
        '--signing-identity'
      ].includes(key) ||
      !argv[i + 1] ||
      key in values
    )
      throw new Error('Expected unique --platform/--arch/--version/--output/--go arguments');
    values[key] = argv[i + 1];
  }
  const platform = values['--platform'] ?? host.platform;
  const arch = values['--arch'] ?? (host.arch === 'x64' ? 'amd64' : host.arch);
  const version = values['--version'];
  if (!['darwin', 'windows', 'linux'].includes(platform) || !['arm64', 'amd64'].includes(arch))
    throw new Error('Unsupported platform/architecture');
  if (!version || !/^\d+\.\d+\.\d+$/.test(version))
    throw new Error('An explicit numeric --version is required');
  if (
    platform !== 'windows' &&
    (host.platform !== platform || (host.arch === 'x64' ? 'amd64' : host.arch) !== arch)
  )
    throw new Error('macOS/Linux GUI builds require a native host and architecture');
  const signingIdentity = values['--signing-identity'];
  if (
    signingIdentity &&
    (platform !== 'darwin' ||
      signingIdentity === '-' ||
      signingIdentity.length > 200 ||
      /[\x00-\x1f\x7f]/u.test(signingIdentity))
  )
    throw new Error('--signing-identity requires a macOS certificate identity');
  return {
    platform,
    arch,
    version,
    platformURL: values['--platform-url'],
    signingIdentity,
    devLoopback: values['--dev-loopback'] === '1',
    output: resolve(values['--output'] ?? join(project, 'dist')),
    go: values['--go'] ?? 'go',
    config: resolve(
      values['--config'] ?? process.env.CONFIG_JSON_PATH ?? join(repoRoot, 'config/config.json')
    )
  };
}

/** 发行包必须显式绑定公开 HTTPS 平台；拒绝凭据、路径及链接参数，避免误分发。 */
export function validatePlatformURL(value, devLoopback = false) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('An explicit HTTPS --platform-url is required');
  }
  const localDev =
    devLoopback &&
    url.protocol === 'http:' &&
    ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    (!localDev && url.protocol !== 'https:') ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== '/' && url.pathname !== '') ||
    /[\s'"\\]/u.test(value)
  ) {
    throw new Error(
      '--platform-url must be an HTTPS origin without credentials, path or parameters'
    );
  }
  return url.origin;
}

/** Builds a fresh package. Explicit macOS identities sign the app, helper and DMG; notarization is separate. */
export async function build(options) {
  const platformURL = validatePlatformURL(options.platformURL, options.devLoopback);
  const { name, iconPath: brandingIconPath, bundleId } = await readBranding(options.config);
 let iconPath = brandingIconPath;
  const run = (program, args, env = process.env) => {
    const result = spawnSync(program, args, { cwd: project, env, stdio: 'inherit', shell: false });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${program} failed (${result.status})`);
  };
  await mkdir(options.output, { recursive: true });
  const directory = join(options.output, `${options.version}-${options.platform}-${options.arch}`);
  await mkdir(directory); // Existing packages are never silently overwritten.
  // 原生 macOS 工具将 OEM 图标转换为应用多分辨率图标与托盘 PNG，不依赖远程图片。
  const trayPath = join(directory, 'tray.png');
  if (options.platform === 'darwin') {
    iconPath = join(directory, 'Connector.png');
    run('/usr/bin/swift', [join(project, 'native/macos/ConnectorIcon.swift'), iconPath, trayPath]);
    run('/usr/bin/sips', ['-z', '32', '32', trayPath, '--out', trayPath]);
  }
  const staging = join(directory, 'installer');
  const bundle = join(staging, `${name}.app`);
  const installer = join(directory, `${name}-${options.version}-${options.arch}.dmg`);
  const binary =
    options.platform === 'darwin'
      ? join(bundle, 'Contents', 'MacOS', name)
      : join(directory, options.platform === 'windows' ? `${name}.exe` : name);
  await mkdir(dirname(binary), { recursive: true });
  if (options.platform === 'darwin') {
    run('/usr/bin/swiftc', [
      '-parse-as-library',
      '-O',
      '-target',
      options.arch === 'arm64' ? 'arm64-apple-macos12.0' : 'x86_64-apple-macos12.0',
      join(project, 'native/macos/ConnectorDialog.swift'),
      '-o',
      join(dirname(binary), 'connector-dialog')
    ]);
  }
  const linker = ['-s', '-w', `-X=main.version=${options.version}`];
  if (options.devLoopback) linker.push('-X=main.devLoopback=1');
  linker.push(`-X=fastgpt.local/local-device/internal/desktop.PlatformOrigin=${platformURL}`);
  // Go 的 -ldflags 有自己的引号解析；禁止单引号以避免注入链接参数。
  linker.push(`'-X=fastgpt.local/local-device/internal/desktop.ProductName=${name}'`);
  if (options.platform === 'darwin')
    linker.push(
      `-X=fastgpt.local/local-device/internal/desktop.ProductIconBase64=${(await readFile(trayPath)).toString('base64')}`
    );
  if (options.platform === 'windows') linker.push('-H=windowsgui');
  run(
    options.go,
    [
      'build',
      '-trimpath',
      '-buildvcs=false',
      '-ldflags',
      linker.join(' '),
      '-o',
      binary,
      './cmd/connector'
    ],
    {
      ...process.env,
      GOOS: options.platform,
      GOARCH: options.arch,
      CGO_ENABLED: options.platform === 'windows' ? '0' : '1'
    }
  );
  if (options.platform === 'darwin') {
    const template = await readFile(join(project, 'packaging', 'macos', 'Info.plist'), 'utf8');
    const xmlName = name.replaceAll('&', '&amp;');
    await writeFile(
      join(bundle, 'Contents', 'Info.plist'),
      template
        .replaceAll('{{PRODUCT_NAME}}', xmlName)
        .replaceAll('{{BUNDLE_ID}}', bundleId)
        .replace('<string>0.1.0</string>', `<string>${options.version}</string>`)
    );
    const resources = join(bundle, 'Contents', 'Resources');
    const iconset = join(directory, 'Connector.iconset');
    await mkdir(resources, { recursive: true });
    await mkdir(iconset);
    for (const size of [16, 32, 128, 256, 512]) {
      for (const scale of [1, 2]) {
        run('/usr/bin/sips', [
          '-s',
          'format',
          'png',
          '-z',
          String(size * scale),
          String(size * scale),
          iconPath,
          '--out',
          join(iconset, `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`)
        ]);
      }
    }
    run('/usr/bin/iconutil', ['-c', 'icns', iconset, '-o', join(resources, 'Connector.icns')]);
    const signingArguments = [
      '--force',
      '--sign',
      options.signingIdentity ?? '-',
      ...(options.signingIdentity ? ['--options', 'runtime', '--timestamp'] : [])
    ];
    run('/usr/bin/codesign', [...signingArguments, join(dirname(binary), 'connector-dialog')]);
    run('/usr/bin/codesign', [...signingArguments, bundle]);
    run('/usr/bin/codesign', ['--verify', '--strict', bundle]);
    await symlink('/Applications', join(staging, 'Applications'));
    run('/usr/bin/hdiutil', [
      'create',
      '-volname',
      name,
      '-srcfolder',
      staging,
      '-format',
      'UDZO',
      installer
    ]);
    if (options.signingIdentity) {
      run('/usr/bin/codesign', [
        '--force',
        '--sign',
        options.signingIdentity,
        '--timestamp',
        installer
      ]);
      run('/usr/bin/codesign', ['--verify', '--strict', installer]);
    }
  }
  const artifacts = [binary];
  if (options.platform === 'darwin') artifacts.push(installer);
  const hashes = await Promise.all(
    artifacts.map(async (path) => ({
      file: path.slice(directory.length + 1),
      sha256: createHash('sha256')
        .update(await readFile(path))
        .digest('hex')
    }))
  );
  await writeFile(
    join(directory, 'manifest.json'),
    JSON.stringify(
      {
        version: options.version,
        platform: options.platform,
        arch: options.arch,
        name,
        productionReady: false,
        developmentLoopback: options.devLoopback === true,
        platformURL,
        signing:
          options.platform === 'darwin'
            ? options.signingIdentity
              ? 'developer-id-not-notarized'
              : 'ad-hoc-not-notarized'
            : 'unsigned',
        signingIdentity: options.signingIdentity,
        artifacts: hashes
      },
      null,
      2
    ) + '\n'
  );
  await writeFile(
    join(directory, 'INSTALL.txt'),
    [
      options.signingIdentity
        ? 'DEVELOPER ID SIGNED TEST BUILD — NOT NOTARIZED'
        : 'DEVELOPMENT BUILD — NOT SIGNED FOR PUBLIC DISTRIBUTION',
      `Version ${options.version}; ${options.platform}/${options.arch}`,
      'Run the connector as your normal user, not Administrator/root.',
      `Platform: ${platformURL}. Open the platform in your browser to pair this computer.`,
      'Pairing does not authorize commands. Approve each conversation locally.',
      'Use the tray menu to pause, stop the current command, revoke approvals, or quit.',
      `Windows: launch ${name}.exe. PowerShell is the default; no policy bypass.`,
      `macOS: open the DMG and drag ${name}.app into Applications.`,
      'Do not disable OS security checks. Public distribution requires trusted signing/notarization.',
      'Linux: a graphical session and the platform tray/AppIndicator libraries are required.',
      'No automatic startup, elevation, or automatic update is installed.',
      ''
    ].join('\n')
  );
  return directory;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    console.log(await build(parseOptions(process.argv.slice(2))));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

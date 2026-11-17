# 客户端连接器与后端开发接手指南

更新日期：2026-11-10。本文用于开发接手，不代表某个部署环境已完成上线验收。当前行为以代码及下述跨端约定为准；按日期、版本保留的发行记录只说明当时的验证范围。

## 先读这些

- [架构与协议设计](../../.agents/design/core/ai/local-device-connector.md)：设计背景、授权边界及历史决策；其中未勾选事项需以代码和验收记录核实。
- [本地联调](DEVELOPMENT.md)：启动入口与开发模式。
- [安装包分发](packaging/DOWNLOADS.md)：下载页、上传接口及版本管理。
- [仓库代码规范](../../.agents/code/syntax.md)：开始修改前阅读。

## 用户应看到的流程

1. 开发者按目标平台打包，预置平台 HTTPS 地址、名称和品牌。
2. 用户启动客户端，客户端驻留托盘；不要求用户输入平台地址、网关地址或 Token。
3. 用户在网页“管理我的设备”中点击“连接此电脑”，在本机确认绑定。
4. 网页选择该设备；执行会话仍需本机单独授权并选择工作目录。
5. macOS 菜单栏只展示原创图标和状态点，产品名称、版本号及授权管理放在菜单中。绿色为已连接，橙色为连接中或等待授权，红色为断线，灰色为暂停。
6. 授权管理内切换列表、添加授权和连接设置，不另外创建表单窗口。地址历史保留，默认平台位于首位，新增地址测试通过后保存。
7. 收到执行授权申请时先关闭管理窗口并等待其进程退出，再显示授权申请。申请期间管理入口唤回授权窗口，不能拒绝请求或再开管理窗口。
8. “允许执行”始终可点击。弹窗已有有效工作目录时可直接确认，首次授权和更换目录申请均可沿用当前目录；没有目录或目录失效时，点击后打开目录选择器，取消不批准授权。网页失败显示带原因及“取消 / 重试”的弹窗，重试保持原设备和更换目录意图。
9. 从当前聊天的设备管理入口完成新绑定后，自动为该聊天选择新设备并走执行授权流程；绑定成功本身不等于可以执行。从独立设备管理页绑定，不能据此改写其他聊天的选择。
10. 已授权会话取消“更换工作文件夹”时，重验原授权及设备仍可用后静默关闭，继续使用原目录；首次授权取消仍是未授权。具体校验见下述跨端约定。

设备配对不等于执行授权。工作目录是命令默认目录，不是文件访问沙箱。命令以当前操作系统用户身份运行。

## 架构与职责

| 部分 | 入口/目录 | 职责 |
| --- | --- | --- |
| Go 客户端 | `cmd/connector` | 启动配置、Windows 单实例、桌面生命周期 |
| 桌面适配 | `internal/desktop`、`native/macos` | 托盘、原生配对与会话确认窗口 |
| 客户端核心 | `internal/connector` | 服务发现、配对、公钥身份认证、重连和会话生命周期 |
| 本机配对桥 | `internal/pairbridge` | 监听 `127.0.0.1:13005`，向指定网页 Origin 提供配对握手 |
| 身份存储 | `internal/devicekey` | 分平台保存设备私钥；Windows 使用用户级 DPAPI，macOS 使用钥匙串 |
| 授权与任务 | `internal/grant`、`internal/operation` | 会话授权、撤销、任务幂等、状态和输出 |
| 本地日志 | `internal/journal` | SQLite 任务/绑定状态与进程锁 |
| 原生执行 | `internal/executor` | Shell 选择、输出、退出码、超时和进程树取消 |
| App 内置通信 | `packages/service/core/localDevice/socket.ts` | 客户端长连接、平台票据校验、在线路由与进程内调用 |
| 协议 | `internal/protocol` | 帧结构与消息约束 |
| NextJS 接口 | `projects/app/src/pages/api/core/localDevice` | 服务发现、配对、设备管理、票据和会话授权 |
| App 调用层 | `projects/app/src/service/core/chat/localDevice.ts` | 聊天与本机执行能力接入 |
| 后端公共能力 | `packages/service/core/localDevice` | 网关调用、持久化与业务能力 |

客户端主动向 App 的 `/local-device/connect` 建立 WS/WSS 连接。网页不直接调用本机 Shell；回环服务只用于配对。服务端仅保留 TypeScript App 内置通信层，独立 Go 网关及外部 RPC 适配已删除。

## 配置放在哪里

| 配置 | 位置 | 生效方式 |
| --- | --- | --- |
| 平台地址 | 打包参数 `--platform-url` | 嵌入客户端，需要重新构建 |
| 名称、macOS bundleId | App `config.json` 中公开 OEM 字段 | 打包读取，需要重新构建客户端 |
| 托盘与应用图标 | macOS 使用 `native/macos/ConnectorIcon.swift`，Windows 托盘使用 `internal/desktop/tray.go` | 运行时托盘图标与应用文件图标分别构建，见下文 |
| 默认通信地址 | App 请求的协议和 Host | 服务发现返回同源 WebSocket 地址 |
| 配对身份、授权、任务状态 | 当前用户状态目录 | 由客户端管理，不随包分发 |
| 下载入口 | OEM releases 或安装包上传接口 | 见分发文档 |

`config.json` 不是网关运行配置。不要把完整 config.json、数据库连接、网关 Token 或私钥嵌入客户端。

默认状态目录由 `os.UserConfigDir()` 下的 `FastGPT/local-device` 决定；Windows 通常为 `%APPDATA%/FastGPT/local-device`。`--state-dir` 可用于隔离开发状态。不要通过删除用户身份文件解决重连问题，应使用重新配对流程。

Windows 0.1.7 起，当前用户会话使用命名互斥量限制单实例，名称不依赖 exe 路径或版本。再次启动通过同一用户会话的命名事件通知已有进程打开授权管理，然后退出；通知不依赖网络、配对桥或平台凭据。退出或崩溃后内核自动释放对象。旧版进程没有唤起事件监听，升级后应先退出旧版再启动新版；互斥量也不会阻止不含单实例逻辑的更旧进程。

## 快速开发路线

先安装仓库要求的 Node/pnpm、执行 `pnpm install --frozen-lockfile`，安装 `go.mod` 指定的 Go 工具链。实际版本以各 package.json 和 go.mod 为准。

### 开发启动

在仓库根目录运行 `pnpm dev`，复用远端依赖并启动 App。在 `projects/app` 下运行 `pnpm dev`，则使用该应用已有的环境配置。两种入口都由同一个 TypeScript App 进程处理网页、API 和连接器通信。

默认入口为 `http://localhost:3000`。连接器先访问服务发现 API，再通过同一地址的 `/local-device/connect` 建立 WebSocket。App 从已验证的设备票据识别连接归属，授权、任务、输出和取消在进程内路由。此启动方式只需要 App 端口，服务端不依赖 Go 工具链或独立网关凭据。客户端连接器继续使用 Go。

`pnpm dev:device` 保持可用。桌面连接器通过已安装的 App 或网页「连接此电脑」启动。调试连接器源码时，可另用 `pnpm dev:device -- --connector`，它使用隔离身份目录 `.codex-tmp/local-device-dev`。

可配置 `GO_BIN`、`FASTGPT_DEV_APP_PORT`。不再使用独立设备网关端口配置；macOS 构建原生窗口需要 Xcode Command Line Tools。

Windows 注意：`scripts/dev-local-device.mjs` 的 pnpm 子进程启动及退出清理尚未完成真实端到端验收；遇到 cmd shim 启动问题应先检查脚本跨平台 spawn，不能用跳过授权替代联调。Go 测试通过不代表此启动脚本已通过。

### 本地 App 复用远端依赖

```sh
pnpm dev:server
```

该命令复用远端 App 的数据库、缓存、存储和代码沙盒配置，沙盒经 SSH 转发。连接器通信由 App 内置处理。共享数据库的本地测试会写入远端环境。

启动器仅启动 App；端口被其他进程占用时会明确报错。

## 构建可分发客户端

仓库根目录执行，平台地址由开发者确定：

```sh
node projects/local-device/packaging/build.mjs --platform windows --arch amd64 --version 0.2.0 --platform-url https://your-platform.example
```

macOS 在对应架构的 Mac 上执行：

```sh
node projects/local-device/packaging/build.mjs --platform darwin --arch arm64 --version 0.2.0 --platform-url https://your-platform.example
```

支持 `--go` 指定 Go 可执行文件、`--config` 指定 OEM JSON5 配置、`--output` 指定输出目录。平台地址必须是无凭据、路径、查询参数及片段的 HTTPS origin；漏配会在创建产物前失败。

输出目录为 `dist/<version>-<platform>-<arch>`；已有同名目录不会覆盖。包含二进制、manifest 摘要和 INSTALL.txt，macOS 另有 DMG。Windows 当前输出便携 exe，不是 MSI 安装器，不安装开机启动项；Windows 文件图标及签名体验仍需专门验收。

macOS 支持 `--signing-identity` 指定 Developer ID Application 企业证书，构建器为辅助窗口、主 App 和 DMG 签名，启用 hardened runtime 与可信时间戳。不传参数仍为 ad-hoc。签名不等于公证。Windows 构建器默认输出未签名 EXE，内部包 0.1.52/0.1.54/0.1.55 已采用构建后自签名及时间戳；自签名需要 IT 部署公钥证书信任，不代表公开可信或 SmartScreen 放行。各平台自动更新尚未实现，签名与上传顺序见[分发文档](packaging/DOWNLOADS.md#windows-内部签名与交付)。

### 托盘图标与应用图标

托盘图标出现在 macOS 菜单栏或 Windows 通知区域，由进程启动时设置。应用图标来自安装包里的应用资源，用于 Finder、Dock 或 Windows 资源管理器。修改品牌图案时，分别检查这两处。

**macOS**

- 图案源文件是 `native/macos/ConnectorIcon.swift`。打包时分别生成应用用的 `Connector.png` 和托盘用的 `tray.png`。构建器用 `sips` 把托盘图缩到 32×32，再通过 Go 链接参数写入 `desktop.ProductIconBase64`。状态点由 `internal/desktop/status_darwin.m` 单独绘制。
- 应用 PNG 经 `sips` 生成多尺寸 iconset，再由 `iconutil` 输出 `Contents/Resources/Connector.icns`。`packaging/macos/Info.plist` 通过 `CFBundleIconFile` 引用它。改图后重新构建，再签名和公证。

**Windows 通知区域**

- `internal/desktop/run.go` 启动时调用 `systray.SetTemplateIcon`，图像来自 `internal/desktop/tray.go` 的 `trayIcon()`。当前 Windows 包使用该函数绘制的默认图案。要接入品牌图案，可在 `packaging/build.mjs` 的 Windows 分支准备透明背景的 32×32 PNG，并复用 `-X=fastgpt.local/local-device/internal/desktop.ProductIconBase64=<PNG 的 Base64>` 注入路径。
- `trayIcon()` 会检查 PNG 尺寸，输入缺失或无效时回退到默认图案。它在 Windows 上会把 PNG 封装成 ICO 字节再交给托盘库。因此构建注入的原始素材应是 PNG，托盘库接收的是 ICO。

**Windows EXE 应用图标**

- 当前 Windows 构建只传 `-H=windowsgui` 设置 GUI 子系统，尚未嵌入品牌图标资源。要让资源管理器显示品牌图标，应将多尺寸 ICO 编入 EXE 的 PE 资源。建议在 ICO 内包含 16、24、32、48、64、128、256 像素的透明图层。
- amd64 构建可在临时资源目录准备 `Connector.ico` 与 `connector.rc`，在 RC 中写入 `1 ICON "Connector.ico"`。从该目录执行下列命令，把生成的 COFF 资源放到 `cmd/connector` 包，随后运行上节 Windows 打包命令。arm64 需要能输出 ARM64 COFF 的资源编译器，并使用 `_windows_arm64.syso` 后缀。

```sh
x86_64-w64-mingw32-windres -O coff -i connector.rc \
  -o /path/to/ai-chat/projects/local-device/cmd/connector/connector_windows_amd64.syso
```

Go 构建会将匹配目标系统和架构的 `.syso` 链入 EXE。正式接入时将资源生成纳入 `go build` 前的打包步骤，确保最终 EXE 生成后再计算 manifest 摘要或签名。

Windows 授权管理等对话框由 `internal/desktop/dialog_windows.ps1` 创建，窗口和任务栏图标通过 WPF 的 `Window.Icon` 设置，需要单独接入本地打包素材。验收时用新版本文件名在真实 Windows 上检查资源管理器、通知区域和打开窗口后的任务栏，避免图标缓存干扰。

### macOS 公证与发布

使用本机钥匙串已有的公证 profile，不在源码、日志或命令历史写入密码。证书 Team 与公证账号须具备对应团队权限。

```sh
xcrun notarytool submit '<安装包.dmg>' --keychain-profile '<profile>' --output-format json
xcrun notarytool info '<submission-id>' --keychain-profile '<profile>'
xcrun notarytool log '<submission-id>' --keychain-profile '<profile>'
xcrun stapler staple '<安装包.dmg>'
xcrun stapler validate '<安装包.dmg>'
spctl --assess --type open --context context:primary-signature --verbose=2 '<安装包.dmg>'
```

必须取得 Accepted 后再装订并发布；Invalid 时读取公证日志修复，不绕过 Gatekeeper。装订会改变 DMG 摘要，必须重算 manifest 中 SHA-256。上传后核对下载列表版本，并重新下载比较摘要。平台下载通道不自动验证公证。发布者完成验证后，在 `packages/service/core/localDevice/release/verification.ts` 登记最终摘要、平台架构、版本与 Apple 提交编号。公开 API 仅在完整匹配凭据时返回 notarization；下载页按产品要求不展示签名与公证提示。未登记或换包后不能仅凭版本号继承认证。

主 App 的公证票据可在获批后单独装订；若重做 DMG，须重新签名、提交该最终 DMG 并验证，不能继续发布旧摘要。

不得打包状态目录、设备私钥、授权链接或账号凭据。公证只认证分发包，不代表多账号绑定、实际授权或执行已验收。

## 后端与网关部署契约

当前默认部署只有 App 服务。反向代理需要将 `/local-device/connect` 转发至 App，并支持 WebSocket Upgrade 与长连接。发现和认证接口需要拿到实际 Node HTTP Server，挂载升级监听器。

旧独立网关的环境变量、票据兑换 API 和服务入口均已删除，不再提供外部网关兼容模式。内置路由驻留单个 App 进程，尚未实现多副本间连接路由；扩容前必须补齐路由方案，不能直接声明支持集群。

用户可切换 HTTP/HTTPS 的本机、内网、公网 IP 或域名，运行时不限制主机范围；HTTPS 仍验证证书。HTTP 对应 WS，HTTPS 对应 WSS，不应要求用户额外填写网关地址。

公开服务发现用于首先确认配置是否具备：

```sh
curl -X POST -H 'Content-Type: application/json' -d '{}' https://your-platform.example/api/core/localDevice/discovery
```

返回的业务 `data.available` 应为 true，并包含协议版本及公开 gatewayUrl。注意此接口是配置发现，不是网关健康检查；true 后仍需验证 TLS、WSS 握手和票据认证。

## 常见问题排查顺序

| 现象 | 先检查 | 相关代码 |
| --- | --- | --- |
| 网页访问不到本机连接器 | 进程、13005 监听、发现接口、托盘错误，再查浏览器本地网络权限 | desktop / pairbridge / connector |
| `platform_connector_unavailable` | 发现接口是否可访问、是否 available:false，确认 App 版本及路由 | discovery.ts / connector/platform.go |
| 进程在但 13005 不监听 | 启动失败后桥随上下文关闭；检查网关发现、Shell、状态目录、托盘提示 | desktop/dialog.go / connector/start.go |
| 回环接口返回 403 | Origin 是否和包内平台一致，Host 是否精确匹配 | pairbridge/server.go |
| 配对成功但不能执行 | 会话授权、到期/撤销、当前设备选择、客户端在线状态 | grant / operation |
| 解绑重装后首轮 `device_revoked`，重选设备后恢复 | 浏览器是否残留旧 deviceId/grantId，新绑定是否回调到当前聊天选择 | LocalDevice/DeviceManager.tsx / store.ts / LocalDeviceSelector.tsx |
| 取消换目录后误报“没能完成授权” | 是否重验并保留原授权，是否把取消新申请误当作撤销原授权 | LocalDevice/request.ts / LocalDeviceSelector.tsx |
| 菜单已显示新目录，Agent 仍引用历史目录 | 本轮动态上下文和工具实际 workdir，区分默认目录与命令显式指定目录 | chat/localDevice.ts / agent/adapter/userContext.ts / executor |
| 文件操作成功、脚本失败，返回 `grant_rejected` | 先确认原始工具回执及失败阶段，查本机授权诊断；不能据此推断命令黑名单 | connector/local.go / session.go / grant/manager.go |
| 启动服务后立即退出 | 主命令是否已结束、进程是否被 Job/进程组清理，不能只看 Start-Process 返回成功 | executor/process_windows.go / process_unix.go |
| Windows 多个托盘 | 是否还有旧版，当前用户会话是否已有新实例 | cmd/connector/instance_windows.go |
| 取消显示失败 | 检查启动与 Job 绑定期间取消的竞态 | executor/executor.go / process_windows.go |
| 下载包品牌或平台错误 | 构建使用的 config 与 --platform-url，不是只修改服务端配置 | packaging/build.mjs |

Windows 可用 `Get-NetTCPConnection -LocalPort 13005` 检查监听；带正确 Origin 请求 `http://127.0.0.1:13005/status` 检查配对桥。排查时不要重复双击启动更多旧客户端。

2026-11-10 本机检测约定：设备面板打开及手动刷新时，只读探测 `/status`，与服务端设备列表请求独立；未绑定也可以识别运行中的客户端。新客户端在原身份字段之外返回 `version`（构建版本）和 `platform`（windows/darwin/linux），桌面各端共享该实现，原 Host/Origin、无缓存和原生确认约束不变。旧客户端缺少版本字段时显示“当前版本暂不可读取”，不得拿服务端设备版本或下载页最新版冒充本机版本。

浏览器无法直接枚举已安装软件；超时、进程未启动、本地网络权限或平台 Origin 不匹配都可能导致检测失败，统一提示“未检测到运行中的连接器”，引导打开已有客户端或下载，保留手动重新检测。检测结果与对应系统下载入口放在顶部连接卡片；未探测成功时以浏览器桌面系统信息推荐 Windows/macOS/Linux，未知或移动平台提供通用下载页，不推断 CPU 架构。下载链接定位 `/connector#windows` 等对应系统区域，由用户选择架构。网页变更需部署 App，版本展示还需安装支持新字段的客户端；此检测不申请配对或执行权限。

当前桥与连接生命周期耦合：即使短暂启动监听，连接器核心启动失败后也会关闭。网页可能因此显示泛化的“访问不到连接器”，不能据此认定为防火墙问题。

## 跨端行为与实现约定

### 设备选择与重新绑定

- 浏览器按成员、应用、会话和分享入口隔离选择，只持久化目标，不持久化等待授权的 UI 状态。服务端和本机仍须重验，不能信任 localStorage 表示已授权。
- 解绑标记引用该设备的旧选择为 revoked，保留显式目标以阻止下一轮悄悄退回云端。新绑定使用新 deviceId，必须清理相关旧申请缓存、刷新列表，并由当前聊天重新申请执行授权。
- `DeviceManager` 的绑定完成回调须识别本轮实际新增且未撤销的设备，避免把列表中的旧在线设备当作新绑定。回调不得因重复轮询多次触发；组件关闭、入口变化或迟到响应不能覆盖后来的选择。
- 设备列表包含解绑记录且有分页，不能凭首屏没有目标判断解绑。仅用户明确切回云端才清除本机选择；失效、离线或授权失败不能自动换执行目标。

### 工作目录确认和取消

- 两端都不能用“是否打开过目录选择器”或“是否改过路径”作为允许执行的前提。已有有效目录可直接批准；无有效目录时点击确认再选择目录，选择器取消不得产生批准结果。
- “更换工作文件夹”只是提出新的确认申请，到达弹窗时可能还没改目录；用户也可以确认沿用原路径。首次授权、更换目录和取消必须分别测试。
- 取消更换申请后，网页重读原授权，核对 grantId、deviceId、appId、chatId、未撤销、本机已批准、exec 能力、有效期和非空目录，再遍历设备分页确认目标在线且未解绑。全部通过才静默保留原目录；失效、离线或读取失败仍提示真实失败。
- 保留结果还须核对请求序号、组件存活状态和当前选择，迟到响应不能恢复用户已经撤销或替换的授权。取消新申请不等于撤销原授权，也不能只凭浏览器缓存静默成功。

### 每轮模型上下文与实际目录

- `projects/app/src/service/core/chat/localDevice.ts` 从服务端校验后的设备系统和会话授权目录生成一行事实：`本轮本机执行环境：Windows；默认工作目录：D:\work`。macOS/Linux 使用对应系统名和实际路径。
- 该行经 `localDeviceRuntime.environmentPrompt`、`agent/adapter/userContext.ts` 进入本轮用户消息的背景信息，仅在当前应用实际选择本机时注入；不改全局 system prompt、不追加行为指令、不覆盖云端沙盒目录或已有工具描述。
- 下一轮重新读取有效授权，更换目录后无需重打客户端即可更新这行上下文。工具执行仍会重验授权；命令显式传入 workdir、使用绝对路径或自行 cd 时，实际位置可能与默认目录不同。结果 actualWorkdir 反映该次调用的起始目录，不跟踪脚本内部 cd 后的位置，不能把提示行或该字段当作执行约束。
- 历史消息不追加本轮环境。浏览器工作台工具回执恢复会跳过原用户消息，以避免重复执行；不能宣称每次恢复都重新注入了这行事实。

### 命令执行和后台服务

- 当前执行授权没有“仅文件读写但禁止脚本/子进程”的独立档位。文件工作台有不启动 Shell 的专用路径；其文件边界校验不等于普通命令的目录沙箱，文件操作成功也不能证明命令通道正常。
- 普通命令以当前系统用户启动本机 Shell。Windows 保留系统执行策略，不自动设置 Bypass、不提权、不在失败后换 Shell 重跑。应区分命令退出码、stderr、进程启动失败和命令派发前的授权控制错误。
- 每次命令是独立非交互进程，不保留前一次 cd 或环境变量。Windows 将进程树纳入 kill-on-close Job，macOS/Linux 使用进程组，并在主命令退出时清理所管理的子进程；Unix 刻意脱离进程组的后代不在清理保证内。
- 因此 `Start-Process` 或后台启动返回成功不保证服务能在该次调用结束后存活。当前不承诺托管长期后台服务；不能为了启动项目绕开进程收容、撤销或租约机制。长任务仍受授权、租约和命令超时约束。

## 修改与验收

### 原生确认窗口

Mac 界面在 `native/macos/ConnectorDialog.swift`，使用 SwiftUI；Windows 界面在
`internal/desktop/dialog_windows.ps1`，使用系统自带 WPF，由 `dialog_windows.go` 的
`go:embed` 编入 exe，不需要用户安装额外运行时或分发脚本文件。修改脚本后必须重新构建客户端。

两端采用相同的绑定卡片、执行授权说明、工作目录选择和确认反馈。绑定不授予命令权限；
执行授权必须确认有效目录，可沿用已有目录，不要求每次重新选择。Windows 默认焦点为取消，Escape 或关闭窗口
均返回拒绝；确认后延迟关闭并返回原有结果格式。系统关闭动画时，Windows 不播放等待动画。
外部平台地址和对话文字只能作为数据赋给控件，不能拼进 XAML 或 PowerShell 源码。

Windows UI 验收需覆盖绑定同意/取消、授权目录选择/取消、超长中文内容、键盘操作和高 DPI。
离屏渲染仅用于检查布局，不等同于真实网页绑定与执行验收。

Windows 双击 EXE 启动后自动打开授权管理，不等待平台连接完成；窗口显示版本、打开时的连接状态和网页连接引导。授权列表与连接状态是打开时的快照，点击「刷新」通过本机父子进程管道向控制器重新获取并原位更新，失败时保留原列表并允许重试，不能将启动时尚未加载的空列表解释成没有绑定。关闭管理窗口只关闭界面，托盘和连接继续运行；需要完全停止时使用托盘「退出连接器」。重复双击已有窗口时尝试恢复和激活，系统拒绝前台请求时闪烁任务栏三次；如已有授权确认弹窗，则优先唤起该弹窗，不替换它，也不自动同意授权。此启动体验需要重新打包客户端，macOS 原有启动行为不变。

2026-11-10 窗口感知改进：Windows 共享帮助脚本 `internal/desktop/window_windows.ps1` 在窗口首次 ContentRendered 时尝试激活及 SetForegroundWindow，失败后仅闪烁任务栏三次，获得焦点或关闭时停止提醒，不循环抢焦点或永久置顶。Windows 可以拒绝后台进程的前台请求，不能承诺每次都盖过浏览器或飞书。共享脚本与管理、确认脚本一并嵌入；只重打客户端不能更新网页提示。

同日 0.1.56 实机反馈：飞书前台时激活被拒绝，任务栏三次闪烁有效。窗口图标虽然赋值成功，Windows 未注入 macOS 的 ProductIconBase64，实际回退到原来的终端 `>_` 图案，视觉上仍像 PowerShell；不能将“Icon 非空”的单测当作品牌图案验收。默认图案改为内嵌 `internal/desktop/connector.png`，图形源为 `native/ConnectorIcon.svg`，复用 macOS 连接窗口标记，托盘与 WPF 使用同一份 PNG；原有效 OEM 32px PNG 覆盖能力保留。回归增加真实 HWND 的大小图标句柄检查。前台请求仍遵守系统限制，不能把有限闪烁称为自动切前台已经成功。
WPF 窗口使用连接器自身的 AppUserModelID 和 `windowPNG()` 品牌图案，避免沿用 PowerShell 的默认窗口身份；PNG 与托盘 ICO 分开提供，本机 WPF 解码器曾拒绝托盘用的 PNG-in-ICO 容器，不应直接把 trayIcon() 结果当作 WPF BitmapFrame 输入。
Windows 高 DPI 图标还须检查实际 HICON 中的透明边距：175% 缩放实测，WPF 将 32px 源图居中放入 56×56 的大 HICON，可见图案仅 28×28，造成任务栏图标明显偏小。窗口现在使用独立的 256px `connector-window.png`（源图 `native/ConnectorIcon.svg`），托盘保留 32px；旧 OEM 小 PNG 在 WPF 中先归一化到 256px。不要仅检查 WM_GETICON 返回非空或 HICON 尺寸，还要读取原生大小图标像素，检查可见图案占比；回归覆盖默认窗口资源和旧小图输入。图案修复需重新打包客户端。
网页按钮附近显示明显等待提示，说明可从任务栏打开连接器或旧版 PowerShell 窗口。邀请交接 HTTP 请求返回不等于本机已确认；邀请仍等待确认时保持按钮等待状态，邀请完成、取消或过期后结束。网页提示与客户端前台行为分别回归；不自动批准、不模拟用户点击确认。真实飞书/浏览器遮挡与系统焦点限制仍需实机验收。

Windows 管理页在 `internal/desktop/management_windows.ps1`，由 `settings_windows.go`
传入当前平台、默认发行平台、地址历史和本地授权快照。列表、添加授权和设置在一个窗口内切换；
撤销需要二次确认，设置页调用当前 exe 的 `--test-platform`，测试通过且地址未改变才能保存。
Go 控制器继续校验并处理 `invite:`、`settings:`、`revoke:`、`clear`，界面不直接修改权限或身份。
`dialog_windows.go` 管理窗口槽位和串行申请队列：安全申请关闭并等待管理 helper 退出，
申请期间的管理入口只唤回原窗口。脚本及 JSON 分行经 stdin 传递，避免编码脚本超过命令行上限。
helper 启动时先挂起并加入 Windows Job，再恢复运行；管理窗口被替换或取消时，
连接测试子进程一起清理。取消和关闭窗口不产生授权结果。

托盘只保留产品/版本/状态、授权管理、暂停、运行时的终止任务和退出。账号/会话撤销、添加授权及连接设置统一在管理窗口内操作。Windows 托盘库更新已隐藏菜单项可能重新插入旧项，所以废弃入口应从创建和事件处理两处删除，不能仅 Hide 后继续更新。两端管理页保持用户流程一致，布局使用各端原生控件；长路径、滚动、窗口缩放与高 DPI 分别验收。

- 改 Shell、取消或超时：检查 Windows Job 进程树、挂起启动、子进程清理、中文输出及退出码；不要改执行策略或自动提权。
- 改协议或 API：同时核对 Go 协议、全局 OpenAPI schema、后端处理和前端调用。NextJS API 入参使用 `parseApiInput`。
- 改桌面流程：Windows/macOS 分别真实操作，不能把跨平台编译当作运行证据。
- 改状态存储：保留身份兼容性，确认崩溃恢复和重复任务不会重放。

局部测试按改动目录执行，最终运行连接器全部测试：

```sh
cd projects/local-device
go test ./internal/executor ./internal/grant
go test ./...
```

打包测试在仓库根目录执行：

```sh
node --test projects/local-device/packaging/build.test.mjs
```

Node 后端变更使用 `pnpm test <实际测试文件路径>` 做局部回归，最终按仓库要求运行 `pnpm test`。不要把纯 Go 回归称为整个 monorepo 全量通过。

Windows 测试环境的已遇问题：

- 包装脚本若报 `spawn pnpm ENOENT`，可在对应 workspace 运行现有 Vitest，不修改业务代码规避。例如在 `packages/service` 执行 `node ../../node_modules/vitest/vitest.mjs run -c vitest.config.ts test/core/localDevice/gateway.test.ts test/core/localDevice/execute.test.ts --coverage.enabled=false --maxWorkers=1 --fileParallelism=false`；应用侧在 `projects/app` 使用其可解析的 Vitest 路径。记录实际运行的范围及退出码。
- 本机工具自带的 pwsh 曾因缺失 Modules 导致测试异常；检查实际解析到的 Shell 路径和 PSModulePath，仅调整测试进程环境，不能改变用户系统策略。Go 不在 PATH 时使用实际安装路径或构建器 `--go`，不要假定所有机器与开发机路径相同。
- PowerShell 冷启动可能超过 1 秒。组合/重连测试使用足够的启动时限，专门的超时测试单独验证取消；本轮仅将 Windows 组合测试时限调为 10 秒，没有放宽生产执行超时。
- Vitest 本轮相关套件退出码为 0，结束时仍出现过 ECONNRESET 输出。应同时检查测试汇总与退出码；若退出码非 0 或影响断言，必须排查，不能一律当作可忽略日志。

真实验收至少覆盖：干净用户状态启动不询问平台、重复启动、网页配对、原生拒绝/同意、会话授权、执行与中文输出、取消进程树、撤销、断网重连、客户端退出后无残留任务，以及下载产物摘要核对。

跨端回归还应覆盖：解绑旧设备→重新绑定→首次提问不再使用旧 ID；首次授权沿用默认目录；更换申请确认原目录；取消更换时原授权有效/失效/设备离线；更换目录后的下一轮上下文；同账号多设备及同平台多账号互不串用。实机执行与窗口验收应与单测分别记录。

## 已知验证范围与接手 TODO

### 任务中断复盘

新版执行结果增加可选字段 `terminationReason`、`startedAt`、`finishedAt`（Unix 毫秒），
随最终任务结果存入本机 `operations.sqlite` 的 operations.result，并通过网关返回工具结果。
旧客户端缺少这些字段时仍兼容；历史任务不能反推补齐原因。

原因码：`command_timeout` 命令时限到期、`local_user_stop` 托盘停止、
`remote_cancel_request` 后端取消请求、`execution_lease_expired` 短租约失效、
`grant_expired` 授权到期、`grant_revoked` 授权撤销、`connection_lost` 连接生命周期终止、
`connector_shutdown` 客户端有序退出、`cancellation_source_unknown` 来源未知。
后端取消请求不等于用户主动停止，需关联后端日志判定；强制杀进程无法保证写出最终原因。

按 operationId 关联客户端 `operation finished` 和后端 `Local device` 日志。

后端额外记录续租失败、输出校验失败、调用方取消或未取得终态触发取消。诊断日志不附带命令正文、标准输出、工作目录或 Token。SQLite 原有结果仍包含任务输出，交付排障材料时优先提供对应日志行，不直接公开整个状态目录。

### 授权控制失败诊断（2026-11-09 代码验证）

授权控制失败另写入当前平台状态目录的 `grant-diagnostics.jsonl`，每行包含 timestamp、stage、code、grantId、grantVersion 和 leaseRemainingMs；文件达到 1 MiB 后重新记录。桌面后台运行时无需依赖控制台即可保留这些诊断。多平台状态目录分别保存日志。
首次 `grant_renew` 在命令派发前完成，执行期间还会定时续租；续租报文没有命令正文。`grant_rejected` 只是未分类错误，不能据此推断脚本或子进程被禁止；同一个 grantId 跨调用复用是正常行为，不代表权限降级。诊断写入失败仍返回原授权错误，不影响批准、撤销和执行规则。

| 原因码 | 含义及排查方向 |
| --- | --- |
| `grant_unavailable` | 本机没有该授权，检查实际设备和授权引用及本地状态 |
| `grant_revoked` | 授权已撤销或会话被阻止，不自动恢复 |
| `grant_expired` | 本机批准的授权已到期 |
| `grant_permission_conflict` | 版本或权限字段不一致，包括目录、归属等；对照服务端与本机授权 |
| `account_access_paused` / `account_access_removed` | 本地账号访问暂停或已移除 |
| `invalid_execution_lease` | 租约已过期、超过本机当前时间 60 秒上界或超过原授权期限 |
| `grant_rejected` | 尚未分类，不能补推为某条命令被策略禁止 |

排查材料应包含客户端版本、平台、失败时间、原始工具名/命令/回执及对应本机诊断行。Agent 生成的测试表格和解释不等于原始执行记录；`probe.ps1` 失败也不能单独证明命令黑名单存在。
租约时间无效时结合 leaseRemainingMs 检查过期、时钟差及 60 秒上界；设备连接认证的 30 秒容差不适用于执行租约，不得通过放宽期限或跳过授权解决。原同事脚本故障的具体根因仍未实机确认。

2026-11-10 Windows 本地实测补充：使用隔离测试状态，调用实际连接器授权、Prepare 和执行服务，系统 PowerShell 的内联命令、`-File probe.ps1`、`& .\probe.ps1`、`Get-Process`、`Start-Process` 均可执行。另以真实平台主机时间构造当前后端相同的租约报文，命令超时 60/120 秒时到达本机的租约仍剩约 60080 ms，触发 `invalid_execution_lease`；15 秒租约通过。默认命令超时为 120 秒，因此即使短命令也可能命中 60 秒租约边界，不能按命令内容推断权限差异。旧客户端将此原因归为 `grant_rejected`。

同次对照测试仅在测试报文中将租约缩短为 45 秒，续租及真实命令执行通过，但用户确认应消除对本机时钟的依赖，最终实现采用下面的平台时间方案，未采用缩短租约。该复现不等于已确认历史 harold 会话的具体失败原因，后者仍需对应客户端诊断。

原 harold 测试命令另有独立的 Shell 引号问题：在外层 PowerShell 中再次运行 `powershell -Command "... $PSVersionTable.PSVersion.ToString() ..."` 会先展开变量，实测返回退出码 1 和 `ExpectedExpression`。直接执行 PowerShell 内容可通过。此类执行后的解析错误与执行前的授权拒绝必须分别诊断，不能为修复引号而修改授权规则。

### 平台时间与本地单调计时（2026-11-10）

需求：电脑系统时间快慢不应导致已批准的命令被误拒绝；可容忍传输耗时，但不能跳过授权、复活撤销记录、无界延长执行或重放命令。适用于 Windows、macOS 和 Linux 共用核心。

实现：新版连接器在 WebSocket 握手声明 `X-FastGPT-Clock: server-time-v1`。App 仅为声明支持的连接，在 welcome 和每个后续下行帧的发送处附加 `serverTime`；旧版 Go 严格拒绝未知字段，不能向所有客户端无条件发送。协议版本保持 1，未协商的连接保持原报文。

`internal/remoteclock` 在收到已验证连接的报文后记录平台时间，使用本地单调经过时长推进。后续样本只能向前校准，不能因延迟到达的帧回拨计时、重新获得一整段租约；新的已认证连接显式重设时间域。协商后缺失时间字段的帧关闭连接，不在连接中途静默回退。允许首个时间样本存在传输延迟，但不因电脑系统时间误差拒绝租约；不会修改操作系统时间或 TLS 证书验证。

授权管理器用平台时间检查授权期限、有限期/持续有效状态、续租上限及管理界面的过期状态，将有效租约剩余时长转成本地单调截止点。命令执行服务保留原始平台 deadline 和摘要，用平台时钟计算剩余时长，再交给本地 context 超时；不能把原始平台时间直接交给 `context.WithDeadline`。租约上限仍为 60 秒、服务端仍每 20 秒续租，命令最长 10 分钟，有限授权不能被续租延长。本地撤销、暂停、断线取消与原 operationId 查询规则不变。此实现不是给本机时间增加固定几秒容差，也没有更改 prompt。

首次 WebSocket 之前，配对、挑战和票据校验使用所选平台成功 HTTP 响应的标准 `Date` 字段建立时间样本，保留原有 TTL/一次性消费规则和 30 秒响应余量；缺失/无效 Date 时保持旧行为。配对等待也用剩余时长计时。该 Date 必须来自已选平台的正常响应；不跟随重定向、不关闭 HTTPS 证书验证。代理应保留正确 Date，不能用另一台时钟错误的代理覆盖它。

上线需要更新 App 和连接器；新 App 兼容旧连接器，新连接器连接旧 App 时仍走旧绝对时间逻辑，不代表旧端已获得修复。macOS/Linux 必须重新构建才能使用新核心，单独更新网页不能修复已安装的旧客户端。

实施与验收 TODO：

- [x] 协商字段和逐帧时间样本，保持旧报文兼容。
- [x] 统一授权、命令截止时间、连接凭据与配对等待的时间域。
- [x] 真实 TLS WebSocket + 本机 Shell 测试平台快/慢一天、旧协议、过期命令、超过 60 秒租约、撤销后拒绝；保留原平台 deadline。
- [x] 完成连接器全量测试、Go vet、后端 57 项相关回归和 Lint。
- [ ] 更新 App 并重新构建、签名、分发各端连接器后实机验收。
本次已完成连接器 Go 全量测试、56 项后端相关测试、Go vet 和 Lint；Windows 诊断变更已随 0.1.55 打包并上传，App 错误码白名单尚未部署，macOS/Linux 尚未为这次诊断重新打包。需要新客户端写入日志，并更新 App 的错误码白名单，旧客户端仍可能仅返回 `grant_rejected`。不能因为用户安装了 0.1.54 就认为包含这次诊断改动。

### 变更生效范围与发布核对

| 改动 | 生效方式及验收 |
| --- | --- |
| Go、WPF 内嵌脚本、Swift 原生窗口、托盘、Shell 或本机日志 | 重打并安装对应端新包；升级前退出旧版。修改源码不改变已分发的 EXE/App |
| 网页绑定后选择、取消换目录、设备缓存校验 | 部署 App 并加载新网页；不需要仅为这些网页逻辑重打客户端 |
| 每轮环境提示 | 部署 App；只更换客户端版本不会新增该行 |
| 新授权诊断原因码 | 新客户端产生分类及本地日志，App 白名单保留分类；只升级一侧不能保证完整诊断 |
| 签名、时间戳、公证装订或任何包字节变化 | 对最终产物重新计算摘要并核对下载；已发布版本不能用不同内容覆盖 |

截至本次文档更新，`384836b01` 包含两端目录确认、Windows 托盘/管理页及重绑选择修复，`13cd70a69` 包含取消换目录校验和每轮本机环境事实。提交状态、App 部署、客户端发行和真实跨端验收必须分别记录；这两个提交不能证明既有 0.1.54 已含全部修复。本次新增授权诊断与回归测试、本文一并提交，Windows 客户端已随 0.1.55 发行；网页及服务端改动不能因 EXE 上传而视为已部署。

### 2026-11-09 Windows 0.1.55 发行验证

- Windows amd64 内部便携 EXE 预置 `https://chat.asiainfo.tech`，未启用 developmentLoopback；包含当前 Windows 确认窗口、托盘/管理页修复及授权诊断日志。App 侧选择、上下文及错误白名单需单独部署。
- 使用原内部证书 `CN=Tengyun Connector Internal` 签署，附带 DigiCert RFC3161 时间戳；公钥证书 SHA-256 为 `2979175E9652E6EBBD23508B12C697CD10F74C77BFC021E13E23E1F516CBC67D`。本地目录另有公钥证书、INSTALL.txt 和验签脚本，私钥未随包分发。
- 版本、平台连接测试及 3 项打包测试通过。通过管理员接口上传后，公网固定版本回下载核对大小为 12,306,072 字节，最终 SHA-256 为 `25889812d2dde4941e1fdc47c80dc2c57085268edb322cd9c25ea23ce786df4b`。
- 构建机未安装此内部证书的根信任，系统验签显示根不受信任；已独立校验 CMS 签名及 PE 内容摘要，签名工具确认时间戳。IT 仍需部署证书信任，不能把该状态称作系统已信任，也不能把所有 UnknownError 都归因于自签名。
- 本次没有替换当前运行客户端、部署 App 或完成同事机器上的实机复现；原脚本故障具体根因仍需新版本诊断数据确认。

### 2026-11-10 Windows 0.1.56 发行验证

- Windows amd64 内部包包含首次窗口激活尝试、失败后任务栏闪烁三次和连接器窗口图标；不自动批准授权。版本及平台连接检查、Go 全量测试、Go vet、WPF 图标初始化和 3 项打包测试通过。网页等待提示的 8 项测试通过，Lint 无错误、保留一条既有警告。
- 沿用 0.1.55 的内部签名证书，附带 DigiCert 时间戳。上传后回下载核对大小为 12,309,656 字节，SHA-256 为 `d0cb5ca9420f6fa383ab71cef49edcbdaab64971b68d3f040966cf5e8caae761`；构建机上的 CMS 签名和 PE 内容摘要校验通过，系统根信任仍需 IT 部署。
- 网页按钮附近的提示尚未部署 App；发布客户端不代表网页已更新。飞书遮挡、任务栏闪烁及实际前台效果仍需安装新客户端后人工验收，本轮没有替换正在运行的连接器。

### 2026-11-10 Windows 0.1.57 发行验证

- 增加 `/status` 的本机构建版本及平台字段，未配对时也返回；Windows amd64 内部包已签名、附加 DigiCert 时间戳并上传。Go 全量测试、Go vet、14 项设备面板测试、3 项打包测试及版本/平台连接检查通过；Lint 无错误，保留一条既有警告。
- 公网回下载大小为 12,310,168 字节，SHA-256 为 `5e2bb19d997136b761f81b631006e31f326f209a1f21b18d695a29af367e7061`，与已验证 CMS 签名及 PE 内容摘要的本地包一致；内部证书信任要求不变。
- 本机检测和系统下载推荐的网页改动尚未部署 App，macOS/Linux 尚未为版本字段重新打包。不能因为 Windows 包已上传就认为网页已更新或各端均可返回版本。

### 2026-11-10 Windows 0.1.58 发行验证

- 修正 Windows 默认终端图案，托盘和 WPF 确认/管理窗口改用与 macOS 一致的连接器标记。Go 全量测试、Go vet、真实 HWND 大小图标句柄检查及 3 项打包测试通过。
- 内部签名并附带 DigiCert 时间戳，版本及平台连接检查通过；上传大小为 12,209,816 字节，SHA-256 为 `8a5695b896066f69ceee3b0ce5e384aa65455468ef19340ddb86e95fa2e271d7`。本地 CMS 签名及 PE 内容摘要验证通过，内部信任部署要求不变。
- 本次未增加强制抢焦点或永久置顶。0.1.56 用户反馈证明任务栏三次闪烁有效，不能据此承诺自动切换前台；新图案在飞书中的最终显示仍需用户复测。网页相关改动仍需单独部署。

### 2026-11-04 历史验收与待办

历史验收记录（2026-11-04，不代表当前环境）：Windows amd64 构建、Go 全模块测试、打包测试通过；重复启动三次仅保留一个实例及退出后重启已实测。Mac 既有业务流程由此前测试确认，本轮未重测。

线上 `https://chat.asiainfo.tech` 当时服务发现返回 available:false，telecom-app 容器未配置上述 LOCAL_DEVICE 网关变量，尚未完成 Windows 真实聊天配对到执行的验收。远端配置未修改；不可把这次构建视为上线成功。

上段是当时的故障记录，不能作为当前配置指南；旧独立网关及其配置已删除，现行部署按本文“后端与网关部署契约”处理。

- [ ] 验证现有 App 域名、证书及 `/local-device/connect` 反向代理；如需部署配置变更，先给出具体 diff 并审批，不新增独立网关。
- [ ] 生产 App 验证发现、WebSocket Upgrade、票据及授权；默认不再部署独立网关。
- [ ] 完成 Windows 真机网页配对、授权、命令、撤销和重连验收。
- [ ] 验证 Windows 本地联调脚本及子进程退出清理。
- [ ] 补齐正式安装、签名、图标及发布验收。

### 2026-11-05 Windows 本地验证

发布记录：Windows amd64 0.1.40 重新构建并预置 `https://chat.asiainfo.tech`，
未启用 developmentLoopback，经既有管理员上传接口发布到线上 `/connector`，仍标记未签名测试版。
安装包 `--test-platform https://chat.asiainfo.tech` 返回成功，公开列表及固定版本回下载摘要一致：
`4d1a4e117c975899e8569508efe01eaf892eeaa78cd5e12bad248135a77e6128`，大小 12087808 字节。
此记录不表示真实绑定、授权执行或 Windows 签名已完成验收。

Windows amd64 本地包 0.1.39 预置 `http://localhost:3000`，未签名、未发布。
桌面模块测试及 `go vet ./internal/desktop` 通过，覆盖管理进程替换、申请优先、
管理进程的测试子进程清理、取消拒绝，以及实际加载完整内嵌 WPF 模板。
六种窗口离屏渲染通过；额外在独立 WPF 进程中调用生产事件处理器，验证同窗导航与输入保留、
无效/有效连接链接、撤销二次确认、真实 CLI 连接测试及测试后保存、地址改变后拒绝保存、
目录未主动选择时禁止执行、取消与绑定确认反馈。这些检查未创建绑定或赋予本机权限。
最终 exe 的 `--version`、本地发现成功与不可用端口失败返回、manifest SHA-256 核对通过。
`node --test projects/local-device/packaging/build.test.mjs` 通过。

完整 Go 回归已执行：desktop、executor、grant、operation、pairbridge 等通过；
`TestLocalSessionCompositionAndReconnect` 的 1 秒命令期限触发超时，
`TestAuthenticationRenewalDuringCommand` 的 changed_owner/rejected/no_refresh 在写出 marker 前取消，
因此 connector/gateway 两包失败，未调整其时限或权限语义来使结果通过。
此处为 0.1.39/0.1.40 构建时的历史结果；后续独立 gateway 包已删除，不能继续按该包的测试路径回归。
本次测试进程排除了 Codex 缓存中缺少 Modules 的 pwsh，使用系统 Windows PowerShell；
没有修改用户 PATH、执行策略或部署配置。
真实网页绑定、系统目录选择器、前台焦点与高 DPI 尚未完成本轮人工交互验收。

### macOS 窗口与焦点回归

- `dialog_darwin.go` 管理管理窗口槽位及串行授权队列。安全申请优先关闭管理进程，等待退出后才启动申请；管理窗口存在不能返回授权取消。
- `status_darwin.m` 在按钮 action 中决定唤回窗口或展开菜单，不可在 `NSMenuDidBeginTrackingNotification` 内取消 tracking 或反复抢焦点，会影响键盘输入。
- `ConnectorDialog.swift` 提供 Edit 菜单与粘贴快捷键，关闭窗口应结束 helper；只在窗口存在期间显示 Dock 图标。
- 回归覆盖管理打开时申请授权、申请期间点击图标、关闭后再开、键盘输入与粘贴、目录选择取消/同意、Dock 仅一个窗口图标。进程级测试不能替代这些实际 UI 验收。
- 同平台可以保留多个账号绑定。为第二个账号在网页生成连接链接，在本机「授权管理 → 添加授权」粘贴并核对账号及团队。同平台新增授权会启动独立连接，原有任务继续运行。每个设备 ID 使用独立的会话工厂，网页解绑只撤销对应账号的设备记录与会话授权。

### 2026-11-05 macOS 发行记录

v0.1.37 darwin/arm64 使用企业 Developer ID（Team 6A77ZAA856）签名。
苹果公证提交 `9f9f8f82-2a06-4b80-a7a5-cca197919f28` 返回 Accepted；DMG 票据装订和验证通过，Gatekeeper 评估为 `Notarized Developer ID`。发布摘要以装订后的 manifest 为准。
已发布至当前 App 的 `/connector`，并从固定版本下载接口回下载验证 SHA-256：`030aab1243adf849dd04af0031ad209a4fa1d62771c8f2ed9d0eec9e8e320ade`。
这只证明签名与公证状态，不扩展到 Windows 或尚未完成的多账号绑定能力。


### 认证时间偏差与多设备排查（v0.1.38）

- 每个账号可关联多台电脑；服务端连接按 `deviceId` 保存，仅同一设备的新连接替换旧连接。不要把一台离线误判为账号单设备限制。
- 挑战有效期为 60 秒、连接票据为 5 分钟。客户端 `validRemoteExpiry` 允许服务器时钟最多领先 30 秒，避免网络往返后剩余时间略大于标称 TTL 时被误拒绝。已经过期的响应、超过容差的未来时间仍拒绝；服务端 TTL、签名校验、一次性消费规则不变。
- 初次认证与长连接续期必须使用同一个时间上界。只修挑战会在票据或后续续期时再次断开。此容差只适用于设备连接认证，不改变会话执行授权有效期。
- 排查顺序：确认平台 origin 与客户端版本 → 服务发现 → 日志是否经过 authenticating / connecting / connected → 设备列表刷新 → 保持连接超过一次续期间隔。HTTP 200 可能只是错误信封，不代表认证或 WebSocket 成功。
- 无需打印挑战、票据或私钥。对比响应 expiresAt 与接收时的本机时间时，只输出差值。macOS 从 Finder 启动的 stdout/stderr 可能为 `/dev/null`，必要时退出并从终端启动现有签名程序，将日志写入权限 0600 的临时文件；不要清除设备身份来排查时钟问题。
- 回归：模拟服务器领先 150 毫秒、29 秒均可完成签名交换与票据获取；31 秒拒绝。覆盖过期、标称 TTL 与容差边界。执行 `go test ./...` 后，使用线上同账号两台设备验证同时在线。


### v0.1.38 macOS 发行验证

- 平台：darwin/arm64；企业 Developer ID Team：6A77ZAA856。
- Apple 公证提交：`b2182493-614a-4668-863c-9fef69f3b0f1`，状态 Accepted。
- DMG 装订、stapler validate 和 Gatekeeper 均通过；本机已安装相同签名版本并装订 App。
- 最终 DMG SHA-256：`ea38a054ae97a6d70688448a43e8d637db7d0ddbddeec40bd3846080480c69bf`。
- Go 全量测试通过。线上 `https://chat.asiainfo.tech` 实测 Mac mini 与本机 MacBook 同时在线。

- 已发布到 `https://chat.asiainfo.tech/connector`；公网下载固定版本 0.1.38 的文件为 6,538,744 字节，SHA-256 与最终装订包一致。发布通过同一生产 App 的内网入口完成，公网页面已验证显示 v0.1.38。
- 原有 v0.1.37 公证凭据保留，v0.1.38 独立登记摘要与提交编号；不能用新记录替换或冒充历史版本。
- 本机 21:54:39 建立连接，超过首张票据五分钟有效期后刷新仍与 Mac mini 同时在线，日志无断线重连，真实续期链路通过。

### v0.1.49 授权管理与工作目录

- 设备授权按平台和账号分别保存。同一台电脑可接受多个账号授权，同一账号也可管理多台电脑。网页「连接此电脑」唤起本机确认，远程电脑则在「授权管理 → 添加授权」粘贴网页生成的链接。
- 「已授权用户」支持按姓名、团队和平台搜索。点击用户进入详情，顶部显示账号状态和默认目录，会话列表显示当前可管理的授权数量。长路径可悬停查看完整内容。
- 「暂停」作用于账号，恢复后仍可使用未撤销的会话授权。「撤销会话」只影响该会话；「撤销账号授权」停止该账号所有会话的本机访问。撤销后，详情页自动过滤已撤销的会话，保留本地撤销记录和拦截状态。
- 聊天设备菜单在已选电脑卡片中显示当前会话目录。「更换工作文件夹」仍需在连接器上确认，即使账号已有长期授权。取消时继续使用原目录。
- 回归时分别验证同平台两个账号同时在线、单会话撤销不影响另一会话、账号暂停和恢复、撤销后详情刷新，以及更换目录的确认和取消。macOS 另检查有目录和无目录的卡片，状态和操作按钮均在右侧垂直居中。

### v0.1.49 macOS 发行验证

- 平台为 macOS Apple Silicon（darwin/arm64），使用企业 Developer ID Team 6A77ZAA856 签名。
- Apple 公证提交 `1989c50d-ef02-4694-a608-d1c13af1e3f0` 返回 Accepted。DMG 票据装订、`stapler validate` 与 Gatekeeper `Notarized Developer ID` 评估通过。本机安装的 App 也已装订。
- 已通过生产平台管理员接口发布到 `https://chat.asiainfo.tech/connector`。公开清单显示 v0.1.49，从固定版本接口回下载并核对最终 DMG 的 SHA-256 为 `2afb3ea5444557af36fc26c19348fc7aaef2fac29659aa88ebd68a836dba67b0`，大小为 6,670,291 字节。
- 连接器 Go 全量测试、网页设备与发布服务相关测试、打包脚本测试通过。会话卡片用示例数据渲染检查。本次发行验证覆盖签名、公证和公网下载，真实多账号授权流程仍需按上节步骤验收。

### v0.1.51 macOS 发行验证

- 桌面多账号模式对主平台和本地开发平台均使用邀请交接。网页读取本机桥的 `inviteHandoff`，生成当前账号的邀请，再交给连接器弹出原生确认。主平台保留旧 `/pair` 路由以兼容旧页面。
- 排查生产页面提示「正在准备绑定」时，先核对下载版本和本机桥的能力，再确认页面是否发出邀请交接请求。实测 `https://chat.asiainfo.tech/account/devices` 的「连接此电脑」已打开本机确认窗口。配对桥、桌面及发布服务测试通过。
- Apple Silicon DMG 使用企业 Developer ID Team 6A77ZAA856 签名，Apple 公证提交 `5be69942-5710-4de6-b7e9-f030d5fc0081` 返回 Accepted。DMG 装订验证与 Gatekeeper 检查通过。
- 已发布到 `https://chat.asiainfo.tech/connector`。公网清单及固定版本回下载校验通过，最终包为 6,688,937 字节，SHA-256 为 `2df7881a2df97618a5171d8f5e181f920c0a4acf3a4e9a779323aa7f268621e2`。

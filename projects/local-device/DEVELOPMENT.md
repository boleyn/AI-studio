# 本机连接器本地联调

首次接手请阅读 [客户端与后端开发接手指南](HANDBOOK.md)。

## 启动 App

仓库根目录执行：

```sh
pnpm dev
```

网页、API 和设备 WebSocket 都由同一个 TypeScript App 进程处理。
默认平台地址是 `http://localhost:3000`，设备连接地址由服务发现返回
`ws://localhost:3000/local-device/connect`。不需要启动其他连接服务、配置共享网关密钥或增加监听端口。
`pnpm dev:device` 作为相同 App 启动入口保留。

仓库根目录启动器可复用远端数据库、缓存和存储，沙盒配置按既有开发环境处理。
在 `projects/app` 下启动则使用该应用自己的环境配置。先停止占用 App 端口的开发进程。

## 调试客户端

启动 App 不需要 Go。仅从源码构建客户端时需要 `go.mod` 指定的 Go 工具链；
macOS 原生窗口还需要 Xcode Command Line Tools。

在另一个终端执行：

```sh
pnpm dev:device -- --connector
```

客户端使用 `.codex-tmp/local-device-dev` 隔离身份目录，不覆盖已安装应用的配置和授权。
`GO_BIN` 可指定 Go 可执行文件，`FASTGPT_DEV_APP_PORT` 可调整 App 端口。
`pnpm dev:device -- --check` 检查环境，不启动服务。

平台地址支持 HTTP/HTTPS 的本机、内网、公网 IP 和域名，按实际路由访问。
HTTPS 仍校验可信证书。若开启代理时内网不可达，应检查代理分流和 TUN 路由。

Windows 便携版需先手动启动客户端；网页「连接此电脑」通过本机配对桥握手，本机确认后完成绑定；
「添加其他电脑」复制授权链接，在目标电脑的授权管理中添加。
本机配对桥只监听 `127.0.0.1:13005`，用于网页握手，不是服务端设备网关。
配对不等于会话执行授权。当前聊天入口完成绑定后会选择新设备并申请执行授权；确认窗口可沿用已有有效目录，不要求每次打开目录选择器。取消更换目录时，网页重验原授权及设备后继续使用原目录。

## Windows 构建与管理

在仓库根目录构建本地联调包：

```powershell
node projects/local-device/packaging/build.mjs --platform windows --arch amd64 --version 0.1.41 --platform-url http://localhost:3000 --dev-loopback 1
```

正式平台构建改用 `--platform-url https://chat.asiainfo.tech`，并去掉 `--dev-loopback 1`。
版本号必须未被构建或发布使用，已有产物不覆盖。产物位于 `projects/local-device/dist/<version>-windows-amd64/`。
平台地址与公开品牌由开发者打包预置，用户无需填写网关地址或 Token。

Windows 0.1.7 起按当前用户会话限制单实例，复制 exe 或切换版本共用限制。
升级时先从托盘退出旧版，再启动新包；退出或崩溃后系统释放限制。
构建器默认输出未签名便携 exe；内部分发包可在构建后使用内部证书签名并添加时间戳，随后重算 manifest 摘要。0.1.54/0.1.55 使用与 0.1.52 相同的内部证书，IT 需按包内 INSTALL.txt 部署公钥证书信任。不安装开机启动项，不注册 URL 唤起协议。

托盘授权管理在同一窗口内切换授权列表、添加授权和连接设置。
托盘不再提供全量撤销、重新配对或重复的添加授权入口；账号与会话权限统一在授权管理中操作。终止任务仅在有任务运行时显示。连接失败可在授权管理的连接设置中测试并重新保存地址。
地址历史保留，连接测试通过后才能保存；收到执行授权申请时先关闭管理窗口，
申请期间管理入口只唤回申请窗口。绑定不授予执行权限，执行确认须有有效目录；“允许执行”始终可点击，无有效目录时再打开选择器。
Windows helper 及其连接测试子进程由 Job 一起清理。

## Docker 部署

重新构建并更新 App 镜像，保留已有 App 容器 3000 端口映射即可。
反向代理需支持 `/local-device/connect` 的 WebSocket Upgrade，保留外部 Host，
HTTPS 入口传递 `X-Forwarded-Proto: https`。当前设备路由驻留单 App 进程，使用单副本。

## 验证

```sh
cd projects/local-device
go test ./...
```

App 服务发现：

```sh
curl -X POST -H 'Content-Type: application/json' -d '{}' http://localhost:3000/api/core/localDevice/discovery
```

检查返回的 available、协议版本与同源 gatewayUrl，再验证真实客户端认证、授权、
执行、撤销和断网重连。构建/单测通过不代表 Docker 或 Windows 实机链路已验收。


## 认证失败但平台可访问

先查看客户端是否从 `authenticating` 进入 `connecting`，不要只以 HTTP 200 判断成功。
设备认证挑战与票据由服务器计时，客户端通过 `validRemoteExpiry` 容忍最多 30 秒的服务器时钟领先；
过期、签名和一次性使用仍由服务端强制校验。初次认证与续期必须同步回归。
同账号多台设备应同时在线，只有同一个 deviceId 重连会替换自身旧连接。
详细测试、发行签名和公证步骤见 [开发手册](HANDBOOK.md)。

## 跨端联调时避免误判

- 解绑再绑定后检查当前聊天实际发送的 deviceId/grantId。浏览器保留失效目标以阻止自动退回云端，新绑定必须通过回调更新当前聊天；不能只看“设备在线”。
- 更换目录后，下一轮背景信息携带服务端有效授权的系统和默认目录。该行只描述默认位置，命令显式路径和脚本内部 cd 仍可能访问其他位置；不要通过增加常驻 prompt 掩盖状态同步错误。
- `grant_rejected` 不能解释为禁止脚本或创建进程。优先保留原始工具回执；新诊断客户端在对应平台状态目录写 `grant-diagnostics.jsonl`，需要同时更新 App 才能完整保留错误分类。Windows 诊断已随 0.1.55 发布，App 白名单尚未部署，macOS/Linux 尚未为此重新打包，旧包不保证有此文件。
- 启动后台服务时核查主命令是否已经结束：连接器会清理所管理的子进程。`Start-Process` 返回成功不代表服务能持续运行，不要绕过 Job/进程组或租约实现常驻。
- Windows 测试注意实际 PowerShell 路径、Modules、冷启动时限及 `spawn pnpm ENOENT`；具体回归方式见[开发手册的修改与验收](HANDBOOK.md#修改与验收)。

各端共用的详细行为、失败分类、发布生效范围与验收矩阵集中维护在[开发手册](HANDBOOK.md#跨端行为与实现约定)，不要把本地提交或测试通过写成已部署、已发布或已实机验收。

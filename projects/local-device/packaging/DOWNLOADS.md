# 连接器下载入口

开发接手、网关配置和排障见 [开发指南](../HANDBOOK.md)。

公开页面为 `/connector`，无需登录；“管理我的设备”包含下载入口。

将 `downloads.example.json` 中的 `feConfigs.connector` 合并到现有平台配置或 OEM 配置文件中。示例地址不是实际发行地址，必须替换后使用；不要把本机开发包标记为正式发行包。配置加载与重启方式沿用现有 OEM 机制。

- 名称优先使用 `feConfigs.connector.name`，未配置时为 `feConfigs.systemTitle + 连接器`；Logo 和平台名称复用现有 OEM 品牌。
- 客户端是构建产物：使用同一配置文件打包，名称写入应用文件名、macOS Info.plist、原生窗口与托盘。修改品牌后必须重新打包；服务端运行时修改不会改写已下载的客户端。
- macOS 应用和托盘图标读取 `feConfigs.connector.icon`，未配置时复用 `feConfigs.favicon`，最后回退 `/favicon.ico`。素材须存在主应用 public 目录，使用站内 PNG/ICO/ICNS 路径；构建时转换为多分辨率 ICNS 和 32px PNG，不在客户端联网读取图标。Windows 已有内部测试 EXE 发行，不等于正式安装或品牌图标验收完成；Linux 发行状态需单独核实。
- `connector.bundleId` 可配置 macOS 应用标识，未配置时保留 `tech.fastgpt.local-device` 兼容旧版；已有安装不要随意变更。旧状态目录维持兼容，名称修改不影响配对和授权。
- `node projects/local-device/packaging/build.mjs --version 0.1.5 --platform-url https://your-platform.example --config /path/to/config.json`，默认读取 `CONFIG_JSON_PATH` 或仓库 `projects/app/data/config.json`，支持 JSON5。将公开品牌信息和显式指定的平台 HTTPS 地址写入产物，绝不包含完整配置或密钥。
- macOS 输出压缩 DMG，打开后拖动应用到 Applications 即可；不再生成 ZIP。新上传仅接收 DMG，历史 ZIP 的固定版本链接仍可用。
- `releases` 为外部托管的备用清单，覆盖基础配置中的清单；上传发行优先于同平台/架构的手工链接。`[]` 只清空手工清单，不撤回已上传的发行。没有配置且没有上传时，显示不可点击的“暂未提供下载”。
- `platform` 支持 `darwin`、`windows`、`linux`；`arch` 支持 `arm64`、`amd64`，每种组合最多一条。
- 每条独立填写 `version`、公开 HTTPS `url`，可选 `requirement`（经过验证的最低系统版本等）。所有字段均对访客公开，禁止放 Token、密码或签名私钥。
- `helpUrl` 是可选的 HTTPS 安装帮助地址。
- 平台提供持久化安装包上传和下载（私有 S3 + MongoDB），不提供客户端自动更新。
- macOS 签名公证、Windows 代码签名、各平台真实安装验收仍由发布流程负责；页面不会据平台名称自动宣称“已签名”或“已公证”。

## Windows 内部签名与交付

构建器默认输出未签名 Windows 便携 EXE；内部包 0.1.52/0.1.54/0.1.55 已走构建后自签名及时间戳流程。这不代表构建器会自动签后续版本，也不代表公开电脑自动信任发布者。内部证书信任由公司 IT 在受管电脑部署，不能靠自签名承诺消除 SmartScreen 提示。

1. 构建一个未使用的新版本，退出旧版后验证版本、预置平台地址和连接测试。内部分发包仍保留 `productionReady: false`；当前 `push.mjs` 只接受此类内部测试构建。
2. 使用指定内部代码签名证书签署最终 EXE 并添加时间戳，核验发布者、摘要算法、证书指纹及时间戳。私钥保留在构建机证书存储，不随包分发，不为排障导出或粘贴私钥。
3. 签名改变 EXE 字节，必须重算 `manifest.artifacts[].sha256`，记录实际签名身份、证书 SHA-256 指纹及时间戳状态，确保上传脚本使用的是签名后的同一文件。不能用旧摘要，也不能同版本换内容覆盖。
4. 内部交付同时准备公钥证书 `.cer`、`INSTALL.txt` 和验签说明；IT 先经可信渠道核对该版本证书指纹，再按包内说明或组策略部署信任。公开下载页目前只下发上传的 EXE，不自动分发这些辅助文件，也不会安装证书；需另行通过内部渠道交付。
5. 上传后查询公开清单，再从带固定 version 的下载接口回下载，比较 SHA-256 并再次验签。清单显示新版本不等于二进制、平台地址或证书都正确；安装后仍需绑定、授权、执行及撤销的实机验收。

0.1.54 本地产物 manifest 标记 `self-signed-internal`、`timestamped: true`，公钥证书 SHA-256 为 `2979175E9652E6EBBD23508B12C697CD10F74C77BFC021E13E23E1F516CBC67D`。这是该内部包的记录，后续包须核对自己的 manifest、证书和最终 EXE，不能仅按版本号继承签名状态。

0.1.55 已沿用同一证书并发布，最终 EXE SHA-256 为 `25889812d2dde4941e1fdc47c80dc2c57085268edb322cd9c25ea23ce786df4b`，大小 12,306,072 字节。未部署内部根信任的机器可能显示证书链不受信任，需读取具体错误信息并区分签名完整性与系统信任；不得仅因 UnknownError 就跳过验签或自动安装根证书。验证范围见[开发手册](../HANDBOOK.md#2026-11-09-windows-0155-发行验证)。

## 上传连接器安装包

需先部署本版本主服务，现有 MongoDB 与私有对象存储可用；无需新增容器卷。反向代理需允许最大 128 MiB 请求体和足够上传时长，否则会返回 413/超时（本次未修改部署配置）。

使用 root 登录会话 token（不是普通用户/API key），通过环境变量提供，不写入配置、URL 或脚本。运行后及时 unset。不要将真实 token 贴进共享日志。

```sh
node projects/local-device/packaging/push.mjs https://your-platform.example \
  projects/local-device/dist/0.1.5-darwin-arm64/manifest.json \
  projects/local-device/dist/0.1.5-darwin-arm64/腾云平台连接器-0.1.5-arm64.dmg
```

运行前设置 `CONNECTOR_ADMIN_TOKEN`；本地 HTTPS 测试信任开发 CA，不能关闭 TLS 校验。

- `POST /api/admin/connector/push?platform=darwin&arch=arm64&version=0.1.5&sha256=...`，请求头 `token` 和 `Content-Type: application/octet-stream`，body 为文件原始字节。先鉴权再接收；服务端流式限额、验 SHA-256 与格式魔数（DMG 为末尾 512 字节的 UDIF trailer），不解压执行。当前构建产物格式为 macOS DMG、Windows EXE、Linux ELF 二进制（下载名后缀为 .bin）。魔数不能证明包内架构/版本真实，管理员应使用构建产物和配套 manifest。
- 上传接口只校验格式与摘要。macOS 公证包须先取得 Apple Accepted 并装订，再用最终摘要上传和登记公证凭据。下载页不展示签名或公证提示。
- 成功才产生公开记录，最新发布立即出现在 `/connector`；相同版本相同摘要重试幂等，不提升发布时间；同版本不同内容拒绝覆盖。并发首发可能一方收到冲突，重试即可。历史包不会自动删除。
- `GET /api/connector/releases`：公开的最新清单（每系统/架构一条），不含存储 key/发布人。
- `GET /api/connector/download?platform=darwin&arch=arm64`：稳定最新下载入口；加 `&version=0.1.4` 下载固定历史版本。响应头 `X-Checksum-SHA256` 可核验；未知版本返回 404。
- “最新”指最后成功发布的版本，不做版本大小比较。下载经主服务流式代理，不依赖浏览器访问内网 S3；大规模分发建议另配 CDN，当前不支持断点续传。
- 发布权限是供应链信任边界：只有平台 root 可操作，不能用于接收普通用户文件。

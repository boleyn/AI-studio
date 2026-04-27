# Next.js AI Studio

基于 Next.js 14（Pages Router）的 AI Studio 示例项目，支持私有化部署。  
当前版本聚焦 4 条主线：`对话编排`、`项目工作区`、`Skills Studio`、`模型工作台`。

## 当前能力（2026 版）

- 聊天与 Agent
  - `POST /api/chat/completions`
  - `POST /api/v2/chat/completions`
  - 对话中断/交互恢复（`/api/v2/chat/stop`、`/api/v2/chat/pending-interactions`、`/api/v2/chat/resolve-interaction`）
- 项目工作区
  - 项目列表与编辑：`/`、`/project/[di]`
  - 兼容旧入口：`/run/[di]` 自动重定向到 `/project/[di]`
- Skills Studio
  - 可视化编辑页：`/skills/create`
  - Skills 管理：`/api/skills/*`、`/api/agent/skills/*`
  - 工作区初始化：`POST /api/skills/workspaces/create`
- 模型工作台
  - 模型管理页：`/models`
  - 使用统计页：`/models?tab=usage`（`/model-usage` 会重定向）
- 账号体系
  - 登录注册与资料管理：`/login`、`/account`、`/api/auth/*`
  - 飞书登录（可选）：`/auth/feishu/login` 与 `/auth/feishu/callback`
- 分享能力
  - `POST /api/share`
  - `GET /api/share/[shareId]`
  - `POST /api/share/[shareId]/clone`

## 技术栈

- Next.js 14
- TypeScript
- Chakra UI
- MongoDB（用户、项目、会话与元数据）
- S3 兼容对象存储（MinIO / AWS S3）
- Bun（脚本与依赖管理）

## 快速开始

1. 安装依赖

```bash
bun install
```

2. 初始化环境变量

```bash
cp .env.example .env
```

3. 启动开发环境

```bash
bun run dev
```

4. 打开页面

- `http://localhost:3000`
- `http://localhost:3000/skills/create`
- `http://localhost:3000/models`

## 最小必填环境变量

```env
# 数据库
MONGODB_URI=mongodb://127.0.0.1:27017/nextjs_ai_studio

# 鉴权
JWT_SECRET=replace_with_a_long_random_secret
AUTH_COOKIE_SECURE=false

# 模型接入（二选一，优先 AIPROXY）
AIPROXY_API_ENDPOINT=
AIPROXY_API_TOKEN=
# 或
OPENAI_BASE_URL=
CHAT_API_KEY=

# 对象存储（S3 / MinIO）
STORAGE_REGION=us-east-1
STORAGE_ACCESS_KEY_ID=
STORAGE_SECRET_ACCESS_KEY=
STORAGE_PUBLIC_BUCKET=
STORAGE_PRIVATE_BUCKET=
STORAGE_S3_ENDPOINT=
STORAGE_S3_FORCE_PATH_STYLE=true
```

## 常用可选环境变量

```env
# 模型目录配置
CHAT_MODEL_CONFIG_FILE=config/config.json

# MCP（JSON 数组）
MCP_SERVER_URLS=[{"name":"mcp-example","url":"http://127.0.0.1:8000/sse"}]

# Skills 发布到 Hub（可选）
SKILL_HUB=
SKILL_HUB_PROXY_SECRET=

# 飞书登录（可选）
FEISHU_APP_ID=
FEISHU_REDIRECT_URI=http://localhost:3000/auth/feishu/callback
FEISHU_APP_SECRET=
FEISHU_DEFAULT_PASSWORD=Feishu@123456
```

## 常用命令

```bash
# 开发
bun run dev

# 构建与启动
bun run build
bun run start

# 类型检查
bun run typecheck:web
bun run typecheck:v2chat
bun run typecheck:agent-now
bun run typecheck:queryengine-now

# 测试
bun run test:workspace
bun run test:agent
bun run test:regression:saas-runtime
```

## Docker 部署

```bash
docker compose up -d --build
```

默认 `docker-compose.yml` 中：

- Web 暴露端口：`18367 -> 3000`
- Sandbox 服务：`18080` 与 `18091`

## 项目结构（精简）

```text
src/pages/          页面与 API Route
src/server/         服务端核心逻辑（auth / agent / skills / storage）
src/features/       业务模块
src/components/     UI 组件
skills/             本地技能目录
config/             模型与系统配置
data/               本地项目模板与运行数据
```

## 常见问题

- 登录后被重定向回登录页
  - 本地 HTTP 环境将 `AUTH_COOKIE_SECURE=false`
- 聊天接口提示模型鉴权失败
  - 检查 `AIPROXY_API_TOKEN` 或 `CHAT_API_KEY`
- 上传/附件异常
  - 检查 `STORAGE_*` 是否完整、bucket 权限是否正确

## License

Apache-2.0

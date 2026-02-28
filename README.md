# Next.js AI Studio

一个可私有化部署的全栈 AI Studio 示例，基于 Next.js（Pages Router）构建，集成了聊天编排、项目代码工作区、Skills 工作流、MCP 工具接入与基础账号体系。

![功能截图](https://github.com/user-attachments/assets/6fe031a6-a472-441c-b9c6-7a6097dcf754)

## 功能介绍

- AI 聊天与工具调用
  - 聊天接口：`/api/chat/completions`
  - 支持流式输出（SSE）
  - 支持 Agent 工具链（文件操作、项目工具、MCP 工具）
- 项目代码工作区
  - 项目列表、项目编辑、运行预览
  - 代码数据由后端 API 提供（可接入自定义后端逻辑）
- Skills 体系
  - 项目内技能目录：`skills/<skill-name>/SKILL.md`
  - Skills 管理 API：`/api/agent/skills/*`
  - Skills Studio 页面：`/skills/create`
- MCP 接入
  - 支持通过 `MCP_SERVER_URLS` 配置多个 MCP SSE 服务
  - 支持为单个 MCP 服务配置请求头
- 登录鉴权
  - 账号登录/注册
  - Feishu OAuth 登录（可选）
- 文件与对象存储
  - 聊天附件/项目文件使用 S3 兼容对象存储（MinIO / AWS S3）

## 技术栈

- Next.js 14（Pages Router）
- TypeScript
- Chakra UI
- MongoDB（项目、会话、用户等元数据）
- S3 兼容对象存储（MinIO / AWS S3）

## 项目结构

```text
src/
  pages/        # 页面与 API Route
  server/       # 服务端能力（鉴权、存储、agent、skills）
  features/     # 业务模块
  components/   # 通用组件
  shared/       # 跨模块共享能力
skills/         # 项目内 skills
config/         # 模型与解析配置
data/           # 本地开发数据目录
```

## 环境要求

- Node.js 20+
- Yarn 4.5.1（仓库使用 Yarn Berry）
- MongoDB（必需）
- S3 兼容对象存储（必需，推荐 MinIO）

## 配置说明（`.env`）

先复制：

```bash
cp .env.example .env
```

### 1) 必填

```env
MONGODB_URI=mongodb://127.0.0.1:27017/nextjs_ai_studio
JWT_SECRET=replace_with_a_long_random_secret

# 建议本地 HTTP 开发时明确设置
AUTH_COOKIE_SECURE=false

# 二选一优先级：AIPROXY > OpenAI 兼容
AIPROXY_API_ENDPOINT=
AIPROXY_API_TOKEN=
# 或者
OPENAI_BASE_URL=
CHAT_API_KEY=

# 对象存储（MinIO / S3）
STORAGE_REGION=us-east-1
STORAGE_ACCESS_KEY_ID=
STORAGE_SECRET_ACCESS_KEY=
STORAGE_PUBLIC_BUCKET=
STORAGE_PRIVATE_BUCKET=
STORAGE_S3_ENDPOINT=
STORAGE_S3_FORCE_PATH_STYLE=true
STORAGE_S3_MAX_RETRIES=3
```

### 2) 常用可选

```env
# 模型目录配置文件（JSON5）
CHAT_MODEL_CONFIG_FILE=config/config.json

# MCP（推荐 JSON 数组格式）
MCP_SERVER_URLS=[{"name":"mcp-example","url":"http://127.0.0.1:8000/sse"}]

# Agent 兼容模式 skill 文件（当项目 skills 不可用时）
AGENT_SKILL_FILE=skills/aistudio-mcp-code-workflow/SKILL.md

# 对外访问地址（用于生成链接）
STORAGE_EXTERNAL_ENDPOINT=http://127.0.0.1:3000
```

### 3) Feishu 登录（可选）

```env
FEISHU_APP_ID=
FEISHU_REDIRECT_URI=http://localhost:3000/auth/feishu/callback
FEISHU_APP_SECRET=
FEISHU_DEFAULT_PASSWORD=Feishu@123456
```

### 4) Agent 调参（可选）

```env
TOOL_CALL_MODEL=
NORMAL_MODEL=
AI_RECURSION_LIMIT=
AI_MAX_CONTEXT=
AI_TEMPERATURE=0.2
```

## 本地开发

```bash
yarn
yarn dev
```

访问：

- `http://localhost:3000`
- `http://localhost:3000/skills/create`

## 生产构建

```bash
yarn build
yarn start
```

## Docker 部署

### 1) 构建镜像

```bash
docker build -t nextjs-ai-studio:latest .
```

### 2) 准备 `.env`

将生产环境变量写入 `.env`（重点检查 Mongo、对象存储、模型凭证）。

### 3) 使用 compose 启动

```bash
docker compose up -d --build
```

默认端口：`3000`。

## Skills 使用约定

- Skill 文件必须位于：`skills/<skill-name>/SKILL.md`
- `skill-name` 需满足：`^[a-z0-9]+(-[a-z0-9]+)*$`
- `SKILL.md` frontmatter 至少包含：
  - `name`
  - `description`

相关 API：

- `GET /api/agent/skills`
- `GET /api/agent/skills/[name]`
- `POST /api/agent/skills/validate`
- `POST /api/agent/skills/reload`
- `POST /api/agent/skills/create`

## MCP 配置示例

基础：

```env
MCP_SERVER_URLS=[{"name":"mcp-gitlab-kb","url":"http://10.21.8.6:8008/sse"}]
```

带请求头：

```env
MCP_SERVER_URLS=[{"name":"mcp-private","url":"https://example.com/sse","headers":{"Authorization":"Bearer xxx"}}]
```

## 常见问题

- 登录后又跳回登录页
  - 检查 `AUTH_COOKIE_SECURE`。HTTP 场景建议设为 `false`。
- 聊天报缺少模型凭证
  - 检查 `AIPROXY_API_TOKEN` 或 `CHAT_API_KEY` 是否已配置。
- 文件上传或项目读写失败
  - 检查对象存储配置与 bucket 权限，确认 `STORAGE_*` 变量完整。

## License

Apache-2.0

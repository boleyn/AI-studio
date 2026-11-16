# Hermes Agent 架构重写小本本

> 分支：`refactor/hermes-agent` | 包管理器：`bun` | 状态：**已完成**

## 目标架构（Hermes 规范）

```text
src/agent/
├── app/            # Agent 主体（配置、Prompt、历史映射、上下文预算、ReAct 循环）
├── tools/          # 工具注册中心与内置工具（file/terminal/planning/skills/web/project/delegation）
├── sandbox/        # 工作空间沙盒（remote-vm / local / connector）
├── mcp/            # 基于 @modelcontextprotocol/sdk 的 MCP 客户端桥接
└── gateway/        # 对外入口（对接 Next.js API / SSE 流式协议）
projects/
├── agent-sandbox/  # 虚拟机沙盒服务端
└── agent-connector/# 本机目录挂载连接器
```

## 进度清单

### 1. 沙盒与工作空间 (`src/agent/sandbox/` & `projects/agent-connector/`)
- [x] `sandbox/types.ts`、`sandbox/paths.ts`：虚拟路径规范化、宿主机路径脱敏、导出过滤
- [x] `sandbox/environments/hostDirFs.ts`、`localExec.ts`：宿主机目录文件系统与本地命令执行
- [x] `sandbox/environments/remoteVm.ts`：虚拟机沙盒快照同步与远端命令执行
- [x] `sandbox/environments/connector.ts` + `projects/agent-connector/server.ts`：本机目录连接器协议与服务端
- [x] `sandbox/workspace.ts`、`snapshot.ts`、`runtimeFiles.ts`、`index.ts`：脱离 Claude `FsOperations` 依赖，完成沙盒工厂

### 2. 工具系统 (`src/agent/tools/`)
- [x] `tools/types.ts`、`tools/registry.ts`：工具定义、Toolset 分组、OpenAI Function Calling 转换与分发
- [x] `tools/fileTools.ts`：`Read` / `Write` / `Edit` / `Glob` / `Grep`
- [x] `tools/terminalTool.ts`：`Bash`（在当前 Sandbox 中执行）
- [x] `tools/planningTools.ts`：`TodoWrite` / `update_plan` / `AskUserQuestion` / `ExitPlanMode`
- [x] `tools/skillTool.ts`：`Skill`（发现与加载 `/skills` 及 `.aistudio/skills`）
- [x] `tools/compileProjectTool.ts`：`compile_project`（读取 Sandpack 编译诊断）
- [x] `tools/webTools.ts`：`WebFetch` / `WebSearch`
- [x] `tools/delegationTool.ts`：`Agent`（子 Agent 委派）
- [x] `tools/index.ts`：统一导出并注册内置工具

### 3. MCP 客户端 (`src/agent/mcp/`)
- [x] `mcp/client.ts`、`mcp/index.ts`：基于 `@modelcontextprotocol/sdk` 管理 stdio / HTTP / SSE MCP 连接并动态注册到 `ToolRegistry`

### 4. Agent 主体 (`src/agent/app/` & `src/agent/memory/`)
- [x] `app/config.ts`：运行时配置与 OpenAI 客户端工厂
- [x] `app/context.ts` & `app/compressor.ts`：模型上下文窗口查询、Token 预算、tool-output 裁剪与 LLM 结构化摘要压缩
- [x] `app/session.ts`：会话迭代/工具调用/Token 轨迹统计
- [x] `app/prompt.ts`：系统提示词组装（沙盒声明、冻结记忆快照、Skills 索引、项目文件、附件）
- [x] `app/history.ts`：消息历史与交互审批结果转换
- [x] `app/agentLoop.ts` & `app/index.ts`：Hermes ReAct 流式主循环与 `runHermesAgent` 入口
- [x] `memory/store.ts` & `memory/tool.ts`：跨轮持久化记忆（`MEMORY.md` / `USER.md`）与 `Memory` 工具

### 5. Gateway 与外部集成 (`src/agent/gateway/` & Next.js)
- [x] `gateway/index.ts`：SSE 事件适配与 `resolveRuntimeStrategy` 兼容导出
- [x] `src/pages/api/agent/connector/test.ts`：本机挂载连接器健康探测 API
- [x] 切换外部引用（`v2/chat/completions.ts`、`projectMemory.ts`、`imageCaptionService.ts`、`conversationStorage.ts`、`catalogStore.ts`、`ai/model.ts`）

### 6. 依赖清理与验证
- [x] 清理 `package.json` 中的 `vendor/claude-packages` 依赖（移除 21 个私有/内部包）、`_moduleAliases`、`tsconfig.json`、`next.config.js`
- [x] 移除 `vendor/claude-packages`、`claude-full-src`、`src/server/agent`、`src/server/builtin-tools`、`.yarn`/`.pnp.*` 与冗余 `tsconfig.*.json`
- [x] 运行 `bun install`、`bun run test:agent` 及 `tsc --noEmit` 验证通过

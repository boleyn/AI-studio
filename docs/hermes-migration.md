# Hermes Agent 架构重写小本本

> 当前分支：`feat/hermes-agent-workspace` | 包管理器：`bun` | 状态：**核心迁移已落地，工作台持续完善，端到端待验收**

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


## 2026-11-16 实际代码复核与工作台调整

原提交 `af7f2da` 已提供 Hermes ReAct、工具、MCP、记忆、沙盒及会话工作台。
历史勾选表示原迁移记录，不能替代当前环境验收。本次复核发现技能 API 引用已删除模块、Anthropic SDK 缺失，已修复。

### 本次完成
- [x] 将技能目录服务迁入 `src/agent/skills`，移除旧 Agent 文件系统依赖；全局目录只读内置技能，项目技能仍经项目权限校验后从快照读取。
- [x] 恢复模型协议层仍需要的 `@anthropic-ai/sdk`。
- [x] 让 `hideHeader` 真正生效，工作台只保留一套会话导航。
- [x] 聊天正文和输入区居中限宽，白色主工作区；空态面向通用工作任务。
- [x] 工作成果面板独立成组件，支持关闭、文件选择和文本文件下载。
- [x] 从项目 API 恢复已有文件，按项目隔离文件状态，避免切换项目显示其他项目内容。
- [x] 小屏侧栏覆盖显示、选择后关闭；成果面板在小屏全宽显示；顶部允许换行。
- [x] 搜索展示所有匹配会话；无匹配时显示准确提示。
- [x] 跨项目新建会话移除 80ms 固定定时器，通过初始化后的信号处理。

### 尚未完成 / 待验收
- [ ] 登录后的桌面和移动端实际交互验收，包括切换、新建、删除、刷新、下载。
- [ ] 真实模型 + 远端 VM/MCP 的完整任务验收：计划、工具执行、提问、停止、继续、成果持久化。
- [ ] 对照 ChatGPT 网页工作模式验收交互和视觉一致性。

### 已实现
- 成果面板支持 Word、PDF、Excel、图片和 Markdown 预览。Excel 可切换工作表，每张表预览前 200 行。下载读取原始字节。
- 新消息保存成果路径和版本。正文链接、工具记录和成果按钮可打开对应版本，旧消息无版本时使用当前项目文件。
- 工作过程可展开查看计划和工具调用。头像设置包含账号、密码、模型配置和用量统计。

### 验证
- `bun install` 恢复本地依赖。
- `bun run typecheck` 通过。
- `bun test src/agent src/features/chat/utils` 通过（32 项）。
- `bun run build` 成功退出。
- 隔离环境使用 MongoDB、S3 兼容存储和临时账号，验证登录、成果读写和版本读取。
- 浏览器验证头像设置中的模型与用量分区、Word 正文、Excel 工作表切换、PNG、CSV 和 Markdown。Excel 下载与原始工作簿逐字节一致。
- 本地模型替身执行 Hermes Write 工具并保存成果，浏览器从历史对话展开工作过程并打开回复版本。
- 在 390px 窗口确认成果覆盖层不会被聊天遮挡。1280px 窗口已查看新版居中的空态构图。
- 浏览器发送 PNG 附件后，本地模型替身完成工具调用并显示成果。测试桶允许验收页跨域上传，预签名 PUT 不再绑定空文件校验值。上传附件保留在消息中，不计入成果列表。
- 生产构建通过 HTTP 调用本机独立沙盒进程，命令生成的报告随快照回传并保存版本。项目所有者读回的内容与原文件一致，其他测试账号收到 403。

## 2026-11-17 核心模块重构与连接器验收

当前模块边界、扩展方式和运行命令以 [agent-architecture.md](./agent-architecture.md) 为准。

### 完成项
- 工具声明与 builtin 清单分离，删除导入副作用和全局注册表。
- 插件 manifest、显式启停、环境要求、逐请求隔离、资源清理，以及 tools/skills/prompts 贡献入口。
- 技能统一 YAML 解析，项目覆盖、插件命名空间及正文按需加载；二进制内置资源保持原始字节。
- 提示词根据可用能力构成；gateway 负责模型配置、资源生命周期、成果导出和 Web 交互适配。
- MCP 分页、完整 schema、取消信号和失败连接回收。
- 删除未使用的旧提示词/记忆实现、历史补丁目录、module-alias 依赖与失效 query_engine 入口。
- 修复系统模型连接遗漏、模块循环依赖、SSE 错误静默丢失。
- 连接器共享文件导出，只回传本轮修改；内置技能挂载；认证、协议、路径校验及显式命令取消。

### 当前验证
- `bun run typecheck`：通过。
- 连接器独立严格 TypeScript 检查：通过。
- `bun run lint`：无警告、无错误。
- `bun test src/agent src/server/skills src/features/chat/utils src/shared/network/streamFetch.test.ts`：48 项通过。
- `bun run build`：生产构建成功。
- `bun run connector:build`：独立可执行文件构建成功。

### 真实网页与本机连接器验收

使用隔离测试数据库、对象存储和目录：MongoDB 27028、S3 19028、Next.js（Node 24）3100、编译后的连接器 18787。

1. 网页连接器认证和连通性成功。
2. MiniMax-M2.7 经真实 Anthropic 协议执行 Write/Read/Bash；`connector-check.txt` 内容为 `Hermes connector verification`，命令退出码 0，网页回复版本预览与本机文件一致。
3. Skill 工具列出 7 个内置技能并按需加载 pdf-text-extractor；只用 Bash 生成 `shell-artifact.txt`，网页工作成果成功回传并预览 `Generated by connector shell`。
4. 网页启动 `sleep 30` 的命令后点击停止；超过 30 秒后确认后续文件未生成，验证后台进程确已终止。

测试资源和截图位于忽略目录 `.aistudio/verification/`，未纳入代码提交：
- `connector-browser-proof.jpg`
- `skills-shell-browser-proof.jpg`
- `tests.log`、`build.log`、`lint.log`

本次未调用真实远端 VM；该路径保留原有快照与沙盒回归覆盖。以上验收针对用户指定的本机连接器与 Next.js 网页。

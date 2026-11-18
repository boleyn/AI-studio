# Bore Agent（伯仁）核心架构

本项目采用 Hermes 的工具注册、插件贡献、技能渐进加载和 gateway 编排思路，以 TypeScript 实现，运行于 Next.js Node 服务端。不是 Python Hermes 插件的二进制兼容层。

参考：
- [Hermes 工具注册中心](https://github.com/NousResearch/hermes-agent/blob/main/tools/registry.py)
- [Hermes 插件系统](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/plugins.md)

## 模块边界

```text
Next.js API → gateway/session → app/agentLoop
                    │               │
                    ├─ plugins ── tools/registry ← tools/builtin
                    ├─ prompts      │
                    ├─ skills       └─ sandbox
                    ├─ memory
                    └─ mcp
```

- `app/`：ReAct、上下文预算、压缩、历史转换、模型适配。主循环接收 registry、sandbox、skills、事件回调和交互 transport，不访问 Next.js request/response 或 Web activeRuns。
- `gateway/`：解析模型连接、建立沙盒与插件、冻结提示词上下文、执行主循环、导出成果、最终释放资源；Web 审批与取消在这里适配。
- `tools/`：定义、注册、能力过滤与 dispatch。`builtin/` 显式导出工具，`builtins.ts` 为静态清单。导入模块不注册到全局单例。
- `plugins/`：manifest、配置、逐请求激活和逆序清理。内置 toolset 与 MCP 都通过插件贡献能力。
- `skills/`：统一 YAML frontmatter、内置目录/项目快照/沙盒目录发现、按需正文加载。插件技能使用 `plugin-id:skill-name` 命名空间。
- `prompts/`：稳定系统指令与逐轮上下文分离。插件指令通过 Skill 按需披露；目录、记忆和附件追加到当前轮。
- `sandbox/`：local、remote-vm、connector 文件与执行抽象。共享文件导出保留二进制，过滤运行时目录，限制单文件/总字节/文件数量。
- `mcp/`：SDK 连接、分页工具发现、schema、取消信号和连接回收。

## 扩展一个能力

在受信任的服务端模块声明 `AgentPlugin`，加入 `plugins/builtins.ts` 的静态清单：

```ts
const plugin: AgentPlugin = {
  manifest: { id: "reports", version: "1.0.0", description: "Reports" },
  setup(ctx) {
    ctx.registerTool(reportTool);
    ctx.registerSkill({ name: "summary", content: skillMarkdown });
    ctx.registerPrompt(tools => tools.has("report") ? "Use report for reports." : undefined);
    ctx.onDispose(() => resource.close());
  },
};
```

`defaultEnabled` 未设置的扩展需要显式启用。项目上传文件不能成为 Node 可执行插件。静态清单让 Next.js 能追踪并打包所有代码依赖。当前 skill 贡献入口用于说明正文；需要脚本的内置技能通过 `skills/` 资源目录挂载。

```env
AGENT_PLUGINS={"enabled":["reports"],"disabled":["web"]}
AGENT_MCP_SERVERS=[{"name":"example","transport":"http","url":"http://127.0.0.1:9000/mcp"}]
```

禁用优先于启用；重复工具名（不区分大小写）、无效 manifest、未知插件 ID、缺失必要环境变量会显式报错。初始化失败会释放已获取的插件资源。每轮都有独立 registry，不影响其他项目或会话。

## 工具与提示词一致性

同一能力策略同时用于工具列表与 dispatch：plan 模式不执行写工具，子代理不继续委派，不可用工具不执行，已取消调用不进入 handler。Memory 支持 plan 中读取，但禁止修改。MCP 只有显式 readOnlyHint 才可在 plan 中调用。

技能按名称大小写归一匹配，项目 `/.aistudio/skills` 覆盖同名 `/skills`。API 与运行时共享 YAML 解析，支持多行描述和嵌套 metadata。技能全文由 Skill 工具加载。

## 连接器

```sh
bun run connector:build
AISTUDIO_CONNECTOR_ROOT=/absolute/path/to/workspace \
AISTUDIO_CONNECTOR_TOKEN=your-token \
.aistudio/bin/aistudio-connector
```

默认监听 `127.0.0.1:8787`；可通过 `AISTUDIO_CONNECTOR_HOST`、`AISTUDIO_CONNECTOR_PORT` 配置地址。网页工作台选择“本机目录连接器”，填写服务端可达的地址和 token，点击“测试连通性”。

连接器目录是实际本机目录。内置技能只补充不存在的资源，不覆盖已有文件。每轮记录挂载目录基线，回传本轮修改的可导出文件；既有文件不会因挂载而全部同步到项目。Write/Edit 的变更实时推送，Bash 生成的文件在回合结束时导出。协议版本、token 与路径边界在连接器验证。停止通过带请求 ID 的取消 RPC 终止命令进程组，不依赖 HTTP 断连推断。

## 验证

```sh
bun run typecheck
bun test src/agent src/server/skills src/features/chat/utils src/shared/network/streamFetch.test.ts
bun run build
bun run connector:build
```

测试覆盖：插件隔离/启停/失败清理、能力过滤、技能 YAML、真实 MCP HTTP 分页调用、审批恢复/取消、连接器读写/命令成果/认证/路径边界、二进制资源、SSE 错误传播及原有聊天与沙盒行为。

Next.js 构建配置仍跳过内置类型检查，必须独立执行 typecheck。服务使用 Node 运行；Bun 用于包管理、测试与连接器编译。

早期重构验收见 [迁移验收记录](./hermes-migration.md)。当前上下文改造及尚未完成的原生桌面验收见 [上下文工程记录](./context-engineering.md)，不能用旧截图替代当前版本验收。

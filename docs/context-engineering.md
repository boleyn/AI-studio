# 上下文工程实现与验收

## 设计依据

- [Codex agent loop](https://openai.com/index/unrolling-the-codex-agent-loop/)：固定前缀、追加环境变化、完整工具协议与边界压缩。
- [Hermes context compression and caching](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/developer-guide/context-compression-and-caching.md)：保护工具调用轮次、归档与技能恢复。
- [DeepSeek context caching](https://api-docs.deepseek.com/guides/kv_cache/)：以服务返回的缓存 token 衡量效果，而非承诺固定命中率。
- [DeepSeek thinking mode](https://api-docs.deepseek.com/guides/thinking_mode/)：工具调用历史中的 reasoning_content 原样保留。

不将 30%–40% 窗口占用或 95% 缓存命中视为跨模型保证。当前预算按配置的模型窗口扣除输出预算与安全空间；tokenizer 是保守估计，需要继续用服务端 usage 校准。

## 当前行为

1. 默认 wire tools 为可用的 Read、Bash、Skill、search_tools、call_dynamic_tool。其他工具完整 schema 以检索结果追加；底层 registry 使用相同权限策略并做 AJV 参数校验。
2. 检索采用精确名称、BM25、领域关键词扩展；尚无 embedding 服务或大规模召回率基准。
3. Skill 先暴露有限目录，正文与参考文件分别按需读取。插件 registerPrompt 转为命名空间 instruction skill，工具发现返回关联名称，不再将全部插件 SOP 注入系统提示词。
4. 超长工具输出落入私有 .aistudio/context 文件，再返回有界预览与恢复路径。命令输出流式写入，达到硬限额会停止生产者并明确说明部分输出。归档失败不把已执行的变更伪装成未执行，也不建议自动重试。
5. 普通轮次原样续接协议历史。只有达到预算边界才归档、生成有限摘要并移除完整工具轮次；最新请求与未消费结果受保护。归档是历史数据，不构成新授权。
6. 稳定系统指令与逐轮附件、记忆、目录分离。Mongo 检查点按会话保存完整 wire history；环境或模型改变时失效。会话指纹兼容网页把 assistant 工具轨迹转换成可见文本的保存方式，用户文本和附件改变仍会失效。
7. 后台子任务有独立模型历史与资源生命周期，状态原子落盘，主会话下轮注入未确认状态。取消和进程丢失有明确终态，丢失任务不会自动重跑。它是本进程 worker，不是分布式持久队列。
8. 两种连接器共享运行时资源安装和本轮文件差异导出。原生 POSIX 文件传输分块读取/写入，避免 stdout 上限损坏文件；遍历跳过符号链接。Bash command 使用工作目录相对路径，只有 cwd 与文件工具参数使用虚拟绝对路径。

## 验收证据（2026-11-18，本地工作区）

- Sol 和 Terra 均通过真实 API 的插件指令、Skill 参考文件、长报告中间标记恢复、Write 与跨轮回读测试。每个模型 11 次推理请求，报告只导出一次，wire tools 固定且续接前缀一致。
- 该合成用例聚合 cached/input：Sol 30592/41947（约 73%），Terra 19968/42631（约 47%）。这些数字仅说明本次调用，不是生产保证。
- 新编译的 HTTP 连接器通过真实进程测试：认证、版本校验、Skill 挂载、读写、只导出变化文件、500000+ 字节输出完整恢复、命令取消、目录边界。
- 原生 POSIX 适配器用真实 Bash 验证了 220000 字节二进制往返、特殊文件名、Skill 引用、符号链接跳过和差异导出。该测试不等同于桌面授权/网络链路验收。
- 网页 Terra 已完成 Skill → 参考文件 → 长输出归档 → 中间标记恢复 → 文件回传。执行计数文件只有一行。
- 网页后台子任务真实完成并创建 background-result.txt，下轮通知后由 Read 复核；完成事件只注入一次。
- 修复网页保存表示差异后，数据库证据确认相同 identity 的 10 条协议消息在下一轮 12 条历史中保持完整原样前缀。

可复查的本地证据位于忽略目录 .aistudio/verification：model-probes/*/verification.json、browser-replay-proof.json、context-browser-terra.jpg、context-browser-background.jpg。脚本仅使用合成数据，不包含模型 API key。

## 验收补充与限制

- 原生 macOS 测试 App 0.2.3 已编译安装，钥匙串、平台配对、本机目录确认和网页执行已通过。真实 Skill → 参考文件 → Read → 检索 Write → 写入 → 回读链路成功；sleep 65 后返回 NATIVE_LEASE_OK，连接器 SQLite 记录 completed / exitCode 0，跨越单次 50 秒租约。
- Windows PowerShell 文件适配未在本机验证；当前抽出的原生文件适配器明确为 POSIX。
- 尚无独立的按任务完成卸载状态机；已加载指令随历史保留直到预算压缩。
- 本轮新增：网页 Sol 的 Skill → 参考文件 → Read → search_tools → Write → Read 通过，未调用 Bash；本机报告执行次数仍为 1。
- Sol 和 Terra 都通过真实压缩恢复测试：约 54825 个估算输入 token 的历史，在 8192 窗口中归档压缩一次后找回原始标记。
- 全量指定回归 74 项通过，typecheck、lint、Go 全包测试通过；原生包 codesign 验证通过。桌面配对、目录授权与执行链路已通过。

原生执行租约按 50 秒签发，每 20 秒串行续期；执行结束或取消后停止续期，续期拒绝会取消当前执行，不重试命令。网页目录授权提供初始目录输入，本机仍做最终确认。

目录确认的网页响应等待为 130 秒，覆盖连接器的 120 秒本机确认期限，避免后半段确认结果丢失。

普通新项目不再隐式创建 React 模板或复制内置 Skills。显式模板仍可创建源码；输出 API 排除内部资源与未修改的模板文件，保留实际文件及修改后的源码。用户既有项目刷新后输出为空，新建项目 UI 与不传 files/template 的 API 均验证 fileCount/outputCount 为 0；切回验收项目仍保留真实成果。证据：outputs-clean-proof.jpg、new-project-empty-proof.jpg、new-project-api-proof.json、native-browser-proof.jpg、native-execution-proof.json。

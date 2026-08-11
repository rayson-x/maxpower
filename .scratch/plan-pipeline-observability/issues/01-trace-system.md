# 01 — Trace 系统：统一事件模型 + 双写 sink + 可靠性

**What to build:** agent 的每次行动（对话轮次、工具调用、策略决策、规划、输出过滤、后台任务、同步、错误）都产生一条结构化 trace 事件（traceId=runId、sessionId 关联、kind 闭集对齐 OpenInference、orderKey 嵌套排序、eventId 幂等）。事件经 TraceRecorder 扇出双写：本地 JSONL 文件（debug 开关控制、5MB 轮转保留 5 个）+ 可插拔远程 sink 适配器端口（GenericHTTP 先行，CloudWatch/SLS/OTLP-HTTP 为可配置备选）。离线时远程事件进账本内 outbox，恢复后补发且按 eventId 去重；启动时 reconcile 从账本投影幂等回填崩溃窗口丢失的事件；日志写失败只计数不阻断业务。新增独立 observability 授权项（默认关闭，remoteLlm 授权为前提）。用户可拿到错误短码（traceId 前 8 位 + sessionId 前 4 位）用于报错追踪。

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] TraceEnvelope 校验：缺 traceId/sessionId 拒绝；metadata 只允许 string/number/boolean；kind 为闭集
- [ ] 无 sink 时零成本 no-op；本地 sink 创建目录、按行写 JSONL、5MB 轮转、最多保留 5 个文件
- [ ] 远程 sink 为适配器端口，部署配置可切换（配置改=适配器改，代码不变）
- [ ] outbox 离线暂存、恢复补发、eventId 去重（at-least-once 不重）
- [ ] reconcile：崩溃窗口事件从账本投影幂等回填，重放不产生重复事件
- [ ] observability 授权默认关；关闭时远程事件不入 outbox
- [ ] 埋点接入：provider 请求/响应、工具调用、policy 决策、guardrail 拦截、recipe、sync、错误均产生事件
- [ ] 事件只含元数据与引用（无对话文本、无直接标识符，userPseudonym 假名）

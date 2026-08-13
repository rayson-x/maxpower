# 01 — Trace 系统：统一事件模型 + 双写 sink + 可靠性

**What to build:** agent 的每次行动（对话轮次、工具调用、策略决策、规划、输出过滤、后台任务、同步、错误）都产生一条结构化 trace 事件（traceId=runId、sessionId 关联、kind 闭集对齐 OpenInference、orderKey 嵌套排序、eventId 幂等）。事件经 TraceRecorder 扇出双写：本地 JSONL 文件（debug 开关控制、5MB 轮转保留 5 个）+ 可插拔远程 sink 适配器端口（GenericHTTP 先行，CloudWatch/SLS/OTLP-HTTP 为可配置备选）。离线时远程事件进账本内 outbox，恢复后补发且按 eventId 去重；启动时 reconcile 从账本投影幂等回填崩溃窗口丢失的事件；日志写失败只计数不阻断业务。新增独立 observability 授权项（默认关闭，remoteLlm 授权为前提）。用户可拿到错误短码（traceId 前 8 位 + sessionId 前 4 位）用于报错追踪。

**Blocked by:** None — can start immediately.

**Status:** done

- [x] TraceEnvelope 校验：缺 traceId/sessionId 拒绝；metadata 只允许 string/number/boolean；kind 为闭集
- [x] 无 sink 时零成本 no-op；本地 sink 创建目录、按行写 JSONL、5MB 轮转、最多保留 5 个文件
- [x] 远程 sink 为适配器端口，部署配置可切换（配置改=适配器改，代码不变）
- [x] outbox 离线暂存、恢复补发、eventId 去重（at-least-once 不重）
- [x] reconcile：崩溃窗口事件从账本投影幂等回填，重放不产生重复事件
- [x] observability 授权默认关；关闭时远程事件不入 outbox
- [x] 埋点接入：provider 请求/响应、工具调用、policy 决策、guardrail 拦截、recipe、sync、错误均产生事件
- [x] 事件只含元数据与引用（无对话文本、无直接标识符，userPseudonym 假名）

## Comments

已实现（`src/observability/`，测试 `tools/observability/`）：

- `model.ts`：TraceEnvelope（schemaVersion 2、kind 闭集、eventId=64 位内容哈希、dotted_order 式 orderKey、假名与 deviceId）、校验、`traceShortCode`。
- `TraceRecorder`：校验 + 扇出 + 失败计数 + 进程内同 eventId 去重；无 sink 时零成本返回。
- `LocalFileTraceSink` + `TraceFileSystem` 端口：JSONL、5MB 轮转、保留 5 个文件；附内存实现供测试与工具使用。
- `RemoteTraceSink`：`TraceTransport` 端口 + GenericHTTP / CloudWatchLogs / 阿里云 SLS / OTLP-HTTP 四个适配器，由 `TraceWriterConfig.remote` 选择；OTLP 映射把 sessionId 落到 `gen_ai.conversation.id`。
- `TraceOutbox`：账本内 `traceOutbox` 集合（LedgerSnapshot schema 6 → 7，SQLite 迁移 6 → 7）、授权门（`observability` 授权 + `remoteLlm` 前提，默认关时事件不入队）、`TraceOutboxDispatcher`（at-least-once、断网留队、4xx 与超次数放弃）。
- `traceProjection.ts`：已提交事实 → 事件的唯一映射（ToolAudit / CoachRun / ActionEvent / plan.revised / JobAttempt / 复制 outbox），domain 与 legacy AtomicCommit 两条落账通道都覆盖。
- `TracingCoachLedger`：唯一接线点——所有写入路径都经账本 commit，所以埋点不用穿进应用代码。
- `TraceReconciler` + `LedgerTraceEventIndex` / `LocalFileTraceEventIndex`：启动时从账本投影幂等回填崩溃窗口。
- 授权项：`PermissionSetData.observability`（可选字段，缺省即 not_configured = 关）、`DataScope` 增 `observability`、隐私设置读模型新增 observability 披露。
- 错误短码落到 `run-error` 事件的 `shortCode` 字段。

刻意未做（读取侧另立项）：日志查看器/分析工具。

# Agent 可观测性实施范式调研（2026-08）

> 调研日期：2026-08-11 · 方法：一手来源（官方 spec/文档，不用二手综述）
> 背景：MaxPower 已定方向——traceId=runId、sessionId 关联、统一事件模型、本地 JSONL + 可插拔云端 sink、元数据+假名不上文本、outbox 离线补发、账本投影可重建。本文对照业界范式验证与补缺。

## 1. OpenTelemetry GenAI 语义约定（最重要的一手标准）

来源：[semantic-conventions-genai 仓库](https://github.com/open-telemetry/semantic-conventions-genai)（已从 opentelemetry.io 主站迁至独立仓库，状态：Development）

**Span 分类**（[gen-ai-agent-spans.md](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai-agent-spans.md)、[gen-ai-spans.md](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai-spans.md)）：

| Span | 语义 |
|---|---|
| `create_agent` | 创建 agent（多为远程服务） |
| `invoke_agent`（client/internal） | 调用 agent，agent 是工具调用的决策者 |
| `invoke_workflow` | 确定性工作流（与自主 agent 区分） |
| `plan` | 规划步骤 |
| `execute_tool` | 单次工具执行 |
| `inference` / `embeddings` / `retrievals` / `fetch` / `memory` | 推理、嵌入、检索、抓取、记忆读写 |

**关键属性**：

- `gen_ai.operation.name`（Required）+ `gen_ai.provider.name`（Required）
- **`gen_ai.conversation.id`**：会话（session/thread）关联 id——官方语义就是"used to store and correlate messages within this conversation"（[属性说明](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai-spans.md)）。与我们 sessionId 语义完全同构。
- `error.type`（Stable）：错误分类（timeout/500 等）
- **内容捕获是显式分层的**（[Capturing instructions, inputs, and outputs](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai-spans.md)）：full buffered vs streaming chunks 两种模式——即"记不记内容、怎么记"是独立决策，与我们的"元数据默认、文本可选"一致。
- **`gen_ai.evaluation.result` 事件**（[gen-ai-events.md](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai-events.md)）：评价结果是一等事件——eval 分数可以挂到 trace 上，正好对应我们的 eval 套件（ticket 10）。

## 2. LangSmith 数据模型

来源：[LangSmith 文档](https://docs.langchain.com/langsmith)（原 docs.smith.langchain.com 已 308 迁移）

四层结构：**Run → Trace → Thread**，另有 Trajectory 投影视图：

- **Run**：最小工作单元（LLM 调用、工具执行、检索），即 span。带 run type（chain/llm/tool/retriever 等）与 `dotted_order`（层级内排序键，解决嵌套顺序）
- **Trace**：共享 trace_id 的 run 集合（一次完整交互）
- **Thread**：多 trace 的长会话（≈ 我们的 sessionId）

## 3. Langfuse 数据模型与部署形态

来源：[langfuse-docs/content/docs/observability/data-model.mdx](https://raw.githubusercontent.com/langfuse/langfuse-docs/main/content/docs/observability/data-model.mdx)

- 层级：**Observation（span/generation/event，可嵌套）→ Trace（一次完整请求）→ Session（多 trace 对话线程）**
- **存储设计值得注意**：概念上只有一张 observations 表，trace 级属性（user_id、session_id、tags、metadata）**反规范化复制到每行**——用存储换查询/聚合性能。对我们"按 traceId 快速检索"的诉求是直接佐证。
- **基于 OpenTelemetry**，不被私有 SDK 锁定（可同时发 Langfuse + Datadog）
- **后台批处理 + 必须显式 flush**：SDK 本地批量异步发送，短进程退出前不调 `flush()` 会丢缓冲区——与我们 reconcile 回填要解决的"崩溃窗口"是同一问题的业界标准答案。
- 自托管：docker compose / k8s 形态（本次未深入，[self-hosting 文档](https://github.com/langfuse/langfuse-docs/tree/main/content/self-hosting)）

## 4. OpenInference Span 分类

来源：[openinference/spec/traces.md](https://github.com/Arize-ai/openinference/blob/main/spec/traces.md)

- Span kind 闭集：**Chain / Retriever / Reranker / LLM / Embedding / Tool / Agent / Guardrail / Evaluator / Prompt**
- 与 OTel 的关系：OTLP 传输时 span kind 存 `openinference.span.kind` 属性（不与 OTel 原生 span kind 冲突）
- 属性值只允许 string/boolean/number 或其数组——与我们"metadata 只允许原始类型"的约束相同（可索引性）
- **Guardrail / Evaluator 是独立 span kind**——输出过滤器（ticket 09）和 eval（ticket 10）在业界范式里都有明确位置

## 5. OpenAI Agents SDK Tracing

来源：[openai-agents-python/tracing](https://openai.github.io/openai-agents-python/tracing/)

- Trace（一次端到端工作流，带 `workflow_name`/`trace_id`/`group_id`）+ Span（`started_at`/`ended_at`/`parent_id`/`span_data`）
- 自动 span 类型：agent / turn / generation(LLM) / function(tool) / guardrail / handoff / 音频类；`group_id` 关联同组 trace（≈ 会话层）
- **Processor/Exporter 可插拔**：`add_trace_processor()` 追加、`set_trace_processors()` 替换——与我们 ObservabilitySink 适配器端口同构
- **BatchTraceProcessor**：后台批量导出 + 退出前 flush；敏感数据默认收集、可用环境变量关闭——再次印证"批处理+flush"与"内容可选"两个模式

## 6. 云端检索能力（未本次核验，标记待复核）

- CloudWatch Logs Insights 支持 JSON 字段自动发现与 `fields/filter/stats` 查询——结构化事件可按 `trace_id`、`decision_codes` 秒级检索
- 阿里云 SLS 支持 JSON 字段索引与 SQL 分析
- 两者都能满足"按字段快速检索 trace"，**待实际接入时验证字段索引配置**。

## 7. 对 MaxPower 设计的对照与建议

### 已对齐（范式确认）

| 我们的设计 | 业界对应 |
|---|---|
| traceId=runId + sessionId 分层 | Langfuse Trace/Session、LangSmith Trace/Thread、OTel `gen_ai.conversation.id`、OpenAI `group_id`——**四层模型是行业标准** |
| 统一事件模型 + 可插拔 sink | OpenAI processor/exporter、OTel OTLP、Langfuse 多目的地 |
| 元数据默认、文本可选 | OTel 内容捕获分层、OpenAI 敏感数据开关 |
| 原始类型 metadata | OpenInference 属性值约束（可索引） |
| 崩溃窗口 reconcile + outbox | Langfuse/OpenAI 的 batch+flush 语义；我们的 reconcile 更强（账本投影可完全重建，业界 flush 丢了就是丢了） |

### 值得抄的

1. **Span kind 分类法**（OpenInference 闭集）：我们的事件 kind 应对齐——`agent / turn / llm / tool / guardrail(输出过滤) / evaluator(eval) / plan(planner) / recipe / sync`，其中 **guardrail 和 evaluator 独立成类**，比混在 policy_decision 里更符合检索习惯。
2. **dotted_order**（LangSmith）：嵌套 trace 的排序键，reconcile 回填后乱序事件的稳定排序方案，比单比 occurredAt 可靠。
3. **trace 级属性反规范化**（Langfuse）：每条事件带上 sessionId/userId 假名/tags，本地 JSONL 与云端都按单表设计，检索不需要 join。
4. **eval 结果挂 trace**（OTel `gen_ai.evaluation.result`）：ticket 10 的 eval 结果应以标准事件形式进 trace 流。
5. **batch + flush 纪律**：云端 sink 批量发送；app 退到后台前 flush 一次（复用 catchUp 周期）。

### 不建议现在抄的

- OTLP 全协议接入：我们的本地优先 + 无文本约束下，OTLP 的完整 span 生命周期管理是过剩工程；保持 JSONL + 自有 envelope，**字段命名对齐 OTel GenAI**（`gen_ai.conversation.id` 等）即可，将来要接 Tempo/OTel collector 时写个映射层。

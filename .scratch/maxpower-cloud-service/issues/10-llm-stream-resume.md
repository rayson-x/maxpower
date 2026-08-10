# 10 — 支持 LLM SSE、Tool Call 与五分钟恢复

**What to build:** 让现有客户端 Agent 通过 OpenAI-compatible SSE 获取文本和工具调用，并能在短暂断线后继续原 invocation。

**Blocked by:** 09 — 交付非流式 LLM Gateway

**Status:** completed

- [x] SSE 文本、streamed tool_calls 与 `[DONE]` 兼容现有 adapter。
- [x] 五分钟 volatile buffer 支持 owner-only Last-Event-ID 恢复。
- [x] 相同幂等请求复用，内容不同返回 idempotency conflict。
- [x] buffer 禁止持久化；过期返回 stream_expired 且不重复计费。
- [x] 短暂断网只断开消费端并保留原 invocation；已认证的显式取消才跨节点中止 Provider，并按保守 usage/cost 结算。

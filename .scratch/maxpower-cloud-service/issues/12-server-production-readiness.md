# 12 — 完成服务端安全、观测与部署验收

**What to build:** 提供一个能在 staging/production 配置下安全启动、迁移、观测和回滚的服务端发行物。

**Blocked by:** 03 — 接入 Google、Apple 与显式身份链接；06 — 保存 WorkoutSession 与结构化结果；07 — 交付可选私有媒体资料库；10 — 支持 LLM SSE、Tool Call 与五分钟恢复；11 — 编排账号与媒体删除

**Status:** completed

- [x] 容器、迁移、健康/就绪检查和环境配置可由 CI 验证。
- [x] HTTPS 边界、Secret、CORS、rate limit 和请求大小限制明确。
- [x] 日志/APM/error reporting 不采集凭据或 LLM 内容。
- [x] production 禁止内存 Adapter、debug OTP 与持久化 stream buffer。

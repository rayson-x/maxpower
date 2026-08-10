# 15 — 客户端统一切换云端 LLM

**What to build:** 让所有 Coach 与营养视觉请求都自动使用 MaxPower Gateway，客户端不再包含 Provider 配置或秘密。

**Blocked by:** 13 — 客户端强制在线登录与账号命名空间

**Status:** completed

- [x] Coach 与营养 observation 使用 service JWT 和固定产品 alias。
- [x] 现有 SSE/tool loop 继续工作，旧流在账号切换时中止。
- [x] 删除 endpoint/model/API key 配置 UI、持久化与 bootstrap。
- [x] bundle、SQLite、SecureStore 与日志扫描不到 Provider key。
- [x] Coach 与营养请求主动中止时用原幂等键通知 Gateway；普通网络断流不误发取消并继续使用五分钟恢复。

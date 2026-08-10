# 13 — 客户端强制在线登录与账号命名空间

**What to build:** 让客户端只有在联网并恢复有效登录后才加载产品运行时，并在账号切换时彻底隔离本机状态。

**Blocked by:** 12 — 完成服务端安全、观测与部署验收

**Status:** completed

- [x] 未登录或无网络时不进入产品运行时。
- [x] session 使用 SecureStore，service JWT 仅保存在内存。
- [x] accountId 替换固定本地用户并隔离 SQLite、UI state 与后台任务。
- [x] 切换/退出时停止旧流、清理缓存并重建运行时。

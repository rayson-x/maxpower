# 11 — 编排账号与媒体删除

**What to build:** 让用户删除账号后立即停止服务，并可靠清理身份、规范数据、媒体原件和全部派生物。

**Blocked by:** 03 — 接入 Google、Apple 与显式身份链接；06 — 保存 WorkoutSession 与结构化结果；07 — 交付可选私有媒体资料库；08 — 建立额度账本与后台 Grant

**Status:** completed

- [x] 删除请求立即撤销 session、禁止写入并停止 LLM。
- [x] deletion job 可重试、可审计且不会遗留孤儿对象。
- [x] 业务数据、媒体与 identity 按安全顺序清理。
- [x] 重复删除请求幂等，并能查询删除进度。

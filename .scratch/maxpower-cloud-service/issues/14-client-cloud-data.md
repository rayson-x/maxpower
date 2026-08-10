# 14 — 客户端接入云端规范数据

**What to build:** 让客户端通过云 API 读取和保存 Profile、Plan、WorkoutSession 与 Result，同时把本地数据库降为账号级缓存。

**Blocked by:** 13 — 客户端强制在线登录与账号命名空间

**Status:** completed

- [x] 启动时从云端重建规范 projection。
- [x] 已确认业务资源通过幂等、revision-aware API 保存。
- [x] Coach 对话和 Agent run 保持本地且不会上传。
- [x] 网络或 revision 冲突得到可恢复的用户状态，不伪造成功。

**Verified:** cloud bootstrap first commits the account cache, then `CloudCanonicalLedgerHydrator` rebuilds the cloud-owned Profile/Goal/Plan/Workout/Result slice through a staging Ledger CAS before `CoachApplication` is constructed. Onboarding itself now stays in a private staging Ledger until the versioned Profile recovery envelope receives a cloud ACK, then advances the account Ledger with one CAS. New-device behavior covers profile-only accounts, current and historical/deleted plan versions, completed Progress, set outcomes, and standalone structured results such as motion analysis. Cloud replacement removes stale profile sub-aggregates but deliberately excludes device permissions, local conversations and device-only Timeline data.

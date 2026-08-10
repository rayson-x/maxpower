# 05 — 保存计划与不可变版本

**What to build:** 让用户创建、修改、发布和删除云端计划，同时保留可解释的不可变版本历史。

**Blocked by:** 04 — 建立云端权威用户档案

**Status:** completed

- [x] Plan 与 PlanVersion 生产 Adapter 通过同一 conformance tests。
- [x] 修改 snapshot 创建新版本而不改写旧版本。
- [x] 发布操作明确选择当前版本并具备幂等和 revision 保护。
- [x] 删除计划不会破坏历史训练引用的冻结快照。

**Verified:** PostgreSQL 17 immutable-version and cursor-pagination integration tests pass.

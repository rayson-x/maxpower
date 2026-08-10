# 04 — 建立云端权威用户档案

**What to build:** 让登录用户可以在云端创建、读取和修改自己的规范档案，并安全处理重试和并发修改。

**Blocked by:** 02 — 贯通手机号与邮箱认证

**Status:** completed

- [x] Postgres schema、迁移与 Profile Adapter 可在事务中运行。
- [x] GET/PATCH 只使用 token account identity。
- [x] Idempotency-Key 重放安全，过期 If-Match 返回 revision conflict。
- [x] 两个账号不能读取或修改彼此档案。

**Verified:** PostgreSQL 17 migration replay and production Adapter integration tests pass.

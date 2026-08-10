# 08 — 建立额度账本与后台 Grant

**What to build:** 让运营方发放免费月度或人工额度，并在并发请求下可靠预留、结算和释放消费。

**Blocked by:** 02 — 贯通手机号与邮箱认证

**Status:** completed

- [x] Postgres append-only entitlement ledger 使用整数 credits。
- [x] grant、reserve、settle、release 在真实事务中保持原子性。
- [x] 同一 invocation 不会重复扣费，并发不能透支。
- [x] 用户只获得可用/已耗尽状态，不获得内部成本明细。

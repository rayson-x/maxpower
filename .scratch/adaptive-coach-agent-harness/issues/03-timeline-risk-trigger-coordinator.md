# 03 — TimelineChanged 风险触发与定时检查

**What to build:** 对话、手动记录、训练结果、更正和同步统一形成 Timeline fact；每个有意义变化进入同一风险协调器，定时任务只检查最新快照而不伪造事实。

**Blocked by:** 01 — 扩展可回放的行为决策审计.

**Status:** wontfix

- [ ] 同一事件通过对话和手动记录得到等价的有效 Timeline 事实与触发结果；更正保留原始 provenance。
- [ ] 协调器对 material、coalesced、skipped、stale、failed 做幂等审计，且只对事实变化做风险工作。
- [ ] 可控时钟的定时检查能发现需要复核的最新快照，同时不会把未记录写成失败事实。

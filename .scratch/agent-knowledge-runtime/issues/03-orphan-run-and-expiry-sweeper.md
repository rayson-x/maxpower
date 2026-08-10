# 03 — 孤儿 run 清扫与统一过期清扫器

**What to build:** app 启动加载账本时，把崩溃遗留的非终态 run（streaming/resuming）终态化为 terminated（terminalCode process_lost），UI 显示"上次对话已中断"且可开新对话；清扫幂等、落 action log。在既有 catchUp 周期加统一过期清扫：过期 pending human action 标记 expired、过期 apply/reject/undo/resume token 销毁、expiresAt 到期的 working memory 走 forget 流程，全部幂等并落 action log。

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [x] 崩溃注入测试：streaming 中途杀进程 → 重启后 run 为 terminated(process_lost)，会话可继续
- [x] 清扫幂等测试：重复加载/重复 catchUp 不产生重复记录
- [x] 过期 pending action/token/memory 分别被正确清扫且 action log 留痕
- [x] 未过期项不受影响的回归测试

## Comments

- 2026-08-10 完成：`src/coach/stateSweep.ts` 纯函数 + facade `sweepExpiredCoachState`（catchUpRecipes 触发）；ActionTokenRecord 新增 `revokedAt`；DomainAtomicCommit 新增 `updateActionTokens` 受控更新通道。测试 `tools/coach-runtime/coachStateSweep.test.ts` 7 例全绿，全量 645 通过。

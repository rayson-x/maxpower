# 15 — 每日检查发现长期沉默、瓶颈和恶化趋势

**What to build:** 每日定时复核在没有当天新 Record 时也能观察长期无记录、确认未执行、连续失败、身体趋势、期限瓶颈、恢复和安全。没有新 material Signal 时保持安静；相同状态只有在恶化、新原因、新期限窗口或 cooldown 允许时再次送达。

**Blocked by:** 14 — Timeline 变化在正确渠道触发一次复核.

**Status:** completed

## Existing foundation and required change

- 保留现有 best-effort background wake、幂等任务和通知基础中符合业务的部分。
- 新定时入口必须调用 14 使用的同一 Goal Path review 和 delivery contract，不创建第二个 scheduler evaluator。
- 删除只结算既有 Timeline risk queue、每天无变化即不检查和重复状态反复调用 LLM 的路径。

## Acceptance criteria

- [x] 每日复核在没有当天新 Record 时仍可发现持续 tracking silence、confirmed non-execution、恶化趋势和期限瓶颈。
- [x] tracking silence 不制造未执行 Record，也不进入执行失败分母。
- [x] record-first 用户没有计划观察合同，不因普通未记录收到计划执行提醒。
- [x] 营养记录不足只形成 coverage/tracking 问题，不通过食物推断补齐或判定超额摄入。
- [x] 没有新 material Signal 时不调用 LLM、不创建通知。
- [x] 稳定状态受 cooldown 抑制，只有恶化、新原因或期限窗口变化时重新送达。
- [x] hard safety、review recommended 和 monitor 使用不同 authority 与 delivery 行为。
- [x] 同一 snapshot/version pins 经 Timeline trigger 和 scheduled trigger 得到相同固定判断。
- [x] 定时失败可幂等重试，不重复 Artifact、通知或计划写入。
- [x] 默认客户端覆盖沉默、长期明确未执行、趋势恶化、期限瓶颈、suppression 和无 Signal。
- [x] 删除重复 Scheduler、旧 pending-risk-only background flow 和独立通知状态。


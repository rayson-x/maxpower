# 07 — 用户协商目标期限、代价与 Coach 权限

**What to build:** 用户通过文本 Agent 表达目标后，系统根据期望结果、期限、饮食改变、训练时间、记录负担和健康护栏展示多条真实路径。用户确认后形成 Goal contract，并选择询问、允许一次、允许类似小调整或拒绝等持久 Coach 授权；没有目标的用户继续 record-first。

**Blocked by:** 04 — 无目标用户完成建档后进入记录首页.

**Status:** completed

## Existing foundation and required change

- 保留现有 Goal contract revision、Coaching mandate、权限、确认、stale 和审计中符合领域所有权的结构。
- 直接重写建档目标必填、默认期限、直接进入首次规划、固定模式选择和各入口自行解释权限的流程。
- 目标路径只读取已确认 Profile、Timeline 和 Daily Health Ledger；未知摄入不能通过食物查询或估算补齐。

## Acceptance criteria

- [x] Agent 对明确目标展示渐进、平衡和较快等真实候选路径，并说明期限、行为负担、训练负担、记录要求、护栏和不确定性。
- [x] 证据不足时明确展示需要补充的信息或更宽的不确定性，不调用食物库、模型营养估算或多模态输入。
- [x] 无健康可达路径时展示目标、期限和代价冲突，不生成更极端方案。
- [x] Goal outcome、deadline、测量协议和硬护栏只有用户重新确认后才能变化。
- [x] 用户可选择本次询问、始终询问、允许一次、允许类似小调整或拒绝，并可随时修改。
- [x] 安全、极端限制、伤病、临床边界和高影响变化不能被 managed 权限越过。
- [x] 没有目标的用户继续 record-first；打开 Coach 或完成 Dossier 不会创建 Goal。
- [x] 目标确认与计划确认是两个独立动作；目标确认失败不产生 Plan。
- [x] 全屏初始化和正常 Coach drawer 使用同一 Goal/mandate command，卡片留在同一 thread。
- [x] 默认客户端覆盖明确、模糊、无目标、不可达、授权变化、stale 和重启恢复；删除旧目标分流与权限旁路。


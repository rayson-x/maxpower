# 12 — 增肌与塑形用户获得目标专用路径判断

**What to build:** 增肌和塑形用户通过与减脂相同的 Goal Path 入口获得目标专用判断。增肌综合已确认能量盈余、目标肌群训练剂量、表现、围度和恢复；塑形使用 Goal contract 中确认的围度、比例、表现和主观满意度。体重变化不能独立证明肌肉增长或审美结果。

**Blocked by:** 11 — 减脂用户获得当前计划路径判断.

**Status:** completed

## Existing foundation and required change

- 迁移现有 isolated hypertrophy、physique 和 comparable-measurement 规则中符合目标语义的部分。
- 将目标专用策略隐藏到 11 的唯一 Goal Path Module 内；删除旧 goal-specific snapshot、source、adapter 和 decorator 公共结构。
- 不支持的目标必须明确失败或请求定义，禁止回退为减脂判断。

## Acceptance criteria

- [x] 同一饮食、缺训、体重和恢复事件在减脂、增肌与塑形目标下产生目标专用判断。
- [x] 增肌不能用体重上涨替代确认的能量摄入、目标肌群剂量、表现、围度和恢复证据。
- [x] 塑形只使用 Goal contract 中确认的非图片代理与测量协议，不依赖图片理解或承诺不可测量结果。
- [x] 缺少可比测量时返回最小高价值证据请求，不从一次 BIA、食物名称或模型推断结果。
- [x] 不支持的 Goal type 不调用 fat-loss 逻辑，也不伪装为用户证据不足。
- [x] CoachApplication、Hook、Scheduler 和 UI 不选择目标模式实现。
- [x] 三种目标共享同一 Ledger、执行证据、版本钉、reason code 和客户端卡片合同。
- [x] 11 的全部减脂场景继续通过默认组合。
- [x] 删除旧 goal-specific 公开入口、snapshot assembler、decorator 和相应孤立完成声明。


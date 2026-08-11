# 05 — 实测休息与个人节奏校准

**What to build:** 训练执行时，组间与动作切换给出休息目标区间（主项/辅助/转场分级，来自计划与规则包）；用 canonical packet 的 rep 识别时间戳实测实际休息（上一组最后一次识别完成到下一组第一次识别开始）；偏离时提醒——休息过长提醒继续、过短建议延长，提醒不强制、不锁屏。实测休息数据沉淀为个人节奏校准值（个人知识层 observed_calibration），后续计划的预计时长按该用户真实节奏估算，不再只用通用组成本。

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [x] 每组结束后按动作疲劳度给出休息目标区间提示
- [x] 组间间隔由识别时间戳实测（fixture 时间戳可确定性测试），与实际值一致
- [x] 休息过长触发一次继续提醒（不重复轰炸）；过短给出延长建议；均不阻断训练
- [x] 实测休息沉淀为 observed_calibration 条目（带证据窗与来源事实）
- [x] 有新计划时预计时长引用个人节奏校准值（无则回退通用估算）

## Comments

- 2026-08-11 完成：SetOutcomeData 新增 recordedAt/measuredRestSeconds/restDeviation（<0.5×目标=过短、>1.5×=过长，产品规则）；confirmCurrentSet 用休息计时器单调钟实测，无计时器不测（不编造）；completeWorkoutSession 把实测休息中位数沉淀为 personalKnowledge 的 observed_calibration（rest_tempo_seconds，带证据窗与来源组）；planner 新增 personalRestTempoSeconds——休息建议在安全带宽内（主项≥60s、辅助≥45s、上限 240s）按个人节奏个性化，facade 接线。引擎不直接 import personalLayer（测试守护）。测试 5 例，全量 754 绿。

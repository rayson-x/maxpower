# 13 — 用户知道问题来自记录、执行、时间、测量、恢复还是计划

**What to build:** 当进展变慢时，用户获得原因边界清晰的诊断：记录不足、确认未执行、计划摩擦过高、观察时间不足、测量不可比、恢复受限，或在高质量执行和充分观察后仍缺少预期响应。诊断说明下一次需要观察什么，不能把未知伪装成确定原因。

**Blocked by:** 12 — 增肌与塑形用户获得目标专用路径判断.

**Status:** completed

## Existing foundation and required change

- 迁移现有 isolated execution-continuity、stagnation、recovery 和 measurement-comparability 规则中符合业务的部分。
- 正式诊断只使用 10 的观察合同与 performed evidence、11–12 的 Goal Path 结果和同一 Daily Health Ledger，不重新聚合事实。
- 删除手工 snapshot、独立 decorator、nutrition identity inference 和不完整事实输入路径。

## Acceptance criteria

- [x] tracking silence、未知执行和明确未执行保持不同状态。
- [x] 低完成度先识别计划摩擦、时间、偏好和执行环境，不自动加严计划。
- [x] 高覆盖但观察窗口未结束时继续观察，不判计划无效。
- [x] 测量协议不可比时请求修正测量，不让噪声触发重规划。
- [x] 体重平稳但围度、表现或其他约定代理改善时不判平台。
- [x] 只有覆盖充分、关键执行达标、观察期满足且测量可比时，才能进入 plan-response review。
- [x] 营养覆盖只能来自 confirmed numeric Ledger；缺值返回 insufficient evidence，不能 lookup 或 fallback。
- [x] 恢复或表现下降优先产生降负担、安全复核或 backoff，不增加训练或进一步限制饮食。
- [x] 每个结果包含下一验证信号、复核窗口、证据质量和稳定 reason code。
- [x] LLM 可以解释或选择继续观察，但不能把 insufficient evidence 改写成事实原因。
- [x] 默认客户端覆盖 tracking silence、confirmed non-execution、too early、measurement issue、recovery limitation 和 response review。
- [x] 删除旧 continuity/stagnation 公开 snapshot、decorator、独立聚合路径和被替代测试。


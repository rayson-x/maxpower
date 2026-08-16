# 08 — 危险行为或健康边界触发不可覆盖的安全处置

**What to build:** 当已确认 Record、用户当前文本陈述或计划候选涉及明显伤病风险、极端摄入控制、过度训练或通用产品不能处理的临床边界时，固定规则产生 safety hold。用户获得清晰的非诊断说明和适当求助建议，Agent 不能继续加码或覆盖结果。

**Blocked by:** 04 — 无目标用户完成建档后进入记录首页.

**Status:** completed

## Existing foundation and required change

- 保留现有 Safety constraints、Policy/HITL、typed tool gate 和审计结构中符合硬护栏所有权的部分。
- 收敛分散在记录、规划和调整入口中的安全判断为同一正式结果与客户端呈现；删除 LLM 文案或 managed mandate 可以绕过的路径。
- V1 只处理文本和结构化事实，不引入图片、视频、Realtime Agent 或医学识别能力。

## Acceptance criteria

- [x] 已确认的极端限制摄入、明显恢复恶化、过度训练或伤病风险产生稳定的 hold/review reason code。
- [x] 疾病、药物、孕期或其他特殊临床状态进入明确的专业边界提示，不生成通用营养或训练计划。
- [x] safety hold 不删除用户 Record，但阻止自动加码、候选提交和不适当的普通计划建议。
- [x] LLM 只能解释固定结果、询问必要事实和使用批准的非诊断措辞，不能降低严重度或自行解除。
- [x] Coaching mandate、allow similar 和 managed 模式均不能覆盖硬护栏。
- [x] unknown 不能伪装成安全或危险；证据不足时请求最小必要确认。
- [x] record-first、目标协商、首次计划和后续调整使用同一安全结果与审计合同。
- [x] 手动与文本 Agent 输入的等价事实产生等价安全判断，送达渠道可以不同。
- [x] 默认客户端覆盖 safety hold、clinical boundary、insufficient evidence、stale 和安全输入修正。
- [x] 删除各入口独立 safety fallback、纯 prompt 安全判断和可绕过提交路径。

